-- Restore simple active variant base prices before rolling application code
-- back to a build that reads product_variant_prices.
-- Price-list prices, quantity tiers and rule-based prices stay in Pricing.
INSERT INTO `product_variant_prices` (
  `id`, `variant_id`, `currency_code`, `amount`, `created_at`, `updated_at`
)
SELECT
  'restore_' || `price`.`id`,
  `link`.`variant_id`,
  `price`.`currency_code`,
  `price`.`amount`,
  `price`.`created_at`,
  `price`.`updated_at`
FROM `prices` AS `price`
INNER JOIN `product_variant_price_sets` AS `link`
  ON `link`.`price_set_id` = `price`.`price_set_id`
INNER JOIN `price_sets` AS `price_set`
  ON `price_set`.`id` = `link`.`price_set_id`
 AND `price_set`.`deleted_at` IS NULL
WHERE `price`.`price_list_id` IS NULL
  AND `price`.`min_quantity` IS NULL
  AND `price`.`max_quantity` IS NULL
  AND `price`.`rules_count` = 0
  AND `price`.`deleted_at` IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM `price_rules` AS `rule`
    WHERE `rule`.`price_id` = `price`.`id`
      AND `rule`.`deleted_at` IS NULL
  )
ON CONFLICT (`variant_id`, `currency_code`) DO UPDATE SET
  `amount` = excluded.`amount`,
  `updated_at` = excluded.`updated_at`;
