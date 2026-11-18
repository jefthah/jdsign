package httpapi_test

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jefthah/jdsign/apps/api/internal/google"
	"github.com/jefthah/jdsign/apps/api/internal/httpapi"
	"github.com/jefthah/jdsign/apps/api/internal/mail"
	"github.com/jefthah/jdsign/apps/api/internal/testdb"
)

const testAppURL = "https://jd-sign.test"

func TestNewEmailGetsBuyerAccountAndSession(t *testing.T) {
	app := newAuthApp(t)

	status := app.requestCode(t, " Budi.Santoso@Mail.com ")
	if !status.Sent || status.Email != "budi.santoso@mail.com" || status.SecondsUntilResend != 60 || status.ExpiresInSeconds != 600 {
		t.Fatalf("code status = %+v, want a fresh code for the normalised email", status)
	}

	response := app.verify(t, "budi.santoso@mail.com", app.mailer.lastCode(t), false)
	assertStatus(t, response, http.StatusOK)
	var account httpapi.Account
	decode(t, response, &account)
	if account.Name != "Budi Santoso" || account.Role != httpapi.Buyer || !account.EmailVerified {
		t.Fatalf("account = %+v, want verified buyer named Budi Santoso", account)
	}

	session := sessionCookie(t, response)
	if !session.HttpOnly || !session.Secure || session.SameSite != http.SameSiteLaxMode || session.Path != "/" || session.MaxAge != 0 {
		t.Fatalf("session cookie = %+v, want HttpOnly, Secure, SameSite=Lax browser-session cookie", session)
	}

	me := app.do(t, http.MethodGet, "/api/v1/me", nil, session)
	assertStatus(t, me, http.StatusOK)
	decode(t, me, &account)
	if account.Email != "budi.santoso@mail.com" {
		t.Fatalf("GET /me email = %q", account.Email)
	}
}

func TestRememberMeKeepsSessionForThirtyDays(t *testing.T) {
	app := newAuthApp(t)
	app.requestCode(t, "nadia@studioarunika.id")

	response := app.verify(t, "nadia@studioarunika.id", app.mailer.lastCode(t), true)

	assertStatus(t, response, http.StatusOK)
	if maxAge := sessionCookie(t, response).MaxAge; maxAge != 30*24*60*60 {
		t.Fatalf("remembered cookie Max-Age = %d, want 30 days", maxAge)
	}
}

func TestResendWaitsForCooldown(t *testing.T) {
	app := newAuthApp(t)
	app.requestCode(t, "nadia@studioarunika.id")
	firstCode := app.mailer.lastCode(t)

	again := app.requestCode(t, "nadia@studioarunika.id")
	if again.Sent || again.SecondsUntilResend < 1 || again.SecondsUntilResend > 60 {
		t.Fatalf("second request = %+v, want no new code during cooldown", again)
	}
	if sent := app.mailer.count(); sent != 1 {
		t.Fatalf("emails sent = %d, want 1", sent)
	}

	app.exec(t, "UPDATE login_codes SET sent_at = now() - interval '61 seconds'")
	if after := app.requestCode(t, "nadia@studioarunika.id"); !after.Sent {
		t.Fatalf("request after cooldown = %+v, want a new code", after)
	}

	if newCode := app.mailer.lastCode(t); newCode != firstCode {
		response := app.verify(t, "nadia@studioarunika.id", firstCode, false)
		assertError(t, response, http.StatusUnprocessableEntity, "invalid_code")
	}
}

func TestWrongCodesRunOutAfterFiveAttempts(t *testing.T) {
	app := newAuthApp(t)
	app.requestCode(t, "nadia@studioarunika.id")
	code := app.mailer.lastCode(t)
	wrong := wrongCode(code)

	for remaining := 4; remaining >= 1; remaining-- {
		response := app.verify(t, "nadia@studioarunika.id", wrong, false)
		body := assertError(t, response, http.StatusUnprocessableEntity, "invalid_code")
		if want := fmt.Sprintf("Kode tidak cocok. Sisa %d percobaan.", remaining); body.Error.Message != want {
			t.Fatalf("message = %q, want %q", body.Error.Message, want)
		}
	}

	assertError(t, app.verify(t, "nadia@studioarunika.id", wrong, false), http.StatusUnprocessableEntity, "too_many_attempts")
	assertError(t, app.verify(t, "nadia@studioarunika.id", code, false), http.StatusUnprocessableEntity, "code_expired")
}

