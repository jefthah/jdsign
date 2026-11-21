package catalog

import (
	"regexp"
	"strings"
	"testing"
)

func TestSlugify(t *testing.T) {
	tests := map[string]string{
		"Landing Page":             "landing-page",
		"  Toko   Online!! ":       "toko-online",
		"Café & Résumé 2026":       "cafe-resume-2026",
		"Next.js + Tailwind":       "next-js-tailwind",
		"日本語":                      "",
		"---":                      "",
		"Portfolio / Kreatif / UI": "portfolio-kreatif-ui",
	}
	for input, want := range tests {
		if got := Slugify(input, 100); got != want {
			t.Errorf("Slugify(%q) = %q, want %q", input, got, want)
		}
	}

	long := Slugify(strings.Repeat("kata ", 40), 30)
	if len(long) > 30 || strings.HasSuffix(long, "-") || strings.HasSuffix(long, "kat") {
		t.Errorf("long slug = %q, want at most 30 bytes cut between words", long)
	}
}

func TestNewTemplateSlug(t *testing.T) {
	pattern := regexp.MustCompile(`^arunika-studio-[a-z0-9]{8}$`)
	first, second := NewTemplateSlug("Arunika Studio"), NewTemplateSlug("Arunika Studio")
	if !pattern.MatchString(first) || first == second {
		t.Fatalf("slugs = %q, %q; want arunika-studio-<8 random characters>, different each time", first, second)
	}
	if got := NewTemplateSlug("???"); !strings.HasPrefix(got, "template-") {
		t.Fatalf("slug for a title without letters = %q", got)
	}
}

func TestCategoryInput(t *testing.T) {
	input := CategoryInput{Name: "  Landing Page "}
	if problems := input.Clean(); len(problems) != 0 || input.Slug != "landing-page" || input.Name != "Landing Page" {
		t.Fatalf("problems = %v, input = %+v", problems, input)
	}

	bad := CategoryInput{Name: "", Slug: "Bukan Slug", Description: strings.Repeat("x", 256)}
	problems := bad.Clean()
	for _, field := range []string{"name", "slug", "description"} {
		if problems[field] == "" {
			t.Errorf("no problem reported for %s: %v", field, problems)
		}
	}
}

func validTemplate() TemplateInput {
	return TemplateInput{
		CategoryID:  1,
		Title:       " Arunika ",
		Summary:     "Portfolio studio kreatif",
		Description: "Template portfolio satu halaman untuk studio kreatif kecil.",
		Price:       249_000,
		Version:     "1.0.0",
		Technology:  "Next.js + Tailwind",
		PreviewURL:  "https://arunika.jd-sign.com",
	}
}

func TestTemplateInput(t *testing.T) {
	input := validTemplate()
	if problems := input.Clean(); len(problems) != 0 || input.Title != "Arunika" {
		t.Fatalf("valid template refused: %v", problems)
	}

	tests := []struct {
		field  string
		change func(*TemplateInput)
	}{
		{"categoryId", func(in *TemplateInput) { in.CategoryID = 0 }},
		{"title", func(in *TemplateInput) { in.Title = "   " }},
		{"title", func(in *TemplateInput) { in.Title = strings.Repeat("a", 161) }},
		{"summary", func(in *TemplateInput) { in.Summary = strings.Repeat("a", 241) }},
		{"description", func(in *TemplateInput) { in.Description = "terlalu pendek" }},
		{"price", func(in *TemplateInput) { in.Price = 9_999 }},
		{"price", func(in *TemplateInput) { in.Price = 100_000_001 }},
		{"version", func(in *TemplateInput) { in.Version = "" }},
		{"technology", func(in *TemplateInput) { in.Technology = strings.Repeat("a", 81) }},
		{"previewUrl", func(in *TemplateInput) { in.PreviewURL = "http://arunika.jd-sign.com" }},
		{"previewUrl", func(in *TemplateInput) { in.PreviewURL = "javascript:alert(1)" }},
		{"previewUrl", func(in *TemplateInput) { in.PreviewURL = "https://" }},
	}
	for _, test := range tests {
		input := validTemplate()
		test.change(&input)
		if problems := input.Clean(); problems[test.field] == "" {
			t.Errorf("%s: no problem reported, got %v", test.field, problems)
		}
	}

	noPreview := validTemplate()
	noPreview.PreviewURL = "  "
	if problems := noPreview.Clean(); len(problems) != 0 || noPreview.PreviewURL != "" {
		t.Fatalf("empty preview link refused: %v", problems)
	}
}
