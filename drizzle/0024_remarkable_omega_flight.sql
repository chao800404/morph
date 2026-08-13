CREATE TABLE `storefront_theme_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`theme_id` text NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`document` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`theme_id`) REFERENCES `storefront_themes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `storefront_theme_templates_active_name_unique` ON `storefront_theme_templates` (`theme_id`,`type`,`name`) WHERE "storefront_theme_templates"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `storefront_theme_templates_theme_type_idx` ON `storefront_theme_templates` (`theme_id`,`type`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `storefront_themes` (
	`id` text PRIMARY KEY NOT NULL,
	`storefront_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`storefront_id`) REFERENCES `storefronts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `storefront_themes_active_name_unique` ON `storefront_themes` (`storefront_id`,`name`) WHERE "storefront_themes"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `storefront_themes_storefront_status_idx` ON `storefront_themes` (`storefront_id`,`status`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `storefronts` (
	`id` text PRIMARY KEY NOT NULL,
	`sales_channel_id` text NOT NULL,
	`name` text NOT NULL,
	`domain` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`active_theme_id` text,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`sales_channel_id`) REFERENCES `sales_channels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `storefronts_active_channel_unique` ON `storefronts` (`sales_channel_id`) WHERE "storefronts"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `storefronts_active_domain_unique` ON `storefronts` (`domain`) WHERE "storefronts"."deleted_at" IS NULL AND "storefronts"."domain" IS NOT NULL;--> statement-breakpoint
ALTER TABLE `sales_channels` ADD `type` text DEFAULT 'custom' NOT NULL;
--> statement-breakpoint
UPDATE `sales_channels`
SET `type` = 'storefront',
    `updated_at` = CURRENT_TIMESTAMP
WHERE `id` IN (
  SELECT `default_sales_channel_id`
  FROM `stores`
  WHERE `default_sales_channel_id` IS NOT NULL
);
--> statement-breakpoint
UPDATE `sales_channels`
SET `name` = 'Online Store',
    `description` = 'Products published to the online storefront.',
    `updated_at` = CURRENT_TIMESTAMP
WHERE `name` = 'Default Sales Channel'
  AND `type` = 'storefront';
