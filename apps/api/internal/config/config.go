// Package config reads JD Sign settings from environment variables.
package config

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"

	"github.com/jefthah/jdsign/apps/api/internal/encryption"
)

// LocalDatabaseURL points at the PostgreSQL container from compose.dev.yml.
const LocalDatabaseURL = "postgres://jdsign:jdsign-dev@127.0.0.1:54329/jdsign?sslmode=disable"

// LocalAppURL is the Next.js development server.
const LocalAppURL = "http://localhost:3000"

// DefaultMailFrom is the sender of transactional emails.
const DefaultMailFrom = "JD Sign <hello@jd-sign.com>"

// LocalEncryptionKeys is a fixed key for APP_ENV=local only; it protects nothing real.
const LocalEncryptionKeys = "1:6a647369676e2d6c6f63616c2d646576656c6f706d656e742d6b65792d303031"

// minimumSecretLength keeps LOGIN_CODE_SECRET long enough to resist guessing.
const minimumSecretLength = 32

// Config holds the settings the API needs at startup.
type Config struct {
	Environment        string
	HTTPAddress        string
	DatabaseURL        string
	AppURL             string
	LoginCodeSecret    string
	ResendAPIKey       string
	MailFrom           string
	GoogleClientID     string
	GoogleClientSecret string
	// Encryption comes from ENCRYPTION_KEYS. It is nil on staging when the variable is empty,
	// which keeps the admin area closed.
	Encryption *encryption.Keyring
}

// Load reads the configuration. Outside APP_ENV=local, DATABASE_URL, APP_URL, and
// LOGIN_CODE_SECRET are required; production also requires RESEND_API_KEY and ENCRYPTION_KEYS.
func Load() (Config, error) {
	cfg := Config{
		Environment:        valueOrDefault("APP_ENV", "local"),
		HTTPAddress:        valueOrDefault("HTTP_ADDR", "127.0.0.1:8300"),
		DatabaseURL:        os.Getenv("DATABASE_URL"),
		AppURL:             strings.TrimRight(os.Getenv("APP_URL"), "/"),
		LoginCodeSecret:    os.Getenv("LOGIN_CODE_SECRET"),
		ResendAPIKey:       os.Getenv("RESEND_API_KEY"),
		MailFrom:           valueOrDefault("MAIL_FROM", DefaultMailFrom),
		GoogleClientID:     os.Getenv("GOOGLE_CLIENT_ID"),
		GoogleClientSecret: os.Getenv("GOOGLE_CLIENT_SECRET"),
	}

	switch cfg.Environment {
	case "local", "staging", "production":
	default:
		return Config{}, fmt.Errorf("APP_ENV %q tidak dikenal; pakai local, staging, atau production", cfg.Environment)
	}
	local := cfg.Environment == "local"

	if cfg.DatabaseURL == "" {
		if !local {
			return Config{}, errors.New("DATABASE_URL wajib diisi jika APP_ENV bukan local")
		}
		cfg.DatabaseURL = LocalDatabaseURL
	}

	if cfg.AppURL == "" {
		if !local {
			return Config{}, errors.New("APP_URL wajib diisi jika APP_ENV bukan local")
		}
		cfg.AppURL = LocalAppURL
	}
	if parsed, err := url.Parse(cfg.AppURL); err != nil || parsed.Host == "" || (parsed.Scheme != "https" && !(local && parsed.Scheme == "http")) {
		return Config{}, fmt.Errorf("APP_URL %q harus berupa alamat https (http hanya untuk local)", cfg.AppURL)
	}

	if cfg.LoginCodeSecret == "" && !local {
		return Config{}, errors.New("LOGIN_CODE_SECRET wajib diisi jika APP_ENV bukan local")
	}
	if cfg.LoginCodeSecret != "" && len(cfg.LoginCodeSecret) < minimumSecretLength {
		return Config{}, fmt.Errorf("LOGIN_CODE_SECRET minimal %d karakter", minimumSecretLength)
	}

	if cfg.ResendAPIKey == "" && cfg.Environment == "production" {
		return Config{}, errors.New("RESEND_API_KEY wajib diisi di production agar kode masuk benar-benar terkirim")
	}

	switch keys := strings.TrimSpace(os.Getenv("ENCRYPTION_KEYS")); {
	case keys != "":
		keyring, err := encryption.ParseKeys(keys)
		if err != nil {
			return Config{}, err
		}
		cfg.Encryption = keyring
	case local:
		cfg.Encryption, _ = encryption.ParseKeys(LocalEncryptionKeys)
	case cfg.Environment == "production":
		return Config{}, errors.New(`ENCRYPTION_KEYS wajib diisi di production; buat dengan: echo "1:$(openssl rand -hex 32)"`)
	}

	if (cfg.GoogleClientID == "") != (cfg.GoogleClientSecret == "") {
		return Config{}, errors.New("GOOGLE_CLIENT_ID dan GOOGLE_CLIENT_SECRET harus diisi berdua atau dikosongkan berdua")
	}

	return cfg, nil
}

func valueOrDefault(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}

	return fallback
}
