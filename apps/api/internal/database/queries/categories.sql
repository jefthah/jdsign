-- name: ListCategories :many
SELECT id, name, slug, description
FROM categories
ORDER BY name;

-- name: ListAdminCategories :many
-- template_count menghitung semua template, termasuk yang diarsipkan, karena semuanya menahan kategori.
SELECT categories.id, categories.name, categories.slug, categories.description,
       (SELECT count(*) FROM templates WHERE templates.category_id = categories.id)::int AS template_count
FROM categories
ORDER BY categories.name;

-- name: GetCategory :one
SELECT * FROM categories
WHERE id = @id;

-- name: GetCategoryForUpdate :one
SELECT * FROM categories
WHERE id = @id
FOR UPDATE;

-- name: CreateCategory :one
INSERT INTO categories (name, slug, description)
VALUES (@name, @slug, sqlc.narg(description))
RETURNING *;

-- name: UpdateCategory :one
UPDATE categories
SET name        = @name,
    slug        = @slug,
    description = sqlc.narg(description)
WHERE id = @id
RETURNING *;

-- name: CountTemplatesInCategory :one
SELECT count(*)::int FROM templates WHERE category_id = @category_id;

-- name: DeleteCategory :exec
DELETE FROM categories
WHERE id = @id;
