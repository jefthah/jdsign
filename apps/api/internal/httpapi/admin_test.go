package httpapi_test

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base32"
	"encoding/base64"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/jefthah/jdsign/apps/api/internal/admin"
	"github.com/jefthah/jdsign/apps/api/internal/encryption"
	"github.com/jefthah/jdsign/apps/api/internal/httpapi"
	"github.com/jefthah/jdsign/apps/api/internal/totp"
)

const adminEmail = "pengelola@jd-sign.com"

func TestOnlyAdminsCanOpenTheAdminArea(t *testing.T) {
	app := newAdminApp(t)
	app.exec(t, "INSERT INTO users (email, name, email_verified_at) VALUES ('pembeli@example.com', 'Pembeli', now())")
	buyer := app.sessionFor(t, "pembeli@example.com")

	assertError(t, app.do(t, http.MethodGet, "/api/v1/admin/overview", nil, nil), http.StatusUnauthorized, "unauthenticated")
	assertError(t, app.do(t, http.MethodGet, "/api/v1/admin/overview", nil, buyer), http.StatusForbidden, "admin_only")
	assertError(t, app.do(t, http.MethodGet, "/api/v1/admin/mfa/setup", nil, buyer), http.StatusForbidden, "admin_only")
	assertError(t, app.do(t, http.MethodPost, "/api/v1/admin/mfa/verify", map[string]string{"code": "123456"}, buyer), http.StatusForbidden, "admin_only")
}

func TestAdminSetsUpAuthenticatorBeforeOpeningTheAdminArea(t *testing.T) {
	app := newAdminApp(t)
	session := app.adminSession(t)

	assertError(t, app.do(t, http.MethodGet, "/api/v1/admin/overview", nil, session), http.StatusForbidden, "mfa_setup_required")

	setup := app.mfaSetup(t, session)
	if !strings.HasPrefix(setup.OtpauthUri, "otpauth://totp/JD%20Sign:"+adminEmail+"?secret="+setup.Secret+"&issuer=JD%20Sign") {
		t.Fatalf("otpauthUri = %q", setup.OtpauthUri)
	}
	if again := app.mfaSetup(t, session); again.Secret != setup.Secret {
		t.Fatal("reloading the setup page replaced a secret that may already be scanned")
	}
	var stored []byte
	if err := app.pool.QueryRow(context.Background(), "SELECT totp_secret FROM users WHERE email = $1", adminEmail).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(stored, decodeSecret(t, setup.Secret)) {
		t.Fatal("the TOTP secret is stored in plaintext")
	}

	secret := decodeSecret(t, setup.Secret)
	current := totp.Step(time.Now())
	wrong := app.do(t, http.MethodPost, "/api/v1/admin/mfa/setup", map[string]string{"code": wrongCode(totp.Code(secret, current))}, session)
	if body := assertError(t, wrong, http.StatusUnprocessableEntity, "invalid_code"); body.Error.Message != "Kode authenticator salah." {
		t.Fatalf("wrong code message = %q", body.Error.Message)
	}

	confirm := app.do(t, http.MethodPost, "/api/v1/admin/mfa/setup", map[string]string{"code": totp.Code(secret, current)}, session)
	assertStatus(t, confirm, http.StatusNoContent)

	overview := app.do(t, http.MethodGet, "/api/v1/admin/overview", nil, session)
	assertStatus(t, overview, http.StatusOK)
	var counts httpapi.AdminOverview
	decode(t, overview, &counts)
	if counts != (httpapi.AdminOverview{}) {
		t.Fatalf("overview of an empty marketplace = %+v, want zeros", counts)
	}

	assertError(t, app.do(t, http.MethodGet, "/api/v1/admin/mfa/setup", nil, session), http.StatusConflict, "mfa_already_enabled")
	if got := app.count(t, "SELECT count(*) FROM audit_logs WHERE action = 'user.totp_enabled'"); got != 1 {
		t.Fatalf("audit entries for enabling TOTP = %d, want 1", got)
	}
}

