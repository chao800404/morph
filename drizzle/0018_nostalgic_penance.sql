PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_region_countries` (
	`iso_2` text PRIMARY KEY NOT NULL,
	`iso_3` text,
	`num_code` text,
	`name` text NOT NULL,
	`display_name` text NOT NULL,
	`region_id` text,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`region_id`) REFERENCES `regions`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "region_countries_iso_2_check" CHECK(length("__new_region_countries"."iso_2") = 2 AND "__new_region_countries"."iso_2" = lower("__new_region_countries"."iso_2"))
);
--> statement-breakpoint
INSERT INTO `__new_region_countries`("iso_2", "iso_3", "num_code", "name", "display_name", "region_id", "metadata", "created_at", "updated_at", "deleted_at") SELECT "iso_2", "iso_3", "num_code", "name", "display_name", "region_id", "metadata", "created_at", "updated_at", "deleted_at" FROM `region_countries`;--> statement-breakpoint
DROP TABLE `region_countries`;--> statement-breakpoint
ALTER TABLE `__new_region_countries` RENAME TO `region_countries`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `region_countries_region_iso2_unique` ON `region_countries` (`region_id`,`iso_2`);