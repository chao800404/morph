CREATE TABLE `product_assets` (
	`product_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`rank` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`product_id`, `asset_id`),
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `product_assets_product_rank_idx` ON `product_assets` (`product_id`,`rank`);--> statement-breakpoint
CREATE INDEX `product_assets_asset_idx` ON `product_assets` (`asset_id`);--> statement-breakpoint
CREATE TABLE `product_collections` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`handle` text NOT NULL,
	`description` text,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_collections_active_handle_unique` ON `product_collections` (`handle`) WHERE "product_collections"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `product_collections_active_idx` ON `product_collections` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `product_option_values` (
	`id` text PRIMARY KEY NOT NULL,
	`option_id` text NOT NULL,
	`value` text NOT NULL,
	`rank` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`option_id`) REFERENCES `product_options`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_option_values_option_value_unique` ON `product_option_values` (`option_id`,`value`);--> statement-breakpoint
CREATE INDEX `product_option_values_option_rank_idx` ON `product_option_values` (`option_id`,`rank`);--> statement-breakpoint
CREATE TABLE `product_options` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`title` text NOT NULL,
	`rank` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_options_product_title_unique` ON `product_options` (`product_id`,`title`);--> statement-breakpoint
CREATE INDEX `product_options_product_rank_idx` ON `product_options` (`product_id`,`rank`);--> statement-breakpoint
CREATE TABLE `product_variant_option_values` (
	`variant_id` text NOT NULL,
	`option_value_id` text NOT NULL,
	PRIMARY KEY(`variant_id`, `option_value_id`),
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`option_value_id`) REFERENCES `product_option_values`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `product_variant_option_values_value_idx` ON `product_variant_option_values` (`option_value_id`);--> statement-breakpoint
CREATE TABLE `product_variant_prices` (
	`id` text PRIMARY KEY NOT NULL,
	`variant_id` text NOT NULL,
	`currency_code` text NOT NULL,
	`amount` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "product_variant_prices_amount_check" CHECK("product_variant_prices"."amount" >= 0),
	CONSTRAINT "product_variant_prices_currency_code_check" CHECK(length("product_variant_prices"."currency_code") = 3 AND "product_variant_prices"."currency_code" = lower("product_variant_prices"."currency_code"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_variant_prices_variant_currency_unique` ON `product_variant_prices` (`variant_id`,`currency_code`);--> statement-breakpoint
CREATE TABLE `product_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`title` text NOT NULL,
	`sku` text,
	`barcode` text,
	`rank` integer DEFAULT 0 NOT NULL,
	`manage_inventory` integer DEFAULT true NOT NULL,
	`allow_backorder` integer DEFAULT false NOT NULL,
	`inventory_quantity` integer DEFAULT 0 NOT NULL,
	`weight` integer,
	`length` integer,
	`width` integer,
	`height` integer,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "product_variants_inventory_quantity_check" CHECK("product_variants"."inventory_quantity" >= 0)
);
--> statement-breakpoint
CREATE INDEX `product_variants_product_active_idx` ON `product_variants` (`product_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `product_variants_product_rank_idx` ON `product_variants` (`product_id`,`rank`);--> statement-breakpoint
CREATE UNIQUE INDEX `product_variants_active_sku_unique` ON `product_variants` (`sku`) WHERE "product_variants"."deleted_at" IS NULL AND "product_variants"."sku" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`handle` text NOT NULL,
	`subtitle` text,
	`description` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`collection_id` text,
	`thumbnail_asset_id` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`collection_id`) REFERENCES `product_collections`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`thumbnail_asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "products_status_check" CHECK("products"."status" IN ('draft', 'published', 'archived'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_active_handle_unique` ON `products` (`handle`) WHERE "products"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `products_status_active_idx` ON `products` (`status`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `products_collection_active_idx` ON `products` (`collection_id`,`deleted_at`);