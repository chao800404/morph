-- Preserve the current shipping behavior by assigning each saved option's
-- fulfillment provider to the stock location that owns its fulfillment set.
INSERT INTO `location_fulfillment_providers` (
  `stock_location_id`,
  `fulfillment_provider_id`,
  `created_at`,
  `updated_at`
)
SELECT DISTINCT
  `location_sets`.`stock_location_id`,
  `options`.`provider_id`,
  `options`.`created_at`,
  `options`.`updated_at`
FROM `shipping_options` AS `options`
INNER JOIN `service_zones` AS `zones`
  ON `zones`.`id` = `options`.`service_zone_id`
 AND `zones`.`deleted_at` IS NULL
INNER JOIN `fulfillment_sets` AS `sets`
  ON `sets`.`id` = `zones`.`fulfillment_set_id`
 AND `sets`.`type` = 'shipping'
 AND `sets`.`deleted_at` IS NULL
INNER JOIN `location_fulfillment_sets` AS `location_sets`
  ON `location_sets`.`fulfillment_set_id` = `sets`.`id`
INNER JOIN `stock_locations` AS `locations`
  ON `locations`.`id` = `location_sets`.`stock_location_id`
 AND `locations`.`deleted_at` IS NULL
WHERE `options`.`provider_id` IS NOT NULL
  AND `options`.`deleted_at` IS NULL
ON CONFLICT (`stock_location_id`, `fulfillment_provider_id`) DO NOTHING;
