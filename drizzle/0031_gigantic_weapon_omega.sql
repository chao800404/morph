-- Cloudflare D1 executes migrations inside an implicit transaction and does
-- not authorize changing `foreign_keys` there. Defer constraint validation
-- while Drizzle rebuilds the affected tables instead.
PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__migration_0031_storefront_domains` AS SELECT * FROM `storefront_domains`;--> statement-breakpoint
CREATE TABLE `__migration_0031_storefront_themes` AS SELECT * FROM `storefront_themes`;--> statement-breakpoint
CREATE TABLE `__migration_0031_storefront_theme_templates` AS SELECT * FROM `storefront_theme_templates`;--> statement-breakpoint
CREATE TABLE `__migration_0031_product_assets` AS SELECT * FROM `product_assets`;--> statement-breakpoint
CREATE TABLE `__migration_0031_product_category_links` AS SELECT * FROM `product_category_links`;--> statement-breakpoint
CREATE TABLE `__migration_0031_product_product_options` AS SELECT * FROM `product_product_options`;--> statement-breakpoint
CREATE TABLE `__migration_0031_product_tag_links` AS SELECT * FROM `product_tag_links`;--> statement-breakpoint
CREATE TABLE `__migration_0031_product_variants` AS SELECT * FROM `product_variants`;--> statement-breakpoint
CREATE TABLE `__migration_0031_product_variant_assets` AS SELECT * FROM `product_variant_assets`;--> statement-breakpoint
CREATE TABLE `__migration_0031_product_variant_option_values` AS SELECT * FROM `product_variant_option_values`;--> statement-breakpoint
CREATE TABLE `__migration_0031_product_variant_price_history` AS SELECT * FROM `product_variant_price_history`;--> statement-breakpoint
CREATE TABLE `__migration_0031_product_variant_prices` AS SELECT * FROM `product_variant_prices`;--> statement-breakpoint
CREATE TABLE `__new_user_table_views` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`table_key` text NOT NULL,
	`name` text DEFAULT 'Default' NOT NULL,
	`configuration` text NOT NULL,
	`is_default` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_user_table_views`("id", "user_id", "table_key", "name", "configuration", "is_default", "created_at", "updated_at") SELECT "id", "user_id", "table_key", "name", "configuration", "is_default", "created_at", "updated_at" FROM `user_table_views`;--> statement-breakpoint
