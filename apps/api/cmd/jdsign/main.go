// Command jdsign runs the JD Sign API server and its maintenance tasks.
//
//	jdsign                   menjalankan API (sama dengan "jdsign serve")
//	jdsign migrate up        menerapkan migrasi yang belum dijalankan
//	jdsign migrate down      membatalkan migrasi terakhir
//	jdsign migrate status    menampilkan status migrasi
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jefthah/jdsign/apps/api/internal/config"
	"github.com/jefthah/jdsign/apps/api/internal/database"
	"github.com/jefthah/jdsign/apps/api/internal/httpapi"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	if err := run(os.Args[1:], logger); err != nil {
		logger.Error("jdsign berhenti", "error", err)
		os.Exit(1)
	}
}

func run(args []string, logger *slog.Logger) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	command := "serve"
	if len(args) > 0 {
		command = args[0]
	}

	switch command {
	case "serve":
		return serve(ctx, cfg, logger)
	case "migrate":
		migration := "up"
		if len(args) > 1 {
			migration = args[1]
		}
		pool, err := database.Connect(ctx, cfg.DatabaseURL)
		if err != nil {
			return err
		}
		defer pool.Close()
		return database.Migrate(ctx, pool, migration, os.Stdout)
	default:
		return fmt.Errorf("perintah %q tidak dikenal; pakai serve atau migrate up|down|status", command)
	}
}

func serve(ctx context.Context, cfg config.Config, logger *slog.Logger) error {
	pool, err := database.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	server := &http.Server{
		Addr:              cfg.HTTPAddress,
		Handler:           httpapi.NewHandler(httpapi.NewServer(pool, logger)),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       60 * time.Second,
		WriteTimeout:      120 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	serveErrors := make(chan error, 1)
	go func() {
		logger.Info("API berjalan", "address", cfg.HTTPAddress, "environment", cfg.Environment)
		serveErrors <- server.ListenAndServe()
	}()

	select {
	case err := <-serveErrors:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
	}

	logger.Info("menghentikan API")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	return server.Shutdown(shutdownCtx)
}
