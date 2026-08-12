DELETE FROM `product_variant_assets`
WHERE `asset_id` IN (
	SELECT `id` FROM `assets` WHERE `deleted_at` IS NOT NULL
);
--> statement-breakpoint
DELETE FROM `product_assets`
WHERE `asset_id` IN (
	SELECT `id` FROM `assets` WHERE `deleted_at` IS NOT NULL
);
--> statement-breakpoint
UPDATE `product_variants`
SET `thumbnail_asset_id` = (
	SELECT `pva`.`asset_id`
	FROM `product_variant_assets` `pva`
	INNER JOIN `assets` `a` ON `a`.`id` = `pva`.`asset_id`
	WHERE `pva`.`variant_id` = `product_variants`.`id`
		AND `a`.`deleted_at` IS NULL
	ORDER BY `pva`.`rank` ASC
	LIMIT 1
)
WHERE `thumbnail_asset_id` IN (
	SELECT `id` FROM `assets` WHERE `deleted_at` IS NOT NULL
);
--> statement-breakpoint
UPDATE `products`
SET `thumbnail_asset_id` = (
	SELECT `pa`.`asset_id`
	FROM `product_assets` `pa`
	INNER JOIN `assets` `a` ON `a`.`id` = `pa`.`asset_id`
	WHERE `pa`.`product_id` = `products`.`id`
		AND `a`.`deleted_at` IS NULL
	ORDER BY `pa`.`rank` ASC
	LIMIT 1
)
WHERE `thumbnail_asset_id` IN (
	SELECT `id` FROM `assets` WHERE `deleted_at` IS NOT NULL
);
