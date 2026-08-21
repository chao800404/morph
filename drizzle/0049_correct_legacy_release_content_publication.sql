-- Correct the 0048 compatibility backfill: only the cutover active release
-- can retain a synthetic publication. Historical releases have no stored
-- content identity that would make a backfill trustworthy.
UPDATE storefront_releases AS r
SET content_publication_id = NULL
WHERE r.content_publication_id = 'legacy-' || r.id
  AND NOT EXISTS (
    SELECT 1 FROM storefronts s
    WHERE s.id = r.storefront_id
      AND s.active_release_id = r.id
      AND s.deleted_at IS NULL
  );
--> statement-breakpoint
DELETE FROM storefront_content_publication_items
WHERE publication_id IN (
  SELECT 'legacy-' || r.id
  FROM storefront_releases r
  WHERE r.content_publication_id IS NULL
);
--> statement-breakpoint
DELETE FROM storefront_content_publications
WHERE id IN (
  SELECT 'legacy-' || r.id
  FROM storefront_releases r
  WHERE r.content_publication_id IS NULL
);
