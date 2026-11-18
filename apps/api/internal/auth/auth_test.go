package auth

import "testing"

func TestNameFromEmail(t *testing.T) {
	cases := map[string]string{
		"budi.santoso@mail.com":        "Budi Santoso",
		"nadia_putri+toko@gmail.com":   "Nadia Putri Toko",
		"rina-lestari2026@yahoo.co.id": "Rina Lestari",
		"12345@mail.com":               FallbackName,
		"._-+@mail.com":                FallbackName,
	}

	for email, want := range cases {
		if got := NameFromEmail(email); got != want {
			t.Errorf("NameFromEmail(%q) = %q, want %q", email, got, want)
		}
	}
}

func TestNormalizeEmail(t *testing.T) {
	valid := map[string]string{
		"  Nadia@StudioArunika.ID ": "nadia@studioarunika.id",
		"a.b+toko@sub.domain.co.id": "a.b+toko@sub.domain.co.id",
	}
	for raw, want := range valid {
		got, invalid := NormalizeEmail(raw)
		if invalid != nil || got != want {
			t.Errorf("NormalizeEmail(%q) = %q, %v; want %q", raw, got, invalid, want)
		}
	}

	for _, raw := range []string{"", "nadia", "nadia@", "@mail.com", "nadia@mail", "na dia@mail.com", "nadia@@mail.com", "nadia..x@mail.com", "nadia@-mail.com"} {
		if _, invalid := NormalizeEmail(raw); invalid == nil {
			t.Errorf("NormalizeEmail(%q) accepted an invalid address", raw)
		}
	}
}

func TestGeneratedCodesAreSixDigits(t *testing.T) {
	for range 200 {
		code, err := generateCode()
		if err != nil {
			t.Fatal(err)
		}
		if len(code) != 6 || digitsOnly(code) != code {
			t.Fatalf("generateCode() = %q, want six digits", code)
		}
	}
}
