-- A Theme file is either source text or bytes held in the immutable blob
-- store (images and fonts under public/). A binary row keeps `content` as
-- the empty string only because the column is NOT NULL; its bytes are
-- addressed by `blob_digest`, and no reader may take them from `content`.
ALTER TABLE `storefront_theme_files` ADD `encoding` text DEFAULT 'utf8' NOT NULL;
--> statement-breakpoint
ALTER TABLE `storefront_theme_files` ADD `blob_digest` text;
--> statement-breakpoint
ALTER TABLE `storefront_theme_files` ADD `size_bytes` integer;
--> statement-breakpoint
-- The columns must agree with each other. A CHECK naming several columns
-- cannot be added to an existing table without rebuilding it, and this one
-- has foreign keys, so triggers refuse the bad rows instead: text with a
-- digest, or bytes without a well-formed SHA-256, a size, or an empty body.
-- The digest is checked with ltrim rather than a GLOB character class, which
-- D1 has refused as too complex.
CREATE TRIGGER `storefront_theme_files_encoding_insert`
BEFORE INSERT ON `storefront_theme_files`
WHEN NOT (
  (NEW.`encoding` = 'utf8' AND NEW.`blob_digest` IS NULL AND NEW.`size_bytes` IS NULL)
  OR (
    NEW.`encoding` = 'binary'
    AND NEW.`content` = ''
    AND NEW.`size_bytes` IS NOT NULL AND NEW.`size_bytes` >= 0
    AND NEW.`blob_digest` IS NOT NULL
    AND length(NEW.`blob_digest`) = 64
    AND ltrim(NEW.`blob_digest`, '0123456789abcdef') = ''
  )
)
BEGIN
  SELECT RAISE(ABORT, 'storefront_theme_files: encoding, blob_digest, size_bytes and content disagree');
END;
--> statement-breakpoint
CREATE TRIGGER `storefront_theme_files_encoding_update`
BEFORE UPDATE ON `storefront_theme_files`
WHEN NOT (
  (NEW.`encoding` = 'utf8' AND NEW.`blob_digest` IS NULL AND NEW.`size_bytes` IS NULL)
  OR (
    NEW.`encoding` = 'binary'
    AND NEW.`content` = ''
    AND NEW.`size_bytes` IS NOT NULL AND NEW.`size_bytes` >= 0
    AND NEW.`blob_digest` IS NOT NULL
    AND length(NEW.`blob_digest`) = 64
    AND ltrim(NEW.`blob_digest`, '0123456789abcdef') = ''
  )
)
BEGIN
  SELECT RAISE(ABORT, 'storefront_theme_files: encoding, blob_digest, size_bytes and content disagree');
END;
