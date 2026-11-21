package httpapi

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/jefthah/jdsign/apps/api/internal/catalog"
	"github.com/jefthah/jdsign/apps/api/internal/database/sqlcdb"
	"github.com/jefthah/jdsign/apps/api/internal/storage"
	"github.com/jefthah/jdsign/apps/api/internal/upload"
)

// Admin catalog: categories and templates, managed directly by the admin while JD Sign has a
// single seller (2026-11-21). Templates are "published" (status approved) or "draft", and
// archiving hides them without deleting anything (docs/spec.md 7 and 8).

const adminTemplatesPerPage = 20

// uploadDeadline is how long a ZIP upload or download may take, for slow connections. It replaces
// the server's 60-second read and 120-second write timeouts for that request only.
const uploadDeadline = 15 * time.Minute

// ListAdminCategories returns every category with its number of templates.
func (s *Server) ListAdminCategories(ctx context.Context, _ ListAdminCategoriesRequestObject) (ListAdminCategoriesResponseObject, error) {
	if _, denied, err := s.adminSession(ctx, true); err != nil || denied != nil {
		return denied, err
	}

	rows, err := s.queries.ListAdminCategories(ctx)
	if err != nil {
		return nil, fmt.Errorf("membaca kategori: %w", err)
	}
	categories := make([]AdminCategory, 0, len(rows))
	for _, row := range rows {
		categories = append(categories, AdminCategory{
			Id: row.ID, Name: row.Name, Slug: row.Slug, Description: textPointer(row.Description), TemplateCount: int(row.TemplateCount),
		})
	}

	return ListAdminCategories200JSONResponse{Data: categories}, nil
}

// CreateCategory adds a category.
func (s *Server) CreateCategory(ctx context.Context, request CreateCategoryRequestObject) (CreateCategoryResponseObject, error) {
	admin, denied, err := s.adminSession(ctx, true)
	if err != nil || denied != nil {
		return denied, err
	}

	input := categoryInput(request.Body)
	if problems := input.Clean(); len(problems) > 0 {
		return validationProblem(problems), nil
	}

	var created sqlcdb.Category
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		queries := sqlcdb.New(tx)
		created, err = queries.CreateCategory(ctx, sqlcdb.CreateCategoryParams{Name: input.Name, Slug: input.Slug, Description: optionalText(input.Description)})
		if err != nil {
			return err
		}

		return auditByAdmin(ctx, queries, admin.account.ID, "category", created.ID, "category.created", created.Name)
	})
	if isUniqueViolation(err) {
		return slugTaken(), nil
	}
	if err != nil {
		return nil, fmt.Errorf("membuat kategori: %w", err)
	}

	return CreateCategory201JSONResponse(adminCategory(created, 0)), nil
}

// UpdateCategory renames a category or changes its slug or description.
func (s *Server) UpdateCategory(ctx context.Context, request UpdateCategoryRequestObject) (UpdateCategoryResponseObject, error) {
	admin, denied, err := s.adminSession(ctx, true)
	if err != nil || denied != nil {
		return denied, err
	}

	input := categoryInput(request.Body)
	if problems := input.Clean(); len(problems) > 0 {
		return validationProblem(problems), nil
	}

	var (
		updated   sqlcdb.Category
		templates int32
		missing   bool
	)
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		queries := sqlcdb.New(tx)
		if _, err := queries.GetCategoryForUpdate(ctx, request.Id); errors.Is(err, pgx.ErrNoRows) {
			missing = true
			return nil
		} else if err != nil {
			return err
		}
		updated, err = queries.UpdateCategory(ctx, sqlcdb.UpdateCategoryParams{ID: request.Id, Name: input.Name, Slug: input.Slug, Description: optionalText(input.Description)})
		if err != nil {
			return err
		}
		if templates, err = queries.CountTemplatesInCategory(ctx, request.Id); err != nil {
			return err
		}

		return auditByAdmin(ctx, queries, admin.account.ID, "category", updated.ID, "category.updated", updated.Name)
	})
	switch {
	case isUniqueViolation(err):
		return slugTaken(), nil
	case err != nil:
		return nil, fmt.Errorf("mengubah kategori: %w", err)
	case missing:
		return notFoundProblem("Kategori tidak ditemukan."), nil
	}

	return UpdateCategory200JSONResponse(adminCategory(updated, templates)), nil
}

