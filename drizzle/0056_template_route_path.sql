-- A static source route no template type describes (`/aboutus`) gets a
-- document of its own, bound by route path. Additive: existing templates keep
-- route_path NULL and are still found by type.
ALTER TABLE `storefront_theme_templates` ADD `route_path` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `storefront_theme_templates_active_route_unique` ON `storefront_theme_templates` (`theme_id`,`route_path`) WHERE "storefront_theme_templates"."route_path" IS NOT NULL AND "storefront_theme_templates"."deleted_at" IS NULL;
