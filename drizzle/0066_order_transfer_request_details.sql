ALTER TABLE `order_transfers`
ADD COLUMN `target_email` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `order_transfers`
ADD COLUMN `description` text;
--> statement-breakpoint
ALTER TABLE `order_transfers`
ADD COLUMN `update_order_email` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE `order_transfers`
SET `target_email` = lower((
	SELECT `email` FROM `customers`
	WHERE `customers`.`id` = `order_transfers`.`requester_customer_id`
	  AND `customers`.`deleted_at` IS NULL
))
WHERE `target_email` = ''
	AND EXISTS (
		SELECT 1 FROM `customers`
		WHERE `customers`.`id` = `order_transfers`.`requester_customer_id`
		  AND `customers`.`deleted_at` IS NULL
	);
