CREATE TABLE `order_transfers` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL REFERENCES `orders`(`id`) ON DELETE CASCADE,
	`source_customer_id` text,
	`requester_customer_id` text NOT NULL,
	`sales_channel_id` text NOT NULL,
	`email` text NOT NULL,
	`token_hash` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` text NOT NULL,
	`accepted_at` text,
	`declined_at` text,
	`canceled_at` text,
	`created_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	CONSTRAINT `order_transfers_status_check` CHECK (`status` IN ('pending', 'accepted', 'declined', 'canceled', 'expired'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `order_transfers_pending_order_unique` ON `order_transfers` (`order_id`) WHERE `status` = 'pending' AND `deleted_at` IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `order_transfers_token_hash_unique` ON `order_transfers` (`token_hash`);
--> statement-breakpoint
CREATE INDEX `order_transfers_customer_status_idx` ON `order_transfers` (`requester_customer_id`,`status`,`deleted_at`);
