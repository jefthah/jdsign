-- +goose Up
-- Skema awal JD Sign (Go + PostgreSQL). Diturunkan dari aplikasi Laravel jd-sign-laravel.
-- Semua nominal uang dalam rupiah utuh (bigint). Kolom bytea berisi data terenkripsi AES-256-GCM.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- +goose StatementBegin
CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE FUNCTION reject_ledger_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'ledger_entries tidak boleh diubah atau dihapus; buat entri pembalik';
END;
$$;
-- +goose StatementEnd

-- Pengguna -------------------------------------------------------------------

CREATE TABLE users (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email             text        NOT NULL UNIQUE CHECK (email = lower(email) AND length(email) BETWEEN 3 AND 255),
    name              text        NOT NULL CHECK (length(name) BETWEEN 1 AND 255),
    role              text        NOT NULL DEFAULT 'buyer' CHECK (role IN ('buyer', 'seller', 'admin')),
    is_active         boolean     NOT NULL DEFAULT true,
    email_verified_at timestamptz,
    google_sub        text        UNIQUE,
    totp_secret       bytea,
    totp_confirmed_at timestamptz,
    totp_last_step    bigint,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Kode OTP masuk: satu kode aktif per email.
CREATE TABLE login_codes (
    email      text        PRIMARY KEY CHECK (email = lower(email)),
    code_hash  bytea       NOT NULL,
    attempts   smallint    NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
    sent_at    timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);

-- Sesi login. Cookie berisi token acak; database hanya menyimpan hash SHA-256-nya.
CREATE TABLE sessions (
    token_hash      bytea       PRIMARY KEY,
    user_id         bigint      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    remember        boolean     NOT NULL DEFAULT false,
    mfa_verified_at timestamptz,
    ip_address      inet,
    user_agent      text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    last_seen_at    timestamptz NOT NULL DEFAULT now(),
    expires_at      timestamptz NOT NULL
);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

-- Toko dan katalog -----------------------------------------------------------

CREATE TABLE seller_profiles (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id      bigint      NOT NULL UNIQUE REFERENCES users (id) ON DELETE RESTRICT,
    shop_name    text        NOT NULL CHECK (length(shop_name) BETWEEN 1 AND 100),
    slug         text        NOT NULL UNIQUE,
    bio          text        NOT NULL CHECK (length(bio) BETWEEN 20 AND 2000),
    bank_details bytea,
    status       text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    admin_note   text,
    approved_at  timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX seller_profiles_status_idx ON seller_profiles (status);
CREATE TRIGGER seller_profiles_updated_at BEFORE UPDATE ON seller_profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE categories (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        text        NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
    slug        text        NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 100),
    description text        CHECK (length(description) <= 255),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER categories_updated_at BEFORE UPDATE ON categories FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE templates (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    seller_id    bigint      NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    category_id  bigint      NOT NULL REFERENCES categories (id) ON DELETE RESTRICT,
    title        text        NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
    slug         text        NOT NULL UNIQUE,
    summary      text        NOT NULL CHECK (length(summary) BETWEEN 1 AND 240),
    description  text        NOT NULL CHECK (length(description) BETWEEN 30 AND 20000),
    price        bigint      NOT NULL CHECK (price BETWEEN 10000 AND 100000000),
    version      text        NOT NULL DEFAULT '1.0.0' CHECK (length(version) BETWEEN 1 AND 40),
    technology   text        NOT NULL CHECK (length(technology) BETWEEN 1 AND 80),
    license_type text        NOT NULL DEFAULT 'Standard' CHECK (length(license_type) BETWEEN 1 AND 80),
    preview_url  text        CHECK (preview_url LIKE 'https://%' AND length(preview_url) <= 500),
    cover_path   text        CHECK (length(cover_path) <= 500),
    archive_path text        CHECK (length(archive_path) <= 500),
    is_demo      boolean     NOT NULL DEFAULT false,
    status       text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'approved', 'rejected')),
    admin_note   text,
    approved_by  bigint      REFERENCES users (id) ON DELETE SET NULL,
    approved_at  timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    deleted_at   timestamptz
);
CREATE INDEX templates_status_created_idx ON templates (status, created_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX templates_seller_status_idx ON templates (seller_id, status);
CREATE INDEX templates_category_idx ON templates (category_id);
CREATE INDEX templates_title_trgm_idx ON templates USING gin (title gin_trgm_ops);
CREATE INDEX templates_technology_trgm_idx ON templates USING gin (technology gin_trgm_ops);
CREATE TRIGGER templates_updated_at BEFORE UPDATE ON templates FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE cart_items (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id     bigint      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    template_id bigint      NOT NULL REFERENCES templates (id) ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, template_id)
);

CREATE TABLE wishlists (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id     bigint      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    template_id bigint      NOT NULL REFERENCES templates (id) ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, template_id)
);

-- Pesanan dan pembayaran -----------------------------------------------------

