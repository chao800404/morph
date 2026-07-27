CREATE TABLE `product_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`handle` text NOT NULL,
	`mpath` text NOT NULL,
	`is_active` integer DEFAULT false NOT NULL,
	`is_internal` integer DEFAULT false NOT NULL,
	`rank` integer DEFAULT 0 NOT NULL,
	`parent_category_id` text,
	`external_id` text,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`parent_category_id`) REFERENCES `product_categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_categories_active_handle_unique` ON `product_categories` (`handle`) WHERE "product_categories"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `product_categories_mpath_idx` ON `product_categories` (`mpath`);--> statement-breakpoint
CREATE INDEX `product_categories_parent_rank_idx` ON `product_categories` (`parent_category_id`,`rank`);--> statement-breakpoint
CREATE TABLE `product_category_links` (
	`product_id` text NOT NULL,
	`category_id` text NOT NULL,
	PRIMARY KEY(`product_id`, `category_id`),
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `product_categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `product_category_links_category_idx` ON `product_category_links` (`category_id`);--> statement-breakpoint
CREATE TABLE `product_product_option_values` (
	`product_product_option_id` text NOT NULL,
	`option_value_id` text NOT NULL,
	`rank` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`product_product_option_id`, `option_value_id`),
	FOREIGN KEY (`product_product_option_id`) REFERENCES `product_product_options`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`option_value_id`) REFERENCES `product_option_values`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `product_product_option_values_value_idx` ON `product_product_option_values` (`option_value_id`);--> statement-breakpoint
CREATE TABLE `product_product_options` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`option_id` text NOT NULL,
	`rank` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`option_id`) REFERENCES `product_options`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_product_options_unique` ON `product_product_options` (`product_id`,`option_id`);--> statement-breakpoint
CREATE INDEX `product_product_options_product_rank_idx` ON `product_product_options` (`product_id`,`rank`);--> statement-breakpoint
CREATE INDEX `product_product_options_option_idx` ON `product_product_options` (`option_id`);--> statement-breakpoint
CREATE TABLE `product_tag_links` (
	`product_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`product_id`, `tag_id`),
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `product_tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `product_tag_links_tag_idx` ON `product_tag_links` (`tag_id`);--> statement-breakpoint
CREATE TABLE `product_tags` (
	`id` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`external_id` text,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_tags_active_value_unique` ON `product_tags` (`value`) WHERE "product_tags"."deleted_at" IS NULL;--> statement-breakpoint
CREATE TABLE `product_types` (
	`id` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`external_id` text,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_types_active_value_unique` ON `product_types` (`value`) WHERE "product_types"."deleted_at" IS NULL;--> statement-breakpoint
CREATE TABLE `product_variant_assets` (
	`variant_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`rank` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`variant_id`, `asset_id`),
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `product_variant_assets_variant_rank_idx` ON `product_variant_assets` (`variant_id`,`rank`);--> statement-breakpoint
CREATE INDEX `product_variant_assets_asset_idx` ON `product_variant_assets` (`asset_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_product_options` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text,
	`title` text NOT NULL,
	`is_exclusive` integer DEFAULT false NOT NULL,
	`rank` integer DEFAULT 0 NOT NULL,
	`metadata` text,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
-- drizzle-kit assumes the old table already has every column of the new one.
-- `product_options` gained is_exclusive / metadata / created_by / updated_by /
-- deleted_at in this migration, so only the pre-existing columns can be copied;
-- the rest take their defaults. Existing rows were per-product options, hence
-- is_exclusive = 1.
INSERT INTO `__new_product_options`("id", "product_id", "title", "is_exclusive", "rank", "metadata", "created_by", "updated_by", "created_at", "updated_at", "deleted_at") SELECT "id", "product_id", "title", 1, "rank", NULL, 'system', 'system', "created_at", "updated_at", NULL FROM `product_options`;--> statement-breakpoint
DROP TABLE `product_options`;--> statement-breakpoint
ALTER TABLE `__new_product_options` RENAME TO `product_options`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `product_options_global_title_unique` ON `product_options` (`title`) WHERE "product_options"."deleted_at" IS NULL AND "product_options"."is_exclusive" = 0;--> statement-breakpoint
CREATE INDEX `product_options_active_rank_idx` ON `product_options` (`deleted_at`,`rank`);--> statement-breakpoint
DROP INDEX `option_template_values_template_value_unique`;--> statement-breakpoint
DROP INDEX `option_template_values_template_rank_idx`;--> statement-breakpoint
DROP INDEX `option_templates_active_title_unique`;--> statement-breakpoint
DROP INDEX `option_templates_active_rank_idx`;--> statement-breakpoint
DROP INDEX `product_option_values_option_value_unique`;--> statement-breakpoint
ALTER TABLE `product_option_values` ADD `metadata` text;--> statement-breakpoint
ALTER TABLE `product_option_values` ADD `deleted_at` text;--> statement-breakpoint
CREATE UNIQUE INDEX `product_option_values_option_value_unique` ON `product_option_values` (`option_id`,`value`) WHERE "product_option_values"."deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE `product_collections` ADD `metadata` text;--> statement-breakpoint
ALTER TABLE `product_variants` ADD `ean` text;--> statement-breakpoint
ALTER TABLE `product_variants` ADD `upc` text;--> statement-breakpoint
ALTER TABLE `product_variants` ADD `origin_country` text;--> statement-breakpoint
ALTER TABLE `product_variants` ADD `hs_code` text;--> statement-breakpoint
ALTER TABLE `product_variants` ADD `mid_code` text;--> statement-breakpoint
ALTER TABLE `product_variants` ADD `material` text;--> statement-breakpoint
ALTER TABLE `product_variants` ADD `thumbnail_asset_id` text REFERENCES assets(id);--> statement-breakpoint
ALTER TABLE `product_variants` ADD `metadata` text;--> statement-breakpoint
CREATE UNIQUE INDEX `product_variants_active_barcode_unique` ON `product_variants` (`barcode`) WHERE "product_variants"."deleted_at" IS NULL AND "product_variants"."barcode" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `product_variants_active_ean_unique` ON `product_variants` (`ean`) WHERE "product_variants"."deleted_at" IS NULL AND "product_variants"."ean" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `product_variants_active_upc_unique` ON `product_variants` (`upc`) WHERE "product_variants"."deleted_at" IS NULL AND "product_variants"."upc" IS NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `is_giftcard` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `discountable` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `type_id` text REFERENCES product_types(id);--> statement-breakpoint
ALTER TABLE `products` ADD `weight` integer;--> statement-breakpoint
ALTER TABLE `products` ADD `length` integer;--> statement-breakpoint
ALTER TABLE `products` ADD `width` integer;--> statement-breakpoint
ALTER TABLE `products` ADD `height` integer;--> statement-breakpoint
ALTER TABLE `products` ADD `origin_country` text;--> statement-breakpoint
ALTER TABLE `products` ADD `hs_code` text;--> statement-breakpoint
ALTER TABLE `products` ADD `mid_code` text;--> statement-breakpoint
ALTER TABLE `products` ADD `material` text;--> statement-breakpoint
ALTER TABLE `products` ADD `external_id` text;--> statement-breakpoint
CREATE INDEX `products_type_active_idx` ON `products` (`type_id`,`deleted_at`);