package httpapi

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jefthah/jdsign/apps/api/internal/auth"
	"github.com/jefthah/jdsign/apps/api/internal/database/sqlcdb"
	"github.com/jefthah/jdsign/apps/api/internal/encryption"
	"github.com/jefthah/jdsign/apps/api/internal/google"
	"github.com/jefthah/jdsign/apps/api/internal/mail"
	"github.com/jefthah/jdsign/apps/api/internal/ratelimit"
)

const maximumRequestBytes = 1 << 20

// DefaultAppURL is the Next.js development server, used when Settings.AppURL is empty.
const DefaultAppURL = "http://localhost:3000"

// developmentLoginCodeSecret keys stored codes when no secret is configured (tests and local).
const developmentLoginCodeSecret = "jdsign-local-development-login-code-secret"

// Settings configures the parts of the API that depend on the environment.
type Settings struct {
	// AppURL is the public origin of the site, e.g. https://jd-sign.com. Unsafe requests must
	// come from it, and sign-in redirects point at it.
	AppURL string
	// LoginCodeSecret keys the HMAC of stored sign-in codes.
	LoginCodeSecret string
	// Mailer sends sign-in codes. Nil writes them to the log.
	Mailer mail.Mailer
	// Google configures "Sign in with Google". An empty ClientID disables it.
	Google google.Config
	// Encryption seals admin authenticator secrets. Nil turns admin MFA, and so the admin area, off.
	Encryption *encryption.Keyring
}

// Server implements the operations from api/openapi.yaml on top of PostgreSQL.
type Server struct {
	pool          *pgxpool.Pool
	queries       *sqlcdb.Queries
	logger        *slog.Logger
	auth          *auth.Service
	limiter       *ratelimit.Limiter
	appURL        string
	appOrigin     string
	secureCookies bool
	google        google.Config
	stateKey      []byte
}

var _ StrictServerInterface = (*Server)(nil)

// NewServer creates the API implementation.
func NewServer(pool *pgxpool.Pool, logger *slog.Logger, settings Settings) *Server {
	appURL := strings.TrimRight(settings.AppURL, "/")
	parsed, err := url.Parse(appURL)
	if appURL == "" || err != nil || parsed.Scheme == "" || parsed.Host == "" {
		appURL = DefaultAppURL
		parsed, _ = url.Parse(appURL)
	}
	secret := settings.LoginCodeSecret
	if secret == "" {
		secret = developmentLoginCodeSecret
	}
	mailer := settings.Mailer
	if mailer == nil {
		mailer = mail.LogMailer{Logger: logger}
	}
	googleConfig := settings.Google
	if googleConfig.RedirectURL == "" {
		googleConfig.RedirectURL = appURL + "/api/v1/auth/google/callback"
	}
	stateKey := hmac.New(sha256.New, []byte(secret))
	stateKey.Write([]byte("google-oauth-state"))

	server := &Server{
		pool:          pool,
		logger:        logger,
		limiter:       ratelimit.New(),
		appURL:        appURL,
		appOrigin:     parsed.Scheme + "://" + parsed.Host,
		secureCookies: parsed.Scheme == "https",
		google:        googleConfig,
		stateKey:      stateKey.Sum(nil),
	}
	if pool != nil {
		server.queries = sqlcdb.New(pool)
		server.auth = auth.NewService(pool, mailer, []byte(secret), settings.Encryption)
	}

	return server
}

// NewHandler mounts the API under /api/v1 and adds the shared HTTP safeguards.
func NewHandler(server *Server) http.Handler {
	mux := http.NewServeMux()

	strict := NewStrictHandlerWithOptions(server, []StrictMiddlewareFunc{withHTTPExchange}, StrictHTTPServerOptions{
		RequestErrorHandlerFunc: func(w http.ResponseWriter, r *http.Request, err error) {
			writeError(w, http.StatusBadRequest, "bad_request", "Permintaan tidak valid.")
		},
		ResponseErrorHandlerFunc: func(w http.ResponseWriter, r *http.Request, err error) {
			server.logger.ErrorContext(r.Context(), "permintaan gagal", "method", r.Method, "path", r.URL.Path, "error", err)
			writeError(w, http.StatusInternalServerError, "server_error", "Terjadi kesalahan pada server. Silakan coba lagi.")
		},
	})
	HandlerWithOptions(strict, StdHTTPServerOptions{
		BaseURL:    "/api/v1",
		BaseRouter: mux,
		ErrorHandlerFunc: func(w http.ResponseWriter, r *http.Request, err error) {
			writeError(w, http.StatusBadRequest, "bad_request", "Permintaan tidak valid.")
		},
	})
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, "not_found", "Halaman API tidak ditemukan.")
	})

	return withSafeguards(withSameOrigin(mux, server.appOrigin), server.logger)
}

// GetHealth reports whether the API can reach the database.
func (s *Server) GetHealth(ctx context.Context, _ GetHealthRequestObject) (GetHealthResponseObject, error) {
	if s.pool == nil {
		return GetHealth503JSONResponse{Status: HealthStatusDegraded, Database: HealthDatabaseUnavailable}, nil
	}

	pingCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	if err := s.pool.Ping(pingCtx); err != nil {
		s.logger.WarnContext(ctx, "database tidak dapat dihubungi", "error", err)
		return GetHealth503JSONResponse{Status: HealthStatusDegraded, Database: HealthDatabaseUnavailable}, nil
	}

	return GetHealth200JSONResponse{Status: HealthStatusOk, Database: HealthDatabaseOk}, nil
}

// ListCategories returns every category ordered by name.
func (s *Server) ListCategories(ctx context.Context, _ ListCategoriesRequestObject) (ListCategoriesResponseObject, error) {
	rows, err := s.queries.ListCategories(ctx)
	if err != nil {
		return nil, fmt.Errorf("membaca kategori: %w", err)
	}

	categories := make([]Category, 0, len(rows))
	for _, row := range rows {
		category := Category{Id: row.ID, Name: row.Name, Slug: row.Slug}
		if row.Description.Valid {
			description := row.Description.String
			category.Description = &description
		}
		categories = append(categories, category)
	}

	return ListCategories200JSONResponse{Data: categories}, nil
}

func withSafeguards(next http.Handler, logger *slog.Logger) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		recorder := &statusRecorder{ResponseWriter: w, status: http.StatusOK}

		recorder.Header().Set("X-Content-Type-Options", "nosniff")
		recorder.Header().Set("Cache-Control", "no-store")
		r.Body = http.MaxBytesReader(recorder, r.Body, maximumRequestBytes)

		next.ServeHTTP(recorder, r)

		logger.InfoContext(r.Context(), "permintaan", "method", r.Method, "path", r.URL.Path, "status", recorder.status, "duration_ms", time.Since(started).Milliseconds())
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	var body Error
	body.Error.Code = code
	body.Error.Message = message

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
