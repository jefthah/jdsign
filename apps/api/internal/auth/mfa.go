package auth

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/jefthah/jdsign/apps/api/internal/database/sqlcdb"
	"github.com/jefthah/jdsign/apps/api/internal/totp"
)

// totpIssuer names JD Sign in authenticator apps.
const totpIssuer = "JD Sign"

var errNoEncryptionKeys = errors.New("ENCRYPTION_KEYS belum diatur")

// MFASetup is what an admin needs to add JD Sign to an authenticator app.
type MFASetup struct {
	// Secret is the base32 secret for typing into the app by hand.
	Secret string
	// URI is the otpauth:// link shown as a QR code.
	URI string
}

// AdminAccess reports why account may not use the admin area, or nil when it may. The three MFA
// endpoints pass requireMFA = false; everything else in the admin area passes true.
func AdminAccess(account Account, requireMFA bool) *Error {
	forbidden := func(code, message string) *Error {
		return &Error{Kind: KindForbidden, Code: code, Message: message}
	}

	switch {
	case account.Role != "admin":
		return forbidden("admin_only", "Halaman ini khusus admin JD Sign.")
	case !account.EmailVerified:
		return forbidden("email_unverified", "Verifikasi email Anda dengan masuk memakai kode email terlebih dahulu.")
	case !requireMFA:
		return nil
	case !account.TOTPEnabled:
		return forbidden("mfa_setup_required", "Pasang aplikasi authenticator untuk membuka panel admin.")
	case !account.MFAVerified:
		return forbidden("mfa_required", "Masukkan kode dari aplikasi authenticator untuk membuka panel admin.")
	}

	return nil
}

// AdminMFASetup returns the admin's authenticator secret while it is not yet confirmed. The first
// call creates the secret; later calls return the same one, so reloading the page keeps a QR code
// that was already scanned working.
func (s *Service) AdminMFASetup(ctx context.Context, account Account) (MFASetup, error) {
	if s.keys == nil {
		return MFASetup{}, encryptionUnavailable()
	}

	var (
		setup    MFASetup
		rejected *Error
	)
	err := s.inTx(ctx, func(queries *sqlcdb.Queries) error {
		user, err := queries.GetUserForUpdate(ctx, account.ID)
		if err != nil {
			return err
		}
		if user.TotpConfirmedAt.Valid {
			rejected = &Error{Kind: KindConflict, Code: "mfa_already_enabled", Message: "Aplikasi authenticator sudah terpasang untuk akun ini."}
			return nil
		}

		// An unconfirmed secret that no configured key can open is simply replaced.
		secret, err := s.keys.Open(user.TotpSecret, totpContext(user.ID))
		if err != nil {
			if secret, err = totp.NewSecret(); err != nil {
				return err
			}
			sealed, err := s.keys.Seal(secret, totpContext(user.ID))
			if err != nil {
				return err
			}
			if err := queries.SaveUserTOTPSecret(ctx, sqlcdb.SaveUserTOTPSecretParams{ID: user.ID, TotpSecret: sealed}); err != nil {
				return err
			}
		}

		setup = MFASetup{Secret: totp.EncodeSecret(secret), URI: totp.URI(secret, totpIssuer, user.Email)}
		return nil
	})
	if err != nil {
		return MFASetup{}, fmt.Errorf("menyiapkan authenticator admin: %w", err)
	}
	if rejected != nil {
		return MFASetup{}, rejected
	}

	return setup, nil
}

