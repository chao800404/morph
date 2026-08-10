CREATE TABLE `product_variant_price_history` (
	`id` text PRIMARY KEY NOT NULL,
	`variant_id` text NOT NULL,
	`currency_code` text NOT NULL,
	`old_amount` integer,
	`new_amount` integer,
	`changed_by` text NOT NULL,
	`changed_at` text NOT NULL,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "product_variant_price_history_currency_code_check" CHECK(length("product_variant_price_history"."currency_code") = 3 AND "product_variant_price_history"."currency_code" = lower("product_variant_price_history"."currency_code"))
);
--> statement-breakpoint
CREATE INDEX `product_variant_price_history_variant_date_idx` ON `product_variant_price_history` (`variant_id`,`changed_at`);