DROP TABLE `user_table_views`;--> statement-breakpoint
ALTER TABLE `__new_user_table_views` RENAME TO `user_table_views`;--> statement-breakpoint
CREATE UNIQUE INDEX `user_table_views_user_table_name_uq` ON `user_table_views` (`user_id`,`table_key`,`name`);--> statement-breakpoint
CREATE TABLE `__new_storefronts` (
	`id` text PRIMARY KEY NOT NULL,
	`sales_channel_id` text NOT NULL,
	`name` text NOT NULL,
	`domain` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`active_theme_id` text,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
INSERT INTO `__new_storefronts`("id", "sales_channel_id", "name", "domain", "status", "active_theme_id", "metadata", "created_at", "updated_at", "deleted_at") SELECT "id", "sales_channel_id", "name", "domain", "status", "active_theme_id", "metadata", "created_at", "updated_at", "deleted_at" FROM `storefronts`;--> statement-breakpoint
DROP TABLE `storefronts`;--> statement-breakpoint
ALTER TABLE `__new_storefronts` RENAME TO `storefronts`;--> statement-breakpoint
CREATE UNIQUE INDEX `storefronts_active_channel_unique` ON `storefronts` (`sales_channel_id`) WHERE "storefronts"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `storefronts_active_domain_unique` ON `storefronts` (`domain`) WHERE "storefronts"."deleted_at" IS NULL AND "storefronts"."domain" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `__new_product_assets` (
	`product_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`rank` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`product_id`, `asset_id`),
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_product_assets`("product_id", "asset_id", "rank") SELECT "product_id", "asset_id", "rank" FROM `product_assets`;--> statement-breakpoint
DROP TABLE `product_assets`;--> statement-breakpoint
ALTER TABLE `__new_product_assets` RENAME TO `product_assets`;--> statement-breakpoint
CREATE INDEX `product_assets_product_rank_idx` ON `product_assets` (`product_id`,`rank`);--> statement-breakpoint
CREATE INDEX `product_assets_asset_idx` ON `product_assets` (`asset_id`);--> statement-breakpoint
CREATE TABLE `__new_product_variant_assets` (
	`variant_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`rank` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`variant_id`, `asset_id`),
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_product_variant_assets`("variant_id", "asset_id", "rank") SELECT "variant_id", "asset_id", "rank" FROM `product_variant_assets`;--> statement-breakpoint
DROP TABLE `product_variant_assets`;--> statement-breakpoint
ALTER TABLE `__new_product_variant_assets` RENAME TO `product_variant_assets`;--> statement-breakpoint
CREATE INDEX `product_variant_assets_variant_rank_idx` ON `product_variant_assets` (`variant_id`,`rank`);--> statement-breakpoint
CREATE INDEX `product_variant_assets_asset_idx` ON `product_variant_assets` (`asset_id`);--> statement-breakpoint
CREATE TABLE `__new_product_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`title` text NOT NULL,
	`sku` text,
	`barcode` text,
	`ean` text,
	`upc` text,
	`rank` integer DEFAULT 0 NOT NULL,
	`manage_inventory` integer DEFAULT true NOT NULL,
	`allow_backorder` integer DEFAULT false NOT NULL,
	`inventory_quantity` integer DEFAULT 0 NOT NULL,
	`weight` real,
	`length` real,
	`width` real,
	`height` real,
	`origin_country` text,
	`hs_code` text,
	`mid_code` text,
	`material` text,
	`thumbnail_asset_id` text,
	`metadata` text,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "product_variants_inventory_quantity_check" CHECK("__new_product_variants"."inventory_quantity" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_product_variants`("id", "product_id", "title", "sku", "barcode", "ean", "upc", "rank", "manage_inventory", "allow_backorder", "inventory_quantity", "weight", "length", "width", "height", "origin_country", "hs_code", "mid_code", "material", "thumbnail_asset_id", "metadata", "created_by", "updated_by", "created_at", "updated_at", "deleted_at") SELECT "id", "product_id", "title", "sku", "barcode", "ean", "upc", "rank", "manage_inventory", "allow_backorder", "inventory_quantity", "weight", "length", "width", "height", "origin_country", "hs_code", "mid_code", "material", "thumbnail_asset_id", "metadata", "created_by", "updated_by", "created_at", "updated_at", "deleted_at" FROM `product_variants`;--> statement-breakpoint
DROP TABLE `product_variants`;--> statement-breakpoint
ALTER TABLE `__new_product_variants` RENAME TO `product_variants`;--> statement-breakpoint
CREATE INDEX `product_variants_product_active_idx` ON `product_variants` (`product_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `product_variants_product_rank_idx` ON `product_variants` (`product_id`,`rank`);--> statement-breakpoint
CREATE UNIQUE INDEX `product_variants_active_sku_unique` ON `product_variants` (`sku`) WHERE "product_variants"."deleted_at" IS NULL AND "product_variants"."sku" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `product_variants_active_barcode_unique` ON `product_variants` (`barcode`) WHERE "product_variants"."deleted_at" IS NULL AND "product_variants"."barcode" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `product_variants_active_ean_unique` ON `product_variants` (`ean`) WHERE "product_variants"."deleted_at" IS NULL AND "product_variants"."ean" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `product_variants_active_upc_unique` ON `product_variants` (`upc`) WHERE "product_variants"."deleted_at" IS NULL AND "product_variants"."upc" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `__new_products` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`handle` text NOT NULL,
	`subtitle` text,
	`description` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`is_giftcard` integer DEFAULT false NOT NULL,
	`discountable` integer DEFAULT true NOT NULL,
	`collection_id` text,
	`type_id` text,
	`thumbnail_asset_id` text,
	`weight` real,
	`length` real,
	`width` real,
	`height` real,
	`origin_country` text,
	`hs_code` text,
	`mid_code` text,
	`material` text,
	`external_id` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`collection_id`) REFERENCES `product_collections`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`type_id`) REFERENCES `product_types`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "products_status_check" CHECK("__new_products"."status" IN ('draft', 'published', 'archived'))
);
--> statement-breakpoint
INSERT INTO `__new_products`("id", "title", "handle", "subtitle", "description", "status", "is_giftcard", "discountable", "collection_id", "type_id", "thumbnail_asset_id", "weight", "length", "width", "height", "origin_country", "hs_code", "mid_code", "material", "external_id", "metadata", "created_by", "updated_by", "created_at", "updated_at", "deleted_at") SELECT "id", "title", "handle", "subtitle", "description", "status", "is_giftcard", "discountable", "collection_id", "type_id", "thumbnail_asset_id", "weight", "length", "width", "height", "origin_country", "hs_code", "mid_code", "material", "external_id", "metadata", "created_by", "updated_by", "created_at", "updated_at", "deleted_at" FROM `products`;--> statement-breakpoint
DROP TABLE `products`;--> statement-breakpoint
ALTER TABLE `__new_products` RENAME TO `products`;--> statement-breakpoint
CREATE UNIQUE INDEX `products_active_handle_unique` ON `products` (`handle`) WHERE "products"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `products_status_active_idx` ON `products` (`status`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `products_collection_active_idx` ON `products` (`collection_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `products_type_active_idx` ON `products` (`type_id`,`deleted_at`);
--> statement-breakpoint
INSERT OR IGNORE INTO `storefront_domains` SELECT * FROM `__migration_0031_storefront_domains`;--> statement-breakpoint
INSERT OR IGNORE INTO `storefront_themes` SELECT * FROM `__migration_0031_storefront_themes`;--> statement-breakpoint
INSERT OR IGNORE INTO `storefront_theme_templates` SELECT * FROM `__migration_0031_storefront_theme_templates`;--> statement-breakpoint
INSERT OR IGNORE INTO `product_variants` SELECT * FROM `__migration_0031_product_variants`;--> statement-breakpoint
INSERT OR IGNORE INTO `product_assets` SELECT * FROM `__migration_0031_product_assets`;--> statement-breakpoint
INSERT OR IGNORE INTO `product_category_links` SELECT * FROM `__migration_0031_product_category_links`;--> statement-breakpoint
INSERT OR IGNORE INTO `product_product_options` SELECT * FROM `__migration_0031_product_product_options`;--> statement-breakpoint
INSERT OR IGNORE INTO `product_tag_links` SELECT * FROM `__migration_0031_product_tag_links`;--> statement-breakpoint
INSERT OR IGNORE INTO `product_variant_assets` SELECT * FROM `__migration_0031_product_variant_assets`;--> statement-breakpoint
INSERT OR IGNORE INTO `product_variant_option_values` SELECT * FROM `__migration_0031_product_variant_option_values`;--> statement-breakpoint
INSERT OR IGNORE INTO `product_variant_price_history` SELECT * FROM `__migration_0031_product_variant_price_history`;--> statement-breakpoint
INSERT OR IGNORE INTO `product_variant_prices` SELECT * FROM `__migration_0031_product_variant_prices`;--> statement-breakpoint
DROP TABLE `__migration_0031_storefront_domains`;--> statement-breakpoint
DROP TABLE `__migration_0031_storefront_themes`;--> statement-breakpoint
DROP TABLE `__migration_0031_storefront_theme_templates`;--> statement-breakpoint
DROP TABLE `__migration_0031_product_assets`;--> statement-breakpoint
DROP TABLE `__migration_0031_product_category_links`;--> statement-breakpoint
DROP TABLE `__migration_0031_product_product_options`;--> statement-breakpoint
DROP TABLE `__migration_0031_product_tag_links`;--> statement-breakpoint
DROP TABLE `__migration_0031_product_variants`;--> statement-breakpoint
DROP TABLE `__migration_0031_product_variant_assets`;--> statement-breakpoint
DROP TABLE `__migration_0031_product_variant_option_values`;--> statement-breakpoint
DROP TABLE `__migration_0031_product_variant_price_history`;--> statement-breakpoint
DROP TABLE `__migration_0031_product_variant_prices`;--> statement-breakpoint
PRAGMA foreign_key_check;
