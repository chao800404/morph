-- Allow one price-list price per quantity range, including unbounded ends.
-- The expression index normalizes NULL bounds so SQLite still enforces
-- uniqueness for regular prices and for open-ended quantity tiers.
DROP INDEX IF EXISTS `prices_list_currency_active_unique`;

CREATE UNIQUE INDEX `prices_list_currency_quantity_active_unique`
ON `prices` (
  `price_set_id`,
  `price_list_id`,
  `currency_code`,
  ifnull(`min_quantity`, -1),
  ifnull(`max_quantity`, -1)
)
WHERE `price_list_id` IS NOT NULL AND `deleted_at` IS NULL;
