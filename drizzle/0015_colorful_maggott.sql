CREATE TABLE `currencies` (
	`code` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`symbol_native` text NOT NULL,
	`name` text NOT NULL,
	`decimal_digits` integer DEFAULT 0 NOT NULL,
	`rounding` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "currencies_code_check" CHECK(length("currencies"."code") = 3 AND "currencies"."code" = lower("currencies"."code")),
	CONSTRAINT "currencies_decimal_digits_check" CHECK("currencies"."decimal_digits" >= 0)
);
--> statement-breakpoint
CREATE TABLE `store_supported_currencies` (
	`store_id` text NOT NULL,
	`currency_code` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`is_tax_inclusive` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`store_id`, `currency_code`),
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`currency_code`) REFERENCES `currencies`(`code`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `store_supported_currencies_code_idx` ON `store_supported_currencies` (`currency_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `store_supported_currencies_one_default` ON `store_supported_currencies` (`store_id`) WHERE "store_supported_currencies"."is_default" = 1;--> statement-breakpoint
CREATE TABLE `stores` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
