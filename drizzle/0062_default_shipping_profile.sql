-- Products need a shipping profile before checkout can expose matching
-- shipping options. The stable default keeps existing and newly created
-- products usable while still allowing operators to move products into custom
-- profiles from the dashboard.
INSERT INTO `shipping_profiles` (
  `id`, `name`, `type`, `metadata`, `created_at`, `updated_at`, `deleted_at`
)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'Default',
  'default',
  '{}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  NULL
)
ON CONFLICT (`id`) DO NOTHING;

INSERT INTO `product_shipping_profiles` (
  `product_id`, `shipping_profile_id`, `created_at`, `updated_at`
)
SELECT
  `products`.`id`,
  '00000000-0000-4000-8000-000000000001',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM `products`
WHERE `products`.`deleted_at` IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM `product_shipping_profiles`
    WHERE `product_shipping_profiles`.`product_id` = `products`.`id`
  )
ON CONFLICT (`product_id`, `shipping_profile_id`) DO NOTHING;
