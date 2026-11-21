-- Template di panel admin (mode satu penjual) ----------------------------------
-- Status di panel: "published" = status approved dan belum diarsipkan; "draft" = status lain dan
-- belum diarsipkan; "archived" = deleted_at terisi. Pencarian memakai pola ILIKE yang sudah di-escape.

-- name: ListAdminTemplates :many
SELECT sqlc.embed(templates), categories.name AS category_name, categories.slug AS category_slug
FROM templates
JOIN categories ON categories.id = templates.category_id
WHERE (
        (@filter::text = 'active' AND templates.deleted_at IS NULL)
     OR (@filter = 'published' AND templates.deleted_at IS NULL AND templates.status = 'approved')
     OR (@filter = 'draft' AND templates.deleted_at IS NULL AND templates.status <> 'approved')
     OR (@filter = 'archived' AND templates.deleted_at IS NOT NULL)
    )
  AND (@pattern::text = '' OR templates.title ILIKE @pattern OR templates.technology ILIKE @pattern)
ORDER BY templates.updated_at DESC, templates.id DESC
LIMIT @row_limit OFFSET @row_offset;

-- name: CountAdminTemplates :one
SELECT count(*)::int
FROM templates
WHERE (
        (@filter::text = 'active' AND deleted_at IS NULL)
     OR (@filter = 'published' AND deleted_at IS NULL AND status = 'approved')
     OR (@filter = 'draft' AND deleted_at IS NULL AND status <> 'approved')
     OR (@filter = 'archived' AND deleted_at IS NOT NULL)
    )
  AND (@pattern::text = '' OR title ILIKE @pattern OR technology ILIKE @pattern);

-- name: GetAdminTemplate :one
SELECT sqlc.embed(templates), categories.name AS category_name, categories.slug AS category_slug
FROM templates
JOIN categories ON categories.id = templates.category_id
WHERE templates.id = @id;

-- name: GetTemplateForUpdate :one
SELECT * FROM templates
WHERE id = @id
FOR UPDATE;

-- name: CreateTemplate :one
INSERT INTO templates (seller_id, category_id, title, slug, summary, description, price, version, technology, preview_url)
VALUES (@seller_id, @category_id, @title, @slug, @summary, @description, @price, @version, @technology, sqlc.narg(preview_url))
RETURNING id;

-- name: UpdateTemplateDetails :exec
UPDATE templates
SET category_id = @category_id,
    title       = @title,
    summary     = @summary,
    description = @description,
    price       = @price,
    version     = @version,
    technology  = @technology,
    preview_url = sqlc.narg(preview_url)
WHERE id = @id;

-- name: SetTemplateArchiveFile :exec
UPDATE templates
SET archive_path = @archive_path,
    archive_name = @archive_name,
    archive_size = @archive_size
WHERE id = @id;

-- name: SetTemplateCoverFile :exec
UPDATE templates
SET cover_path = @cover_path
WHERE id = @id;

-- name: PublishTemplate :exec
UPDATE templates
SET status      = 'approved',
    approved_by = @admin_id,
    approved_at = now(),
    admin_note  = NULL
WHERE id = @id;

-- name: UnpublishTemplate :exec
UPDATE templates
SET status      = 'draft',
    approved_by = NULL,
    approved_at = NULL
WHERE id = @id;

-- name: ArchiveTemplate :exec
-- Diarsipkan sekaligus diturunkan ke draft, supaya memulihkannya tidak langsung menayangkannya lagi.
UPDATE templates
SET deleted_at  = now(),
    status      = 'draft',
    approved_by = NULL,
    approved_at = NULL
WHERE id = @id;

-- name: RestoreTemplate :exec
UPDATE templates
SET deleted_at = NULL
WHERE id = @id;

-- name: CountOrderItemsUsingArchive :one
-- File ZIP lama tidak boleh dihapus selama masih dipakai pesanan (lihat docs/spec.md 7.3).
SELECT count(*)::int FROM order_items WHERE archive_path = @archive_path;
