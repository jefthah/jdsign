package httpapi

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"path"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/jefthah/jdsign/apps/api/internal/catalog"
	"github.com/jefthah/jdsign/apps/api/internal/database/sqlcdb"
	"github.com/jefthah/jdsign/apps/api/internal/storage"
	"github.com/jefthah/jdsign/apps/api/internal/upload"
)

// changeTemplate locks the template, applies change, and answers with the template as it is
// afterwards. A problem returned by change is sent as the response; change must not have written
// anything when it returns one.
func changeTemplate[R any](ctx context.Context, s *Server, id int64, change func(*sqlcdb.Queries, sqlcdb.Template) (*problem, error), respond func(AdminTemplate) R) (R, error) {
	var zero R
	var refused *problem
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		queries := sqlcdb.New(tx)
		current, err := queries.GetTemplateForUpdate(ctx, id)
		if errors.Is(err, pgx.ErrNoRows) {
			refused = templateNotFound()
			return nil
		}
		if err != nil {
			return err
		}
		refused, err = change(queries, current)

		return err
	})
	if err != nil {
		return zero, fmt.Errorf("mengubah template %d: %w", id, err)
	}
	if refused != nil {
		return any(refused).(R), nil
	}

	updated, err := s.loadAdminTemplate(ctx, id)
	if err != nil {
		return zero, err
	}

	return respond(updated), nil
}

// replaceTemplateFile moves a checked upload into storage and points the template at it in one
// transaction. apply records the new path and returns the old file to delete, or "" to keep it.
// The new file is removed again if the transaction fails, and temp is always consumed.
func replaceTemplateFile[R any](ctx context.Context, s *Server, id int64, temp *os.File, kind, extension string,
	apply func(queries *sqlcdb.Queries, current sqlcdb.Template, stored string) (string, error), respond func(AdminTemplate) R,
) (R, error) {
	var zero R
	var refused *problem
	var stored, obsolete string
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		queries := sqlcdb.New(tx)
		current, err := queries.GetTemplateForUpdate(ctx, id)
		if errors.Is(err, pgx.ErrNoRows) {
			refused = templateNotFound()
			return nil
		}
		if err != nil {
			return err
		}
		if current.DeletedAt.Valid {
			refused = archivedProblem()
			return nil
		}

		name, err := storage.NewName(kind, current.SellerID, extension)
		if err != nil {
			return err
		}
		if err := s.storage.Commit(temp, name); err != nil {
			return fmt.Errorf("menyimpan file: %w", err)
		}
		stored = name
		obsolete, err = apply(queries, current, name)

		return err
	})
	if stored == "" {
		storage.Discard(temp)
	}
	if err != nil {
		if stored != "" {
			_ = s.storage.Remove(stored)
		}
		return zero, fmt.Errorf("mengganti file template %d: %w", id, err)
	}
	if refused != nil {
		return any(refused).(R), nil
	}
	if obsolete != "" && obsolete != stored {
		if err := s.storage.Remove(obsolete); err != nil {
			s.logger.WarnContext(ctx, "file lama template tidak terhapus", "template_id", id, "path", obsolete, "error", err)
		}
	}

	updated, err := s.loadAdminTemplate(ctx, id)
	if err != nil {
		return zero, err
	}

	return respond(updated), nil
}

func (s *Server) loadAdminTemplate(ctx context.Context, id int64) (AdminTemplate, error) {
	row, err := s.queries.GetAdminTemplate(ctx, id)
	if err != nil {
		return AdminTemplate{}, fmt.Errorf("membaca template %d: %w", id, err)
	}

	return adminTemplate(row.Template, row.CategoryName, row.CategorySlug), nil
}

// checkTemplateInput validates the input, including that its category exists.
func (s *Server) checkTemplateInput(ctx context.Context, input *catalog.TemplateInput) (*problem, error) {
	problems := input.Clean()
	if _, invalid := problems["categoryId"]; !invalid {
		if _, err := s.queries.GetCategory(ctx, input.CategoryID); errors.Is(err, pgx.ErrNoRows) {
			problems["categoryId"] = "Kategori tidak ditemukan. Pilih kategori yang ada."
		} else if err != nil {
			return nil, fmt.Errorf("membaca kategori: %w", err)
		}
	}
	if len(problems) > 0 {
		return validationProblem(problems), nil
	}

	return nil, nil
}

// checkUploadTarget refuses an upload before its body is read: no storage, no such template, or
// an archived one.
func (s *Server) checkUploadTarget(ctx context.Context, id int64) (*problem, error) {
	if s.storage == nil {
		return &problem{status: http.StatusServiceUnavailable, body: errorBody("storage_unavailable",
			"Penyimpanan file belum disiapkan di server (STORAGE_DIR). Hubungi pengelola server.")}, nil
	}
	current, err := s.queries.GetAdminTemplate(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return templateNotFound(), nil
	}
	if err != nil {
		return nil, fmt.Errorf("membaca template %d: %w", id, err)
	}
	if current.Template.DeletedAt.Valid {
		return archivedProblem(), nil
	}

	return nil, nil
}

