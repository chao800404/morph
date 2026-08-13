CREATE TABLE `storefront_domains` (
	`id` text PRIMARY KEY NOT NULL,
	`storefront_id` text NOT NULL,
	`hostname` text NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`cloudflare_domain_id` text,
	`error_message` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`storefront_id`) REFERENCES `storefronts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `storefront_domains_active_hostname_unique` ON `storefront_domains` (`hostname`) WHERE "storefront_domains"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `storefront_domains_primary_unique` ON `storefront_domains` (`storefront_id`) WHERE "storefront_domains"."deleted_at" IS NULL AND "storefront_domains"."is_primary" = 1;--> statement-breakpoint
CREATE INDEX `storefront_domains_storefront_status_idx` ON `storefront_domains` (`storefront_id`,`status`,`deleted_at`);