func TestExpiredCodeIsRejected(t *testing.T) {
	app := newAuthApp(t)
	app.requestCode(t, "nadia@studioarunika.id")
	app.exec(t, "UPDATE login_codes SET expires_at = now() - interval '1 second'")

	response := app.verify(t, "nadia@studioarunika.id", app.mailer.lastCode(t), false)

	body := assertError(t, response, http.StatusUnprocessableEntity, "code_expired")
	if body.Error.Message != "Kode sudah kedaluwarsa. Kirim kode baru untuk melanjutkan." {
		t.Fatalf("message = %q", body.Error.Message)
	}
}

func TestCodeAcceptsSpacesAndDashes(t *testing.T) {
	app := newAuthApp(t)
	app.requestCode(t, "nadia@studioarunika.id")
	code := app.mailer.lastCode(t)

	response := app.verify(t, "nadia@studioarunika.id", code[:3]+" - "+code[3:], false)

	assertStatus(t, response, http.StatusOK)
}

func TestExistingUnverifiedAccountIsVerifiedWithoutDuplicates(t *testing.T) {
	app := newAuthApp(t)
	app.exec(t, "INSERT INTO users (email, name) VALUES ('sari@toko.id', 'Sari Toko')")
	app.requestCode(t, "sari@toko.id")

	response := app.verify(t, "sari@toko.id", app.mailer.lastCode(t), false)

	assertStatus(t, response, http.StatusOK)
	var account httpapi.Account
	decode(t, response, &account)
	if account.Name != "Sari Toko" || !account.EmailVerified {
		t.Fatalf("account = %+v, want the existing account, now verified", account)
	}
	if users := app.count(t, "SELECT count(*) FROM users"); users != 1 {
		t.Fatalf("users = %d, want 1", users)
	}
}

func TestDeactivatedAccountCannotSignIn(t *testing.T) {
	app := newAuthApp(t)
	app.exec(t, "INSERT INTO users (email, name, is_active) VALUES ('blokir@toko.id', 'Blokir', false)")
	app.requestCode(t, "blokir@toko.id")

	response := app.verify(t, "blokir@toko.id", app.mailer.lastCode(t), false)

	assertError(t, response, http.StatusForbidden, "account_inactive")
	if sessions := app.count(t, "SELECT count(*) FROM sessions"); sessions != 0 {
		t.Fatalf("sessions = %d, want 0", sessions)
	}
}

func TestSignInNeverGrantsElevatedRole(t *testing.T) {
	app := newAuthApp(t)
	response := app.do(t, http.MethodPost, "/api/v1/auth/code", map[string]any{"email": "nakal@mail.com", "role": "admin"}, nil)
	assertStatus(t, response, http.StatusOK)

	verified := app.do(t, http.MethodPost, "/api/v1/auth/code/verify", map[string]any{
		"email": "nakal@mail.com", "code": app.mailer.lastCode(t), "role": "admin", "isActive": false,
	}, nil)

	assertStatus(t, verified, http.StatusOK)
	var account httpapi.Account
	decode(t, verified, &account)
	if account.Role != httpapi.Buyer {
		t.Fatalf("role = %q, want buyer", account.Role)
	}
}

func TestEmailIsValidated(t *testing.T) {
	app := newAuthApp(t)
	cases := map[string]string{
		"":                                     "Masukkan alamat email Anda.",
		"bukan-email":                          "Format email belum benar. Contoh: nama@email.com",
		"nama@domain":                          "Format email belum benar. Contoh: nama@email.com",
		strings.Repeat("a", 250) + "@mail.com": "Alamat email terlalu panjang.",
	}

	for email, want := range cases {
		response := app.do(t, http.MethodPost, "/api/v1/auth/code", map[string]string{"email": email}, nil)
		body := assertError(t, response, http.StatusUnprocessableEntity, "validation_failed")
		if got := (*body.Error.Fields)["email"]; got != want {
			t.Fatalf("email %q: message = %q, want %q", email, got, want)
		}
	}
	if sent := app.mailer.count(); sent != 0 {
		t.Fatalf("emails sent = %d, want 0", sent)
	}
}