// openStoredFile opens a template file for sending, or explains why it cannot.
func (s *Server) openStoredFile(ctx context.Context, stored pgtype.Text, missing string) (*os.File, int64, *problem, error) {
	if !stored.Valid {
		return nil, 0, notFoundProblem(missing), nil
	}
	if s.storage == nil {
		return nil, 0, &problem{status: http.StatusServiceUnavailable, body: errorBody("storage_unavailable", "Penyimpanan file belum disiapkan di server.")}, nil
	}
	file, info, err := s.storage.OpenFile(stored.String)
	if errors.Is(err, fs.ErrNotExist) {
		s.logger.ErrorContext(ctx, "file template hilang dari penyimpanan", "path", stored.String)
		return nil, 0, notFoundProblem("File tidak ditemukan di penyimpanan server."), nil
	}
	if err != nil {
		return nil, 0, nil, fmt.Errorf("membuka %s: %w", stored.String, err)
	}

	return file, info.Size(), nil, nil
}

// extendDeadlines gives a large upload or download more time than the server's usual timeouts.
func extendDeadlines(ctx context.Context) {
	controller := http.NewResponseController(exchangeFrom(ctx).writer)
	_ = controller.SetReadDeadline(time.Now().Add(uploadDeadline))
	_ = controller.SetWriteDeadline(time.Now().Add(uploadDeadline + time.Minute))
}

// bodyProblem turns an upload over its size limit into a 413 answer.
func bodyProblem(err error, message string) *problem {
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		return &problem{status: http.StatusRequestEntityTooLarge, body: errorBody("file_too_large", message)}
	}

	return nil
}

// uploadProblem turns a refused file into a 422 answer; other errors are returned as they are.
func uploadProblem(err error, code string) (*problem, error) {
	var rejection *upload.Rejection
	if errors.As(err, &rejection) {
		return &problem{status: http.StatusUnprocessableEntity, body: errorBody(code, rejection.Message)}, nil
	}

	return nil, fmt.Errorf("memeriksa file: %w", err)
}

// requestBodyLimit is the largest request body accepted for r: the upload limits for template
// files, and 1 MiB for everything else.
func requestBodyLimit(r *http.Request) int64 {
	if r.Method == http.MethodPut && strings.HasPrefix(r.URL.Path, "/api/v1/admin/templates/") {
		switch {
		case strings.HasSuffix(r.URL.Path, "/files/zip"):
			return upload.MaxZIPBytes
		case strings.HasSuffix(r.URL.Path, "/files/cover"):
			return upload.MaxCoverBytes
		}
	}

	return maximumRequestBytes
}

