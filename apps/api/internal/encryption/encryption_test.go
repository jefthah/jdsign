package encryption

import (
	"bytes"
	"errors"
	"strings"
	"testing"
)

var (
	firstKey  = strings.Repeat("11", KeySize)
	secondKey = strings.Repeat("22", KeySize)
)

func TestSealedValueOpensOnlyInItsOwnContext(t *testing.T) {
	keyring := mustParse(t, "1:"+firstKey)

	sealed, err := keyring.Seal([]byte("rahasia totp"), "users.totp_secret:7")
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(sealed, []byte("rahasia totp")) {
		t.Fatal("sealed value contains the plaintext")
	}

	opened, err := keyring.Open(sealed, "users.totp_secret:7")
	if err != nil || string(opened) != "rahasia totp" {
		t.Fatalf("Open() = %q, %v; want the original plaintext", opened, err)
	}
	if _, err := keyring.Open(sealed, "users.totp_secret:8"); !errors.Is(err, ErrCannotOpen) {
		t.Fatalf("Open() in another context error = %v, want ErrCannotOpen", err)
	}
}

func TestSealingTwiceGivesDifferentValues(t *testing.T) {
	keyring := mustParse(t, "1:"+firstKey)

	first, _ := keyring.Seal([]byte("sama"), "konteks")
	second, _ := keyring.Seal([]byte("sama"), "konteks")
	if bytes.Equal(first, second) {
		t.Fatal("two seals of the same plaintext are identical; the nonce is not random")
	}
}

func TestRotatedKeyringStillOpensOldValues(t *testing.T) {
	old := mustParse(t, "1:"+firstKey)
	sealed, _ := old.Seal([]byte("lama"), "konteks")

	rotated := mustParse(t, "2:"+secondKey+", 1:"+firstKey)
	if opened, err := rotated.Open(sealed, "konteks"); err != nil || string(opened) != "lama" {
		t.Fatalf("rotated Open() = %q, %v; want the value sealed with key 1", opened, err)
	}

	fresh, _ := rotated.Seal([]byte("baru"), "konteks")
	if fresh[0] != 2 {
		t.Fatalf("new value sealed with key %d, want the first listed key 2", fresh[0])
	}
	if _, err := old.Open(fresh, "konteks"); !errors.Is(err, ErrCannotOpen) {
		t.Fatalf("keyring without key 2 opened a value sealed with it: %v", err)
	}
}

func TestDamagedValueIsRejected(t *testing.T) {
	keyring := mustParse(t, "1:"+firstKey)
	sealed, _ := keyring.Seal([]byte("utuh"), "konteks")

	sealed[len(sealed)-1] ^= 0xff
	if _, err := keyring.Open(sealed, "konteks"); !errors.Is(err, ErrCannotOpen) {
		t.Fatalf("Open() of a damaged value error = %v, want ErrCannotOpen", err)
	}
	if _, err := keyring.Open([]byte{1, 2, 3}, "konteks"); !errors.Is(err, ErrCannotOpen) {
		t.Fatalf("Open() of a short value error = %v, want ErrCannotOpen", err)
	}
}

func TestParseKeysRejectsBadConfiguration(t *testing.T) {
	cases := map[string]string{
		"empty":        "",
		"no id":        firstKey,
		"id zero":      "0:" + firstKey,
		"id too large": "256:" + firstKey,
		"short key":    "1:abcd",
		"not hex":      "1:" + strings.Repeat("zz", KeySize),
		"duplicate id": "1:" + firstKey + ",1:" + secondKey,
	}

	for name, value := range cases {
		if _, err := ParseKeys(value); err == nil {
			t.Errorf("%s: ParseKeys(%q) succeeded", name, value)
		}
	}
}

func mustParse(t *testing.T, value string) *Keyring {
	t.Helper()

	keyring, err := ParseKeys(value)
	if err != nil {
		t.Fatalf("ParseKeys(%q): %v", value, err)
	}

	return keyring
}
