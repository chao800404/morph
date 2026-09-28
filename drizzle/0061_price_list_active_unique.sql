-- A price list has one amount per variant price set and currency. Base prices
-- continue to live in product_variant_prices and are outside this partial key.
CREATE UNIQUE INDEX `prices_list_currency_active_unique`
ON `prices` (`price_set_id`, `price_list_id`, `currency_code`)
WHERE `price_list_id` IS NOT NULL AND `deleted_at` IS NULL;
