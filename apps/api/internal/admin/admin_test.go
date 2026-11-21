package admin_test

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jefthah/jdsign/apps/api/internal/admin"
	"github.com/jefthah/jdsign/apps/api/internal/testdb"
)

func TestCreateMakesANewAdminAccount(t *testing.T) {
	pool := testdb.New(t)

	created, err := admin.Create(context.Background(), pool, " Pengelola@JD-Sign.com ")
	if err != nil {
		t.Fatal(err)
	}
	if !created.NewAccount || created.AlreadyAdmin || created.Email != "pengelola@jd-sign.com" {
		t.Fatalf("Create() = %+v, want a new account for the normalised email", created)
	}

	var role, name string
	var verified bool
	row := pool.QueryRow(context.Background(), "SELECT role, name, email_verified_at IS NOT NULL FROM users WHERE email = 'pengelola@jd-sign.com'")
	if err := row.Scan(&role, &name, &verified); err != nil {
		t.Fatal(err)
	}
	if role != "admin" || name != "Pengelola" || verified {
		t.Fatalf("user = role %q, name %q, verified %v; want an unverified admin named Pengelola", role, name, verified)
	}
	if got := count(t, pool, "SELECT count(*) FROM audit_logs WHERE action = 'user.made_admin' AND actor_id IS NULL"); got != 1 {
		t.Fatalf("system audit entries = %d, want 1", got)
	}
}

func TestCreatePromotesABuyerOnce(t *testing.T) {
	pool := testdb.New(t)
	exec(t, pool, "INSERT INTO users (email, name, email_verified_at) VALUES ('nadia@studioarunika.id', 'Nadia', now())")

	created, err := admin.Create(context.Background(), pool, "nadia@studioarunika.id")
	if err != nil || created.NewAccount || created.AlreadyAdmin {
		t.Fatalf("Create() = %+v, %v; want the buyer promoted", created, err)
	}
	again, err := admin.Create(context.Background(), pool, "nadia@studioarunika.id")
	if err != nil || !again.AlreadyAdmin {
		t.Fatalf("second Create() = %+v, %v; want AlreadyAdmin", again, err)
	}

	if got := count(t, pool, "SELECT count(*) FROM users WHERE role = 'admin'"); got != 1 {
		t.Fatalf("admins = %d, want 1", got)
	}
	if got := count(t, pool, "SELECT count(*) FROM audit_logs WHERE action = 'user.made_admin'"); got != 1 {
		t.Fatalf("audit entries = %d, want 1 (repeating the command changes nothing)", got)
	}
}

func TestCreateRefusesSellersAndDeactivatedAccounts(t *testing.T) {
	pool := testdb.New(t)
	exec(t, pool, `INSERT INTO users (email, name, role) VALUES ('toko@example.com', 'Toko', 'seller');
		INSERT INTO users (email, name, is_active) VALUES ('nonaktif@example.com', 'Nonaktif', false)`)

	for _, email := range []string{"toko@example.com", "nonaktif@example.com", "bukan-email"} {
		if _, err := admin.Create(context.Background(), pool, email); err == nil {
			t.Errorf("Create(%q) succeeded", email)
		}
	}
	if got := count(t, pool, "SELECT count(*) FROM users WHERE role = 'admin'"); got != 0 {
		t.Fatalf("admins = %d, want 0", got)
	}
}

func TestResetTOTPRemovesAuthenticatorAndSessions(t *testing.T) {
	pool := testdb.New(t)
	exec(t, pool, `INSERT INTO users (email, name, role, totp_secret, totp_confirmed_at, totp_last_step)
			VALUES ('admin@jd-sign.com', 'Admin', 'admin', '\x01'::bytea, now(), 42);
		INSERT INTO sessions (token_hash, user_id, mfa_verified_at, expires_at)
			SELECT '\x02'::bytea, id, now(), now() + interval '1 hour' FROM users WHERE email = 'admin@jd-sign.com'`)

	if err := admin.ResetTOTP(context.Background(), pool, "ADMIN@jd-sign.com"); err != nil {
		t.Fatal(err)
	}

	if got := count(t, pool, "SELECT count(*) FROM users WHERE totp_secret IS NULL AND totp_confirmed_at IS NULL AND totp_last_step IS NULL"); got != 1 {
		t.Fatal("authenticator columns were not cleared")
	}
	if got := count(t, pool, "SELECT count(*) FROM sessions"); got != 0 {
		t.Fatalf("sessions = %d, want 0", got)
	}
	if got := count(t, pool, "SELECT count(*) FROM audit_logs WHERE action = 'user.totp_reset' AND actor_id IS NULL"); got != 1 {
		t.Fatalf("audit entries = %d, want 1", got)
	}
}

func TestResetTOTPOnlyAppliesToAdmins(t *testing.T) {
	pool := testdb.New(t)
	exec(t, pool, "INSERT INTO users (email, name) VALUES ('pembeli@example.com', 'Pembeli')")

	for _, email := range []string{"pembeli@example.com", "tidak-ada@example.com"} {
		if err := admin.ResetTOTP(context.Background(), pool, email); err == nil {
			t.Errorf("ResetTOTP(%q) succeeded", email)
		}
	}
}

func exec(t *testing.T, pool *pgxpool.Pool, sql string) {
	t.Helper()

	if _, err := pool.Exec(context.Background(), sql); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
}

func count(t *testing.T, pool *pgxpool.Pool, sql string) int {
	t.Helper()

	var total int
	if err := pool.QueryRow(context.Background(), sql).Scan(&total); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}

	return total
}
