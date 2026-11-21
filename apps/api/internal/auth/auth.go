// Package auth implements passwordless sign-in for JD Sign: six-digit email codes, Google
// identities, and database-backed sessions. See docs/spec.md section 4.
package auth

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"math/big"
	"net/netip"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jefthah/jdsign/apps/api/internal/database/sqlcdb"
	"github.com/jefthah/jdsign/apps/api/internal/encryption"
	"github.com/jefthah/jdsign/apps/api/internal/mail"
)

const (
	// CodeLifetime is how long a sign-in code stays valid.
	CodeLifetime = 10 * time.Minute
	// ResendCooldown is the minimum time between two code emails to the same address.
	ResendCooldown = 60 * time.Second
	// MaxAttempts is the number of wrong codes after which the code is discarded.
	MaxAttempts = 5
	// SessionLifetime is the idle timeout of a session without "remember me".
	SessionLifetime = 2 * time.Hour
	// RememberLifetime is the idle timeout of a session with "remember me".
	RememberLifetime = 30 * 24 * time.Hour
	// FallbackName is used when no name can be derived from the email address.
	FallbackName = "Pengguna JD Sign"
)

// ErrNoSession means the request carries no valid session.
var ErrNoSession = errors.New("sesi tidak ditemukan atau sudah berakhir")

// Kind classifies an Error so the HTTP layer can choose a status code.
type Kind int

const (
	// KindInvalid is a problem with the submitted input (HTTP 422).
	KindInvalid Kind = iota + 1
	// KindForbidden means the account may not sign in (HTTP 403).
	KindForbidden
	// KindUnavailable means a dependency such as email delivery failed (HTTP 503).
	KindUnavailable
	// KindConflict means the request does not fit the account's current state (HTTP 409).
	KindConflict
)

// Error is a sign-in failure the user can act on. Message is shown to the user as-is.
type Error struct {
	Kind    Kind
	Code    string
	Message string
	Field   string
	cause   error
}

func (e *Error) Error() string { return e.Message }

// Account is the signed-in user as exposed to the rest of the application.
type Account struct {
	ID            int64
	Email         string
	Name          string
	Role          string
	EmailVerified bool
	// TOTPEnabled means the account has a confirmed authenticator app (admins only).
	TOTPEnabled bool
	// MFAVerified means this session passed the authenticator check for the admin area within
	// the last 12 hours and has been active within the last hour. A session idle for an hour
	// loses the check when it is next used (TouchSession), so the admin enters a new code.
	MFAVerified bool
}

// Client describes where a sign-in comes from; it is stored on the session.
type Client struct {
	IP        string
	UserAgent string
}

// CodeStatus reports the state of the active code after a send request.
type CodeStatus struct {
	Email              string
	Sent               bool
	SecondsUntilResend int
	ExpiresInSeconds   int
}

// GoogleIdentity is a verified Google account.
type GoogleIdentity struct {
	Subject string
	Email   string
	Name    string
}

// Service signs people in. It is safe for concurrent use.
type Service struct {
	pool    *pgxpool.Pool
	queries *sqlcdb.Queries
	mailer  mail.Mailer
	secret  []byte
	keys    *encryption.Keyring
}

// NewService creates the sign-in service. secret keys the HMAC that protects stored codes; keys
// encrypts admin authenticator secrets and may be nil, which turns admin MFA off.
func NewService(pool *pgxpool.Pool, mailer mail.Mailer, secret []byte, keys *encryption.Keyring) *Service {
	return &Service{pool: pool, queries: sqlcdb.New(pool), mailer: mailer, secret: secret, keys: keys}
}