func TestMailFailureReturns503AndAllowsImmediateRetry(t *testing.T) {
	app := newAuthApp(t)
	app.mailer.fail(true)

	response := app.do(t, http.MethodPost, "/api/v1/auth/code", map[string]string{"email": "nadia@studioarunika.id"}, nil)
	body := assertError(t, response, http.StatusServiceUnavailable, "mail_failed")
	if body.Error.Message != "Kode belum bisa dikirim. Coba lagi dalam beberapa saat." {
		t.Fatalf("message = %q", body.Error.Message)
	}

	app.mailer.fail(false)
	if status := app.requestCode(t, "nadia@studioarunika.id"); !status.Sent {
		t.Fatalf("retry after failure = %+v, want a code to be sent without waiting", status)
	}
}

func TestStateChangingRequestsRequireSiteOrigin(t *testing.T) {
	app := newAuthApp(t)

	for _, origin := range []string{"", "https://evil.example"} {
		request := httptest.NewRequest(http.MethodPost, "/api/v1/auth/code", strings.NewReader(`{"email":"nadia@studioarunika.id"}`))
		request.Header.Set("Content-Type", "application/json")
		if origin != "" {
			request.Header.Set("Origin", origin)
		}
		recorder := httptest.NewRecorder()
		app.handler.ServeHTTP(recorder, request)

		assertError(t, recorder.Result(), http.StatusForbidden, "origin_rejected")
	}
}

func TestLogoutEndsSession(t *testing.T) {
	app := newAuthApp(t)
	app.requestCode(t, "nadia@studioarunika.id")
	session := sessionCookie(t, app.verify(t, "nadia@studioarunika.id", app.mailer.lastCode(t), false))

	response := app.do(t, http.MethodPost, "/api/v1/auth/logout", nil, session)

	assertStatus(t, response, http.StatusNoContent)
	if cleared := findCookie(response, "jdsign_session"); cleared == nil || cleared.MaxAge >= 0 {
		t.Fatalf("logout cookie = %+v, want it cleared", cleared)
	}
	assertError(t, app.do(t, http.MethodGet, "/api/v1/me", nil, session), http.StatusUnauthorized, "unauthenticated")
}

func TestDeactivatingAccountEndsItsSessions(t *testing.T) {
	app := newAuthApp(t)
	app.requestCode(t, "nadia@studioarunika.id")
	session := sessionCookie(t, app.verify(t, "nadia@studioarunika.id", app.mailer.lastCode(t), false))

	app.exec(t, "UPDATE users SET is_active = false")

	assertError(t, app.do(t, http.MethodGet, "/api/v1/me", nil, session), http.StatusUnauthorized, "unauthenticated")
	if sessions := app.count(t, "SELECT count(*) FROM sessions"); sessions != 0 {
		t.Fatalf("sessions = %d, want 0", sessions)
	}
}

func TestCodeRequestsAreRateLimitedPerIP(t *testing.T) {
	app := newAuthApp(t)
	for index := range 6 {
		app.requestCode(t, fmt.Sprintf("orang%d@mail.com", index))
	}

	response := app.do(t, http.MethodPost, "/api/v1/auth/code", map[string]string{"email": "orang7@mail.com"}, nil)

	assertError(t, response, http.StatusTooManyRequests, "rate_limited")
	if response.Header.Get("Retry-After") == "" {
		t.Fatal("429 response has no Retry-After header")
	}
}

func TestGoogleIsDisabledWithoutClientID(t *testing.T) {
	app := newAuthApp(t)

	response := app.do(t, http.MethodGet, "/api/v1/auth/google", nil, nil)

	assertRedirect(t, response, testAppURL+"/login?error=google_unavailable")
}

