package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/jefthah/jdsign/apps/api/internal/auth"
)

// adminMFAAttemptsPerMinute limits authenticator codes per admin; setup and verify share it.
const adminMFAAttemptsPerMinute = 5

// GetAdminMfaSetup returns the QR code contents while the admin's authenticator is not confirmed.
func (s *Server) GetAdminMfaSetup(ctx context.Context, _ GetAdminMfaSetupRequestObject) (GetAdminMfaSetupResponseObject, error) {
	admin, denied, err := s.adminSession(ctx, false)
	if err != nil {
		return nil, err
	}
	if denied != nil {
		return denied, nil
	}

	setup, err := s.auth.AdminMFASetup(ctx, admin.account)
	if failure := s.authProblem(ctx, err); failure != nil {
		return failure, nil
	}
	if err != nil {
		return nil, err
	}

	return GetAdminMfaSetup200JSONResponse{OtpauthUri: setup.URI, Secret: setup.Secret}, nil
}

// ConfirmAdminMfaSetup turns on the authenticator with one correct code.
func (s *Server) ConfirmAdminMfaSetup(ctx context.Context, request ConfirmAdminMfaSetupRequestObject) (ConfirmAdminMfaSetupResponseObject, error) {
	admin, denied, err := s.adminSession(ctx, false)
	if err != nil {
		return nil, err
	}
	if denied != nil {
		return denied, nil
	}
	if limited := s.limitAuthenticatorAttempts(admin.account); limited != nil {
		return limited, nil
	}

	var code string
	if request.Body != nil {
		code = request.Body.Code
	}
	err = s.auth.ConfirmAdminMFASetup(ctx, admin.account, admin.token, code)
	if failure := s.authProblem(ctx, err); failure != nil {
		return failure, nil
	}
	if err != nil {
		return nil, err
	}

	return ConfirmAdminMfaSetup204Response{}, nil
}

// VerifyAdminMfa unlocks the admin area for the current session.
func (s *Server) VerifyAdminMfa(ctx context.Context, request VerifyAdminMfaRequestObject) (VerifyAdminMfaResponseObject, error) {
	admin, denied, err := s.adminSession(ctx, false)
	if err != nil {
		return nil, err
	}
	if denied != nil {
		return denied, nil
	}
	if limited := s.limitAuthenticatorAttempts(admin.account); limited != nil {
		return limited, nil
	}

	var code string
	if request.Body != nil {
		code = request.Body.Code
	}
	err = s.auth.VerifyAdminMFA(ctx, admin.account, admin.token, code)
	if failure := s.authProblem(ctx, err); failure != nil {
		return failure, nil
	}
	if err != nil {
		return nil, err
	}

	return VerifyAdminMfa204Response{}, nil
}

// GetAdminOverview counts the work waiting for an admin.
func (s *Server) GetAdminOverview(ctx context.Context, _ GetAdminOverviewRequestObject) (GetAdminOverviewResponseObject, error) {
	_, denied, err := s.adminSession(ctx, true)
	if err != nil {
		return nil, err
	}
	if denied != nil {
		return denied, nil
	}

	row, err := s.queries.GetAdminOverview(ctx)
	if err != nil {
		return nil, fmt.Errorf("membaca ringkasan admin: %w", err)
	}

	return GetAdminOverview200JSONResponse{
		PendingSellers:      int(row.PendingSellers),
		PendingTemplates:    int(row.PendingTemplates),
		PendingPayouts:      int(row.PendingPayouts),
		PendingPayoutAmount: row.PendingPayoutAmount,
		OrdersInReview:      int(row.OrdersInReview),
	}, nil
}

type adminSession struct {
	account auth.Account
	token   string
}

// adminSession returns the signed-in admin, or the problem to answer with when the request may
// not use the admin area. Only the MFA endpoints pass requireMFA = false.
func (s *Server) adminSession(ctx context.Context, requireMFA bool) (adminSession, *problem, error) {
	cookie, err := exchangeFrom(ctx).request.Cookie(sessionCookieName)
	if err != nil {
		return adminSession{}, &problem{status: http.StatusUnauthorized, body: unauthenticatedBody()}, nil
	}
	account, err := s.auth.Authenticate(ctx, cookie.Value)
	if errors.Is(err, auth.ErrNoSession) {
		return adminSession{}, &problem{status: http.StatusUnauthorized, body: unauthenticatedBody()}, nil
	}
	if err != nil {
		return adminSession{}, nil, err
	}
	if failure := auth.AdminAccess(account, requireMFA); failure != nil {
		return adminSession{}, &problem{status: http.StatusForbidden, body: authErrorBody(failure)}, nil
	}

	return adminSession{account: account, token: cookie.Value}, nil, nil
}

func (s *Server) limitAuthenticatorAttempts(account auth.Account) *problem {
	allowed, wait := s.limiter.Allow("admin-mfa:"+strconv.FormatInt(account.ID, 10), adminMFAAttemptsPerMinute, time.Minute)
	if allowed {
		return nil
	}

	limited := tooManyRequests(wait)
	limited.Body.Error.Message = "Terlalu banyak percobaan. Tunggu satu menit, lalu coba lagi."

	return &problem{status: http.StatusTooManyRequests, body: limited.Body, retryAfter: *limited.Headers.RetryAfter}
}

// authProblem turns a user-facing auth.Error into a response; other errors return nil.
func (s *Server) authProblem(ctx context.Context, err error) *problem {
	var failure *auth.Error
	if !errors.As(err, &failure) {
		return nil
	}

	status := http.StatusUnprocessableEntity
	switch failure.Kind {
	case auth.KindForbidden:
		status = http.StatusForbidden
	case auth.KindConflict:
		status = http.StatusConflict
	case auth.KindUnavailable:
		status = http.StatusServiceUnavailable
		s.logger.ErrorContext(ctx, "MFA admin tidak tersedia", "code", failure.Code, "error", errors.Unwrap(failure))
	}

	return &problem{status: status, body: authErrorBody(failure)}
}

func unauthenticatedBody() Error {
	var body Error
	body.Error.Code = "unauthenticated"
	body.Error.Message = "Silakan masuk terlebih dahulu."

	return body
}

// problem is an error response that every admin operation can return, so the admin endpoints
// share one access check instead of mapping each failure to every generated response type.
// api/openapi.yaml documents the statuses it produces.
type problem struct {
	status     int
	body       Error
	retryAfter int
}

func (p *problem) write(w http.ResponseWriter) error {
	w.Header().Set("Content-Type", "application/json")
	if p.retryAfter > 0 {
		w.Header().Set("Retry-After", strconv.Itoa(p.retryAfter))
	}
	w.WriteHeader(p.status)

	return json.NewEncoder(w).Encode(p.body)
}

func (p *problem) VisitGetAdminMfaSetupResponse(w http.ResponseWriter) error { return p.write(w) }

func (p *problem) VisitConfirmAdminMfaSetupResponse(w http.ResponseWriter) error {
	return p.write(w)
}

func (p *problem) VisitVerifyAdminMfaResponse(w http.ResponseWriter) error { return p.write(w) }

func (p *problem) VisitGetAdminOverviewResponse(w http.ResponseWriter) error { return p.write(w) }