func TestEveryNewSessionNeedsAFreshAuthenticatorCode(t *testing.T) {
	app := newAdminApp(t)
	secret, usedStep := app.enableAuthenticator(t, app.adminSession(t))

	second := app.sessionFor(t, adminEmail)
	assertError(t, app.do(t, http.MethodGet, "/api/v1/admin/overview", nil, second), http.StatusForbidden, "mfa_required")

	reused := app.do(t, http.MethodPost, "/api/v1/admin/mfa/verify", map[string]string{"code": totp.Code(secret, usedStep)}, second)
	assertError(t, reused, http.StatusUnprocessableEntity, "code_used")

	next := totp.Code(secret, usedStep+1)
	assertStatus(t, app.do(t, http.MethodPost, "/api/v1/admin/mfa/verify", map[string]string{"code": next[:3] + " " + next[3:]}, second), http.StatusNoContent)
	assertStatus(t, app.do(t, http.MethodGet, "/api/v1/admin/overview", nil, second), http.StatusOK)

	third := app.sessionFor(t, adminEmail)
	assertError(t, app.do(t, http.MethodPost, "/api/v1/admin/mfa/verify", map[string]string{"code": next}, third), http.StatusUnprocessableEntity, "code_used")
	assertError(t, app.do(t, http.MethodGet, "/api/v1/admin/overview", nil, third), http.StatusForbidden, "mfa_required")
}

func TestAuthenticatorAttemptsAreLimitedPerAdmin(t *testing.T) {
	app := newAdminApp(t)
	secret, step := app.enableAuthenticator(t, app.adminSession(t))
	session := app.sessionFor(t, adminEmail)
	wrong := map[string]string{"code": wrongCode(totp.Code(secret, step+1))}

	// The confirmation above already used one of the five attempts this minute.
	for attempt := 2; attempt <= 5; attempt++ {
		assertError(t, app.do(t, http.MethodPost, "/api/v1/admin/mfa/verify", wrong, session), http.StatusUnprocessableEntity, "invalid_code")
	}

	limited := app.do(t, http.MethodPost, "/api/v1/admin/mfa/verify", map[string]string{"code": totp.Code(secret, step+1)}, session)
	body := assertError(t, limited, http.StatusTooManyRequests, "rate_limited")
	if body.Error.Message != "Terlalu banyak percobaan. Tunggu satu menit, lalu coba lagi." || limited.Header.Get("Retry-After") == "" {
		t.Fatalf("rate limit message = %q, Retry-After = %q", body.Error.Message, limited.Header.Get("Retry-After"))
	}
}

func TestVerifyingBeforeSetupAsksForSetup(t *testing.T) {
	app := newAdminApp(t)
	session := app.adminSession(t)

	assertError(t, app.do(t, http.MethodPost, "/api/v1/admin/mfa/verify", map[string]string{"code": "123456"}, session), http.StatusConflict, "mfa_setup_required")
	assertError(t, app.do(t, http.MethodPost, "/api/v1/admin/mfa/verify", map[string]string{"code": "12"}, session), http.StatusUnprocessableEntity, "validation_failed")
}

func TestResetTOTPSignsTheAdminOutAndRequiresANewSetup(t *testing.T) {
	app := newAdminApp(t)
	session := app.adminSession(t)
	secret, _ := app.enableAuthenticator(t, session)

	if err := admin.ResetTOTP(context.Background(), app.pool, adminEmail); err != nil {
		t.Fatal(err)
	}
	assertError(t, app.do(t, http.MethodGet, "/api/v1/admin/overview", nil, session), http.StatusUnauthorized, "unauthenticated")

	fresh := app.sessionFor(t, adminEmail)
	assertError(t, app.do(t, http.MethodGet, "/api/v1/admin/overview", nil, fresh), http.StatusForbidden, "mfa_setup_required")
	if replacement := decodeSecret(t, app.mfaSetup(t, fresh).Secret); bytes.Equal(replacement, secret) {
		t.Fatal("the new setup reused the old secret")
	}
}

