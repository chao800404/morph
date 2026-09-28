-- Move legacy variant base prices into Pricing-owned price sets.
-- Keep product_variant_prices during the compatibility period so old builds
-- can continue reading their original data until an application rollback.

INSERT INTO `price_sets` (`id`, `created_at`, `updated_at`, `deleted_at`)
SELECT
  'pset_' || `legacy`.`variant_id`,
  MIN(`legacy`.`created_at`),
  MAX(`legacy`.`updated_at`),
  NULL
FROM `product_variant_prices` AS `legacy`
WHERE NOT EXISTS (
  SELECT 1
  FROM `product_variant_price_sets` AS `link`
  INNER JOIN `price_sets` AS `active_set`
    ON `active_set`.`id` = `link`.`price_set_id`
   AND `active_set`.`deleted_at` IS NULL
  WHERE `link`.`variant_id` = `legacy`.`variant_id`
)
GROUP BY `legacy`.`variant_id`
ON CONFLICT (`id`) DO UPDATE SET
  `updated_at` = excluded.`updated_at`,
  `deleted_at` = NULL;

INSERT INTO `product_variant_price_sets` (
  `variant_id`, `price_set_id`, `created_at`, `updated_at`
)
SELECT
  `legacy`.`variant_id`,
  'pset_' || `legacy`.`variant_id`,
  MIN(`legacy`.`created_at`),
  MAX(`legacy`.`updated_at`)
FROM `product_variant_prices` AS `legacy`
WHERE NOT EXISTS (
  SELECT 1
  FROM `product_variant_price_sets` AS `link`
  INNER JOIN `price_sets` AS `active_set`
    ON `active_set`.`id` = `link`.`price_set_id`
   AND `active_set`.`deleted_at` IS NULL
  WHERE `link`.`variant_id` = `legacy`.`variant_id`
)
GROUP BY `legacy`.`variant_id`
ON CONFLICT (`variant_id`, `price_set_id`) DO NOTHING;

INSERT INTO `prices` (
  `id`, `price_set_id`, `price_list_id`, `title`, `currency_code`, `amount`,
  `min_quantity`, `max_quantity`, `rules_count`, `created_at`, `updated_at`,
  `deleted_at`
)
SELECT
  'price_variant_base_' || `legacy`.`id`,
  (
    SELECT `link`.`price_set_id`
    FROM `product_variant_price_sets` AS `link`
    INNER JOIN `price_sets` AS `active_set`
      ON `active_set`.`id` = `link`.`price_set_id`
     AND `active_set`.`deleted_at` IS NULL
    WHERE `link`.`variant_id` = `legacy`.`variant_id`
    ORDER BY `link`.`price_set_id`
    LIMIT 1
  ),
  NULL,
  NULL,
  `legacy`.`currency_code`,
  `legacy`.`amount`,
  NULL,
  NULL,
  0,
  `legacy`.`created_at`,
  `legacy`.`updated_at`,
  NULL
FROM `product_variant_prices` AS `legacy`
WHERE NOT EXISTS (
  SELECT 1
  FROM `prices` AS `existing`
  INNER JOIN `product_variant_price_sets` AS `link`
    ON `link`.`price_set_id` = `existing`.`price_set_id`
   AND `link`.`variant_id` = `legacy`.`variant_id`
  INNER JOIN `price_sets` AS `active_set`
    ON `active_set`.`id` = `link`.`price_set_id`
   AND `active_set`.`deleted_at` IS NULL
  WHERE `existing`.`price_list_id` IS NULL
    AND `existing`.`currency_code` = `legacy`.`currency_code`
    AND `existing`.`min_quantity` IS NULL
    AND `existing`.`max_quantity` IS NULL
    AND `existing`.`rules_count` = 0
    AND `existing`.`deleted_at` IS NULL
    AND `link`.`price_set_id` = (
      SELECT `first_link`.`price_set_id`
      FROM `product_variant_price_sets` AS `first_link`
      INNER JOIN `price_sets` AS `first_set`
        ON `first_set`.`id` = `first_link`.`price_set_id`
       AND `first_set`.`deleted_at` IS NULL
      WHERE `first_link`.`variant_id` = `legacy`.`variant_id`
      ORDER BY `first_link`.`price_set_id`
      LIMIT 1
    )
)
AND NOT EXISTS (
  SELECT 1 FROM `prices` AS `existing`
  WHERE `existing`.`id` = 'price_variant_base_' || `legacy`.`id`
);
