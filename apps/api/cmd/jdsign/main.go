// Command jdsign runs the JD Sign API server and its maintenance tasks.
//
//	jdsign                   menjalankan API (sama dengan "jdsign serve")
//	jdsign migrate up        menerapkan migrasi yang belum dijalankan
//	jdsign migrate down      membatalkan migrasi terakhir
//	jdsign migrate status    menampilkan status migrasi
//	jdsign admin create --email EMAIL      menjadikan akun admin (dibuat jika belum ada)
//	jdsign admin reset-totp --email EMAIL  menghapus authenticator admin dan semua sesinya
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/jefthah/jdsign/apps/api/internal/admin"
	"github.com/jefthah/jdsign/apps/api/internal/config"
	"github.com/jefthah/jdsign/apps/api/internal/database"
	"github.com/jefthah/jdsign/apps/api/internal/google"
	"github.com/jefthah/jdsign/apps/api/internal/httpapi"
	"github.com/jefthah/jdsign/apps/api/internal/mail"
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
	case "admin":
		return runAdmin(ctx, cfg, args[1:], os.Stdout)
	default:
		return fmt.Errorf("perintah %q tidak dikenal; pakai serve, migrate up|down|status, atau admin create|reset-totp", command)
	}
}

// runAdmin handles "jdsign admin create|reset-totp --email EMAIL".
func runAdmin(ctx context.Context, cfg config.Config, args []string, out io.Writer) error {
	const usage = "pakai: jdsign admin create --email EMAIL, atau jdsign admin reset-totp --email EMAIL"
	if len(args) == 0 {
		return errors.New(usage)
	}

	flags := flag.NewFlagSet("jdsign admin "+args[0], flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	email := flags.String("email", "", "email akun admin")
	if err := flags.Parse(args[1:]); err != nil || *email == "" || flags.NArg() > 0 {
		return errors.New(usage)
	}

	pool, err := database.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	switch args[0] {
	case "create":
		created, err := admin.Create(ctx, pool, *email)
		if err != nil {
			return err
		}
		switch {
		case created.AlreadyAdmin:
			fmt.Fprintln(out, created.Email, "sudah admin. Tidak ada yang diubah.")
		case created.NewAccount:
			fmt.Fprintln(out, "Akun admin baru dibuat untuk", created.Email+".")
		default:
			fmt.Fprintln(out, created.Email, "sekarang admin.")
		}
		fmt.Fprintln(out, "Masuk dengan kode email atau Google, lalu buka /admin untuk memasang aplikasi authenticator.")
	case "reset-totp":
		if err := admin.ResetTOTP(ctx, pool, *email); err != nil {
			return err
		}
		fmt.Fprintln(out, "Authenticator", strings.ToLower(strings.TrimSpace(*email)), "dihapus dan semua sesinya diakhiri. Pasang ulang saat masuk berikutnya di /admin.")
	default:
		return errors.New(usage)
	}

	return nil
}

func serve(ctx context.Context, cfg config.Config, logger *slog.Logger) error {
	pool, err := database.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	server := &http.Server{
		Addr:              cfg.HTTPAddress,
		Handler:           httpapi.NewHandler(httpapi.NewServer(pool, logger, serverSettings(cfg, logger))),
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

// serverSettings turns the configuration into API settings. Without RESEND_API_KEY, sign-in codes
// are written to the log instead of being emailed.
func serverSettings(cfg config.Config, logger *slog.Logger) httpapi.Settings {
	settings := httpapi.Settings{
		AppURL:          cfg.AppURL,
		LoginCodeSecret: cfg.LoginCodeSecret,
		Mailer:          mail.LogMailer{Logger: logger},
		Google: google.Config{
			ClientID:     cfg.GoogleClientID,
			ClientSecret: cfg.GoogleClientSecret,
		},
	}
	if cfg.ResendAPIKey != "" {
		settings.Mailer = mail.NewResendMailer(cfg.ResendAPIKey, cfg.MailFrom)
	} else {
		logger.Warn("RESEND_API_KEY kosong: kode masuk hanya ditulis ke log, tidak dikirim lewat email")
	}
	if !settings.Google.Enabled() {
		logger.Info("GOOGLE_CLIENT_ID kosong: login Google dinonaktifkan")
	}
	settings.Encryption = cfg.Encryption
	if settings.Encryption == nil {
		logger.Warn("ENCRYPTION_KEYS kosong: panel admin tertutup karena authenticator admin tidak bisa disimpan")
	}

	return settings
}