// DeleteCategory removes a category that no template uses, archived ones included.
func (s *Server) DeleteCategory(ctx context.Context, request DeleteCategoryRequestObject) (DeleteCategoryResponseObject, error) {
	admin, denied, err := s.adminSession(ctx, true)
	if err != nil || denied != nil {
		return denied, err
	}

	var refused *problem
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		queries := sqlcdb.New(tx)
		category, err := queries.GetCategoryForUpdate(ctx, request.Id)
		if errors.Is(err, pgx.ErrNoRows) {
			refused = notFoundProblem("Kategori tidak ditemukan.")
			return nil
		}
		if err != nil {
			return err
		}
		templates, err := queries.CountTemplatesInCategory(ctx, request.Id)
		if err != nil {
			return err
		}
		if templates > 0 {
			refused = conflictProblem("category_in_use", fmt.Sprintf(
				"Kategori %s masih dipakai %d template, termasuk yang diarsipkan. Pindahkan template itu ke kategori lain dulu.", category.Name, templates))
			return nil
		}
		if err := queries.DeleteCategory(ctx, request.Id); err != nil {
			return err
		}

		return auditByAdmin(ctx, queries, admin.account.ID, "category", category.ID, "category.deleted", category.Name)
	})
	if err != nil {
		return nil, fmt.Errorf("menghapus kategori: %w", err)
	}
	if refused != nil {
		return refused, nil
	}

	return DeleteCategory204Response{}, nil
}

// ListAdminTemplates returns one page of templates, most recently changed first.
func (s *Server) ListAdminTemplates(ctx context.Context, request ListAdminTemplatesRequestObject) (ListAdminTemplatesResponseObject, error) {
	if _, denied, err := s.adminSession(ctx, true); err != nil || denied != nil {
		return denied, err
	}

	filter := string(ListAdminTemplatesParamsStatusActive)
	if request.Params.Status != nil {
		filter = string(*request.Params.Status)
	}
	pattern := ""
	if request.Params.Q != nil {
		if query := strings.TrimSpace(*request.Params.Q); query != "" {
			pattern = "%" + escapeLike(truncateRunes(query, 100)) + "%"
		}
	}
	page := 1
	if request.Params.Page != nil {
		page = min(max(*request.Params.Page, 1), 10_000)
	}

	total, err := s.queries.CountAdminTemplates(ctx, sqlcdb.CountAdminTemplatesParams{Filter: filter, Pattern: pattern})
	if err != nil {
		return nil, fmt.Errorf("menghitung template: %w", err)
	}
	rows, err := s.queries.ListAdminTemplates(ctx, sqlcdb.ListAdminTemplatesParams{
		Filter: filter, Pattern: pattern, RowLimit: adminTemplatesPerPage, RowOffset: int32((page - 1) * adminTemplatesPerPage),
	})
	if err != nil {
		return nil, fmt.Errorf("membaca template: %w", err)
	}

	templates := make([]AdminTemplate, 0, len(rows))
	for _, row := range rows {
		templates = append(templates, adminTemplate(row.Template, row.CategoryName, row.CategorySlug))
	}

	return ListAdminTemplates200JSONResponse{Data: templates, Page: page, PerPage: adminTemplatesPerPage, Total: int(total)}, nil
}

// CreateTemplate adds a draft template owned by the signed-in admin.
func (s *Server) CreateTemplate(ctx context.Context, request CreateTemplateRequestObject) (CreateTemplateResponseObject, error) {
	admin, denied, err := s.adminSession(ctx, true)
	if err != nil || denied != nil {
		return denied, err
	}

	input := templateInput(request.Body)
	if refused, err := s.checkTemplateInput(ctx, &input); err != nil || refused != nil {
		return refused, err
	}

	var id int64
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		queries := sqlcdb.New(tx)
		id, err = queries.CreateTemplate(ctx, sqlcdb.CreateTemplateParams{
			SellerID:    admin.account.ID,
			CategoryID:  input.CategoryID,
			Title:       input.Title,
			Slug:        catalog.NewTemplateSlug(input.Title),
			Summary:     input.Summary,
			Description: input.Description,
			Price:       input.Price,
			Version:     input.Version,
			Technology:  input.Technology,
			PreviewUrl:  optionalText(input.PreviewURL),
		})
		if err != nil {
			return err
		}

		return auditByAdmin(ctx, queries, admin.account.ID, "template", id, "template.created", input.Title)
	})
	if err != nil {
		return nil, fmt.Errorf("membuat template: %w", err)
	}

	created, err := s.loadAdminTemplate(ctx, id)
	if err != nil {
		return nil, err
	}

	return CreateTemplate201JSONResponse(created), nil
}

