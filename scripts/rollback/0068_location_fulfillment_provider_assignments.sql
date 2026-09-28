-- Roll back the location assignments introduced from existing shipping
-- options. Rows whose timestamps changed after the backfill are retained.
DELETE FROM `location_fulfillment_providers`
WHERE EXISTS (
  SELECT 1
  FROM `shipping_options` AS `options`
  INNER JOIN `service_zones` AS `zones`
    ON `zones`.`id` = `options`.`service_zone_id`
  INNER JOIN `fulfillment_sets` AS `sets`
    ON `sets`.`id` = `zones`.`fulfillment_set_id`
  INNER JOIN `location_fulfillment_sets` AS `location_sets`
    ON `location_sets`.`fulfillment_set_id` = `sets`.`id`
  INNER JOIN `stock_locations` AS `locations`
    ON `locations`.`id` = `location_sets`.`stock_location_id`
  WHERE `location_sets`.`stock_location_id` = `location_fulfillment_providers`.`stock_location_id`
    AND `options`.`provider_id` = `location_fulfillment_providers`.`fulfillment_provider_id`
    AND `options`.`created_at` = `location_fulfillment_providers`.`created_at`
    AND `options`.`updated_at` = `location_fulfillment_providers`.`updated_at`
);
