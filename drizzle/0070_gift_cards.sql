CREATE TABLE `gift_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`store_credit_account_id` text NOT NULL,
	`code` text NOT NULL,
	`code_hash` text NOT NULL,
	`value` integer NOT NULL,
	`currency_code` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`expires_at` text,
	`reference` text,
	`reference_id` text,
	`line_item_id` text,
	`note` text,
	`created_by` text,
	`updated_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gift_cards_code_unique` ON `gift_cards` (`code`);
--> statement-breakpoint
CREATE UNIQUE INDEX `gift_cards_code_hash_unique` ON `gift_cards` (`code_hash`);
--> statement-breakpoint
CREATE UNIQUE INDEX `gift_cards_store_credit_account_unique` ON `gift_cards` (`store_credit_account_id`);
--> statement-breakpoint
CREATE INDEX `gift_cards_reference_idx` ON `gift_cards` (`reference`,`reference_id`,`deleted_at`);
--> statement-breakpoint
CREATE INDEX `gift_cards_line_item_idx` ON `gift_cards` (`line_item_id`,`deleted_at`);