// GetAdminTemplate returns one template, archived or not.
func (s *Server) GetAdminTemplate(ctx context.Context, request GetAdminTemplateRequestObject) (GetAdminTemplateResponseObject, error) {
	if _, denied, err := s.adminSession(ctx, true); err != nil || denied != nil {
		return denied, err
	}

	found, err := s.loadAdminTemplate(ctx, request.Id)
	if errors.Is(err, pgx.ErrNoRows) {
		return templateNotFound(), nil
	}
	if err != nil {
		return nil, err
	}

	return GetAdminTemplate200JSONResponse(found), nil
}

// UpdateTemplate changes a template's details. A published template stays published: the admin
// is the only seller, so there is no one else to review the change.
func (s *Server) UpdateTemplate(ctx context.Context, request UpdateTemplateRequestObject) (UpdateTemplateResponseObject, error) {
	admin, denied, err := s.adminSession(ctx, true)
	if err != nil || denied != nil {
		return denied, err
	}

	input := templateInput(request.Body)
	if refused, err := s.checkTemplateInput(ctx, &input); err != nil || refused != nil {
		return refused, err
	}

	return changeTemplate(ctx, s, request.Id, func(queries *sqlcdb.Queries, current sqlcdb.Template) (*problem, error) {
		if current.DeletedAt.Valid {
			return archivedProblem(), nil
		}
		err := queries.UpdateTemplateDetails(ctx, sqlcdb.UpdateTemplateDetailsParams{
			ID:          current.ID,
			CategoryID:  input.CategoryID,
			Title:       input.Title,
			Summary:     input.Summary,
			Description: input.Description,
			Price:       input.Price,
			Version:     input.Version,
			Technology:  input.Technology,
			PreviewUrl:  optionalText(input.PreviewURL),
		})
		if err != nil {
			return nil, err
		}

		return nil, auditByAdmin(ctx, queries, admin.account.ID, "template", current.ID, "template.updated", input.Title)
	}, func(template AdminTemplate) UpdateTemplateResponseObject {
		return UpdateTemplate200JSONResponse(template)
	})
}

// ArchiveTemplate hides a template from the site and turns it back into a draft.
func (s *Server) ArchiveTemplate(ctx context.Context, request ArchiveTemplateRequestObject) (ArchiveTemplateResponseObject, error) {
	admin, denied, err := s.adminSession(ctx, true)
	if err != nil || denied != nil {
		return denied, err
	}

	return changeTemplate(ctx, s, request.Id, func(queries *sqlcdb.Queries, current sqlcdb.Template) (*problem, error) {
		if current.DeletedAt.Valid {
			return nil, nil
		}
		if err := queries.ArchiveTemplate(ctx, current.ID); err != nil {
			return nil, err
		}

		return nil, auditByAdmin(ctx, queries, admin.account.ID, "template", current.ID, "template.archived", current.Title)
	}, func(template AdminTemplate) ArchiveTemplateResponseObject {
		return ArchiveTemplate200JSONResponse(template)
	})
}

// RestoreTemplate brings an archived template back as a draft.
func (s *Server) RestoreTemplate(ctx context.Context, request RestoreTemplateRequestObject) (RestoreTemplateResponseObject, error) {
	admin, denied, err := s.adminSession(ctx, true)
	if err != nil || denied != nil {
		return denied, err
	}

	return changeTemplate(ctx, s, request.Id, func(queries *sqlcdb.Queries, current sqlcdb.Template) (*problem, error) {
		if !current.DeletedAt.Valid {
			return nil, nil
		}
		if err := queries.RestoreTemplate(ctx, current.ID); err != nil {
			return nil, err
		}

		return nil, auditByAdmin(ctx, queries, admin.account.ID, "template", current.ID, "template.restored", current.Title)
	}, func(template AdminTemplate) RestoreTemplateResponseObject {
		return RestoreTemplate200JSONResponse(template)
	})
}

