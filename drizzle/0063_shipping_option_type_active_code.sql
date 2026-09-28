-- Option type codes are stable identifiers used by shipping options. Retired
-- types may keep their historical row while a replacement reuses the code.
CREATE UNIQUE INDEX `shipping_option_types_active_code_unique`
ON `shipping_option_types` (`code`)
WHERE `deleted_at` IS NULL;

-- Keep the two built-in shopper categories available on a new store. Existing
-- active merchant records with these codes are preserved.
INSERT INTO `shipping_option_types` (
  `id`, `label`, `description`, `code`, `created_at`, `updated_at`, `deleted_at`
)
SELECT
  '00000000-0000-4000-8000-000000000101',
  'Standard',
  NULL,
  'standard',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  NULL
WHERE NOT EXISTS (
  SELECT 1 FROM `shipping_option_types`
  WHERE `code` = 'standard' AND `deleted_at` IS NULL
)
AND NOT EXISTS (
  SELECT 1 FROM `shipping_option_types`
  WHERE `id` = '00000000-0000-4000-8000-000000000101'
);

INSERT INTO `shipping_option_types` (
  `id`, `label`, `description`, `code`, `created_at`, `updated_at`, `deleted_at`
)
SELECT
  '00000000-0000-4000-8000-000000000102',
  'Express',
  NULL,
  'express',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  NULL
WHERE NOT EXISTS (
  SELECT 1 FROM `shipping_option_types`
  WHERE `code` = 'express' AND `deleted_at` IS NULL
)
AND NOT EXISTS (
  SELECT 1 FROM `shipping_option_types`
  WHERE `id` = '00000000-0000-4000-8000-000000000102'
);
