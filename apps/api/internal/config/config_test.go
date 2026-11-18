package config

import "testing"

func TestLocalEnvironmentFallsBackToComposeDatabase(t *testing.T) {
	t.Setenv("APP_ENV", "")
	t.Setenv("DATABASE_URL", "")
	t.Setenv("HTTP_ADDR", "")
	t.Setenv("APP_URL", "")
	t.Setenv("LOGIN_CODE_SECRET", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.Environment != "local" || cfg.DatabaseURL != LocalDatabaseURL || cfg.HTTPAddress != "127.0.0.1:8300" {
		t.Fatalf("Load() = %+v, want local defaults", cfg)
	}
}

func TestStagingRequiresDatabaseURL(t *testing.T) {
	t.Setenv("APP_ENV", "staging")
	t.Setenv("DATABASE_URL", "")

	if _, err := Load(); err == nil {
		t.Fatal("Load() succeeded without DATABASE_URL on staging")
	}
}

func TestUnknownEnvironmentIsRejected(t *testing.T) {
	t.Setenv("APP_ENV", "prod")
	t.Setenv("DATABASE_URL", "postgres://example")

	if _, err := Load(); err == nil {
		t.Fatal("Load() accepted APP_ENV=prod")
	}
}

func TestStagingRequiresAppURLAndLoginCodeSecret(t *testing.T) {
	t.Setenv("APP_ENV", "staging")
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("RESEND_API_KEY", "")
	t.Setenv("GOOGLE_CLIENT_ID", "")
	t.Setenv("GOOGLE_CLIENT_SECRET", "")

	t.Setenv("APP_URL", "")
	t.Setenv("LOGIN_CODE_SECRET", "0123456789abcdef0123456789abcdef")
	if _, err := Load(); err == nil {
		t.Fatal("Load() succeeded without APP_URL on staging")
	}

	t.Setenv("APP_URL", "https://staging.jd-sign.com/")
	t.Setenv("LOGIN_CODE_SECRET", "")
	if _, err := Load(); err == nil {
		t.Fatal("Load() succeeded without LOGIN_CODE_SECRET on staging")
	}

	t.Setenv("LOGIN_CODE_SECRET", "terlalu-pendek")
	if _, err := Load(); err == nil {
		t.Fatal("Load() accepted a short LOGIN_CODE_SECRET")
	}

	t.Setenv("LOGIN_CODE_SECRET", "0123456789abcdef0123456789abcdef")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.AppURL != "https://staging.jd-sign.com" || cfg.MailFrom != DefaultMailFrom {
		t.Fatalf("Load() = %+v, want trimmed APP_URL and default sender", cfg)
	}
}

func TestStagingRejectsPlainHTTPAppURL(t *testing.T) {
	t.Setenv("APP_ENV", "staging")
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("APP_URL", "http://staging.jd-sign.com")
	t.Setenv("LOGIN_CODE_SECRET", "0123456789abcdef0123456789abcdef")

	if _, err := Load(); err == nil {
		t.Fatal("Load() accepted an http APP_URL on staging")
	}
}

func TestProductionRequiresResendAPIKey(t *testing.T) {
	t.Setenv("APP_ENV", "production")
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("APP_URL", "https://jd-sign.com")
	t.Setenv("LOGIN_CODE_SECRET", "0123456789abcdef0123456789abcdef")
	t.Setenv("RESEND_API_KEY", "")

	if _, err := Load(); err == nil {
		t.Fatal("Load() succeeded without RESEND_API_KEY on production")
	}
}

func TestGoogleCredentialsComeInPairs(t *testing.T) {
	t.Setenv("APP_ENV", "local")
	t.Setenv("GOOGLE_CLIENT_ID", "client-id")
	t.Setenv("GOOGLE_CLIENT_SECRET", "")

	if _, err := Load(); err == nil {
		t.Fatal("Load() accepted GOOGLE_CLIENT_ID without GOOGLE_CLIENT_SECRET")
	}
}
