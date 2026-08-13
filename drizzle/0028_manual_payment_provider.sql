INSERT OR IGNORE INTO `payment_providers` (
  `id`,
  `is_enabled`,
  `created_at`,
  `updated_at`
) VALUES (
  'pp_manual_manual',
  1,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);
