package httpapi_test

import (
	"archive/zip"
	"bytes"
	"context"
	"image"
	"image/color"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/jefthah/jdsign/apps/api/internal/encryption"
	"github.com/jefthah/jdsign/apps/api/internal/httpapi"
	"github.com/jefthah/jdsign/apps/api/internal/storage"
	"github.com/jefthah/jdsign/apps/api/internal/upload"
)

type catalogApp struct {
	*authApp
	storageDir string
	session    *http.Cookie
}

// newCatalogApp returns an app with file storage and a signed-in admin whose session passed the
// authenticator check.
func newCatalogApp(t *testing.T) *catalogApp {
	t.Helper()

	dir := t.TempDir()
	store, err := storage.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	keys, err := encryption.ParseKeys("1:" + strings.Repeat("5a", encryption.KeySize))
	if err != nil {
		t.Fatal(err)
	}
	app := newAuthApp(t, func(settings *httpapi.Settings) {
		settings.Encryption = keys
		settings.Storage = store
	})
	session := app.adminSession(t)
	app.enableAuthenticator(t, session)

	return &catalogApp{authApp: app, storageDir: dir, session: session}
}

func (a *catalogApp) send(t *testing.T, method, path string, body any) *http.Response {
	t.Helper()
	return a.do(t, method, path, body, a.session)
}

// upload sends a raw file body, as the admin panel does.
func (a *catalogApp) upload(t *testing.T, path string, data []byte) *http.Response {
	t.Helper()

	request := httptest.NewRequest(http.MethodPut, path, bytes.NewReader(data))
	request.Header.Set("Content-Type", "application/octet-stream")
	request.Header.Set("Origin", testAppURL)
	request.AddCookie(&http.Cookie{Name: a.session.Name, Value: a.session.Value})
	recorder := httptest.NewRecorder()
	a.handler.ServeHTTP(recorder, request)

	return recorder.Result()
}

func (a *catalogApp) template(t *testing.T, response *http.Response, status int) httpapi.AdminTemplate {
	t.Helper()

	assertStatus(t, response, status)
	var template httpapi.AdminTemplate
	decode(t, response, &template)

	return template
}

func (a *catalogApp) storedFiles(t *testing.T, kind string) []string {
	t.Helper()

	matches, err := filepath.Glob(filepath.Join(a.storageDir, kind, "*", "*"))
	if err != nil {
		t.Fatal(err)
	}

	return matches
}

func templateBody(categoryID int64) map[string]any {
	return map[string]any{
		"categoryId":  categoryID,
		"title":       "Arunika Studio",
		"summary":     "Portfolio satu halaman untuk studio kreatif",
		"description": "Template portfolio satu halaman untuk studio kreatif kecil, lengkap dengan galeri.",
		"price":       249000,
		"version":     "1.0.0",
		"technology":  "Next.js + Tailwind",
		"previewUrl":  "https://arunika.jd-sign.com",
	}
}