// zipDisplayName keeps the file name of an uploaded ZIP, for display only.
func zipDisplayName(raw *string) string {
	name := ""
	if raw != nil {
		name = path.Base(strings.ReplaceAll(*raw, `\`, "/"))
	}
	name = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || unicode.Is(unicode.Cf, r) || r == utf8.RuneError {
			return -1
		}
		return r
	}, name)
	name = truncateRunes(strings.TrimSpace(name), 255)
	if name == "" || name == "." || name == "/" {
		return "template.zip"
	}

	return name
}

func adminTemplate(t sqlcdb.Template, categoryName, categorySlug string) AdminTemplate {
	template := AdminTemplate{
		Id:          t.ID,
		Slug:        t.Slug,
		Title:       t.Title,
		Summary:     t.Summary,
		Description: t.Description,
		Price:       t.Price,
		Version:     t.Version,
		Technology:  t.Technology,
		PreviewUrl:  textPointer(t.PreviewUrl),
		Category:    Category{Id: t.CategoryID, Name: categoryName, Slug: categorySlug},
		Status:      AdminTemplateStatusDraft,
		Archived:    t.DeletedAt.Valid,
		HasCover:    t.CoverPath.Valid,
		CreatedAt:   t.CreatedAt.Time,
		UpdatedAt:   t.UpdatedAt.Time,
	}
	if t.Status == "approved" {
		template.Status = AdminTemplateStatusPublished
	}
	if t.ApprovedAt.Valid {
		template.PublishedAt = &t.ApprovedAt.Time
	}
	if t.DeletedAt.Valid {
		template.ArchivedAt = &t.DeletedAt.Time
	}
	if t.ArchivePath.Valid {
		template.Zip = &TemplateZip{Name: t.ArchiveName.String, Size: t.ArchiveSize.Int64}
	}

	return template
}

func adminCategory(c sqlcdb.Category, templates int32) AdminCategory {
	return AdminCategory{Id: c.ID, Name: c.Name, Slug: c.Slug, Description: textPointer(c.Description), TemplateCount: int(templates)}
}

func categoryInput(body *CategoryInput) catalog.CategoryInput {
	if body == nil {
		return catalog.CategoryInput{}
	}
	input := catalog.CategoryInput{Name: body.Name}
	if body.Slug != nil {
		input.Slug = *body.Slug
	}
	if body.Description != nil {
		input.Description = *body.Description
	}

	return input
}

func templateInput(body *TemplateInput) catalog.TemplateInput {
	if body == nil {
		return catalog.TemplateInput{}
	}
	input := catalog.TemplateInput{
		CategoryID:  body.CategoryId,
		Title:       body.Title,
		Summary:     body.Summary,
		Description: body.Description,
		Price:       body.Price,
		Version:     body.Version,
		Technology:  body.Technology,
	}
	if body.PreviewUrl != nil {
		input.PreviewURL = *body.PreviewUrl
	}

	return input
}

func auditByAdmin(ctx context.Context, queries *sqlcdb.Queries, adminID int64, subjectType string, subjectID int64, action, note string) error {
	return queries.InsertAuditLog(ctx, sqlcdb.InsertAuditLogParams{
		ActorID:     pgtype.Int8{Int64: adminID, Valid: true},
		SubjectType: subjectType,
		SubjectID:   subjectID,
		Action:      action,
		Note:        optionalText(note),
	})
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

func errorBody(code, message string) Error {
	var body Error
	body.Error.Code = code
	body.Error.Message = message

	return body
}

func validationProblem(problems catalog.FieldErrors) *problem {
	body := errorBody("validation_failed", "Periksa kembali isian yang ditandai.")
	fields := map[string]string(problems)
	body.Error.Fields = &fields

	return &problem{status: http.StatusUnprocessableEntity, body: body}
}

func slugTaken() *problem {
	body := errorBody("slug_taken", "Slug sudah dipakai kategori lain.")
	body.Error.Fields = &map[string]string{"slug": "Slug sudah dipakai kategori lain."}

	return &problem{status: http.StatusConflict, body: body}
}

func notFoundProblem(message string) *problem {
	return &problem{status: http.StatusNotFound, body: errorBody("not_found", message)}
}

func templateNotFound() *problem {
	return notFoundProblem("Template tidak ditemukan.")
}

func conflictProblem(code, message string) *problem {
	return &problem{status: http.StatusConflict, body: errorBody(code, message)}
}

func archivedProblem() *problem {
	return conflictProblem("template_archived", "Template ini diarsipkan. Pulihkan dulu untuk mengubahnya.")
}

func textPointer(value pgtype.Text) *string {
	if !value.Valid {
		return nil
	}

	return &value.String
}

func optionalText(value string) pgtype.Text {
	return pgtype.Text{String: value, Valid: value != ""}
}

// escapeLike makes user text match literally inside an ILIKE pattern.
func escapeLike(text string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(text)
}

func truncateRunes(text string, limit int) string {
	if utf8.RuneCountInString(text) <= limit {
		return text
	}

	return string([]rune(text)[:limit])
}

func (p *problem) VisitListAdminCategoriesResponse(w http.ResponseWriter) error { return p.write(w) }
func (p *problem) VisitCreateCategoryResponse(w http.ResponseWriter) error      { return p.write(w) }
func (p *problem) VisitUpdateCategoryResponse(w http.ResponseWriter) error      { return p.write(w) }
func (p *problem) VisitDeleteCategoryResponse(w http.ResponseWriter) error      { return p.write(w) }
func (p *problem) VisitListAdminTemplatesResponse(w http.ResponseWriter) error  { return p.write(w) }
func (p *problem) VisitCreateTemplateResponse(w http.ResponseWriter) error      { return p.write(w) }
func (p *problem) VisitGetAdminTemplateResponse(w http.ResponseWriter) error    { return p.write(w) }
func (p *problem) VisitUpdateTemplateResponse(w http.ResponseWriter) error      { return p.write(w) }
func (p *problem) VisitArchiveTemplateResponse(w http.ResponseWriter) error     { return p.write(w) }
func (p *problem) VisitRestoreTemplateResponse(w http.ResponseWriter) error     { return p.write(w) }
func (p *problem) VisitPublishTemplateResponse(w http.ResponseWriter) error     { return p.write(w) }
func (p *problem) VisitUnpublishTemplateResponse(w http.ResponseWriter) error   { return p.write(w) }
func (p *problem) VisitUploadTemplateZipResponse(w http.ResponseWriter) error   { return p.write(w) }
func (p *problem) VisitUploadTemplateCoverResponse(w http.ResponseWriter) error { return p.write(w) }
func (p *problem) VisitDownloadAdminTemplateZipResponse(w http.ResponseWriter) error {
	return p.write(w)
}
func (p *problem) VisitGetAdminTemplateCoverResponse(w http.ResponseWriter) error { return p.write(w) }
