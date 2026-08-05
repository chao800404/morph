PRAGMA foreign_keys=OFF;--> statement-breakpoint
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
	FOREIGN KEY (`thumbnail_asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "product_variants_inventory_quantity_check" CHECK("__new_product_variants"."inventory_quantity" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_product_variants`("id", "product_id", "title", "sku", "barcode", "ean", "upc", "rank", "manage_inventory", "allow_backorder", "inventory_quantity", "weight", "length", "width", "height", "origin_country", "hs_code", "mid_code", "material", "thumbnail_asset_id", "metadata", "created_by", "updated_by", "created_at", "updated_at", "deleted_at") SELECT "id", "product_id", "title", "sku", "barcode", "ean", "upc", "rank", "manage_inventory", "allow_backorder", "inventory_quantity", "weight", "length", "width", "height", "origin_country", "hs_code", "mid_code", "material", "thumbnail_asset_id", "metadata", "created_by", "updated_by", "created_at", "updated_at", "deleted_at" FROM `product_variants`;--> statement-breakpoint
DROP TABLE `product_variants`;--> statement-breakpoint
ALTER TABLE `__new_product_variants` RENAME TO `product_variants`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
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
	FOREIGN KEY (`thumbnail_asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "products_status_check" CHECK("__new_products"."status" IN ('draft', 'published', 'archived'))
);
--> statement-breakpoint
INSERT INTO `__new_products`("id", "title", "handle", "subtitle", "description", "status", "is_giftcard", "discountable", "collection_id", "type_id", "thumbnail_asset_id", "weight", "length", "width", "height", "origin_country", "hs_code", "mid_code", "material", "external_id", "metadata", "created_by", "updated_by", "created_at", "updated_at", "deleted_at") SELECT "id", "title", "handle", "subtitle", "description", "status", "is_giftcard", "discountable", "collection_id", "type_id", "thumbnail_asset_id", "weight", "length", "width", "height", "origin_country", "hs_code", "mid_code", "material", "external_id", "metadata", "created_by", "updated_by", "created_at", "updated_at", "deleted_at" FROM `products`;--> statement-breakpoint
DROP TABLE `products`;--> statement-breakpoint
ALTER TABLE `__new_products` RENAME TO `products`;--> statement-breakpoint
CREATE UNIQUE INDEX `products_active_handle_unique` ON `products` (`handle`) WHERE "products"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `products_status_active_idx` ON `products` (`status`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `products_collection_active_idx` ON `products` (`collection_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `products_type_active_idx` ON `products` (`type_id`,`deleted_at`);--> statement-breakpoint
ALTER TABLE `product_collections` ADD `external_id` text;