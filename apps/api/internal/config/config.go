// Package config reads JD Sign settings from environment variables.
package config

import (
	"errors"
	"fmt"
	"os"
)

// LocalDatabaseURL points at the PostgreSQL container from compose.dev.yml.
const LocalDatabaseURL = "postgres://jdsign:jdsign-dev@127.0.0.1:54329/jdsign?sslmode=disable"

// Config holds the settings the API needs at startup.
type Config struct {
	Environment string
	HTTPAddress string
	DatabaseURL string
}

// Load reads the configuration. DATABASE_URL may only be omitted when APP_ENV is local.
func Load() (Config, error) {
	cfg := Config{
		Environment: valueOrDefault("APP_ENV", "local"),
		HTTPAddress: valueOrDefault("HTTP_ADDR", "127.0.0.1:8300"),
		DatabaseURL: os.Getenv("DATABASE_URL"),
	}

	switch cfg.Environment {
	case "local", "staging", "production":
	default:
		return Config{}, fmt.Errorf("APP_ENV %q tidak dikenal; pakai local, staging, atau production", cfg.Environment)
	}

	if cfg.DatabaseURL == "" {
		if cfg.Environment != "local" {
			return Config{}, errors.New("DATABASE_URL wajib diisi jika APP_ENV bukan local")
		}
		cfg.DatabaseURL = LocalDatabaseURL
	}

	return cfg, nil
}

func valueOrDefault(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}

	return fallback
}
