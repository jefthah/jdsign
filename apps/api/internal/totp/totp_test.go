package totp

import (
	"testing"
	"time"
)

// rfcSecret is the SHA-1 seed from RFC 6238 appendix B.
var rfcSecret = []byte("12345678901234567890")

func TestCodeMatchesRFC6238Vectors(t *testing.T) {
	// The RFC lists 8-digit codes; a 6-digit code is the last six of them.
	vectors := map[int64]string{
		59:          "287082",
		1111111109:  "081804",
		1111111111:  "050471",
		1234567890:  "005924",
		2000000000:  "279037",
		20000000000: "353130",
	}

	for unix, want := range vectors {
		if got := Code(rfcSecret, Step(time.Unix(unix, 0))); got != want {
			t.Errorf("Code at %d = %s, want %s", unix, got, want)
		}
	}
}

func TestMatchAllowsOneStepOfClockDrift(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	current := Step(now)

	for _, offset := range []int64{-1, 0, 1} {
		step, ok := Match(rfcSecret, Code(rfcSecret, current+offset), now)
		if !ok || step != current+offset {
			t.Errorf("code from step offset %d: Match = %d, %v; want step %d", offset, step, ok, current+offset)
		}
	}
	for _, offset := range []int64{-2, 2} {
		if _, ok := Match(rfcSecret, Code(rfcSecret, current+offset), now); ok {
			t.Errorf("code from step offset %d was accepted", offset)
		}
	}
}

func TestMatchRejectsMalformedCodes(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	code := Code(rfcSecret, Step(now))

	for _, input := range []string{"", code[:5], code + "0", "abcdef"} {
		if _, ok := Match(rfcSecret, input, now); ok {
			t.Errorf("Match accepted %q", input)
		}
	}
}

func TestURIIsReadableByAuthenticatorApps(t *testing.T) {
	uri := URI(rfcSecret, "JD Sign", "nadia@studioarunika.id")

	want := "otpauth://totp/JD%20Sign:nadia@studioarunika.id?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=JD%20Sign&algorithm=SHA1&digits=6&period=30"
	if uri != want {
		t.Fatalf("URI =\n%s\nwant\n%s", uri, want)
	}
}

func TestNewSecretIsRandom(t *testing.T) {
	first, err := NewSecret()
	if err != nil {
		t.Fatal(err)
	}
	second, _ := NewSecret()

	if len(first) != SecretSize || string(first) == string(second) {
		t.Fatalf("NewSecret returned %d bytes, repeated = %v", len(first), string(first) == string(second))
	}
}