func TestAdminAreaStaysClosedWithoutEncryptionKeys(t *testing.T) {
	app := newAuthApp(t)
	if _, err := admin.Create(context.Background(), app.pool, adminEmail); err != nil {
		t.Fatal(err)
	}
	app.exec(t, "UPDATE users SET email_verified_at = now()")
	session := app.sessionFor(t, adminEmail)

	assertError(t, app.do(t, http.MethodGet, "/api/v1/admin/mfa/setup", nil, session), http.StatusServiceUnavailable, "encryption_unavailable")
	assertError(t, app.do(t, http.MethodGet, "/api/v1/admin/overview", nil, session), http.StatusForbidden, "mfa_setup_required")
}

func TestAdminSignInWithEmailCodeReachesAuthenticatorStep(t *testing.T) {
	app := newAdminApp(t)
	if _, err := admin.Create(context.Background(), app.pool, adminEmail); err != nil {
		t.Fatal(err)
	}

	app.requestCode(t, adminEmail)
	signedIn := app.verify(t, adminEmail, app.mailer.lastCode(t), false)
	assertStatus(t, signedIn, http.StatusOK)
	var account httpapi.Account
	decode(t, signedIn, &account)
	if account.Role != httpapi.Admin || !account.EmailVerified {
		t.Fatalf("account = %+v, want a verified admin", account)
	}

	assertError(t, app.do(t, http.MethodGet, "/api/v1/admin/overview", nil, sessionCookie(t, signedIn)), http.StatusForbidden, "mfa_setup_required")
}

func newAdminApp(t *testing.T) *authApp {
	t.Helper()

	keys, err := encryption.ParseKeys("1:" + strings.Repeat("5a", encryption.KeySize))
	if err != nil {
		t.Fatal(err)
	}

	return newAuthApp(t, func(settings *httpapi.Settings) { settings.Encryption = keys })
}

// adminSession creates the admin account with the CLI command and returns a signed-in session.
func (a *authApp) adminSession(t *testing.T) *http.Cookie {
	t.Helper()

	if _, err := admin.Create(context.Background(), a.pool, adminEmail); err != nil {
		t.Fatal(err)
	}
	a.exec(t, "UPDATE users SET email_verified_at = now() WHERE email = '"+adminEmail+"'")

	return a.sessionFor(t, adminEmail)
}

// sessionFor signs the account in directly, without going through the email code each time.
func (a *authApp) sessionFor(t *testing.T, email string) *http.Cookie {
	t.Helper()

	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		t.Fatal(err)
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	digest := sha256.Sum256([]byte(token))

	_, err := a.pool.Exec(context.Background(),
		"INSERT INTO sessions (token_hash, user_id, expires_at) SELECT $1, id, now() + interval '1 hour' FROM users WHERE email = $2",
		digest[:], email)
	if err != nil {
		t.Fatal(err)
	}

	return &http.Cookie{Name: "jdsign_session", Value: token}
}

func (a *authApp) mfaSetup(t *testing.T, session *http.Cookie) httpapi.AdminMfaSetup {
	t.Helper()

	response := a.do(t, http.MethodGet, "/api/v1/admin/mfa/setup", nil, session)
	assertStatus(t, response, http.StatusOK)
	var setup httpapi.AdminMfaSetup
	decode(t, response, &setup)

	return setup
}

// enableAuthenticator completes the setup and returns the secret and the step its code used.
func (a *authApp) enableAuthenticator(t *testing.T, session *http.Cookie) ([]byte, int64) {
	t.Helper()

	secret := decodeSecret(t, a.mfaSetup(t, session).Secret)
	step := totp.Step(time.Now())
	assertStatus(t, a.do(t, http.MethodPost, "/api/v1/admin/mfa/setup", map[string]string{"code": totp.Code(secret, step)}, session), http.StatusNoContent)

	return secret, step
}

func decodeSecret(t *testing.T, encoded string) []byte {
	t.Helper()

	secret, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(encoded)
	if err != nil || len(secret) != totp.SecretSize {
		t.Fatalf("secret %q: %v", encoded, err)
	}

	return secret
}
