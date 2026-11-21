-- Kode masuk ---------------------------------------------------------------

-- name: LockLoginEmail :exec
-- Kunci per email selama transaksi, juga saat baris kode belum ada.
SELECT pg_advisory_xact_lock(hashtextextended(@email::text, 0));

-- name: GetLoginCodeForUpdate :one
-- Mengunci baris kode agar kirim ulang dan verifikasi untuk email yang sama berjalan berurutan.
SELECT
    email,
    code_hash,
    attempts,
    (expires_at <= now())::boolean AS expired,
    GREATEST(0, CEIL(EXTRACT(EPOCH FROM (sent_at + make_interval(secs => @cooldown_seconds::int) - now()))))::int AS seconds_until_resend,
    GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (expires_at - now()))))::int AS expires_in_seconds
FROM login_codes
WHERE email = @email
FOR UPDATE;

-- name: SaveLoginCode :exec
INSERT INTO login_codes (email, code_hash, attempts, sent_at, expires_at)
VALUES (@email, @code_hash, 0, now(), now() + make_interval(secs => @ttl_seconds::int))
ON CONFLICT (email) DO UPDATE
SET code_hash  = EXCLUDED.code_hash,
    attempts   = 0,
    sent_at    = EXCLUDED.sent_at,
    expires_at = EXCLUDED.expires_at;

-- name: IncrementLoginCodeAttempts :one
UPDATE login_codes
SET attempts = attempts + 1
WHERE email = @email
RETURNING attempts;

-- name: DeleteLoginCode :exec
DELETE FROM login_codes
WHERE email = @email;

-- Pengguna -------------------------------------------------------------------

-- name: GetUserByEmail :one
SELECT * FROM users
WHERE email = @email;

-- name: GetUserByGoogleSub :one
SELECT * FROM users
WHERE google_sub = @google_sub;

-- name: CreateVerifiedBuyer :one
-- Akun baru dari OTP atau Google selalu berperan buyer dan langsung terverifikasi.
INSERT INTO users (email, name, role, is_active, email_verified_at, google_sub)
VALUES (@email, @name, 'buyer', true, now(), sqlc.narg(google_sub))
RETURNING *;

-- name: MarkUserEmailVerified :exec
UPDATE users
SET email_verified_at = now()
WHERE id = @id AND email_verified_at IS NULL;

-- name: LinkUserGoogleSub :exec
UPDATE users
SET google_sub        = @google_sub,
    email_verified_at = COALESCE(email_verified_at, now())
WHERE id = @id;

-- Sesi -----------------------------------------------------------------------

-- name: CreateSession :exec
INSERT INTO sessions (token_hash, user_id, remember, ip_address, user_agent, expires_at)
VALUES (
    @token_hash,
    @user_id,
    @remember,
    sqlc.narg(ip_address),
    sqlc.narg(user_agent),
    now() + make_interval(secs => @lifetime_seconds::int)
);

-- name: GetSessionAccount :one
SELECT
    s.remember,
    (s.last_seen_at < now() - interval '1 minute')::boolean AS needs_touch,
    (s.mfa_verified_at IS NOT NULL)::boolean AS mfa_verified,
    u.id,
    u.email,
    u.name,
    u.role,
    u.is_active,
    u.email_verified_at,
    (u.totp_confirmed_at IS NOT NULL)::boolean AS totp_enabled
FROM sessions s
JOIN users u ON u.id = s.user_id
WHERE s.token_hash = @token_hash
  AND s.expires_at > now();

-- name: TouchSession :exec
UPDATE sessions
SET last_seen_at = now(),
    expires_at   = now() + make_interval(secs => @lifetime_seconds::int)
WHERE token_hash = @token_hash;

-- name: DeleteSession :exec
DELETE FROM sessions
WHERE token_hash = @token_hash;

-- name: DeleteUserSessions :exec
DELETE FROM sessions
WHERE user_id = @user_id;
