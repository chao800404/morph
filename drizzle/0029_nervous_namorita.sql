DROP INDEX `order_shipping_method_adjustments_version_method_unique`;--> statement-breakpoint
CREATE INDEX `order_shipping_method_adjustments_version_method_idx` ON `order_shipping_method_adjustments` (`version`,`shipping_method_id`);--> statement-breakpoint
ALTER TABLE `order_line_items` ADD `product_collection_id` text;