func TestGoogleSignInCreatesAccountAndSession(t *testing.T) {
	provider := newFakeGoogle(t, "Rina Lestari", "rina@gmail.com", true)
	app := newAuthApp(t, func(settings *httpapi.Settings) { settings.Google = provider.config() })

	start := app.do(t, http.MethodGet, "/api/v1/auth/google?next=/account/pesanan", nil, nil)
	assertStatus(t, start, http.StatusFound)
	authURL, err := url.Parse(start.Header.Get("Location"))
	if err != nil || !strings.HasPrefix(authURL.String(), provider.server.URL+"/auth?") {
		t.Fatalf("Location = %q, want the Google authorization URL", start.Header.Get("Location"))
	}
	query := authURL.Query()
	if query.Get("code_challenge_method") != "S256" || query.Get("redirect_uri") != testAppURL+"/api/v1/auth/google/callback" {
		t.Fatalf("authorization query = %v, want PKCE S256 and the site callback", query)
	}
	provider.expect(query.Get("nonce"), query.Get("code_challenge"))
	stateCookie := findCookie(start, "jdsign_google")
	if stateCookie == nil || !stateCookie.HttpOnly {
		t.Fatal("start did not set an HttpOnly jdsign_google cookie")
	}

	callback := app.do(t, http.MethodGet, "/api/v1/auth/google/callback?code=kode-google&state="+url.QueryEscape(query.Get("state")), nil, stateCookie)

	assertRedirect(t, callback, testAppURL+"/account/pesanan")
	session := sessionCookie(t, callback)
	var account httpapi.Account
	me := app.do(t, http.MethodGet, "/api/v1/me", nil, session)
	assertStatus(t, me, http.StatusOK)
	decode(t, me, &account)
	if account.Email != "rina@gmail.com" || account.Name != "Rina Lestari" || account.Role != httpapi.Buyer {
		t.Fatalf("account = %+v, want new buyer from Google", account)
	}
}

func TestGoogleLinksExistingAccountByEmail(t *testing.T) {
	provider := newFakeGoogle(t, "Nadia", "nadia@studioarunika.id", true)
	app := newAuthApp(t, func(settings *httpapi.Settings) { settings.Google = provider.config() })
	app.exec(t, "INSERT INTO users (email, name) VALUES ('nadia@studioarunika.id', 'Nadia Arunika')")

	callback := app.googleRoundTrip(t, provider)

	assertRedirect(t, callback, testAppURL+"/account")
	if linked := app.count(t, "SELECT count(*) FROM users WHERE google_sub = 'google-subject' AND email_verified_at IS NOT NULL"); linked != 1 {
		t.Fatalf("linked users = %d, want the existing account linked and verified", linked)
	}
	if users := app.count(t, "SELECT count(*) FROM users"); users != 1 {
		t.Fatalf("users = %d, want 1", users)
	}
}

func TestGoogleRejectsUnverifiedEmail(t *testing.T) {
	provider := newFakeGoogle(t, "Tamu", "tamu@gmail.com", false)
	app := newAuthApp(t, func(settings *httpapi.Settings) { settings.Google = provider.config() })

	assertRedirect(t, app.googleRoundTrip(t, provider), testAppURL+"/login?error=google_unverified")
	if users := app.count(t, "SELECT count(*) FROM users"); users != 0 {
		t.Fatalf("users = %d, want 0", users)
	}
}

func TestGoogleCallbackRejectsForgedState(t *testing.T) {
	provider := newFakeGoogle(t, "Rina", "rina@gmail.com", true)
	app := newAuthApp(t, func(settings *httpapi.Settings) { settings.Google = provider.config() })
	start := app.do(t, http.MethodGet, "/api/v1/auth/google", nil, nil)

	forged := app.do(t, http.MethodGet, "/api/v1/auth/google/callback?code=x&state=palsu", nil, findCookie(start, "jdsign_google"))
	assertRedirect(t, forged, testAppURL+"/login?error=google_state")

	withoutCookie := app.do(t, http.MethodGet, "/api/v1/auth/google/callback?code=x&state=palsu", nil, nil)
	assertRedirect(t, withoutCookie, testAppURL+"/login?error=google_state")
}

