ALTER TABLE `reservation_items` ADD `cart_id` text;--> statement-breakpoint
ALTER TABLE `reservation_items` ADD `expires_at` text;--> statement-breakpoint
CREATE INDEX `reservation_items_cart_active_idx` ON `reservation_items` (`cart_id`,`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `reservation_items_line_item_inventory_location_unique` ON `reservation_items` (`line_item_id`,`inventory_item_id`,`location_id`) WHERE "reservation_items"."deleted_at" IS NULL AND "reservation_items"."line_item_id" IS NOT NULL;