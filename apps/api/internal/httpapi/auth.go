package httpapi

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"time"

	"github.com/jefthah/jdsign/apps/api/internal/auth"
	"github.com/jefthah/jdsign/apps/api/internal/google"
)

const (
	sessionCookieName = "jdsign_session"
	googleCookieName  = "jdsign_google"
	googleCookiePath  = "/api/v1/auth/google"
	googleStateMaxAge = 10 * time.Minute
	defaultNextPath   = "/account"
)

// httpExchangeKey stores the request and response writer in the context, so strict handlers can
// read cookies and the client address and set cookies before the response is written.
type httpExchangeKey struct{}

type httpExchange struct {
	writer  http.ResponseWriter
	request *http.Request
}

func withHTTPExchange(next StrictHandlerFunc, _ string) StrictHandlerFunc {
	return func(ctx context.Context, w http.ResponseWriter, r *http.Request, request any) (any, error) {
		return next(context.WithValue(ctx, httpExchangeKey{}, httpExchange{writer: w, request: r}), w, r, request)
	}
}

func exchangeFrom(ctx context.Context) httpExchange {
	exchange, _ := ctx.Value(httpExchangeKey{}).(httpExchange)
	return exchange
}

// withSameOrigin rejects state-changing requests whose Origin header is not the site's own origin.
// This is the API's CSRF protection; the session cookie is also SameSite=Lax.
func withSameOrigin(next http.Handler, appOrigin string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
		default:
			if r.Header.Get("Origin") != appOrigin {
				writeError(w, http.StatusForbidden, "origin_rejected", "Permintaan ditolak karena tidak berasal dari situs JD Sign.")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

// RequestLoginCode emails a sign-in code.
func (s *Server) RequestLoginCode(ctx context.Context, request RequestLoginCodeRequestObject) (RequestLoginCodeResponseObject, error) {
	exchange := exchangeFrom(ctx)
	if allowed, wait := s.limiter.Allow("code-ip:"+clientIP(exchange.request), 6, time.Minute); !allowed {
		return RequestLoginCode429JSONResponse{tooManyRequests(wait)}, nil
	}

	var rawEmail string
	if request.Body != nil {
		rawEmail = request.Body.Email
	}
	email, invalid := auth.NormalizeEmail(rawEmail)
	if invalid != nil {
		return RequestLoginCode422JSONResponse{ValidationFailedJSONResponse(authErrorBody(invalid))}, nil
	}
	if allowed, wait := s.limiter.Allow("code-email:"+email, 8, time.Hour); !allowed {
		return RequestLoginCode429JSONResponse{tooManyRequests(wait)}, nil
	}

	status, err := s.auth.RequestCode(ctx, email)
	var failure *auth.Error
	if errors.As(err, &failure) {
		if failure.Kind == auth.KindUnavailable {
			s.logger.ErrorContext(ctx, "email kode masuk gagal dikirim", "error", errors.Unwrap(failure))
			return RequestLoginCode503JSONResponse{ServiceUnavailableJSONResponse(authErrorBody(failure))}, nil
		}
		return RequestLoginCode422JSONResponse{ValidationFailedJSONResponse(authErrorBody(failure))}, nil
	}
	if err != nil {
		return nil, err
	}

	return RequestLoginCode200JSONResponse{
		Email:              status.Email,
		Sent:               status.Sent,
		SecondsUntilResend: status.SecondsUntilResend,
		ExpiresInSeconds:   status.ExpiresInSeconds,
	}, nil
}

// VerifyLoginCode checks a sign-in code and sets the session cookie.
func (s *Server) VerifyLoginCode(ctx context.Context, request VerifyLoginCodeRequestObject) (VerifyLoginCodeResponseObject, error) {
	exchange := exchangeFrom(ctx)
	if allowed, wait := s.limiter.Allow("verify-ip:"+clientIP(exchange.request), 10, time.Minute); !allowed {
		return VerifyLoginCode429JSONResponse{tooManyRequests(wait)}, nil
	}

	var body VerifyLoginCodeRequest
	if request.Body != nil {
		body = *request.Body
	}
	remember := body.Remember != nil && *body.Remember

	account, token, err := s.auth.VerifyCode(ctx, body.Email, body.Code, remember, clientOf(exchange.request))
	var failure *auth.Error
	if errors.As(err, &failure) {
		if failure.Kind == auth.KindForbidden {
			return VerifyLoginCode403JSONResponse{ForbiddenJSONResponse(authErrorBody(failure))}, nil
		}
		return VerifyLoginCode422JSONResponse{ValidationFailedJSONResponse(authErrorBody(failure))}, nil
	}
	if err != nil {
		return nil, err
	}

	s.setSessionCookie(exchange.writer, token, remember)

	return VerifyLoginCode200JSONResponse(accountBody(account)), nil
}

// GetMe returns the signed-in account.
func (s *Server) GetMe(ctx context.Context, _ GetMeRequestObject) (GetMeResponseObject, error) {
	account, err := s.currentAccount(ctx)
	if errors.Is(err, auth.ErrNoSession) {
		return GetMe401JSONResponse{UnauthorizedJSONResponse(unauthenticatedBody())}, nil
	}
	if err != nil {
		return nil, err
	}

	return GetMe200JSONResponse(accountBody(account)), nil
}

// Logout deletes the current session and clears its cookie.
func (s *Server) Logout(ctx context.Context, _ LogoutRequestObject) (LogoutResponseObject, error) {
	exchange := exchangeFrom(ctx)
	if cookie, err := exchange.request.Cookie(sessionCookieName); err == nil {
		if err := s.auth.Logout(ctx, cookie.Value); err != nil {
			return nil, fmt.Errorf("menghapus sesi: %w", err)
		}
	}
	s.clearCookie(exchange.writer, sessionCookieName, "/")

	return Logout204Response{}, nil
}

// StartGoogleLogin sends the browser to Google with a fresh state, nonce, and PKCE verifier.
func (s *Server) StartGoogleLogin(ctx context.Context, request StartGoogleLoginRequestObject) (StartGoogleLoginResponseObject, error) {
	if !s.google.Enabled() {
		return s.loginErrorRedirect("google_unavailable"), nil
	}

	var state googleState
	var err error
	if state.State, err = google.NewSecret(); err != nil {
		return nil, err
	}
	if state.Nonce, err = google.NewSecret(); err != nil {
		return nil, err
	}
	if state.Verifier, err = google.NewSecret(); err != nil {
		return nil, err
	}
	state.Next = defaultNextPath
	if request.Params.Next != nil {
		state.Next = safeNextPath(*request.Params.Next)
	}

	http.SetCookie(exchangeFrom(ctx).writer, &http.Cookie{
		Name:     googleCookieName,
		Value:    s.sealGoogleState(state),
		Path:     googleCookiePath,
		MaxAge:   int(googleStateMaxAge.Seconds()),
		HttpOnly: true,
		Secure:   s.secureCookies,
		SameSite: http.SameSiteLaxMode,
	})

	return StartGoogleLogin302Response{Headers: RedirectResponseHeaders{
		Location: s.google.AuthCodeURL(state.State, state.Nonce, state.Verifier),
	}}, nil
}

// FinishGoogleLogin handles Google's redirect: it checks state, exchanges the code, signs the
// person in, and redirects back to the site.
func (s *Server) FinishGoogleLogin(ctx context.Context, request FinishGoogleLoginRequestObject) (FinishGoogleLoginResponseObject, error) {
	exchange := exchangeFrom(ctx)
	s.clearCookie(exchange.writer, googleCookieName, googleCookiePath)

	if !s.google.Enabled() {
		return s.loginErrorRedirect("google_unavailable"), nil
	}
	if request.Params.Error != nil {
		if *request.Params.Error == "access_denied" {
			return s.loginErrorRedirect("google_cancelled"), nil
		}
		return s.loginErrorRedirect("google_failed"), nil
	}

	cookie, err := exchange.request.Cookie(googleCookieName)
	if err != nil {
		return s.loginErrorRedirect("google_state"), nil
	}
	state, ok := s.openGoogleState(cookie.Value)
	if !ok || request.Params.State == nil || !hmac.Equal([]byte(*request.Params.State), []byte(state.State)) || request.Params.Code == nil {
		return s.loginErrorRedirect("google_state"), nil
	}

	identity, err := s.google.Exchange(ctx, *request.Params.Code, state.Verifier, state.Nonce)
	if errors.Is(err, google.ErrEmailNotVerified) {
		return s.loginErrorRedirect("google_unverified"), nil
	}
	if err != nil {
		s.logger.WarnContext(ctx, "login Google gagal", "error", err)
		return s.loginErrorRedirect("google_failed"), nil
	}

	_, token, err := s.auth.SignInWithGoogle(ctx, auth.GoogleIdentity(identity), clientOf(exchange.request))
	var failure *auth.Error
	if errors.As(err, &failure) {
		if failure.Kind == auth.KindForbidden {
			return s.loginErrorRedirect("account_inactive"), nil
		}
		return s.loginErrorRedirect("google_failed"), nil
	}
	if err != nil {
		return nil, err
	}

	s.setSessionCookie(exchange.writer, token, true)

	return FinishGoogleLogin302Response{Headers: RedirectResponseHeaders{Location: s.appURL + state.Next}}, nil
}

func (s *Server) currentAccount(ctx context.Context) (auth.Account, error) {
	cookie, err := exchangeFrom(ctx).request.Cookie(sessionCookieName)
	if err != nil {
		return auth.Account{}, auth.ErrNoSession
	}

	return s.auth.Authenticate(ctx, cookie.Value)
}

func (s *Server) setSessionCookie(w http.ResponseWriter, token string, remember bool) {
	cookie := &http.Cookie{
		Name:     sessionCookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   s.secureCookies,
		SameSite: http.SameSiteLaxMode,
	}
	if remember {
		cookie.MaxAge = int(auth.RememberLifetime.Seconds())
	}
	http.SetCookie(w, cookie)
}

func (s *Server) clearCookie(w http.ResponseWriter, name, path string) {
	http.SetCookie(w, &http.Cookie{
		Name:     name,
		Value:    "",
		Path:     path,
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   s.secureCookies,
		SameSite: http.SameSiteLaxMode,
	})
}

func (s *Server) loginErrorRedirect(code string) RedirectResponse {
	return RedirectResponse{Headers: RedirectResponseHeaders{Location: s.appURL + "/login?error=" + url.QueryEscape(code)}}
}

// googleState travels in a signed, HttpOnly cookie between the start and the callback.
type googleState struct {
	State    string    `json:"s"`
	Nonce    string    `json:"n"`
	Verifier string    `json:"v"`
	Next     string    `json:"r"`
	Issued   time.Time `json:"t"`
}

func (s *Server) sealGoogleState(state googleState) string {
	state.Issued = time.Now()
	payload, _ := json.Marshal(state)
	encoded := base64.RawURLEncoding.EncodeToString(payload)

	return encoded + "." + base64.RawURLEncoding.EncodeToString(s.signState(encoded))
}

func (s *Server) openGoogleState(value string) (googleState, bool) {
	encoded, signature, found := strings.Cut(value, ".")
	if !found {
		return googleState{}, false
	}
	given, err := base64.RawURLEncoding.DecodeString(signature)
	if err != nil || !hmac.Equal(given, s.signState(encoded)) {
		return googleState{}, false
	}
	payload, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		return googleState{}, false
	}
	var state googleState
	if json.Unmarshal(payload, &state) != nil || time.Since(state.Issued) > googleStateMaxAge {
		return googleState{}, false
	}
	state.Next = safeNextPath(state.Next)

	return state, true
}

func (s *Server) signState(encoded string) []byte {
	mac := hmac.New(sha256.New, s.stateKey)
	mac.Write([]byte(encoded))
	return mac.Sum(nil)
}

// safeNextPath keeps redirects on this site: only absolute paths are allowed.
func safeNextPath(next string) string {
	if len(next) > 500 || !strings.HasPrefix(next, "/") || strings.HasPrefix(next, "//") || strings.ContainsAny(next, "\\\r\n\t") {
		return defaultNextPath
	}
	parsed, err := url.Parse(next)
	if err != nil || parsed.Scheme != "" || parsed.Host != "" {
		return defaultNextPath
	}

	return next
}

// clientIP returns the visitor's address. Behind Caddy the TCP peer is a private or loopback
// address and the visitor is the last entry Caddy wrote to X-Forwarded-For.
func clientIP(r *http.Request) string {
	if r == nil {
		return ""
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	peer, err := netip.ParseAddr(host)
	if err == nil && (peer.IsLoopback() || peer.IsPrivate()) {
		if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
			entries := strings.Split(forwarded, ",")
			if candidate, err := netip.ParseAddr(strings.TrimSpace(entries[len(entries)-1])); err == nil {
				return candidate.Unmap().String()
			}
		}
	}
	if err != nil {
		return host
	}

	return peer.Unmap().String()
}

func clientOf(r *http.Request) auth.Client {
	return auth.Client{IP: clientIP(r), UserAgent: r.UserAgent()}
}

func accountBody(account auth.Account) Account {
	return Account{
		Id:            account.ID,
		Name:          account.Name,
		Email:         account.Email,
		Role:          AccountRole(account.Role),
		EmailVerified: account.EmailVerified,
	}
}

func authErrorBody(failure *auth.Error) Error {
	var body Error
	body.Error.Code = failure.Code
	body.Error.Message = failure.Message
	if failure.Field != "" {
		body.Error.Fields = &map[string]string{failure.Field: failure.Message}
	}

	return body
}

func tooManyRequests(wait time.Duration) TooManyRequestsJSONResponse {
	seconds := int(wait.Round(time.Second).Seconds())
	if seconds < 1 {
		seconds = 1
	}
	message := fmt.Sprintf("Terlalu banyak percobaan. Coba lagi dalam %d detik.", seconds)
	if seconds > 90 {
		message = fmt.Sprintf("Terlalu banyak percobaan. Coba lagi dalam %d menit.", (seconds+59)/60)
	}

	var body Error
	body.Error.Code = "rate_limited"
	body.Error.Message = message

	return TooManyRequestsJSONResponse{Body: body, Headers: TooManyRequestsResponseHeaders{RetryAfter: &seconds}}
}