func TestGoogleIgnoresExternalNextPath(t *testing.T) {
	provider := newFakeGoogle(t, "Rina", "rina@gmail.com", true)
	app := newAuthApp(t, func(settings *httpapi.Settings) { settings.Google = provider.config() })

	start := app.do(t, http.MethodGet, "/api/v1/auth/google?next="+url.QueryEscape("//evil.example/curi"), nil, nil)
	query := mustLocation(t, start).Query()
	provider.expect(query.Get("nonce"), query.Get("code_challenge"))
	callback := app.do(t, http.MethodGet, "/api/v1/auth/google/callback?code=k&state="+url.QueryEscape(query.Get("state")), nil, findCookie(start, "jdsign_google"))

	assertRedirect(t, callback, testAppURL+"/account")
}

// Test helpers ---------------------------------------------------------------

type authApp struct {
	pool    *pgxpool.Pool
	handler http.Handler
	mailer  *recordingMailer
}

func newAuthApp(t *testing.T, configure ...func(*httpapi.Settings)) *authApp {
	t.Helper()

	pool := testdb.New(t)
	mailer := &recordingMailer{}
	settings := httpapi.Settings{AppURL: testAppURL, LoginCodeSecret: strings.Repeat("s", 32), Mailer: mailer}
	for _, apply := range configure {
		apply(&settings)
	}

	return &authApp{pool: pool, handler: httpapi.NewHandler(httpapi.NewServer(pool, quietLogger(), settings)), mailer: mailer}
}

func (a *authApp) do(t *testing.T, method, path string, body any, cookie *http.Cookie) *http.Response {
	t.Helper()

	var payload *strings.Reader
	if body == nil {
		payload = strings.NewReader("")
	} else {
		encoded, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		payload = strings.NewReader(string(encoded))
	}
	request := httptest.NewRequest(method, path, payload)
	request.RemoteAddr = "203.0.113.7:51000"
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	if method != http.MethodGet {
		request.Header.Set("Origin", testAppURL)
	}
	if cookie != nil {
		request.AddCookie(&http.Cookie{Name: cookie.Name, Value: cookie.Value})
	}

	recorder := httptest.NewRecorder()
	a.handler.ServeHTTP(recorder, request)

	return recorder.Result()
}

func (a *authApp) requestCode(t *testing.T, email string) httpapi.LoginCodeStatus {
	t.Helper()

	response := a.do(t, http.MethodPost, "/api/v1/auth/code", map[string]string{"email": email}, nil)
	assertStatus(t, response, http.StatusOK)
	var status httpapi.LoginCodeStatus
	decode(t, response, &status)

	return status
}

func (a *authApp) verify(t *testing.T, email, code string, remember bool) *http.Response {
	t.Helper()

	return a.do(t, http.MethodPost, "/api/v1/auth/code/verify", map[string]any{"email": email, "code": code, "remember": remember}, nil)
}

func (a *authApp) googleRoundTrip(t *testing.T, provider *fakeGoogle) *http.Response {
	t.Helper()

	start := a.do(t, http.MethodGet, "/api/v1/auth/google", nil, nil)
	query := mustLocation(t, start).Query()
	provider.expect(query.Get("nonce"), query.Get("code_challenge"))

	return a.do(t, http.MethodGet, "/api/v1/auth/google/callback?code=k&state="+url.QueryEscape(query.Get("state")), nil, findCookie(start, "jdsign_google"))
}

func (a *authApp) exec(t *testing.T, sql string) {
	t.Helper()

	if _, err := a.pool.Exec(context.Background(), sql); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
}

func (a *authApp) count(t *testing.T, sql string) int {
	t.Helper()

	var total int
	if err := a.pool.QueryRow(context.Background(), sql).Scan(&total); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}

	return total
}

type recordingMailer struct {
	mu      sync.Mutex
	codes   []string
	failing bool
}

func (m *recordingMailer) SendLoginCode(_ context.Context, message mail.LoginCode) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.failing {
		return errors.New("resend sedang gangguan")
	}
	m.codes = append(m.codes, message.Code)

	return nil
}

