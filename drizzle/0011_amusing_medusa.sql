CREATE TABLE `option_template_values` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text NOT NULL,
	`value` text NOT NULL,
	`rank` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `option_templates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `option_template_values_template_value_unique` ON `option_template_values` (`template_id`,`value`);--> statement-breakpoint
CREATE INDEX `option_template_values_template_rank_idx` ON `option_template_values` (`template_id`,`rank`);--> statement-breakpoint
CREATE TABLE `option_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`rank` integer DEFAULT 0 NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `option_templates_active_title_unique` ON `option_templates` (`title`) WHERE "option_templates"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `option_templates_active_rank_idx` ON `option_templates` (`deleted_at`,`rank`);