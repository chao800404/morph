-- Backfill legacy releases with an immutable content publication before Edge Runtime.
INSERT INTO storefront_content_publications
  (id, storefront_id, created_by, created_at, updated_at)
SELECT
  'legacy-' || r.id,
  r.storefront_id,
  r.created_by,
  r.created_at,
  r.updated_at
FROM storefront_releases r
WHERE r.content_publication_id IS NULL;

INSERT INTO storefront_content_publication_items
  (id, publication_id, item_type, content_id, revision_id, created_at, updated_at)
SELECT
  'legacy-' || r.id || '-template-' || t.id,
  'legacy-' || r.id,
  'template',
  t.id,
  t.published_revision_id,
  r.created_at,
  r.updated_at
FROM storefront_releases r
INNER JOIN storefront_theme_templates t
  ON t.theme_id = r.theme_id
WHERE r.content_publication_id IS NULL
  AND t.published_revision_id IS NOT NULL
  AND t.deleted_at IS NULL;

INSERT INTO storefront_content_publication_items
  (id, publication_id, item_type, content_id, revision_id, created_at, updated_at)
SELECT
  'legacy-' || r.id || '-page-' || p.id,
  'legacy-' || r.id,
  'page',
  p.id,
  p.published_revision_id,
  r.created_at,
  r.updated_at
FROM storefront_releases r
INNER JOIN storefront_pages p
  ON p.storefront_id = r.storefront_id
WHERE r.content_publication_id IS NULL
  AND p.published_revision_id IS NOT NULL
  AND p.deleted_at IS NULL;

UPDATE storefront_releases
SET content_publication_id = 'legacy-' || id
WHERE content_publication_id IS NULL;