func (m *recordingMailer) lastCode(t *testing.T) string {
	t.Helper()

	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.codes) == 0 {
		t.Fatal("no sign-in code was emailed")
	}

	return m.codes[len(m.codes)-1]
}

func (m *recordingMailer) count() int {
	m.mu.Lock()
	defer m.mu.Unlock()

	return len(m.codes)
}

func (m *recordingMailer) fail(failing bool) {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.failing = failing
}

// fakeGoogle is a token endpoint that checks the PKCE verifier and returns an ID token.
type fakeGoogle struct {
	server        *httptest.Server
	mu            sync.Mutex
	nonce         string
	challenge     string
	name          string
	email         string
	emailVerified bool
}

func newFakeGoogle(t *testing.T, name, email string, emailVerified bool) *fakeGoogle {
	t.Helper()

	provider := &fakeGoogle{name: name, email: email, emailVerified: emailVerified}
	provider.server = httptest.NewServer(http.HandlerFunc(provider.token))
	t.Cleanup(provider.server.Close)

	return provider
}

func (f *fakeGoogle) config() google.Config {
	return google.Config{
		ClientID:     "client-id.apps.googleusercontent.com",
		ClientSecret: "client-secret",
		AuthURL:      f.server.URL + "/auth",
		TokenURL:     f.server.URL + "/token",
	}
}

func (f *fakeGoogle) expect(nonce, challenge string) {
	f.mu.Lock()
	defer f.mu.Unlock()

	f.nonce, f.challenge = nonce, challenge
}

func (f *fakeGoogle) token(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()

	if err := r.ParseForm(); err != nil || r.PostForm.Get("client_secret") != "client-secret" {
		http.Error(w, "bad client", http.StatusUnauthorized)
		return
	}
	digest := sha256.Sum256([]byte(r.PostForm.Get("code_verifier")))
	if base64.RawURLEncoding.EncodeToString(digest[:]) != f.challenge {
		http.Error(w, `{"error":"invalid_grant"}`, http.StatusBadRequest)
		return
	}

	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"RS256","typ":"JWT"}`))
	claims, _ := json.Marshal(map[string]any{
		"iss":            "https://accounts.google.com",
		"aud":            "client-id.apps.googleusercontent.com",
		"exp":            time.Now().Add(time.Hour).Unix(),
		"nonce":          f.nonce,
		"sub":            "google-subject",
		"email":          f.email,
		"email_verified": f.emailVerified,
		"name":           f.name,
	})
	idToken := header + "." + base64.RawURLEncoding.EncodeToString(claims) + ".tanda-tangan"

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"id_token": idToken, "access_token": "akses"})
}

func sessionCookie(t *testing.T, response *http.Response) *http.Cookie {
	t.Helper()

	cookie := findCookie(response, "jdsign_session")
	if cookie == nil || cookie.Value == "" {
		t.Fatal("response did not set the jdsign_session cookie")
	}

	return cookie
}

func findCookie(response *http.Response, name string) *http.Cookie {
	for _, cookie := range response.Cookies() {
		if cookie.Name == name {
			return cookie
		}
	}

	return nil
}

func mustLocation(t *testing.T, response *http.Response) *url.URL {
	t.Helper()

	assertStatus(t, response, http.StatusFound)
	location, err := url.Parse(response.Header.Get("Location"))
	if err != nil {
		t.Fatalf("Location: %v", err)
	}

	return location
}

func assertRedirect(t *testing.T, response *http.Response, want string) {
	t.Helper()

	assertStatus(t, response, http.StatusFound)
	if location := response.Header.Get("Location"); location != want {
		t.Fatalf("Location = %q, want %q", location, want)
	}
}

func assertError(t *testing.T, response *http.Response, status int, code string) httpapi.Error {
	t.Helper()

	assertStatus(t, response, status)
	var body httpapi.Error
	decode(t, response, &body)
	if body.Error.Code != code {
		t.Fatalf("error code = %q (%s), want %q", body.Error.Code, body.Error.Message, code)
	}

	return body
}

func wrongCode(code string) string {
	if code == "000000" {
		return "111111"
	}

	return "000000"
}