// RequestCode emails a new code unless one was sent during the resend cooldown.
func (s *Service) RequestCode(ctx context.Context, rawEmail string) (CodeStatus, error) {
	email, invalid := NormalizeEmail(rawEmail)
	if invalid != nil {
		return CodeStatus{}, invalid
	}

	code, err := generateCode()
	if err != nil {
		return CodeStatus{}, err
	}

	cooling := false
	status := CodeStatus{Email: email}
	err = s.inTx(ctx, func(queries *sqlcdb.Queries) error {
		if err := queries.LockLoginEmail(ctx, email); err != nil {
			return err
		}
		current, err := queries.GetLoginCodeForUpdate(ctx, sqlcdb.GetLoginCodeForUpdateParams{
			Email:           email,
			CooldownSeconds: int32(ResendCooldown.Seconds()),
		})
		if err == nil && !current.Expired && current.SecondsUntilResend > 0 {
			cooling = true
			status.SecondsUntilResend = int(current.SecondsUntilResend)
			status.ExpiresInSeconds = int(current.ExpiresInSeconds)
			return nil
		}
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}

		return queries.SaveLoginCode(ctx, sqlcdb.SaveLoginCodeParams{
			Email:      email,
			CodeHash:   s.hashCode(email, code),
			TtlSeconds: int32(CodeLifetime.Seconds()),
		})
	})
	if err != nil {
		return CodeStatus{}, fmt.Errorf("menyimpan kode masuk: %w", err)
	}
	if cooling {
		return status, nil
	}

	if err := s.mailer.SendLoginCode(ctx, mail.LoginCode{To: email, Code: code, ExpiresIn: CodeLifetime}); err != nil {
		// Without the email the code is useless; remove it so the person can retry at once.
		_ = s.queries.DeleteLoginCode(context.WithoutCancel(ctx), email)
		return CodeStatus{}, &Error{
			Kind:    KindUnavailable,
			Code:    "mail_failed",
			Message: "Kode belum bisa dikirim. Coba lagi dalam beberapa saat.",
			Field:   "email",
			cause:   err,
		}
	}

	status.Sent = true
	status.SecondsUntilResend = int(ResendCooldown.Seconds())
	status.ExpiresInSeconds = int(CodeLifetime.Seconds())

	return status, nil
}

// VerifyCode checks a code and, when it matches, signs the person in. An unknown email gets a new
// buyer account. It returns the account and the session token for the cookie.
func (s *Service) VerifyCode(ctx context.Context, rawEmail, rawCode string, remember bool, client Client) (Account, string, error) {
	email, invalid := NormalizeEmail(rawEmail)
	if invalid != nil {
		return Account{}, "", invalid
	}
	code := digitsOnly(rawCode)
	if len(code) != 6 {
		return Account{}, "", &Error{Kind: KindInvalid, Code: "validation_failed", Field: "code", Message: "Masukkan 6 digit kode dari email."}
	}

	var (
		account  Account
		token    string
		rejected *Error
	)
	err := s.inTx(ctx, func(queries *sqlcdb.Queries) error {
		if err := queries.LockLoginEmail(ctx, email); err != nil {
			return err
		}
		current, err := queries.GetLoginCodeForUpdate(ctx, sqlcdb.GetLoginCodeForUpdateParams{
			Email:           email,
			CooldownSeconds: int32(ResendCooldown.Seconds()),
		})
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && current.Expired) {
			rejected = &Error{Kind: KindInvalid, Code: "code_expired", Field: "code", Message: "Kode sudah kedaluwarsa. Kirim kode baru untuk melanjutkan."}
			return queries.DeleteLoginCode(ctx, email)
		}
		if err != nil {
			return err
		}

		if !hmac.Equal(s.hashCode(email, code), current.CodeHash) {
			attempts, err := queries.IncrementLoginCodeAttempts(ctx, email)
			if err != nil {
				return err
			}
			if int(attempts) >= MaxAttempts {
				rejected = &Error{Kind: KindInvalid, Code: "too_many_attempts", Field: "code", Message: "Kode salah terlalu sering. Kirim kode baru untuk melanjutkan."}
				return queries.DeleteLoginCode(ctx, email)
			}
			rejected = &Error{Kind: KindInvalid, Code: "invalid_code", Field: "code", Message: fmt.Sprintf("Kode tidak cocok. Sisa %d percobaan.", MaxAttempts-int(attempts))}
			return nil
		}

		if err := queries.DeleteLoginCode(ctx, email); err != nil {
			return err
		}

		user, err := queries.GetUserByEmail(ctx, email)
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			user, err = queries.CreateVerifiedBuyer(ctx, sqlcdb.CreateVerifiedBuyerParams{Email: email, Name: NameFromEmail(email)})
			if err != nil {
				return err
			}
		case err != nil:
			return err
		case !user.IsActive:
			rejected = inactiveAccount()
			return queries.DeleteUserSessions(ctx, user.ID)
		case !user.EmailVerifiedAt.Valid:
			if err := queries.MarkUserEmailVerified(ctx, user.ID); err != nil {
				return err
			}
			user.EmailVerifiedAt = pgtype.Timestamptz{Time: time.Now(), Valid: true}
		}

		token, err = createSession(ctx, queries, user.ID, remember, client)
		account = accountFromUser(user)
		return err
	})
	if err != nil {
		return Account{}, "", fmt.Errorf("memeriksa kode masuk: %w", err)
	}
	if rejected != nil {
		return Account{}, "", rejected
	}

	return account, token, nil
}

