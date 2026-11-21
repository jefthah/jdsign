-- +goose Up
-- Nama asli dan ukuran ZIP template, untuk ditampilkan di panel admin.
-- Mode satu penjual (2026-11-21): admin mengelola template langsung dan memakai status
-- draft/approved; pending/rejected baru dipakai saat penjual lain dibuka.
ALTER TABLE templates
    ADD COLUMN archive_name text   CHECK (length(archive_name) BETWEEN 1 AND 255),
    ADD COLUMN archive_size bigint CHECK (archive_size > 0);

-- +goose Down
ALTER TABLE templates
    DROP COLUMN IF EXISTS archive_size,
    DROP COLUMN IF EXISTS archive_name;
