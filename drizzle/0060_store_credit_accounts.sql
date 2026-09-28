-- Store credit: accounts and their ledger.
--
-- Written down from the drizzle-kit output, which also carried every schema
-- difference since its last snapshot: tables and columns other migrations
-- already create (0053 deployment lease, 0055 source index, 0056 route path,
-- 0057/0058 route document moves, 0059 binary files, 0063 shipping option type
-- code, 0064 price list tiers, 0065 order transfers, 0069 unit of measure) and
-- rebuilds of inventory_levels, product_variant_inventory_items and
-- reservation_items switching quantities to REAL. Those rebuilds are left out
-- on purpose: 0069 records that the INTEGER-affinity columns already hold
-- fractional values, so no rewrite is needed and rollback stays lossless.
-- Applied in full, that output failed on a fresh database at the first object
-- another migration had already made.
CREATE TABLE `store_credit_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text,
	`code_hash` text NOT NULL,
	`currency_code` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`balance` integer DEFAULT 0 NOT NULL,
	`metadata` text,
	`created_by` text,
	`updated_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	CONSTRAINT "store_credit_accounts_balance_nonnegative" CHECK("store_credit_accounts"."balance" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `store_credit_accounts_code_hash_unique` ON `store_credit_accounts` (`code_hash`);
--> statement-breakpoint
CREATE INDEX `store_credit_accounts_customer_active_idx` ON `store_credit_accounts` (`customer_id`,`deleted_at`,`status`);
--> statement-breakpoint
CREATE INDEX `store_credit_accounts_currency_active_idx` ON `store_credit_accounts` (`currency_code`,`deleted_at`,`status`);
--> statement-breakpoint
CREATE TABLE `store_credit_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`type` text NOT NULL,
	`amount` integer NOT NULL,
	`idempotency_key` text NOT NULL,
	`reference` text,
	`reference_id` text,
	`note` text,
	`metadata` text,
	`created_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `store_credit_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "store_credit_transactions_amount_positive" CHECK("store_credit_transactions"."amount" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `store_credit_transactions_account_idempotency_unique` ON `store_credit_transactions` (`account_id`,`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `store_credit_transactions_account_created_idx` ON `store_credit_transactions` (`account_id`,`created_at`);