// SignInWithGoogle signs in a verified Google identity. It matches on the Google subject first,
// then on the email address (and links the subject), and otherwise creates a buyer account.
func (s *Service) SignInWithGoogle(ctx context.Context, identity GoogleIdentity, client Client) (Account, string, error) {
	email, invalid := NormalizeEmail(identity.Email)
	if invalid != nil {
		return Account{}, "", invalid
	}
	subject := pgtype.Text{String: identity.Subject, Valid: true}

	var (
		account  Account
		token    string
		rejected *Error
	)
	err := s.inTx(ctx, func(queries *sqlcdb.Queries) error {
		user, err := queries.GetUserByGoogleSub(ctx, subject)
		if errors.Is(err, pgx.ErrNoRows) {
			user, err = queries.GetUserByEmail(ctx, email)
			if err == nil {
				if err := queries.LinkUserGoogleSub(ctx, sqlcdb.LinkUserGoogleSubParams{ID: user.ID, GoogleSub: subject}); err != nil {
					return err
				}
				user.GoogleSub = subject
				if !user.EmailVerifiedAt.Valid {
					user.EmailVerifiedAt = pgtype.Timestamptz{Time: time.Now(), Valid: true}
				}
			}
		}
		if errors.Is(err, pgx.ErrNoRows) {
			name := strings.TrimSpace(identity.Name)
			if name == "" || utf8.RuneCountInString(name) > 255 {
				name = NameFromEmail(email)
			}
			user, err = queries.CreateVerifiedBuyer(ctx, sqlcdb.CreateVerifiedBuyerParams{Email: email, Name: name, GoogleSub: subject})
		}
		if err != nil {
			return err
		}
		if !user.IsActive {
			rejected = inactiveAccount()
			return queries.DeleteUserSessions(ctx, user.ID)
		}

		// "Tetap masuk" is the default on the sign-in page, so Google sessions are remembered too.
		token, err = createSession(ctx, queries, user.ID, true, client)
		account = accountFromUser(user)
		return err
	})
	if err != nil {
		return Account{}, "", fmt.Errorf("masuk dengan Google: %w", err)
	}
	if rejected != nil {
		return Account{}, "", rejected
	}

	return account, token, nil
}

// Authenticate returns the account behind a session token and extends the session's idle
// timeout. It returns ErrNoSession for unknown, expired, or deactivated sessions.
func (s *Service) Authenticate(ctx context.Context, token string) (Account, error) {
	if token == "" {
		return Account{}, ErrNoSession
	}
	tokenHash := hashToken(token)

	row, err := s.queries.GetSessionAccount(ctx, tokenHash)
	if errors.Is(err, pgx.ErrNoRows) {
		return Account{}, ErrNoSession
	}
	if err != nil {
		return Account{}, fmt.Errorf("membaca sesi: %w", err)
	}
	if !row.IsActive {
		if err := s.queries.DeleteUserSessions(ctx, row.ID); err != nil {
			return Account{}, fmt.Errorf("menghapus sesi akun nonaktif: %w", err)
		}
		return Account{}, ErrNoSession
	}
	if row.NeedsTouch {
		if err := s.queries.TouchSession(ctx, sqlcdb.TouchSessionParams{TokenHash: tokenHash, LifetimeSeconds: lifetimeSeconds(row.Remember)}); err != nil {
			return Account{}, fmt.Errorf("memperpanjang sesi: %w", err)
		}
	}

	return Account{
		ID:            row.ID,
		Email:         row.Email,
		Name:          row.Name,
		Role:          row.Role,
		EmailVerified: row.EmailVerifiedAt.Valid,
		TOTPEnabled:   row.TotpEnabled,
		MFAVerified:   row.MfaVerified,
	}, nil
}

// Logout deletes the session behind token. Unknown tokens are ignored.
func (s *Service) Logout(ctx context.Context, token string) error {
	if token == "" {
		return nil
	}

	return s.queries.DeleteSession(ctx, hashToken(token))
}