// PublishTemplate shows a template on the site once its ZIP and cover are uploaded.
func (s *Server) PublishTemplate(ctx context.Context, request PublishTemplateRequestObject) (PublishTemplateResponseObject, error) {
	admin, denied, err := s.adminSession(ctx, true)
	if err != nil || denied != nil {
		return denied, err
	}

	return changeTemplate(ctx, s, request.Id, func(queries *sqlcdb.Queries, current sqlcdb.Template) (*problem, error) {
		switch {
		case current.DeletedAt.Valid:
			return archivedProblem(), nil
		case !current.ArchivePath.Valid || !current.CoverPath.Valid:
			return conflictProblem("template_incomplete", "Unggah file ZIP dan sampul dulu sebelum menayangkan template."), nil
		case current.Status == "approved":
			return nil, nil
		}
		if err := queries.PublishTemplate(ctx, sqlcdb.PublishTemplateParams{ID: current.ID, AdminID: pgtype.Int8{Int64: admin.account.ID, Valid: true}}); err != nil {
			return nil, err
		}

		return nil, auditByAdmin(ctx, queries, admin.account.ID, "template", current.ID, "template.published", current.Title)
	}, func(template AdminTemplate) PublishTemplateResponseObject {
		return PublishTemplate200JSONResponse(template)
	})
}

// UnpublishTemplate takes a template off the site and turns it back into a draft.
func (s *Server) UnpublishTemplate(ctx context.Context, request UnpublishTemplateRequestObject) (UnpublishTemplateResponseObject, error) {
	admin, denied, err := s.adminSession(ctx, true)
	if err != nil || denied != nil {
		return denied, err
	}

	return changeTemplate(ctx, s, request.Id, func(queries *sqlcdb.Queries, current sqlcdb.Template) (*problem, error) {
		if current.Status != "approved" {
			return nil, nil
		}
		if err := queries.UnpublishTemplate(ctx, current.ID); err != nil {
			return nil, err
		}

		return nil, auditByAdmin(ctx, queries, admin.account.ID, "template", current.ID, "template.unpublished", current.Title)
	}, func(template AdminTemplate) UnpublishTemplateResponseObject {
		return UnpublishTemplate200JSONResponse(template)
	})
}

// UploadTemplateZip stores a new ZIP for the template after checking it. The previous ZIP is
// deleted unless an order still points at it.
func (s *Server) UploadTemplateZip(ctx context.Context, request UploadTemplateZipRequestObject) (UploadTemplateZipResponseObject, error) {
	admin, denied, err := s.adminSession(ctx, true)
	if err != nil || denied != nil {
		return denied, err
	}
	if refused, err := s.checkUploadTarget(ctx, request.Id); err != nil || refused != nil {
		return refused, err
	}
	extendDeadlines(ctx)

	temp, err := s.storage.CreateTemp()
	if err != nil {
		return nil, fmt.Errorf("menyiapkan file sementara: %w", err)
	}
	size, err := io.Copy(temp, request.Body)
	if refused := bodyProblem(err, "File ZIP maksimal 50 MB."); refused != nil {
		storage.Discard(temp)
		return refused, nil
	}
	if err != nil {
		storage.Discard(temp)
		return nil, fmt.Errorf("menerima file ZIP: %w", err)
	}
	if err := upload.CheckZIP(temp, size); err != nil {
		storage.Discard(temp)
		return uploadProblem(err, "invalid_zip")
	}

	name := zipDisplayName(request.Params.Name)
	return replaceTemplateFile(ctx, s, request.Id, temp, "templates", ".zip", func(queries *sqlcdb.Queries, current sqlcdb.Template, stored string) (string, error) {
		err := queries.SetTemplateArchiveFile(ctx, sqlcdb.SetTemplateArchiveFileParams{
			ID: current.ID, ArchivePath: optionalText(stored), ArchiveName: optionalText(name), ArchiveSize: pgtype.Int8{Int64: size, Valid: true},
		})
		if err != nil {
			return "", err
		}
		if err := auditByAdmin(ctx, queries, admin.account.ID, "template", current.ID, "template.zip_uploaded", fmt.Sprintf("%s (%d byte)", name, size)); err != nil {
			return "", err
		}
		if !current.ArchivePath.Valid {
			return "", nil
		}
		// The template row is locked, so a checkout cannot start using the old ZIP after this count.
		inUse, err := queries.CountOrderItemsUsingArchive(ctx, current.ArchivePath.String)
		if err != nil || inUse > 0 {
			return "", err
		}

		return current.ArchivePath.String, nil
	}, func(template AdminTemplate) UploadTemplateZipResponseObject {
		return UploadTemplateZip200JSONResponse(template)
	})
}

