-- Peran admin dan TOTP ---------------------------------------------------------

-- name: GetUserForUpdate :one
-- Mengunci akun agar dua kode TOTP untuk admin yang sama diperiksa berurutan.
SELECT * FROM users
WHERE id = @id
FOR UPDATE;

-- name: GetUserByEmailForUpdate :one
SELECT * FROM users
WHERE email = @email
FOR UPDATE;

-- name: CreateAdminUser :one
-- Akun admin baru dari CLI. Email terverifikasi saat admin pertama kali masuk dengan kode atau Google.
INSERT INTO users (email, name, role, is_active)
VALUES (@email, @name, 'admin', true)
RETURNING *;

-- name: MakeUserAdmin :exec
UPDATE users
SET role = 'admin'
WHERE id = @id;

-- name: SaveUserTOTPSecret :exec
-- Rahasia hanya boleh diganti selama authenticator belum dikonfirmasi.
UPDATE users
SET totp_secret = @totp_secret
WHERE id = @id AND totp_confirmed_at IS NULL;

-- name: ConfirmUserTOTP :exec
UPDATE users
SET totp_confirmed_at = now(),
    totp_last_step    = @step
WHERE id = @id;

-- name: SetUserTOTPLastStep :exec
UPDATE users
SET totp_last_step = @step
WHERE id = @id;

-- name: ResetUserTOTP :exec
UPDATE users
SET totp_secret       = NULL,
    totp_confirmed_at = NULL,
    totp_last_step    = NULL
WHERE id = @id;

-- name: MarkSessionMFAVerified :exec
UPDATE sessions
SET mfa_verified_at = now()
WHERE token_hash = @token_hash;

-- Log audit -----------------------------------------------------------------

-- name: InsertAuditLog :exec
-- actor_id NULL berarti "Sistem", misalnya perintah CLI di server.
INSERT INTO audit_logs (actor_id, subject_type, subject_id, action, note)
VALUES (sqlc.narg(actor_id), @subject_type, @subject_id, @action, sqlc.narg(note));

-- Ringkasan admin -----------------------------------------------------------

-- name: GetAdminOverview :one
SELECT
    (SELECT count(*) FROM seller_profiles WHERE status = 'pending')::int                        AS pending_sellers,
    (SELECT count(*) FROM templates WHERE status = 'pending' AND deleted_at IS NULL)::int        AS pending_templates,
    (SELECT count(*) FROM payout_requests WHERE status = 'pending')::int                        AS pending_payouts,
    (SELECT COALESCE(sum(amount), 0) FROM payout_requests WHERE status = 'pending')::bigint     AS pending_payout_amount,
    (SELECT count(*) FROM orders WHERE status = 'review')::int                                  AS orders_in_review,
    (SELECT count(*) FROM templates WHERE status = 'approved' AND deleted_at IS NULL)::int       AS published_templates,
    (SELECT count(*) FROM templates WHERE status <> 'approved' AND deleted_at IS NULL)::int      AS draft_templates,
    (SELECT count(*) FROM categories)::int                                                      AS categories;
