// Package admin implements the server-side commands that manage admin accounts:
// "jdsign admin create" and "jdsign admin reset-totp". See docs/spec.md sections 3 and 4.4.
// Both write an audit log entry with no actor, which the admin panel shows as "Sistem".
package admin

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jefthah/jdsign/apps/api/internal/auth"
	"github.com/jefthah/jdsign/apps/api/internal/database/sqlcdb"
)

// Created describes what Create did.
type Created struct {
	Email string
	// NewAccount means no account existed for the email, so one was created.
	NewAccount bool
	// AlreadyAdmin means the account was an admin before; nothing changed.
	AlreadyAdmin bool
}

// Create makes the account with this email an admin, creating the account when it does not exist.
// Signing in still needs the email code or Google, followed by the authenticator app.
func Create(ctx context.Context, pool *pgxpool.Pool, rawEmail string) (Created, error) {
	email, invalid := auth.NormalizeEmail(rawEmail)
	if invalid != nil {
		return Created{}, invalid
	}

	result := Created{Email: email}
	err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		queries := sqlcdb.New(tx)

		user, err := queries.GetUserByEmailForUpdate(ctx, email)
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			user, err = queries.CreateAdminUser(ctx, sqlcdb.CreateAdminUserParams{Email: email, Name: auth.NameFromEmail(email)})
			if err != nil {
				return err
			}
			result.NewAccount = true
		case err != nil:
			return err
		case user.Role == "admin":
			result.AlreadyAdmin = true
			return nil
		case !user.IsActive:
			return fmt.Errorf("akun %s sedang dinonaktifkan; aktifkan dulu sebelum dijadikan admin", email)
		case user.Role == "seller":
			return fmt.Errorf("akun %s adalah penjual; satu akun tidak bisa menjadi penjual sekaligus admin, pakai email lain untuk admin", email)
		default:
			if err := queries.MakeUserAdmin(ctx, user.ID); err != nil {
				return err
			}
		}

		return audit(ctx, queries, user.ID, "user.made_admin", "lewat perintah jdsign admin create")
	})
	if err != nil {
		return Created{}, err
	}

	return result, nil
}

// ResetTOTP removes an admin's authenticator and signs them out everywhere, for when the phone
// with the authenticator app is lost. The admin sets up a new one at the next sign-in.
func ResetTOTP(ctx context.Context, pool *pgxpool.Pool, rawEmail string) error {
	email, invalid := auth.NormalizeEmail(rawEmail)
	if invalid != nil {
		return invalid
	}

	return pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		queries := sqlcdb.New(tx)

		user, err := queries.GetUserByEmailForUpdate(ctx, email)
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("tidak ada akun dengan email %s", email)
		}
		if err != nil {
			return err
		}
		if user.Role != "admin" {
			return fmt.Errorf("akun %s bukan admin", email)
		}

		if err := queries.ResetUserTOTP(ctx, user.ID); err != nil {
			return err
		}
		if err := queries.DeleteUserSessions(ctx, user.ID); err != nil {
			return err
		}

		return audit(ctx, queries, user.ID, "user.totp_reset", "lewat perintah jdsign admin reset-totp")
	})
}

func audit(ctx context.Context, queries *sqlcdb.Queries, userID int64, action, note string) error {
	return queries.InsertAuditLog(ctx, sqlcdb.InsertAuditLogParams{
		SubjectType: "user",
		SubjectID:   userID,
		Action:      action,
		Note:        pgtype.Text{String: note, Valid: true},
	})
}
