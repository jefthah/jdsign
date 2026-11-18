package httpapi_test

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jefthah/jdsign/apps/api/internal/httpapi"
	"github.com/jefthah/jdsign/apps/api/internal/testdb"
)

func TestHealthReportsReadyDatabase(t *testing.T) {
	pool := testdb.New(t)

	response := request(t, httpapi.NewServer(pool, quietLogger(), httpapi.Settings{}), "/api/v1/health")

	assertStatus(t, response, http.StatusOK)
	var body httpapi.Health
	decode(t, response, &body)
	if body.Status != httpapi.HealthStatusOk || body.Database != httpapi.HealthDatabaseOk {
		t.Fatalf("health = %+v, want ok/ok", body)
	}
}

func TestHealthReportsUnavailableDatabase(t *testing.T) {
	pool := testdb.New(t)
	pool.Close()

	response := request(t, httpapi.NewServer(pool, quietLogger(), httpapi.Settings{}), "/api/v1/health")

	assertStatus(t, response, http.StatusServiceUnavailable)
	var body httpapi.Health
	decode(t, response, &body)
	if body.Status != httpapi.HealthStatusDegraded || body.Database != httpapi.HealthDatabaseUnavailable {
		t.Fatalf("health = %+v, want degraded/unavailable", body)
	}
}

func TestCategoriesAreSeededAndSortedByName(t *testing.T) {
	pool := testdb.New(t)

	response := request(t, httpapi.NewServer(pool, quietLogger(), httpapi.Settings{}), "/api/v1/categories")

	assertStatus(t, response, http.StatusOK)
	var body httpapi.CategoryList
	decode(t, response, &body)
	want := []string{"business", "ecommerce", "landing-page", "portfolio"}
	if len(body.Data) != len(want) {
		t.Fatalf("got %d categories, want %d", len(body.Data), len(want))
	}
	for index, slug := range want {
		if body.Data[index].Slug != slug {
			t.Fatalf("category %d = %q, want %q", index, body.Data[index].Slug, slug)
		}
	}
}

func TestUnknownAPIPathReturnsJSONNotFound(t *testing.T) {
	response := request(t, httpapi.NewServer(nil, quietLogger(), httpapi.Settings{}), "/api/v1/does-not-exist")

	assertStatus(t, response, http.StatusNotFound)
	if contentType := response.Header.Get("Content-Type"); contentType != "application/json" {
		t.Fatalf("Content-Type = %q, want application/json", contentType)
	}
	if nosniff := response.Header.Get("X-Content-Type-Options"); nosniff != "nosniff" {
		t.Fatalf("X-Content-Type-Options = %q, want nosniff", nosniff)
	}
	var body httpapi.Error
	decode(t, response, &body)
	if body.Error.Code != "not_found" {
		t.Fatalf("error code = %q, want not_found", body.Error.Code)
	}
}

func request(t *testing.T, server *httpapi.Server, path string) *http.Response {
	t.Helper()

	recorder := httptest.NewRecorder()
	httpapi.NewHandler(server).ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))

	return recorder.Result()
}

func assertStatus(t *testing.T, response *http.Response, want int) {
	t.Helper()

	if response.StatusCode != want {
		body, _ := io.ReadAll(response.Body)
		t.Fatalf("status = %d, want %d; body: %s", response.StatusCode, want, body)
	}
}

func decode(t *testing.T, response *http.Response, target any) {
	t.Helper()

	if err := json.NewDecoder(response.Body).Decode(target); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
}

func quietLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}