func templateZIP(t *testing.T, names ...string) []byte {
	t.Helper()

	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for _, name := range names {
		file, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = file.Write([]byte("<!doctype html><title>" + name + "</title>"))
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	return buffer.Bytes()
}

func coverPNG(t *testing.T, width, height int) []byte {
	t.Helper()

	img := image.NewNRGBA(image.Rect(0, 0, width, height))
	for y := range height {
		for x := range width {
			img.Set(x, y, color.NRGBA{R: 198, G: 255, B: uint8(x), A: 255})
		}
	}
	var buffer bytes.Buffer
	if err := png.Encode(&buffer, img); err != nil {
		t.Fatal(err)
	}

	return buffer.Bytes()
}

func firstCategoryID(t *testing.T, app *catalogApp) int64 {
	t.Helper()

	var id int64
	if err := app.pool.QueryRow(context.Background(), "SELECT id FROM categories WHERE slug = 'portfolio'").Scan(&id); err != nil {
		t.Fatal(err)
	}

	return id
}

func TestCatalogNeedsAVerifiedAdmin(t *testing.T) {
	app := newAdminApp(t)
	app.exec(t, "INSERT INTO users (email, name, email_verified_at) VALUES ('pembeli@example.com', 'Pembeli', now())")
	buyer := app.sessionFor(t, "pembeli@example.com")
	unverified := app.adminSession(t)

	assertError(t, app.do(t, http.MethodGet, "/api/v1/admin/templates", nil, nil), http.StatusUnauthorized, "unauthenticated")
	assertError(t, app.do(t, http.MethodGet, "/api/v1/admin/templates", nil, buyer), http.StatusForbidden, "admin_only")
	assertError(t, app.do(t, http.MethodPost, "/api/v1/admin/categories", map[string]string{"name": "Blog"}, buyer), http.StatusForbidden, "admin_only")
	assertError(t, app.do(t, http.MethodGet, "/api/v1/admin/categories", nil, unverified), http.StatusForbidden, "mfa_setup_required")
	assertError(t, app.do(t, http.MethodGet, "/api/v1/admin/templates/1/files/cover", nil, buyer), http.StatusForbidden, "admin_only")
}

func TestAdminManagesCategories(t *testing.T) {
	app := newCatalogApp(t)

	created := app.send(t, http.MethodPost, "/api/v1/admin/categories", map[string]any{"name": "  Toko Online ", "description": "Untuk UMKM"})
	assertStatus(t, created, http.StatusCreated)
	var category httpapi.AdminCategory
	decode(t, created, &category)
	if category.Name != "Toko Online" || category.Slug != "toko-online" || category.Description == nil || *category.Description != "Untuk UMKM" {
		t.Fatalf("created category = %+v", category)
	}

	duplicate := app.send(t, http.MethodPost, "/api/v1/admin/categories", map[string]any{"name": "Lain", "slug": "toko-online"})
	if body := assertError(t, duplicate, http.StatusConflict, "slug_taken"); body.Error.Fields == nil || (*body.Error.Fields)["slug"] == "" {
		t.Fatalf("duplicate slug fields = %+v", body.Error.Fields)
	}
	invalid := app.send(t, http.MethodPost, "/api/v1/admin/categories", map[string]any{"name": "", "slug": "Bukan Slug"})
	if body := assertError(t, invalid, http.StatusUnprocessableEntity, "validation_failed"); (*body.Error.Fields)["name"] == "" || (*body.Error.Fields)["slug"] == "" {
		t.Fatalf("validation fields = %+v", body.Error.Fields)
	}

	path := "/api/v1/admin/categories/" + strconv.FormatInt(category.Id, 10)
	updated := app.send(t, http.MethodPut, path, map[string]any{"name": "Toko daring", "slug": "toko-daring"})
	assertStatus(t, updated, http.StatusOK)
	var renamed httpapi.AdminCategory
	decode(t, updated, &renamed)
	if renamed.Id != category.Id || renamed.Name != "Toko daring" || renamed.Slug != "toko-daring" || renamed.Description != nil {
		t.Fatalf("updated category = %+v", renamed)
	}
	assertError(t, app.send(t, http.MethodPut, "/api/v1/admin/categories/99999", map[string]any{"name": "X"}), http.StatusNotFound, "not_found")
	assertError(t, app.send(t, http.MethodPut, path, map[string]any{"name": "Bentrok", "slug": "portfolio"}), http.StatusConflict, "slug_taken")

	// A category with a template, even an archived one, cannot be deleted.
	template := app.template(t, app.send(t, http.MethodPost, "/api/v1/admin/templates", templateBody(category.Id)), http.StatusCreated)
	app.template(t, app.send(t, http.MethodDelete, "/api/v1/admin/templates/"+strconv.FormatInt(template.Id, 10), nil), http.StatusOK)
	assertError(t, app.send(t, http.MethodDelete, path, nil), http.StatusConflict, "category_in_use")

	listed := app.send(t, http.MethodGet, "/api/v1/admin/categories", nil)
	assertStatus(t, listed, http.StatusOK)
	var list httpapi.AdminCategoryList
	decode(t, listed, &list)
	counts := map[string]int{}
	for _, item := range list.Data {
		counts[item.Slug] = item.TemplateCount
	}
	if len(list.Data) != 5 || counts["toko-daring"] != 1 || counts["portfolio"] != 0 {
		t.Fatalf("categories = %+v", list.Data)
	}

	empty := app.send(t, http.MethodPost, "/api/v1/admin/categories", map[string]any{"name": "Kosong"})
	assertStatus(t, empty, http.StatusCreated)
	var unused httpapi.AdminCategory
	decode(t, empty, &unused)
	assertStatus(t, app.send(t, http.MethodDelete, "/api/v1/admin/categories/"+strconv.FormatInt(unused.Id, 10), nil), http.StatusNoContent)
	assertError(t, app.send(t, http.MethodDelete, "/api/v1/admin/categories/"+strconv.FormatInt(unused.Id, 10), nil), http.StatusNotFound, "not_found")

	if got := app.count(t, "SELECT count(*) FROM audit_logs WHERE subject_type = 'category' AND actor_id IS NOT NULL"); got != 4 {
		t.Fatalf("category audit entries = %d, want 4 (2 created, 1 updated, 1 deleted)", got)
	}
}

func TestAdminCreatesUploadsAndPublishesATemplate(t *testing.T) {
	app := newCatalogApp(t)
	categoryID := firstCategoryID(t, app)

	refused := app.send(t, http.MethodPost, "/api/v1/admin/templates", map[string]any{"categoryId": 99999, "title": "", "price": 5000, "description": "pendek"})
	body := assertError(t, refused, http.StatusUnprocessableEntity, "validation_failed")
	for _, field := range []string{"categoryId", "title", "summary", "description", "price", "version", "technology"} {
		if (*body.Error.Fields)[field] == "" {
			t.Errorf("no message for %s: %v", field, *body.Error.Fields)
		}
	}

	template := app.template(t, app.send(t, http.MethodPost, "/api/v1/admin/templates", templateBody(categoryID)), http.StatusCreated)
	if template.Status != httpapi.AdminTemplateStatusDraft || template.Zip != nil || template.HasCover || !strings.HasPrefix(template.Slug, "arunika-studio-") || template.Category.Slug != "portfolio" {
		t.Fatalf("new template = %+v", template)
	}
	base := "/api/v1/admin/templates/" + strconv.FormatInt(template.Id, 10)

	assertError(t, app.send(t, http.MethodPost, base+"/publish", nil), http.StatusConflict, "template_incomplete")
	assertError(t, app.upload(t, base+"/files/zip", []byte("bukan zip")), http.StatusUnprocessableEntity, "invalid_zip")
	assertError(t, app.upload(t, base+"/files/zip", templateZIP(t, "../luar.html")), http.StatusUnprocessableEntity, "invalid_zip")
	assertError(t, app.upload(t, base+"/files/cover", []byte("<svg/>")), http.StatusUnprocessableEntity, "invalid_image")
	if files := app.storedFiles(t, "templates"); len(files) != 0 {
		t.Fatalf("refused uploads left files behind: %v", files)
	}

	archive := templateZIP(t, "arunika/index.html", "arunika/style.css")
	template = app.template(t, app.upload(t, base+"/files/zip?name="+`C%3A%5CUsers%5Cnadia%5Carunika-v1.zip`, archive), http.StatusOK)
	if template.Zip == nil || template.Zip.Name != "arunika-v1.zip" || template.Zip.Size != int64(len(archive)) {
		t.Fatalf("zip after upload = %+v", template.Zip)
	}
	template = app.template(t, app.upload(t, base+"/files/cover", coverPNG(t, 2000, 1250)), http.StatusOK)
	if !template.HasCover {
		t.Fatal("hasCover is false after uploading a cover")
	}

	cover := app.send(t, http.MethodGet, base+"/files/cover", nil)
	assertStatus(t, cover, http.StatusOK)
	data, _ := io.ReadAll(cover.Body)
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || format != "webp" || config.Width != upload.CoverFit || config.Height != 1000 || cover.Header.Get("Content-Type") != "image/webp" {
		t.Fatalf("stored cover: format %q %dx%d, content type %q, err %v", format, config.Width, config.Height, cover.Header.Get("Content-Type"), err)
	}

	download := app.send(t, http.MethodGet, base+"/files/zip", nil)
	assertStatus(t, download, http.StatusOK)
	downloaded, _ := io.ReadAll(download.Body)
	if !bytes.Equal(downloaded, archive) || download.Header.Get("Content-Disposition") != `attachment; filename="review-`+template.Slug+`.zip"` {
		t.Fatalf("download: %d bytes, Content-Disposition %q", len(downloaded), download.Header.Get("Content-Disposition"))
	}

	template = app.template(t, app.send(t, http.MethodPost, base+"/publish", nil), http.StatusOK)
	if template.Status != httpapi.AdminTemplateStatusPublished || template.PublishedAt == nil {
		t.Fatalf("published template = %+v", template)
	}

	// Editing a published template keeps it published.
	changed := templateBody(categoryID)
	changed["title"] = "Arunika Studio 2"
	changed["price"] = 299000
	changed["previewUrl"] = nil
	template = app.template(t, app.send(t, http.MethodPut, base, changed), http.StatusOK)
	if template.Title != "Arunika Studio 2" || template.Price != 299000 || template.PreviewUrl != nil || template.Status != httpapi.AdminTemplateStatusPublished || !strings.HasPrefix(template.Slug, "arunika-studio-") {
		t.Fatalf("updated template = %+v", template)
	}

	assertList(t, app, "", 1)
	assertList(t, app, "?status=published", 1)
	assertList(t, app, "?status=draft", 0)
	assertList(t, app, "?q=ARUNIKA", 1)
	assertList(t, app, "?q=tailwind", 1)
	assertList(t, app, "?q=100%25", 0)

	template = app.template(t, app.send(t, http.MethodPost, base+"/unpublish", nil), http.StatusOK)
	if template.Status != httpapi.AdminTemplateStatusDraft || template.PublishedAt != nil {
		t.Fatalf("unpublished template = %+v", template)
	}
	app.template(t, app.send(t, http.MethodPost, base+"/publish", nil), http.StatusOK)

	template = app.template(t, app.send(t, http.MethodDelete, base, nil), http.StatusOK)
	if !template.Archived || template.ArchivedAt == nil || template.Status != httpapi.AdminTemplateStatusDraft {
		t.Fatalf("archived template = %+v", template)
	}
	assertList(t, app, "", 0)
	assertList(t, app, "?status=archived", 1)
	assertError(t, app.send(t, http.MethodPut, base, changed), http.StatusConflict, "template_archived")
	assertError(t, app.send(t, http.MethodPost, base+"/publish", nil), http.StatusConflict, "template_archived")
	assertError(t, app.upload(t, base+"/files/cover", coverPNG(t, 10, 10)), http.StatusConflict, "template_archived")

	template = app.template(t, app.send(t, http.MethodPost, base+"/restore", nil), http.StatusOK)
	if template.Archived || template.Status != httpapi.AdminTemplateStatusDraft || template.Zip == nil || !template.HasCover {
		t.Fatalf("restored template = %+v", template)
	}

	overview := app.send(t, http.MethodGet, "/api/v1/admin/overview", nil)
	assertStatus(t, overview, http.StatusOK)
	var counts httpapi.AdminOverview
	decode(t, overview, &counts)
	if counts.PublishedTemplates != 0 || counts.DraftTemplates != 1 || counts.Categories != 4 {
		t.Fatalf("overview = %+v", counts)
	}

	assertError(t, app.send(t, http.MethodGet, "/api/v1/admin/templates/99999", nil), http.StatusNotFound, "not_found")
	if got := app.count(t, "SELECT count(*) FROM audit_logs WHERE subject_type = 'template' AND subject_id = "+strconv.FormatInt(template.Id, 10)); got != 9 {
		t.Fatalf("template audit entries = %d, want 9", got)
	}
}

func assertList(t *testing.T, app *catalogApp, query string, want int) {
	t.Helper()

	response := app.send(t, http.MethodGet, "/api/v1/admin/templates"+query, nil)
	assertStatus(t, response, http.StatusOK)
	var list httpapi.AdminTemplateList
	decode(t, response, &list)
	if list.Total != want || len(list.Data) != want || list.PerPage != 20 || list.Page != 1 {
		t.Fatalf("list %q: total %d, %d rows, want %d", query, list.Total, len(list.Data), want)
	}
}

func TestReplacingAZipKeepsTheOldOneWhileOrdersUseIt(t *testing.T) {
	app := newCatalogApp(t)
	template := app.template(t, app.send(t, http.MethodPost, "/api/v1/admin/templates", templateBody(firstCategoryID(t, app))), http.StatusCreated)
	base := "/api/v1/admin/templates/" + strconv.FormatInt(template.Id, 10)

	app.template(t, app.upload(t, base+"/files/zip", templateZIP(t, "v1/index.html")), http.StatusOK)
	app.template(t, app.upload(t, base+"/files/zip", templateZIP(t, "v2/index.html")), http.StatusOK)
	if files := app.storedFiles(t, "templates"); len(files) != 1 {
		t.Fatalf("after replacing an unsold ZIP: %v, want only the new one", files)
	}

	app.exec(t, `INSERT INTO orders (number, checkout_key, buyer_id, total, status, paid_at)
		SELECT 'JD-01J00000000000000000000000', gen_random_uuid(), id, 249000, 'paid', now() FROM users LIMIT 1`)
	app.exec(t, `INSERT INTO order_items (order_id, template_id, seller_id, title, version, license_type, license_key, price, commission_bps, platform_fee, seller_net, archive_path)
		SELECT o.id, t.id, t.seller_id, t.title, t.version, t.license_type, gen_random_uuid(), 249000, 0, 0, 249000, t.archive_path
		FROM orders o, templates t`)
	sold := app.storedFiles(t, "templates")[0]

	app.template(t, app.upload(t, base+"/files/zip", templateZIP(t, "v3/index.html")), http.StatusOK)
	files := app.storedFiles(t, "templates")
	if len(files) != 2 || (files[0] != sold && files[1] != sold) {
		t.Fatalf("after replacing a sold ZIP: %v, want the sold one %s kept", files, sold)
	}

	app.template(t, app.upload(t, base+"/files/cover", coverPNG(t, 40, 30)), http.StatusOK)
	app.template(t, app.upload(t, base+"/files/cover", coverPNG(t, 40, 30)), http.StatusOK)
	if covers := app.storedFiles(t, "covers"); len(covers) != 1 {
		t.Fatalf("covers after replacing one: %v", covers)
	}
}

func TestUploadsAreLimited(t *testing.T) {
	app := newCatalogApp(t)
	template := app.template(t, app.send(t, http.MethodPost, "/api/v1/admin/templates", templateBody(firstCategoryID(t, app))), http.StatusCreated)
	base := "/api/v1/admin/templates/" + strconv.FormatInt(template.Id, 10)

	assertError(t, app.upload(t, base+"/files/cover", make([]byte, upload.MaxCoverBytes+1)), http.StatusRequestEntityTooLarge, "file_too_large")
	assertError(t, app.upload(t, base+"/files/zip", make([]byte, upload.MaxZIPBytes+1)), http.StatusRequestEntityTooLarge, "file_too_large")
	if leftovers, _ := os.ReadDir(filepath.Join(app.storageDir, "tmp")); len(leftovers) != 0 {
		t.Fatalf("temporary files left behind: %d", len(leftovers))
	}
	assertError(t, app.upload(t, "/api/v1/admin/templates/99999/files/zip", templateZIP(t, "a.html")), http.StatusNotFound, "not_found")
}

func TestUploadsNeedStorage(t *testing.T) {
	app := newAdminApp(t)
	session := app.adminSession(t)
	app.enableAuthenticator(t, session)
	created := app.do(t, http.MethodPost, "/api/v1/admin/templates", templateBody(1), session)
	assertStatus(t, created, http.StatusCreated)
	var template httpapi.AdminTemplate
	decode(t, created, &template)

	request := httptest.NewRequest(http.MethodPut, "/api/v1/admin/templates/"+strconv.FormatInt(template.Id, 10)+"/files/zip", bytes.NewReader(templateZIP(t, "a.html")))
	request.Header.Set("Origin", testAppURL)
	request.AddCookie(session)
	recorder := httptest.NewRecorder()
	app.handler.ServeHTTP(recorder, request)
	assertError(t, recorder.Result(), http.StatusServiceUnavailable, "storage_unavailable")
}
