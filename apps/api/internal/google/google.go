// Package google implements "Sign in with Google" with the OAuth 2.0 authorization code flow,
// PKCE (S256), state, and nonce.
package google

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	// DefaultAuthURL is Google's authorization endpoint.
	DefaultAuthURL = "https://accounts.google.com/o/oauth2/v2/auth"
	// DefaultTokenURL is Google's token endpoint.
	DefaultTokenURL = "https://oauth2.googleapis.com/token"
)

// ErrEmailNotVerified means Google does not vouch for the account's email address.
var ErrEmailNotVerified = errors.New("email Google belum terverifikasi")

// Config holds the OAuth client. A zero ClientID disables Google sign-in.
type Config struct {
	ClientID     string
	ClientSecret string
	RedirectURL  string
	AuthURL      string
	TokenURL     string
	HTTPClient   *http.Client
	Now          func() time.Time
}

// Identity is the verified subset of the ID token's claims.
type Identity struct {
	Subject string
	Email   string
	Name    string
}

// Enabled reports whether Google sign-in is configured.
func (c Config) Enabled() bool {
	return c.ClientID != "" && c.ClientSecret != ""
}

// NewSecret returns a random URL-safe string for state, nonce, or the PKCE verifier.
func NewSecret() (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}

	return base64.RawURLEncoding.EncodeToString(raw), nil
}

// AuthCodeURL is where the browser goes to choose a Google account.
func (c Config) AuthCodeURL(state, nonce, verifier string) string {
	challenge := sha256.Sum256([]byte(verifier))
	query := url.Values{
		"client_id":             {c.ClientID},
		"redirect_uri":          {c.RedirectURL},
		"response_type":         {"code"},
		"scope":                 {"openid email profile"},
		"state":                 {state},
		"nonce":                 {nonce},
		"code_challenge":        {base64.RawURLEncoding.EncodeToString(challenge[:])},
		"code_challenge_method": {"S256"},
		"prompt":                {"select_account"},
	}

	return c.authURL() + "?" + query.Encode()
}

// Exchange trades the authorization code for an ID token and checks its claims.
//
// The ID token comes straight from Google's token endpoint over TLS, which OpenID Connect Core
// 3.1.3.7 accepts in place of checking the token signature. iss, aud, exp, and nonce are checked.
func (c Config) Exchange(ctx context.Context, code, verifier, nonce string) (Identity, error) {
	form := url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {code},
		"code_verifier": {verifier},
		"client_id":     {c.ClientID},
		"client_secret": {c.ClientSecret},
		"redirect_uri":  {c.RedirectURL},
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.tokenURL(), strings.NewReader(form.Encode()))
	if err != nil {
		return Identity{}, err
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	request.Header.Set("Accept", "application/json")

	response, err := c.httpClient().Do(request)
	if err != nil {
		return Identity{}, fmt.Errorf("menghubungi Google: %w", err)
	}
	defer response.Body.Close()

	body, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return Identity{}, err
	}
	if response.StatusCode != http.StatusOK {
		return Identity{}, fmt.Errorf("google menolak kode (status %d): %.200s", response.StatusCode, body)
	}

	var tokens struct {
		IDToken string `json:"id_token"`
	}
	if err := json.Unmarshal(body, &tokens); err != nil || tokens.IDToken == "" {
		return Identity{}, errors.New("jawaban Google tidak berisi id_token")
	}

	return c.verifyClaims(tokens.IDToken, nonce)
}

type claims struct {
	Issuer        string          `json:"iss"`
	Audience      json.RawMessage `json:"aud"`
	Expires       int64           `json:"exp"`
	Nonce         string          `json:"nonce"`
	Subject       string          `json:"sub"`
	Email         string          `json:"email"`
	EmailVerified json.RawMessage `json:"email_verified"`
	Name          string          `json:"name"`
}

func (c Config) verifyClaims(idToken, nonce string) (Identity, error) {
	parts := strings.Split(idToken, ".")
	if len(parts) != 3 {
		return Identity{}, errors.New("id_token tidak berformat JWT")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return Identity{}, fmt.Errorf("membaca id_token: %w", err)
	}

	var token claims
	if err := json.Unmarshal(payload, &token); err != nil {
		return Identity{}, fmt.Errorf("membaca klaim id_token: %w", err)
	}

	switch {
	case token.Issuer != "https://accounts.google.com" && token.Issuer != "accounts.google.com":
		return Identity{}, fmt.Errorf("iss id_token tidak dikenal: %q", token.Issuer)
	case !audienceIncludes(token.Audience, c.ClientID):
		return Identity{}, errors.New("aud id_token bukan untuk aplikasi ini")
	case c.now().Unix() >= token.Expires:
		return Identity{}, errors.New("id_token sudah kedaluwarsa")
	case nonce == "" || token.Nonce != nonce:
		return Identity{}, errors.New("nonce id_token tidak cocok")
	case token.Subject == "" || token.Email == "":
		return Identity{}, errors.New("id_token tidak berisi sub atau email")
	case !isTrue(token.EmailVerified):
		return Identity{}, ErrEmailNotVerified
	}

	return Identity{Subject: token.Subject, Email: token.Email, Name: token.Name}, nil
}

func audienceIncludes(raw json.RawMessage, clientID string) bool {
	var single string
	if json.Unmarshal(raw, &single) == nil {
		return single == clientID
	}
	var many []string
	if json.Unmarshal(raw, &many) == nil {
		for _, audience := range many {
			if audience == clientID {
				return true
			}
		}
	}

	return false
}

func isTrue(raw json.RawMessage) bool {
	var flag bool
	if json.Unmarshal(raw, &flag) == nil {
		return flag
	}
	var text string
	return json.Unmarshal(raw, &text) == nil && text == "true"
}

func (c Config) authURL() string {
	if c.AuthURL != "" {
		return c.AuthURL
	}
	return DefaultAuthURL
}

func (c Config) tokenURL() string {
	if c.TokenURL != "" {
		return c.TokenURL
	}
	return DefaultTokenURL
}

func (c Config) httpClient() *http.Client {
	if c.HTTPClient != nil {
		return c.HTTPClient
	}
	return &http.Client{Timeout: 10 * time.Second}
}

func (c Config) now() time.Time {
	if c.Now != nil {
		return c.Now()
	}
	return time.Now()
}
