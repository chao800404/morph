-- The source index is a server-derived cache of the Theme source contract.
-- It is keyed by source_generation on the mutable workspace and by the
-- immutable source manifest digest set on revisions. It is never a client
-- supplied path allowlist or an authorization decision by itself.
ALTER TABLE `storefront_themes` ADD `source_index_version` integer;
--> statement-breakpoint
ALTER TABLE `storefront_themes` ADD `source_index_status` text;
--> statement-breakpoint
ALTER TABLE `storefront_themes` ADD `source_index` text;
--> statement-breakpoint
ALTER TABLE `storefront_theme_revisions` ADD `source_index` text;