// ConfirmAdminMFASetup turns on the authenticator after one correct code and marks the session
// behind sessionToken as verified, so the admin does not have to enter a second code.
func (s *Service) ConfirmAdminMFASetup(ctx context.Context, account Account, sessionToken, rawCode string) error {
	code, invalid := normalizeAuthenticatorCode(rawCode)
	if invalid != nil {
		return invalid
	}
	if s.keys == nil {
		return encryptionUnavailable()
	}

	var rejected *Error
	err := s.inTx(ctx, func(queries *sqlcdb.Queries) error {
		user, err := queries.GetUserForUpdate(ctx, account.ID)
		if err != nil {
			return err
		}
		if user.TotpConfirmedAt.Valid {
			rejected = &Error{Kind: KindConflict, Code: "mfa_already_enabled", Message: "Aplikasi authenticator sudah terpasang untuk akun ini."}
			return nil
		}
		secret, err := s.keys.Open(user.TotpSecret, totpContext(user.ID))
		if err != nil {
			rejected = &Error{Kind: KindConflict, Code: "mfa_setup_not_started", Message: "Muat ulang halaman untuk menampilkan kode QR, lalu coba lagi."}
			return nil
		}

		step, ok := totp.Match(secret, code, time.Now())
		if !ok {
			rejected = wrongAuthenticatorCode()
			return nil
		}
		if err := queries.ConfirmUserTOTP(ctx, sqlcdb.ConfirmUserTOTPParams{ID: user.ID, Step: pgtype.Int8{Int64: step, Valid: true}}); err != nil {
			return err
		}
		if err := queries.MarkSessionMFAVerified(ctx, hashToken(sessionToken)); err != nil {
			return err
		}

		return queries.InsertAuditLog(ctx, sqlcdb.InsertAuditLogParams{
			ActorID:     pgtype.Int8{Int64: user.ID, Valid: true},
			SubjectType: "user",
			SubjectID:   user.ID,
			Action:      "user.totp_enabled",
		})
	})
	if err != nil {
		return fmt.Errorf("mengaktifkan authenticator admin: %w", err)
	}
	if rejected != nil {
		return rejected
	}

	return nil
}

// VerifyAdminMFA checks an authenticator code and marks the session behind sessionToken as
// verified for the admin area. A code, or any older code, cannot be used twice.
func (s *Service) VerifyAdminMFA(ctx context.Context, account Account, sessionToken, rawCode string) error {
	code, invalid := normalizeAuthenticatorCode(rawCode)
	if invalid != nil {
		return invalid
	}
	if s.keys == nil {
		return encryptionUnavailable()
	}

	var rejected *Error
	err := s.inTx(ctx, func(queries *sqlcdb.Queries) error {
		user, err := queries.GetUserForUpdate(ctx, account.ID)
		if err != nil {
			return err
		}
		if !user.TotpConfirmedAt.Valid {
			rejected = &Error{Kind: KindConflict, Code: "mfa_setup_required", Message: "Pasang aplikasi authenticator terlebih dahulu."}
			return nil
		}
		secret, err := s.keys.Open(user.TotpSecret, totpContext(user.ID))
		if err != nil {
			rejected = &Error{
				Kind:    KindUnavailable,
				Code:    "mfa_secret_unreadable",
				Message: "Rahasia authenticator tidak bisa dibaca. Minta pengelola server menjalankan jdsign admin reset-totp untuk akun Anda.",
				cause:   err,
			}
			return nil
		}

		step, ok := totp.Match(secret, code, time.Now())
		if !ok {
			rejected = wrongAuthenticatorCode()
			return nil
		}
		if user.TotpLastStep.Valid && step <= user.TotpLastStep.Int64 {
			rejected = &Error{Kind: KindInvalid, Code: "code_used", Field: "code", Message: "Kode ini sudah dipakai. Tunggu kode berikutnya di aplikasi authenticator, lalu coba lagi."}
			return nil
		}
		if err := queries.SetUserTOTPLastStep(ctx, sqlcdb.SetUserTOTPLastStepParams{ID: user.ID, Step: pgtype.Int8{Int64: step, Valid: true}}); err != nil {
			return err
		}

		return queries.MarkSessionMFAVerified(ctx, hashToken(sessionToken))
	})
	if err != nil {
		return fmt.Errorf("memeriksa kode authenticator: %w", err)
	}
	if rejected != nil {
		return rejected
	}

	return nil
}

// totpContext binds an encrypted TOTP secret to its user row.
func totpContext(userID int64) string {
	return "users.totp_secret:" + strconv.FormatInt(userID, 10)
}

func normalizeAuthenticatorCode(raw string) (string, *Error) {
	code := digitsOnly(raw)
	if len(code) != totp.Digits {
		return "", &Error{Kind: KindInvalid, Code: "validation_failed", Field: "code", Message: "Masukkan 6 digit kode dari aplikasi authenticator."}
	}

	return code, nil
}

func wrongAuthenticatorCode() *Error {
	return &Error{Kind: KindInvalid, Code: "invalid_code", Field: "code", Message: "Kode authenticator salah."}
}

func encryptionUnavailable() *Error {
	return &Error{
		Kind:    KindUnavailable,
		Code:    "encryption_unavailable",
		Message: "Panel admin belum siap: kunci enkripsi server (ENCRYPTION_KEYS) belum diatur.",
		cause:   errNoEncryptionKeys,
	}
}
