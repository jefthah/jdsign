package config

import "testing"

func TestLocalEnvironmentFallsBackToComposeDatabase(t *testing.T) {
	t.Setenv("APP_ENV", "")
	t.Setenv("DATABASE_URL", "")
	t.Setenv("HTTP_ADDR", "")

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
