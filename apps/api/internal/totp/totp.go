// Package totp implements RFC 6238 time-based one-time passwords as authenticator apps expect
// them: HMAC-SHA1, 6 digits, 30-second steps. See docs/spec.md section 4.4.
package totp

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/subtle"
	"encoding/base32"
	"encoding/binary"
	"fmt"
	"net/url"
	"strings"
	"time"
)

const (
	// SecretSize is the length of a new secret in bytes (160 bits, as RFC 4226 recommends).
	SecretSize = 20
	// Period is the length of one time step.
	Period = 30 * time.Second
	// Digits is the length of a code.
	Digits = 6
	// Skew is how many steps before and after the current one are still accepted.
	Skew = 1
)

var encoding = base32.StdEncoding.WithPadding(base32.NoPadding)

// NewSecret returns a random secret.
func NewSecret() ([]byte, error) {
	secret := make([]byte, SecretSize)
	if _, err := rand.Read(secret); err != nil {
		return nil, err
	}

	return secret, nil
}

// EncodeSecret returns the secret in the base32 form people type into an authenticator app.
func EncodeSecret(secret []byte) string {
	return encoding.EncodeToString(secret)
}

// Step returns the time step that t falls in.
func Step(t time.Time) int64 {
	return t.Unix() / int64(Period.Seconds())
}

// Code returns the code for one time step.
func Code(secret []byte, step int64) string {
	var counter [8]byte
	binary.BigEndian.PutUint64(counter[:], uint64(step))

	mac := hmac.New(sha1.New, secret)
	mac.Write(counter[:])
	sum := mac.Sum(nil)

	offset := sum[len(sum)-1] & 0x0f
	value := binary.BigEndian.Uint32(sum[offset:offset+4]) & 0x7fffffff

	return fmt.Sprintf("%0*d", Digits, value%1_000_000)
}

// Match reports whether code is valid at now, allowing Skew steps of clock drift, and returns
// the step it belongs to. Callers must reject steps that were already used.
func Match(secret []byte, code string, now time.Time) (int64, bool) {
	if len(code) != Digits {
		return 0, false
	}

	current := Step(now)
	for step := current - Skew; step <= current+Skew; step++ {
		if subtle.ConstantTimeCompare([]byte(Code(secret, step)), []byte(code)) == 1 {
			return step, true
		}
	}

	return 0, false
}

// URI returns the otpauth:// link that authenticator apps read from a QR code, for example
// otpauth://totp/JD%20Sign:nadia@example.com?secret=...&issuer=JD%20Sign.
func URI(secret []byte, issuer, account string) string {
	return fmt.Sprintf("otpauth://totp/%s:%s?secret=%s&issuer=%s&algorithm=SHA1&digits=%d&period=%d",
		escape(issuer), url.PathEscape(account), EncodeSecret(secret), escape(issuer), Digits, int(Period.Seconds()))
}

// escape percent-encodes a value with %20 for spaces; some authenticator apps show "+" literally.
func escape(value string) string {
	return strings.ReplaceAll(url.QueryEscape(value), "+", "%20")
}