CREATE TABLE orders (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    number       text        NOT NULL UNIQUE CHECK (number ~ '^JD-[0-9A-Z]{26}$'),
    checkout_key uuid        NOT NULL,
    buyer_id     bigint      NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    total        bigint      NOT NULL CHECK (total >= 0),
    currency     text        NOT NULL DEFAULT 'IDR' CHECK (currency = 'IDR'),
    status       text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'expired', 'cancelled', 'refunded', 'review')),
    paid_at      timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (buyer_id, checkout_key),
    CHECK (status <> 'paid' OR paid_at IS NOT NULL)
);
CREATE INDEX orders_buyer_created_idx ON orders (buyer_id, created_at DESC);
CREATE INDEX orders_status_idx ON orders (status);
CREATE TRIGGER orders_updated_at BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Salinan (snapshot) template saat dibeli. Tidak berubah walau template diperbarui.
CREATE TABLE order_items (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id       bigint      NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,
    template_id    bigint      NOT NULL REFERENCES templates (id) ON DELETE RESTRICT,
    seller_id      bigint      NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    title          text        NOT NULL,
    version        text        NOT NULL,
    license_type   text        NOT NULL,
    license_key    uuid        NOT NULL UNIQUE,
    price          bigint      NOT NULL CHECK (price >= 0),
    commission_bps integer     NOT NULL CHECK (commission_bps BETWEEN 0 AND 10000),
    platform_fee   bigint      NOT NULL CHECK (platform_fee >= 0),
    seller_net     bigint      NOT NULL CHECK (seller_net >= 0),
    archive_path   text        NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (order_id, template_id),
    CHECK (platform_fee + seller_net = price)
);
CREATE INDEX order_items_seller_idx ON order_items (seller_id);
CREATE INDEX order_items_template_idx ON order_items (template_id);

CREATE TABLE payment_attempts (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id          bigint      NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,
    provider_order_id text        NOT NULL UNIQUE CHECK (length(provider_order_id) <= 50),
    status            text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'failed', 'paid', 'closed', 'refunded')),
    snap_token        bytea,
    redirect_url      bytea,
    transaction_id    text,
    provider_status   text        CHECK (length(provider_status) <= 40),
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_attempts_order_idx ON payment_attempts (order_id, id DESC);
CREATE INDEX payment_attempts_sync_idx ON payment_attempts (updated_at) WHERE status IN ('pending', 'ready');
CREATE TRIGGER payment_attempts_updated_at BEFORE UPDATE ON payment_attempts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Saldo penjual dan pencairan ------------------------------------------------

CREATE TABLE payout_requests (
    id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    seller_id          bigint      NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    amount             bigint      NOT NULL CHECK (amount > 0),
    bank_details       bytea       NOT NULL,
    status             text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'rejected')),
    transfer_reference text        CHECK (length(transfer_reference) <= 160),
    admin_note         text,
    processed_by       bigint      REFERENCES users (id) ON DELETE SET NULL,
    processed_at       timestamptz,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    CHECK (status <> 'paid' OR (transfer_reference IS NOT NULL AND processed_at IS NOT NULL))
);
CREATE INDEX payout_requests_seller_status_idx ON payout_requests (seller_id, status);
CREATE TRIGGER payout_requests_updated_at BEFORE UPDATE ON payout_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Buku besar penjual: hanya boleh ditambah. Koreksi dibuat sebagai entri pembalik.
CREATE TABLE ledger_entries (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    seller_id         bigint      NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    order_item_id     bigint      REFERENCES order_items (id) ON DELETE RESTRICT,
    payout_request_id bigint      REFERENCES payout_requests (id) ON DELETE RESTRICT,
    reference         text        NOT NULL UNIQUE CHECK (reference ~ '^(sale|refund|payout):[0-9]+$'),
    type              text        NOT NULL CHECK (type IN ('sale', 'refund', 'payout')),
    amount            bigint      NOT NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    CHECK (
        (type = 'sale'   AND amount > 0 AND order_item_id IS NOT NULL AND payout_request_id IS NULL)
     OR (type = 'refund' AND amount < 0 AND order_item_id IS NOT NULL AND payout_request_id IS NULL)
     OR (type = 'payout' AND amount < 0 AND payout_request_id IS NOT NULL AND order_item_id IS NULL)
    ),
    CHECK (starts_with(reference, type || ':'))
);
CREATE INDEX ledger_entries_seller_created_idx ON ledger_entries (seller_id, created_at);
CREATE TRIGGER ledger_entries_immutable BEFORE UPDATE OR DELETE ON ledger_entries FOR EACH ROW EXECUTE FUNCTION reject_ledger_change();

-- Log audit tindakan admin dan sistem ----------------------------------------

CREATE TABLE audit_logs (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_id     bigint      REFERENCES users (id) ON DELETE SET NULL,
    subject_type text        NOT NULL CHECK (subject_type IN ('seller_profile', 'template', 'order', 'payout_request', 'user', 'category')),
    subject_id   bigint      NOT NULL,
    action       text        NOT NULL CHECK (length(action) <= 50),
    note         text,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_subject_idx ON audit_logs (subject_type, subject_id);
CREATE INDEX audit_logs_created_idx ON audit_logs (created_at DESC);

-- Data awal ------------------------------------------------------------------

INSERT INTO categories (name, slug) VALUES
    ('Portfolio', 'portfolio'),
    ('Bisnis', 'business'),
    ('E-commerce', 'ecommerce'),
    ('Landing page', 'landing-page');

-- +goose Down
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS ledger_entries;
DROP TABLE IF EXISTS payout_requests;
DROP TABLE IF EXISTS payment_attempts;
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS wishlists;
DROP TABLE IF EXISTS cart_items;
DROP TABLE IF EXISTS templates;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS seller_profiles;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS login_codes;
DROP TABLE IF EXISTS users;
DROP FUNCTION IF EXISTS reject_ledger_change();
DROP FUNCTION IF EXISTS set_updated_at();