// UploadTemplateCover stores the template's cover, encoded again as WebP.
func (s *Server) UploadTemplateCover(ctx context.Context, request UploadTemplateCoverRequestObject) (UploadTemplateCoverResponseObject, error) {
	admin, denied, err := s.adminSession(ctx, true)
	if err != nil || denied != nil {
		return denied, err
	}
	if refused, err := s.checkUploadTarget(ctx, request.Id); err != nil || refused != nil {
		return refused, err
	}

	data, err := io.ReadAll(request.Body)
	if refused := bodyProblem(err, "Sampul maksimal 2 MB."); refused != nil {
		return refused, nil
	}
	if err != nil {
		return nil, fmt.Errorf("menerima sampul: %w", err)
	}

	temp, err := s.storage.CreateTemp()
	if err != nil {
		return nil, fmt.Errorf("menyiapkan file sementara: %w", err)
	}
	// One cover at a time: decoding a 4000×4000 image takes about 100 MB of the API's 256 MB.
	select {
	case s.coverSlot <- struct{}{}:
	case <-ctx.Done():
		storage.Discard(temp)
		return nil, ctx.Err()
	}
	err = upload.EncodeCover(data, temp)
	<-s.coverSlot
	if err != nil {
		storage.Discard(temp)
		return uploadProblem(err, "invalid_image")
	}

	return replaceTemplateFile(ctx, s, request.Id, temp, "covers", ".webp", func(queries *sqlcdb.Queries, current sqlcdb.Template, stored string) (string, error) {
		if err := queries.SetTemplateCoverFile(ctx, sqlcdb.SetTemplateCoverFileParams{ID: current.ID, CoverPath: optionalText(stored)}); err != nil {
			return "", err
		}
		if err := auditByAdmin(ctx, queries, admin.account.ID, "template", current.ID, "template.cover_uploaded", ""); err != nil {
			return "", err
		}

		// Orders never point at covers, so the old one can always go.
		return current.CoverPath.String, nil
	}, func(template AdminTemplate) UploadTemplateCoverResponseObject {
		return UploadTemplateCover200JSONResponse(template)
	})
}

// DownloadAdminTemplateZip sends the current ZIP as review-<slug>.zip.
func (s *Server) DownloadAdminTemplateZip(ctx context.Context, request DownloadAdminTemplateZipRequestObject) (DownloadAdminTemplateZipResponseObject, error) {
	if _, denied, err := s.adminSession(ctx, true); err != nil || denied != nil {
		return denied, err
	}

	current, err := s.queries.GetAdminTemplate(ctx, request.Id)
	if errors.Is(err, pgx.ErrNoRows) {
		return templateNotFound(), nil
	}
	if err != nil {
		return nil, fmt.Errorf("membaca template: %w", err)
	}
	file, size, refused, err := s.openStoredFile(ctx, current.Template.ArchivePath, "File ZIP belum diunggah.")
	if err != nil || refused != nil {
		return refused, err
	}
	extendDeadlines(ctx)

	return DownloadAdminTemplateZip200ApplicationzipResponse{
		Body:          file,
		ContentLength: size,
		Headers:       DownloadAdminTemplateZip200ResponseHeaders{ContentDisposition: `attachment; filename="review-` + current.Template.Slug + `.zip"`},
	}, nil
}

// GetAdminTemplateCover sends the stored cover for previews in the admin panel.
func (s *Server) GetAdminTemplateCover(ctx context.Context, request GetAdminTemplateCoverRequestObject) (GetAdminTemplateCoverResponseObject, error) {
	if _, denied, err := s.adminSession(ctx, true); err != nil || denied != nil {
		return denied, err
	}

	current, err := s.queries.GetAdminTemplate(ctx, request.Id)
	if errors.Is(err, pgx.ErrNoRows) {
		return templateNotFound(), nil
	}
	if err != nil {
		return nil, fmt.Errorf("membaca template: %w", err)
	}
	file, size, refused, err := s.openStoredFile(ctx, current.Template.CoverPath, "Sampul belum diunggah.")
	if err != nil || refused != nil {
		return refused, err
	}

	return GetAdminTemplateCover200ImagewebpResponse{Body: file, ContentLength: size}, nil
}
