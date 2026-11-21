// Package catalog validates what an admin enters for categories and templates and makes their
// slugs (docs/spec.md 7.1). Messages are Indonesian and keyed by the API's JSON field names.
package catalog

import (
	"crypto/rand"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"golang.org/x/text/unicode/norm"
)

// Price limits in rupiah.
const (
	MinPrice = 10_000
	MaxPrice = 100_000_000
)

// FieldErrors maps a JSON field name to what is wrong with it. Empty means valid.
type FieldErrors map[string]string

// CategoryInput is a category as entered in the admin panel.
type CategoryInput struct {
	Name        string
	Slug        string
	Description string
}

var slugPattern = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)

// Clean trims the input, fills in the slug from the name when it is empty, and validates it.
func (in *CategoryInput) Clean() FieldErrors {
	in.Name = strings.TrimSpace(in.Name)
	in.Slug = strings.TrimSpace(in.Slug)
	in.Description = strings.TrimSpace(in.Description)
	if in.Slug == "" {
		in.Slug = Slugify(in.Name, 100)
	}

	problems := FieldErrors{}
	switch length := utf8.RuneCountInString(in.Name); {
	case length == 0:
		problems["name"] = "Nama kategori wajib diisi."
	case length > 80:
		problems["name"] = "Nama kategori maksimal 80 karakter."
	}
	switch {
	case in.Slug == "" && problems["name"] == "":
		problems["slug"] = "Slug wajib diisi dengan huruf atau angka."
	case len(in.Slug) > 100:
		problems["slug"] = "Slug maksimal 100 karakter."
	case in.Slug != "" && !slugPattern.MatchString(in.Slug):
		problems["slug"] = "Slug hanya boleh huruf kecil, angka, dan tanda hubung, misalnya landing-page."
	}
	if utf8.RuneCountInString(in.Description) > 255 {
		problems["description"] = "Deskripsi kategori maksimal 255 karakter."
	}

	return problems
}

// TemplateInput is a template's details as entered in the admin panel. Files are uploaded separately.
type TemplateInput struct {
	CategoryID  int64
	Title       string
	Summary     string
	Description string
	Price       int64
	Version     string
	Technology  string
	PreviewURL  string
}

// Clean trims the input and validates it. The category's existence is checked by the caller.
func (in *TemplateInput) Clean() FieldErrors {
	in.Title = strings.TrimSpace(in.Title)
	in.Summary = strings.TrimSpace(in.Summary)
	in.Description = strings.TrimSpace(strings.ReplaceAll(in.Description, "\r\n", "\n"))
	in.Version = strings.TrimSpace(in.Version)
	in.Technology = strings.TrimSpace(in.Technology)
	in.PreviewURL = strings.TrimSpace(in.PreviewURL)

	problems := FieldErrors{}
	if in.CategoryID < 1 {
		problems["categoryId"] = "Pilih kategori."
	}
	required(problems, "title", in.Title, 160, "Judul")
	required(problems, "summary", in.Summary, 240, "Ringkasan")
	switch length := utf8.RuneCountInString(in.Description); {
	case length < 30:
		problems["description"] = "Deskripsi minimal 30 karakter."
	case length > 20_000:
		problems["description"] = "Deskripsi maksimal 20.000 karakter."
	}
	if in.Price < MinPrice || in.Price > MaxPrice {
		problems["price"] = "Harga harus antara Rp10.000 dan Rp100.000.000."
	}
	required(problems, "version", in.Version, 40, "Versi")
	required(problems, "technology", in.Technology, 80, "Teknologi")
	if in.PreviewURL != "" {
		parsed, err := url.Parse(in.PreviewURL)
		switch {
		case len(in.PreviewURL) > 500:
			problems["previewUrl"] = "Link pratinjau maksimal 500 karakter."
		case err != nil || parsed.Scheme != "https" || parsed.Host == "" || !strings.HasPrefix(in.PreviewURL, "https://"):
			problems["previewUrl"] = "Link pratinjau harus diawali https://, misalnya https://arunika.jd-sign.com."
		}
	}

	return problems
}

func required(problems FieldErrors, field, value string, limit int, label string) {
	switch length := utf8.RuneCountInString(value); {
	case length == 0:
		problems[field] = label + " wajib diisi."
	case length > limit:
		problems[field] = label + " maksimal " + strconv.Itoa(limit) + " karakter."
	}
}

// Slugify turns text into lowercase words joined by hyphens, dropping accents and anything that
// is not a letter or digit, cut to at most limit bytes on a word boundary when possible.
func Slugify(text string, limit int) string {
	var builder strings.Builder
	pendingHyphen := false
	for _, r := range norm.NFKD.String(strings.ToLower(text)) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			if pendingHyphen && builder.Len() > 0 {
				builder.WriteByte('-')
			}
			pendingHyphen = false
			builder.WriteRune(r)
		case unicode.Is(unicode.Mn, r):
			// Accent marks left by NFKD, e.g. "é" becomes "e" + U+0301.
		default:
			pendingHyphen = true
		}
	}

	slug := builder.String()
	if len(slug) > limit {
		slug = slug[:limit]
		if cut := strings.LastIndexByte(slug, '-'); cut > limit/2 {
			slug = slug[:cut]
		}
		slug = strings.TrimRight(slug, "-")
	}

	return slug
}

// NewTemplateSlug returns slug(title) followed by eight random characters, e.g. "arunika-k3x9m2qa".
func NewTemplateSlug(title string) string {
	base := Slugify(title, 80)
	if base == "" {
		base = "template"
	}

	return base + "-" + randomSuffix(8)
}

func randomSuffix(length int) string {
	const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
	random := make([]byte, length)
	_, _ = rand.Read(random) // crypto/rand.Read never fails on supported platforms.
	for i, b := range random {
		random[i] = alphabet[int(b)%len(alphabet)]
	}

	return string(random)
}