// NormalizeEmail trims and lower-cases an email address and checks that it is usable.
func NormalizeEmail(raw string) (string, *Error) {
	email := strings.ToLower(strings.TrimSpace(raw))
	invalid := func(message string) *Error {
		return &Error{Kind: KindInvalid, Code: "validation_failed", Field: "email", Message: message}
	}

	switch {
	case email == "":
		return "", invalid("Masukkan alamat email Anda.")
	case len(email) > 255:
		return "", invalid("Alamat email terlalu panjang.")
	case !looksLikeEmail(email):
		return "", invalid("Format email belum benar. Contoh: nama@email.com")
	}

	return email, nil
}

// NameFromEmail derives a display name from the part of the address before "@":
// "budi.santoso@mail.com" becomes "Budi Santoso".
func NameFromEmail(email string) string {
	local, _, _ := strings.Cut(email, "@")
	cleaned := strings.Map(func(r rune) rune {
		switch {
		case r == '.' || r == '_' || r == '-' || r == '+':
			return ' '
		case unicode.IsDigit(r):
			return -1
		default:
			return r
		}
	}, local)

	words := strings.Fields(cleaned)
	for index, word := range words {
		first, size := utf8.DecodeRuneInString(word)
		words[index] = string(unicode.ToUpper(first)) + word[size:]
	}
	if len(words) == 0 {
		return FallbackName
	}

	return strings.Join(words, " ")
}

func (e *Error) Unwrap() error { return e.cause }

func inactiveAccount() *Error {
	return &Error{Kind: KindForbidden, Code: "account_inactive", Message: "Akun ini sedang dinonaktifkan. Hubungi tim JD Sign untuk bantuan."}
}

func (s *Service) inTx(ctx context.Context, work func(*sqlcdb.Queries) error) error {
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		return work(s.queries.WithTx(tx))
	})
}

func (s *Service) hashCode(email, code string) []byte {
	mac := hmac.New(sha256.New, s.secret)
	mac.Write([]byte(email))
	mac.Write([]byte{0})
	mac.Write([]byte(code))

	return mac.Sum(nil)
}

func createSession(ctx context.Context, queries *sqlcdb.Queries, userID int64, remember bool, client Client) (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	token := base64.RawURLEncoding.EncodeToString(raw)

	params := sqlcdb.CreateSessionParams{
		TokenHash:       hashToken(token),
		UserID:          userID,
		Remember:        remember,
		LifetimeSeconds: lifetimeSeconds(remember),
	}
	if address, err := netip.ParseAddr(client.IP); err == nil {
		params.IpAddress = &address
	}
	if agent := strings.ToValidUTF8(client.UserAgent, ""); agent != "" {
		if len(agent) > 500 {
			agent = agent[:500]
		}
		params.UserAgent = pgtype.Text{String: strings.ToValidUTF8(agent, ""), Valid: true}
	}

	return token, queries.CreateSession(ctx, params)
}

func lifetimeSeconds(remember bool) int32 {
	if remember {
		return int32(RememberLifetime.Seconds())
	}

	return int32(SessionLifetime.Seconds())
}

func hashToken(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}

func accountFromUser(user sqlcdb.User) Account {
	return Account{
		ID:            user.ID,
		Email:         user.Email,
		Name:          user.Name,
		Role:          user.Role,
		EmailVerified: user.EmailVerifiedAt.Valid,
		TOTPEnabled:   user.TotpConfirmedAt.Valid,
	}
}

func generateCode() (string, error) {
	number, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return "", err
	}

	return fmt.Sprintf("%06d", number.Int64()), nil
}

func digitsOnly(value string) string {
	return strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return r
		}
		return -1
	}, value)
}

func looksLikeEmail(email string) bool {
	local, domain, found := strings.Cut(email, "@")
	if !found || local == "" || domain == "" || strings.Contains(domain, "@") {
		return false
	}
	if strings.ContainsAny(email, " \t\r\n<>()[]\\,;:\"") {
		return false
	}
	if strings.HasPrefix(local, ".") || strings.HasSuffix(local, ".") || strings.Contains(email, "..") {
		return false
	}
	labels := strings.Split(domain, ".")
	if len(labels) < 2 {
		return false
	}
	for _, label := range labels {
		if label == "" || strings.HasPrefix(label, "-") || strings.HasSuffix(label, "-") {
			return false
		}
	}

	return true
}
