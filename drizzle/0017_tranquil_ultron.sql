CREATE TABLE `invites` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`token` text NOT NULL,
	`accepted` integer DEFAULT false NOT NULL,
	`expires_at` text NOT NULL,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invites_active_email_unique` ON `invites` (`email`) WHERE "invites"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `invites_token_active_idx` ON `invites` (`token`) WHERE "invites"."deleted_at" IS NULL;--> statement-breakpoint
CREATE TABLE `notification_providers` (
	`id` text PRIMARY KEY NOT NULL,
	`handle` text NOT NULL,
	`name` text NOT NULL,
	`is_enabled` integer DEFAULT true NOT NULL,
	`channels` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text,
	`to` text NOT NULL,
	`from` text,
	`channel` text NOT NULL,
	`template` text,
	`data` text,
	`provider_data` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`trigger_type` text,
	`resource_type` text,
	`resource_id` text,
	`receiver_id` text,
	`original_notification_id` text,
	`idempotency_key` text,
	`external_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`provider_id`) REFERENCES `notification_providers`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "notifications_status_check" CHECK("notifications"."status" IN ('pending', 'success', 'failure'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_idempotency_key_unique` ON `notifications` (`idempotency_key`) WHERE "notifications"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `notifications_receiver_idx` ON `notifications` (`receiver_id`);--> statement-breakpoint
CREATE INDEX `notifications_resource_idx` ON `notifications` (`resource_type`,`resource_id`);--> statement-breakpoint
CREATE INDEX `notifications_status_idx` ON `notifications` (`status`);--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`salt` text NOT NULL,
	`redacted` text NOT NULL,
	`title` text NOT NULL,
	`type` text NOT NULL,
	`last_used_at` text,
	`created_by` text NOT NULL,
	`revoked_by` text,
	`revoked_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	CONSTRAINT "api_keys_type_check" CHECK("api_keys"."type" IN ('publishable', 'secret'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_token_unique` ON `api_keys` (`token`);--> statement-breakpoint
CREATE INDEX `api_keys_type_live_idx` ON `api_keys` (`type`) WHERE "api_keys"."revoked_at" IS NULL AND "api_keys"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `api_keys_redacted_idx` ON `api_keys` (`redacted`);--> statement-breakpoint
CREATE TABLE `store_locales` (
	`store_id` text NOT NULL,
	`locale_code` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`store_id`, `locale_code`),
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `store_locales_one_default` ON `store_locales` (`store_id`) WHERE "store_locales"."is_default" = 1;--> statement-breakpoint
CREATE TABLE `region_countries` (
	`iso_2` text PRIMARY KEY NOT NULL,
	`iso_3` text NOT NULL,
	`num_code` text NOT NULL,
	`name` text NOT NULL,
	`display_name` text NOT NULL,
	`region_id` text,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`region_id`) REFERENCES `regions`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "region_countries_iso_2_check" CHECK(length("region_countries"."iso_2") = 2 AND "region_countries"."iso_2" = lower("region_countries"."iso_2"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `region_countries_region_iso2_unique` ON `region_countries` (`region_id`,`iso_2`);--> statement-breakpoint
CREATE TABLE `regions` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`currency_code` text NOT NULL,
	`automatic_taxes` integer DEFAULT true NOT NULL,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	CONSTRAINT "regions_currency_code_check" CHECK(length("regions"."currency_code") = 3 AND "regions"."currency_code" = lower("regions"."currency_code"))
);
--> statement-breakpoint
CREATE INDEX `regions_currency_active_idx` ON `regions` (`currency_code`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `sales_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`is_disabled` integer DEFAULT false NOT NULL,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sales_channels_active_name_unique` ON `sales_channels` (`name`) WHERE "sales_channels"."deleted_at" IS NULL;--> statement-breakpoint
CREATE TABLE `stock_location_addresses` (
	`id` text PRIMARY KEY NOT NULL,
	`address_1` text NOT NULL,
	`address_2` text,
	`company` text,
	`city` text,
	`country_code` text NOT NULL,
	`phone` text,
	`province` text,
	`postal_code` text,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `stock_locations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`address_id` text,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`address_id`) REFERENCES `stock_location_addresses`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stock_locations_active_name_unique` ON `stock_locations` (`name`) WHERE "stock_locations"."deleted_at" IS NULL;--> statement-breakpoint
CREATE TABLE `inventory_items` (
	`id` text PRIMARY KEY NOT NULL,
	`sku` text,
	`title` text,
	`description` text,
	`thumbnail` text,
	`requires_shipping` integer DEFAULT true NOT NULL,
	`weight` real,
	`length` real,
	`height` real,
	`width` real,
	`origin_country` text,
	`hs_code` text,
	`mid_code` text,
	`material` text,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_items_active_sku_unique` ON `inventory_items` (`sku`) WHERE "inventory_items"."deleted_at" IS NULL AND "inventory_items"."sku" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `inventory_levels` (
	`id` text PRIMARY KEY NOT NULL,
	`inventory_item_id` text NOT NULL,
	`location_id` text NOT NULL,
	`stocked_quantity` integer DEFAULT 0 NOT NULL,
	`reserved_quantity` integer DEFAULT 0 NOT NULL,
	`incoming_quantity` integer DEFAULT 0 NOT NULL,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`inventory_item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "inventory_levels_stocked_check" CHECK("inventory_levels"."stocked_quantity" >= 0),
	CONSTRAINT "inventory_levels_reserved_check" CHECK("inventory_levels"."reserved_quantity" >= 0),
	CONSTRAINT "inventory_levels_incoming_check" CHECK("inventory_levels"."incoming_quantity" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_levels_item_location_unique` ON `inventory_levels` (`inventory_item_id`,`location_id`) WHERE "inventory_levels"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `inventory_levels_location_active_idx` ON `inventory_levels` (`location_id`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `reservation_items` (
	`id` text PRIMARY KEY NOT NULL,
	`inventory_item_id` text NOT NULL,
	`location_id` text NOT NULL,
	`line_item_id` text,
	`quantity` integer NOT NULL,
	`allow_backorder` integer DEFAULT false NOT NULL,
	`description` text,
	`external_id` text,
	`created_by` text,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`inventory_item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "reservation_items_quantity_check" CHECK("reservation_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE INDEX `reservation_items_item_active_idx` ON `reservation_items` (`inventory_item_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `reservation_items_location_active_idx` ON `reservation_items` (`location_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `reservation_items_line_item_active_idx` ON `reservation_items` (`line_item_id`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `price_list_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`price_list_id` text NOT NULL,
	`attribute` text NOT NULL,
	`value` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`price_list_id`) REFERENCES `price_lists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `price_list_rules_list_active_idx` ON `price_list_rules` (`price_list_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `price_list_rules_attribute_active_idx` ON `price_list_rules` (`attribute`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `price_lists` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`type` text DEFAULT 'sale' NOT NULL,
	`starts_at` text,
	`ends_at` text,
	`rules_count` integer DEFAULT 0 NOT NULL,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	CONSTRAINT "price_lists_status_check" CHECK("price_lists"."status" IN ('draft', 'active')),
	CONSTRAINT "price_lists_type_check" CHECK("price_lists"."type" IN ('sale', 'override'))
);
--> statement-breakpoint
CREATE INDEX `price_lists_active_window_idx` ON `price_lists` (`status`,`starts_at`,`ends_at`) WHERE "price_lists"."deleted_at" IS NULL;--> statement-breakpoint
CREATE TABLE `price_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`attribute` text NOT NULL,
	`value` text,
	`is_tax_inclusive` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `price_preferences_attribute_value_unique` ON `price_preferences` (`attribute`,`value`) WHERE "price_preferences"."deleted_at" IS NULL;--> statement-breakpoint
CREATE TABLE `price_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`price_id` text NOT NULL,
	`attribute` text NOT NULL,
	`value` text NOT NULL,
	`operator` text DEFAULT 'eq' NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`price_id`) REFERENCES `prices`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "price_rules_operator_check" CHECK("price_rules"."operator" IN ('eq', 'gt', 'gte', 'lt', 'lte'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `price_rules_price_attribute_operator_unique` ON `price_rules` (`price_id`,`attribute`,`operator`) WHERE "price_rules"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `price_rules_attribute_value_active_idx` ON `price_rules` (`attribute`,`value`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `price_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `prices` (
	`id` text PRIMARY KEY NOT NULL,
	`price_set_id` text NOT NULL,
	`price_list_id` text,
	`title` text,
	`currency_code` text NOT NULL,
	`amount` integer NOT NULL,
	`min_quantity` integer,
	`max_quantity` integer,
	`rules_count` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`price_set_id`) REFERENCES `price_sets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`price_list_id`) REFERENCES `price_lists`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "prices_amount_check" CHECK("prices"."amount" >= 0),
	CONSTRAINT "prices_currency_code_check" CHECK(length("prices"."currency_code") = 3 AND "prices"."currency_code" = lower("prices"."currency_code")),
	CONSTRAINT "prices_quantity_range_check" CHECK("prices"."min_quantity" IS NULL OR "prices"."max_quantity" IS NULL OR "prices"."max_quantity" >= "prices"."min_quantity")
);
--> statement-breakpoint
CREATE INDEX `prices_set_active_idx` ON `prices` (`price_set_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `prices_list_active_idx` ON `prices` (`price_list_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `prices_currency_active_idx` ON `prices` (`currency_code`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `customer_addresses` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`address_name` text,
	`is_default_shipping` integer DEFAULT false NOT NULL,
	`is_default_billing` integer DEFAULT false NOT NULL,
	`company` text,
	`first_name` text,
	`last_name` text,
	`address_1` text,
	`address_2` text,
	`city` text,
	`country_code` text,
	`province` text,
	`postal_code` text,
	`phone` text,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `customer_addresses_customer_active_idx` ON `customer_addresses` (`customer_id`,`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `customer_addresses_one_default_shipping` ON `customer_addresses` (`customer_id`) WHERE "customer_addresses"."is_default_shipping" = 1 AND "customer_addresses"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `customer_addresses_one_default_billing` ON `customer_addresses` (`customer_id`) WHERE "customer_addresses"."is_default_billing" = 1 AND "customer_addresses"."deleted_at" IS NULL;--> statement-breakpoint
CREATE TABLE `customer_group_customers` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`customer_group_id` text NOT NULL,
	`created_by` text,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_group_id`) REFERENCES `customer_groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_group_customers_unique` ON `customer_group_customers` (`customer_group_id`,`customer_id`) WHERE "customer_group_customers"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `customer_group_customers_customer_idx` ON `customer_group_customers` (`customer_id`);--> statement-breakpoint
CREATE TABLE `customer_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`metadata` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_groups_active_name_unique` ON `customer_groups` (`name`) WHERE "customer_groups"."deleted_at" IS NULL;--> statement-breakpoint
CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`company_name` text,
	`first_name` text,
	`last_name` text,
	`email` text,
	`phone` text,
	`has_account` integer DEFAULT false NOT NULL,
	`metadata` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customers_active_email_account_unique` ON `customers` (`email`,`has_account`) WHERE "customers"."deleted_at" IS NULL AND "customers"."email" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `customers_active_idx` ON `customers` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `promotion_application_method_buy_rules` (
	`application_method_id` text NOT NULL,
	`promotion_rule_id` text NOT NULL,
	PRIMARY KEY(`application_method_id`, `promotion_rule_id`),
	FOREIGN KEY (`application_method_id`) REFERENCES `promotion_application_methods`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`promotion_rule_id`) REFERENCES `promotion_rules`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `promotion_application_method_buy_rules_rule_idx` ON `promotion_application_method_buy_rules` (`promotion_rule_id`);--> statement-breakpoint
CREATE TABLE `promotion_application_method_target_rules` (
	`application_method_id` text NOT NULL,
	`promotion_rule_id` text NOT NULL,
	PRIMARY KEY(`application_method_id`, `promotion_rule_id`),
	FOREIGN KEY (`application_method_id`) REFERENCES `promotion_application_methods`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`promotion_rule_id`) REFERENCES `promotion_rules`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `promotion_application_method_target_rules_rule_idx` ON `promotion_application_method_target_rules` (`promotion_rule_id`);--> statement-breakpoint
CREATE TABLE `promotion_application_methods` (
	`id` text PRIMARY KEY NOT NULL,
	`promotion_id` text NOT NULL,
	`type` text NOT NULL,
	`target_type` text NOT NULL,
	`allocation` text,
	`value` real,
	`currency_code` text,
	`max_quantity` integer,
	`apply_to_quantity` integer,
	`buy_rules_min_quantity` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`promotion_id`) REFERENCES `promotions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "promotion_application_methods_type_check" CHECK("promotion_application_methods"."type" IN ('fixed', 'percentage')),
	CONSTRAINT "promotion_application_methods_target_type_check" CHECK("promotion_application_methods"."target_type" IN ('order', 'shipping_methods', 'items')),
	CONSTRAINT "promotion_application_methods_allocation_check" CHECK("promotion_application_methods"."allocation" IS NULL OR "promotion_application_methods"."allocation" IN ('each', 'across', 'once'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `promotion_application_methods_promotion_unique` ON `promotion_application_methods` (`promotion_id`) WHERE "promotion_application_methods"."deleted_at" IS NULL;--> statement-breakpoint
CREATE TABLE `promotion_campaign_budget_usages` (
	`id` text PRIMARY KEY NOT NULL,
	`budget_id` text NOT NULL,
	`attribute_value` text NOT NULL,
	`used` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`budget_id`) REFERENCES `promotion_campaign_budgets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `promotion_campaign_budget_usages_unique` ON `promotion_campaign_budget_usages` (`attribute_value`,`budget_id`) WHERE "promotion_campaign_budget_usages"."deleted_at" IS NULL;--> statement-breakpoint
CREATE TABLE `promotion_campaign_budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`type` text NOT NULL,
	`currency_code` text,
	`limit` integer,
	`used` integer DEFAULT 0 NOT NULL,
	`attribute` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`campaign_id`) REFERENCES `promotion_campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "promotion_campaign_budgets_type_check" CHECK("promotion_campaign_budgets"."type" IN ('spend', 'usage', 'use_by_attribute', 'spend_by_attribute'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `promotion_campaign_budgets_campaign_unique` ON `promotion_campaign_budgets` (`campaign_id`) WHERE "promotion_campaign_budgets"."deleted_at" IS NULL;--> statement-breakpoint
CREATE TABLE `promotion_campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`campaign_identifier` text NOT NULL,
	`starts_at` text,
	`ends_at` text,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `promotion_campaigns_active_identifier_unique` ON `promotion_campaigns` (`campaign_identifier`) WHERE "promotion_campaigns"."deleted_at" IS NULL;--> statement-breakpoint
CREATE TABLE `promotion_promotion_rules` (
	`promotion_id` text NOT NULL,
	`promotion_rule_id` text NOT NULL,
	PRIMARY KEY(`promotion_id`, `promotion_rule_id`),
	FOREIGN KEY (`promotion_id`) REFERENCES `promotions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`promotion_rule_id`) REFERENCES `promotion_rules`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `promotion_promotion_rules_rule_idx` ON `promotion_promotion_rules` (`promotion_rule_id`);--> statement-breakpoint
CREATE TABLE `promotion_rule_values` (
	`id` text PRIMARY KEY NOT NULL,
	`promotion_rule_id` text NOT NULL,
	`value` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`promotion_rule_id`) REFERENCES `promotion_rules`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `promotion_rule_values_rule_value_active_idx` ON `promotion_rule_values` (`promotion_rule_id`,`value`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `promotion_rule_values_value_active_idx` ON `promotion_rule_values` (`value`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `promotion_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`description` text,
	`attribute` text NOT NULL,
	`operator` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	CONSTRAINT "promotion_rules_operator_check" CHECK("promotion_rules"."operator" IN ('gte', 'lte', 'gt', 'lt', 'eq', 'ne', 'in'))
);
--> statement-breakpoint
CREATE INDEX `promotion_rules_attribute_operator_active_idx` ON `promotion_rules` (`attribute`,`operator`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `promotions` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`type` text DEFAULT 'standard' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`is_automatic` integer DEFAULT false NOT NULL,
	`is_tax_inclusive` integer DEFAULT false NOT NULL,
	`limit` integer,
	`used` integer DEFAULT 0 NOT NULL,
	`campaign_id` text,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`campaign_id`) REFERENCES `promotion_campaigns`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "promotions_type_check" CHECK("promotions"."type" IN ('standard', 'buyget')),
	CONSTRAINT "promotions_status_check" CHECK("promotions"."status" IN ('draft', 'active', 'inactive')),
	CONSTRAINT "promotions_used_check" CHECK("promotions"."used" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `promotions_active_code_unique` ON `promotions` (`code`) WHERE "promotions"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `promotions_automatic_active_idx` ON `promotions` (`is_automatic`,`status`) WHERE "promotions"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `promotions_campaign_active_idx` ON `promotions` (`campaign_id`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `tax_providers` (
	`id` text PRIMARY KEY NOT NULL,
	`is_enabled` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `tax_rate_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`tax_rate_id` text NOT NULL,
	`reference` text NOT NULL,
	`reference_id` text NOT NULL,
	`metadata` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`tax_rate_id`) REFERENCES `tax_rates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tax_rate_rules_rate_reference_unique` ON `tax_rate_rules` (`tax_rate_id`,`reference_id`) WHERE "tax_rate_rules"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `tax_rate_rules_reference_active_idx` ON `tax_rate_rules` (`reference_id`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `tax_rates` (
	`id` text PRIMARY KEY NOT NULL,
	`tax_region_id` text NOT NULL,
	`rate` real,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`is_combinable` integer DEFAULT false NOT NULL,
	`metadata` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`tax_region_id`) REFERENCES `tax_regions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tax_rates_region_active_idx` ON `tax_rates` (`tax_region_id`,`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `tax_rates_one_default_per_region` ON `tax_rates` (`tax_region_id`) WHERE "tax_rates"."is_default" = 1 AND "tax_rates"."deleted_at" IS NULL;--> statement-breakpoint
CREATE TABLE `tax_regions` (
	`id` text PRIMARY KEY NOT NULL,
	`country_code` text NOT NULL,
	`province_code` text,
	`parent_id` text,
	`provider_id` text,
	`metadata` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`parent_id`) REFERENCES `tax_regions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_id`) REFERENCES `tax_providers`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "tax_regions_provider_top_level_check" CHECK("tax_regions"."parent_id" IS NULL OR "tax_regions"."provider_id" IS NULL),
	CONSTRAINT "tax_regions_country_top_level_check" CHECK("tax_regions"."parent_id" IS NULL OR "tax_regions"."province_code" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tax_regions_country_province_unique` ON `tax_regions` (`country_code`,`province_code`) WHERE "tax_regions"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `tax_regions_country_toplevel_unique` ON `tax_regions` (`country_code`) WHERE "tax_regions"."province_code" IS NULL AND "tax_regions"."deleted_at" IS NULL;--> statement-breakpoint
CREATE TABLE `fulfillment_addresses` (
	`id` text PRIMARY KEY NOT NULL,
	`company` text,
	`first_name` text,
	`last_name` text,
	`address_1` text,
	`address_2` text,
	`city` text,
	`country_code` text,
	`province` text,
	`postal_code` text,
	`phone` text,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `fulfillment_items` (
	`id` text PRIMARY KEY NOT NULL,
	`fulfillment_id` text NOT NULL,
	`title` text NOT NULL,
	`sku` text NOT NULL,
	`barcode` text NOT NULL,
	`quantity` integer NOT NULL,
	`line_item_id` text,
	`inventory_item_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`fulfillment_id`) REFERENCES `fulfillments`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "fulfillment_items_quantity_check" CHECK("fulfillment_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE INDEX `fulfillment_items_fulfillment_active_idx` ON `fulfillment_items` (`fulfillment_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `fulfillment_items_line_item_active_idx` ON `fulfillment_items` (`line_item_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `fulfillment_items_inventory_item_active_idx` ON `fulfillment_items` (`inventory_item_id`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `fulfillment_labels` (
	`id` text PRIMARY KEY NOT NULL,
	`fulfillment_id` text NOT NULL,
	`tracking_number` text NOT NULL,
	`tracking_url` text NOT NULL,
	`label_url` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`fulfillment_id`) REFERENCES `fulfillments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `fulfillment_labels_fulfillment_active_idx` ON `fulfillment_labels` (`fulfillment_id`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `fulfillment_providers` (
	`id` text PRIMARY KEY NOT NULL,
	`is_enabled` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `fulfillment_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fulfillment_sets_active_name_unique` ON `fulfillment_sets` (`name`) WHERE "fulfillment_sets"."deleted_at" IS NULL;--> statement-breakpoint
CREATE TABLE `fulfillments` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`provider_id` text,
	`shipping_option_id` text,
	`delivery_address_id` text,
	`packed_at` text,
	`shipped_at` text,
	`delivered_at` text,
	`canceled_at` text,
	`marked_shipped_by` text,
	`created_by` text,
	`requires_shipping` integer DEFAULT true NOT NULL,
	`data` text,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`provider_id`) REFERENCES `fulfillment_providers`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`shipping_option_id`) REFERENCES `shipping_options`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`delivery_address_id`) REFERENCES `fulfillment_addresses`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `fulfillments_location_active_idx` ON `fulfillments` (`location_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `fulfillments_option_active_idx` ON `fulfillments` (`shipping_option_id`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `geo_zones` (
	`id` text PRIMARY KEY NOT NULL,
	`service_zone_id` text NOT NULL,
	`type` text DEFAULT 'country' NOT NULL,
	`country_code` text NOT NULL,
	`province_code` text,
	`city` text,
	`postal_expression` text,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`service_zone_id`) REFERENCES `service_zones`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "geo_zones_type_check" CHECK("geo_zones"."type" IN ('country', 'province', 'city', 'zip'))
);
--> statement-breakpoint
CREATE INDEX `geo_zones_zone_active_idx` ON `geo_zones` (`service_zone_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `geo_zones_country_active_idx` ON `geo_zones` (`country_code`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `geo_zones_province_active_idx` ON `geo_zones` (`province_code`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `service_zones` (
	`id` text PRIMARY KEY NOT NULL,
	`fulfillment_set_id` text NOT NULL,
	`name` text NOT NULL,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`fulfillment_set_id`) REFERENCES `fulfillment_sets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `service_zones_active_name_unique` ON `service_zones` (`name`) WHERE "service_zones"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `service_zones_set_active_idx` ON `service_zones` (`fulfillment_set_id`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `shipping_option_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`shipping_option_id` text NOT NULL,
	`attribute` text NOT NULL,
	`operator` text NOT NULL,
	`value` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`shipping_option_id`) REFERENCES `shipping_options`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "shipping_option_rules_operator_check" CHECK("shipping_option_rules"."operator" IN ('in', 'eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'nin'))
);
--> statement-breakpoint
CREATE INDEX `shipping_option_rules_option_active_idx` ON `shipping_option_rules` (`shipping_option_id`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `shipping_option_types` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`description` text,
	`code` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `shipping_options` (
	`id` text PRIMARY KEY NOT NULL,
	`service_zone_id` text NOT NULL,
	`shipping_profile_id` text,
	`provider_id` text,
	`shipping_option_type_id` text,
	`name` text NOT NULL,
	`price_type` text DEFAULT 'flat' NOT NULL,
	`data` text,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`service_zone_id`) REFERENCES `service_zones`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`shipping_profile_id`) REFERENCES `shipping_profiles`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`provider_id`) REFERENCES `fulfillment_providers`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`shipping_option_type_id`) REFERENCES `shipping_option_types`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "shipping_options_price_type_check" CHECK("shipping_options"."price_type" IN ('flat', 'calculated'))
);
--> statement-breakpoint
CREATE INDEX `shipping_options_zone_active_idx` ON `shipping_options` (`service_zone_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `shipping_options_profile_active_idx` ON `shipping_options` (`shipping_profile_id`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `shipping_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shipping_profiles_active_name_unique` ON `shipping_profiles` (`name`) WHERE "shipping_profiles"."deleted_at" IS NULL;--> statement-breakpoint
CREATE TABLE `cart_addresses` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text,
	`company` text,
	`first_name` text,
	`last_name` text,
	`address_1` text,
	`address_2` text,
	`city` text,
	`country_code` text,
	`province` text,
	`postal_code` text,
	`phone` text,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `cart_credit_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`cart_id` text NOT NULL,
	`reference` text,
	`reference_id` text,
	`amount` integer NOT NULL,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`cart_id`) REFERENCES `carts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cart_credit_lines_cart_active_idx` ON `cart_credit_lines` (`cart_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `cart_credit_lines_reference_active_idx` ON `cart_credit_lines` (`reference`,`reference_id`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `cart_line_item_adjustments` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`description` text,
	`code` text,
	`amount` integer NOT NULL,
	`is_tax_inclusive` integer DEFAULT false NOT NULL,
	`provider_id` text,
	`promotion_id` text,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`item_id`) REFERENCES `cart_line_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "cart_line_item_adjustments_amount_check" CHECK("cart_line_item_adjustments"."amount" >= 0)
);
--> statement-breakpoint
CREATE INDEX `cart_line_item_adjustments_item_active_idx` ON `cart_line_item_adjustments` (`item_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `cart_line_item_adjustments_promotion_active_idx` ON `cart_line_item_adjustments` (`promotion_id`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `cart_line_item_tax_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`description` text,
	`code` text NOT NULL,
	`rate` real NOT NULL,
	`provider_id` text,
	`tax_rate_id` text,
	`data` text,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`item_id`) REFERENCES `cart_line_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cart_line_item_tax_lines_item_active_idx` ON `cart_line_item_tax_lines` (`item_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `cart_line_item_tax_lines_rate_active_idx` ON `cart_line_item_tax_lines` (`tax_rate_id`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `cart_line_items` (
	`id` text PRIMARY KEY NOT NULL,
	`cart_id` text NOT NULL,
	`title` text NOT NULL,
	`subtitle` text,
	`thumbnail` text,
	`quantity` integer NOT NULL,
	`variant_id` text,
	`product_id` text,
	`product_title` text,
	`product_description` text,
	`product_subtitle` text,
	`product_type` text,
	`product_type_id` text,
	`product_collection` text,
	`product_handle` text,
	`variant_sku` text,
	`variant_barcode` text,
	`variant_title` text,
	`variant_option_values` text,
	`requires_shipping` integer DEFAULT true NOT NULL,
	`is_discountable` integer DEFAULT true NOT NULL,
	`is_giftcard` integer DEFAULT false NOT NULL,
	`is_tax_inclusive` integer DEFAULT false NOT NULL,
	`is_custom_price` integer DEFAULT false NOT NULL,
	`unit_price` integer NOT NULL,
	`compare_at_unit_price` integer,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`cart_id`) REFERENCES `carts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "cart_line_items_quantity_check" CHECK("cart_line_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE INDEX `cart_line_items_cart_active_idx` ON `cart_line_items` (`cart_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `cart_line_items_variant_active_idx` ON `cart_line_items` (`variant_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `cart_line_items_product_active_idx` ON `cart_line_items` (`product_id`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `cart_shipping_method_adjustments` (
	`id` text PRIMARY KEY NOT NULL,
	`shipping_method_id` text NOT NULL,
	`description` text,
	`code` text,
	`amount` integer NOT NULL,
	`provider_id` text,
	`promotion_id` text,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`shipping_method_id`) REFERENCES `cart_shipping_methods`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "cart_shipping_method_adjustments_amount_check" CHECK("cart_shipping_method_adjustments"."amount" >= 0)
);
--> statement-breakpoint
CREATE INDEX `cart_shipping_method_adjustments_method_active_idx` ON `cart_shipping_method_adjustments` (`shipping_method_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `cart_shipping_method_adjustments_promotion_active_idx` ON `cart_shipping_method_adjustments` (`promotion_id`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `cart_shipping_method_tax_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`shipping_method_id` text NOT NULL,
	`description` text,
	`code` text NOT NULL,
	`rate` real NOT NULL,
	`provider_id` text,
	`tax_rate_id` text,
	`data` text,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`shipping_method_id`) REFERENCES `cart_shipping_methods`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cart_shipping_method_tax_lines_method_active_idx` ON `cart_shipping_method_tax_lines` (`shipping_method_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `cart_shipping_method_tax_lines_rate_active_idx` ON `cart_shipping_method_tax_lines` (`tax_rate_id`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `cart_shipping_methods` (
	`id` text PRIMARY KEY NOT NULL,
	`cart_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`amount` integer NOT NULL,
	`is_tax_inclusive` integer DEFAULT false NOT NULL,
	`shipping_option_id` text,
	`data` text,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`cart_id`) REFERENCES `carts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "cart_shipping_methods_amount_check" CHECK("cart_shipping_methods"."amount" >= 0)
);
--> statement-breakpoint
CREATE INDEX `cart_shipping_methods_cart_active_idx` ON `cart_shipping_methods` (`cart_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `cart_shipping_methods_option_active_idx` ON `cart_shipping_methods` (`shipping_option_id`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `carts` (
	`id` text PRIMARY KEY NOT NULL,
	`region_id` text,
	`customer_id` text,
	`sales_channel_id` text,
	`email` text,
	`currency_code` text NOT NULL,
	`locale` text,
	`shipping_address_id` text,
	`billing_address_id` text,
	`completed_at` text,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`shipping_address_id`) REFERENCES `cart_addresses`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`billing_address_id`) REFERENCES `cart_addresses`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "carts_currency_code_check" CHECK(length("carts"."currency_code") = 3 AND "carts"."currency_code" = lower("carts"."currency_code"))
);
--> statement-breakpoint
CREATE INDEX `carts_customer_active_idx` ON `carts` (`customer_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `carts_region_active_idx` ON `carts` (`region_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `carts_sales_channel_active_idx` ON `carts` (`sales_channel_id`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `account_holders` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`external_id` text NOT NULL,
	`email` text,
	`data` text,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_holders_provider_external_unique` ON `account_holders` (`provider_id`,`external_id`) WHERE "account_holders"."deleted_at" IS NULL;--> statement-breakpoint
CREATE TABLE `captures` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_id` text NOT NULL,
	`amount` integer NOT NULL,
	`created_by` text,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "captures_amount_check" CHECK("captures"."amount" > 0)
);
--> statement-breakpoint
CREATE INDEX `captures_payment_active_idx` ON `captures` (`payment_id`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `payment_collection_payment_providers` (
	`payment_collection_id` text NOT NULL,
	`payment_provider_id` text NOT NULL,
	PRIMARY KEY(`payment_collection_id`, `payment_provider_id`),
	FOREIGN KEY (`payment_collection_id`) REFERENCES `payment_collections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`payment_provider_id`) REFERENCES `payment_providers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `payment_collection_payment_providers_provider_idx` ON `payment_collection_payment_providers` (`payment_provider_id`);--> statement-breakpoint
CREATE TABLE `payment_collections` (
	`id` text PRIMARY KEY NOT NULL,
	`currency_code` text NOT NULL,
	`amount` integer NOT NULL,
	`authorized_amount` integer,
	`captured_amount` integer,
	`refunded_amount` integer,
	`status` text DEFAULT 'not_paid' NOT NULL,
	`completed_at` text,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	CONSTRAINT "payment_collections_status_check" CHECK("payment_collections"."status" IN ('not_paid', 'awaiting', 'authorized', 'partially_authorized', 'partially_captured', 'captured', 'completed', 'failed', 'canceled'))
);
--> statement-breakpoint
CREATE INDEX `payment_collections_status_active_idx` ON `payment_collections` (`status`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `payment_providers` (
	`id` text PRIMARY KEY NOT NULL,
	`is_enabled` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `payment_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_collection_id` text NOT NULL,
	`currency_code` text NOT NULL,
	`amount` integer NOT NULL,
	`provider_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`authorized_at` text,
	`data` text,
	`context` text,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`payment_collection_id`) REFERENCES `payment_collections`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "payment_sessions_status_check" CHECK("payment_sessions"."status" IN ('pending', 'pending_authorization', 'requires_more', 'authorized', 'captured', 'error', 'canceled'))
);
--> statement-breakpoint
CREATE INDEX `payment_sessions_collection_active_idx` ON `payment_sessions` (`payment_collection_id`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_collection_id` text NOT NULL,
	`payment_session_id` text NOT NULL,
	`currency_code` text NOT NULL,
	`amount` integer NOT NULL,
	`provider_id` text NOT NULL,
	`captured_at` text,
	`canceled_at` text,
	`data` text,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`payment_collection_id`) REFERENCES `payment_collections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`payment_session_id`) REFERENCES `payment_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_session_unique` ON `payments` (`payment_session_id`) WHERE "payments"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `payments_collection_active_idx` ON `payments` (`payment_collection_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `payments_provider_active_idx` ON `payments` (`provider_id`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `refund_reasons` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`code` text NOT NULL,
	`description` text,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `refund_reasons_active_code_unique` ON `refund_reasons` (`code`) WHERE "refund_reasons"."deleted_at" IS NULL;--> statement-breakpoint
CREATE TABLE `refunds` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_id` text NOT NULL,
	`refund_reason_id` text,
	`amount` integer NOT NULL,
	`note` text,
	`created_by` text,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`refund_reason_id`) REFERENCES `refund_reasons`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "refunds_amount_check" CHECK("refunds"."amount" > 0)
);
--> statement-breakpoint
CREATE INDEX `refunds_payment_active_idx` ON `refunds` (`payment_id`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `order_addresses` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text,
	`company` text,
	`first_name` text,
	`last_name` text,
	`address_1` text,
	`address_2` text,
	`city` text,
	`country_code` text,
	`province` text,
	`postal_code` text,
	`phone` text,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `order_addresses_customer_idx` ON `order_addresses` (`customer_id`);--> statement-breakpoint
CREATE TABLE `order_change_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`order_change_id` text,
	`order_id` text NOT NULL,
	`return_id` text,
	`claim_id` text,
	`exchange_id` text,
	`ordering` integer NOT NULL,
	`version` integer,
	`reference` text,
	`reference_id` text,
	`action` text NOT NULL,
	`details` text DEFAULT '{}' NOT NULL,
	`amount` integer,
	`internal_note` text,
	`applied` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`order_change_id`) REFERENCES `order_changes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `order_change_actions_change_active_idx` ON `order_change_actions` (`order_change_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `order_change_actions_order_active_idx` ON `order_change_actions` (`order_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `order_change_actions_ordering_active_idx` ON `order_change_actions` (`ordering`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `order_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`version` integer NOT NULL,
	`change_type` text,
	`description` text,
	`status` text DEFAULT 'pending',
	`internal_note` text,
	`return_id` text,
	`claim_id` text,
	`exchange_id` text,
	`created_by` text,
	`requested_by` text,
	`requested_at` text,
	`confirmed_by` text,
	`confirmed_at` text,
	`declined_by` text,
	`declined_reason` text,
	`declined_at` text,
	`canceled_by` text,
	`canceled_at` text,
	`carry_over_promotions` integer,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "order_changes_status_check" CHECK("order_changes"."status" IS NULL OR "order_changes"."status" IN ('pending', 'requested', 'confirmed', 'declined', 'canceled'))
);
--> statement-breakpoint
CREATE INDEX `order_changes_order_version_active_idx` ON `order_changes` (`order_id`,`version`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `order_changes_status_active_idx` ON `order_changes` (`status`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `order_claim_item_images` (
	`id` text PRIMARY KEY NOT NULL,
	`claim_item_id` text NOT NULL,
	`url` text NOT NULL,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`claim_item_id`) REFERENCES `order_claim_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `order_claim_item_images_item_active_idx` ON `order_claim_item_images` (`claim_item_id`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `order_claim_items` (
	`id` text PRIMARY KEY NOT NULL,
	`claim_id` text NOT NULL,
	`item_id` text NOT NULL,
	`reason` text,
	`quantity` integer NOT NULL,
	`is_additional_item` integer DEFAULT false NOT NULL,
	`note` text,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`claim_id`) REFERENCES `order_claims`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `order_line_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "order_claim_items_quantity_check" CHECK("order_claim_items"."quantity" > 0),
	CONSTRAINT "order_claim_items_reason_check" CHECK("order_claim_items"."reason" IS NULL OR "order_claim_items"."reason" IN ('missing_item', 'wrong_item', 'production_failure', 'other'))
);
--> statement-breakpoint
CREATE INDEX `order_claim_items_claim_active_idx` ON `order_claim_items` (`claim_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `order_claim_items_item_active_idx` ON `order_claim_items` (`item_id`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `order_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`return_id` text,
	`display_id` integer NOT NULL,
	`order_version` integer NOT NULL,
	`type` text NOT NULL,
	`refund_amount` integer,
	`no_notification` integer,
	`created_by` text,
	`canceled_at` text,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`return_id`) REFERENCES `returns`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "order_claims_type_check" CHECK("order_claims"."type" IN ('refund', 'replace'))
);
--> statement-breakpoint
CREATE INDEX `order_claims_order_active_idx` ON `order_claims` (`order_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `order_claims_return_active_idx` ON `order_claims` (`return_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `order_claims_display_id_active_idx` ON `order_claims` (`display_id`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `order_credit_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`reference` text,
	`reference_id` text,
	`amount` integer NOT NULL,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `order_credit_lines_order_version_active_idx` ON `order_credit_lines` (`order_id`,`version`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `order_exchange_items` (
	`id` text PRIMARY KEY NOT NULL,
	`exchange_id` text NOT NULL,
	`item_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`note` text,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`exchange_id`) REFERENCES `order_exchanges`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `order_line_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "order_exchange_items_quantity_check" CHECK("order_exchange_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE INDEX `order_exchange_items_exchange_active_idx` ON `order_exchange_items` (`exchange_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `order_exchange_items_item_active_idx` ON `order_exchange_items` (`item_id`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `order_exchanges` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`return_id` text,
	`display_id` integer NOT NULL,
	`order_version` integer NOT NULL,
	`difference_due` integer,
	`allow_backorder` integer DEFAULT false NOT NULL,
	`no_notification` integer,
	`created_by` text,
	`canceled_at` text,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`return_id`) REFERENCES `returns`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `order_exchanges_order_active_idx` ON `order_exchanges` (`order_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `order_exchanges_return_active_idx` ON `order_exchanges` (`return_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `order_exchanges_display_id_active_idx` ON `order_exchanges` (`display_id`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`item_id` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`quantity` integer NOT NULL,
	`fulfilled_quantity` integer DEFAULT 0 NOT NULL,
	`delivered_quantity` integer DEFAULT 0 NOT NULL,
	`shipped_quantity` integer DEFAULT 0 NOT NULL,
	`return_requested_quantity` integer DEFAULT 0 NOT NULL,
	`return_received_quantity` integer DEFAULT 0 NOT NULL,
	`return_dismissed_quantity` integer DEFAULT 0 NOT NULL,
	`written_off_quantity` integer DEFAULT 0 NOT NULL,
	`unit_price` integer,
	`compare_at_unit_price` integer,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `order_line_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "order_items_quantity_check" CHECK("order_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `order_items_order_version_item_unique` ON `order_items` (`order_id`,`version`,`item_id`) WHERE "order_items"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `order_items_item_active_idx` ON `order_items` (`item_id`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `order_line_item_adjustments` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`description` text,
	`code` text,
	`amount` integer NOT NULL,
	`provider_id` text,
	`promotion_id` text,
	`is_tax_inclusive` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`item_id`) REFERENCES `order_line_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "order_line_item_adjustments_amount_check" CHECK("order_line_item_adjustments"."amount" >= 0)
);
--> statement-breakpoint
CREATE INDEX `order_line_item_adjustments_item_idx` ON `order_line_item_adjustments` (`item_id`);--> statement-breakpoint
CREATE TABLE `order_line_item_tax_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`description` text,
	`code` text NOT NULL,
	`rate` real NOT NULL,
	`provider_id` text,
	`tax_rate_id` text,
	`data` text,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`item_id`) REFERENCES `order_line_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `order_line_item_tax_lines_item_idx` ON `order_line_item_tax_lines` (`item_id`);--> statement-breakpoint
CREATE TABLE `order_line_items` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`subtitle` text,
	`thumbnail` text,
	`variant_id` text,
	`product_id` text,
	`product_title` text,
	`product_description` text,
	`product_subtitle` text,
	`product_type` text,
	`product_type_id` text,
	`product_collection` text,
	`product_handle` text,
	`variant_sku` text,
	`variant_barcode` text,
	`variant_title` text,
	`variant_option_values` text,
	`requires_shipping` integer DEFAULT true NOT NULL,
	`is_discountable` integer DEFAULT true NOT NULL,
	`is_giftcard` integer DEFAULT false NOT NULL,
	`is_tax_inclusive` integer DEFAULT false NOT NULL,
	`is_custom_price` integer DEFAULT false NOT NULL,
	`unit_price` integer,
	`compare_at_unit_price` integer,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `order_line_items_variant_active_idx` ON `order_line_items` (`variant_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `order_line_items_product_active_idx` ON `order_line_items` (`product_id`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `order_shipping_method_adjustments` (
	`id` text PRIMARY KEY NOT NULL,
	`shipping_method_id` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`description` text,
	`code` text,
	`amount` integer NOT NULL,
	`provider_id` text,
	`promotion_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`shipping_method_id`) REFERENCES `order_shipping_methods`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `order_shipping_method_adjustments_version_method_unique` ON `order_shipping_method_adjustments` (`version`,`shipping_method_id`) WHERE "order_shipping_method_adjustments"."deleted_at" IS NULL;--> statement-breakpoint
CREATE TABLE `order_shipping_method_tax_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`shipping_method_id` text NOT NULL,
	`description` text,
	`code` text NOT NULL,
	`rate` real NOT NULL,
	`provider_id` text,
	`tax_rate_id` text,
	`data` text,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`shipping_method_id`) REFERENCES `order_shipping_methods`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `order_shipping_method_tax_lines_method_idx` ON `order_shipping_method_tax_lines` (`shipping_method_id`);--> statement-breakpoint
CREATE TABLE `order_shipping_methods` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`amount` integer NOT NULL,
	`is_tax_inclusive` integer DEFAULT false NOT NULL,
	`is_custom_amount` integer DEFAULT false NOT NULL,
	`shipping_option_id` text,
	`data` text,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	CONSTRAINT "order_shipping_methods_amount_check" CHECK("order_shipping_methods"."amount" >= 0)
);
--> statement-breakpoint
CREATE INDEX `order_shipping_methods_option_idx` ON `order_shipping_methods` (`shipping_option_id`);--> statement-breakpoint
CREATE TABLE `order_shippings` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`shipping_method_id` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`return_id` text,
	`exchange_id` text,
	`claim_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`shipping_method_id`) REFERENCES `order_shipping_methods`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`return_id`) REFERENCES `returns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`exchange_id`) REFERENCES `order_exchanges`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`claim_id`) REFERENCES `order_claims`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `order_shippings_order_version_active_idx` ON `order_shippings` (`order_id`,`version`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `order_shippings_method_active_idx` ON `order_shippings` (`shipping_method_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `order_shippings_return_active_idx` ON `order_shippings` (`return_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `order_shippings_exchange_active_idx` ON `order_shippings` (`exchange_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `order_shippings_claim_active_idx` ON `order_shippings` (`claim_id`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `order_summaries` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`totals` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `order_summaries_order_version_unique` ON `order_summaries` (`order_id`,`version`) WHERE "order_summaries"."deleted_at" IS NULL;--> statement-breakpoint
CREATE TABLE `order_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`amount` integer NOT NULL,
	`currency_code` text NOT NULL,
	`reference` text,
	`reference_id` text,
	`return_id` text,
	`exchange_id` text,
	`claim_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`return_id`) REFERENCES `returns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`exchange_id`) REFERENCES `order_exchanges`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`claim_id`) REFERENCES `order_claims`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `order_transactions_order_version_active_idx` ON `order_transactions` (`order_id`,`version`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `order_transactions_reference_active_idx` ON `order_transactions` (`reference_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `order_transactions_return_active_idx` ON `order_transactions` (`return_id`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`display_id` integer NOT NULL,
	`custom_display_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`region_id` text,
	`customer_id` text,
	`sales_channel_id` text,
	`email` text,
	`currency_code` text NOT NULL,
	`locale` text,
	`is_draft_order` integer DEFAULT false NOT NULL,
	`no_notification` integer,
	`shipping_address_id` text,
	`billing_address_id` text,
	`canceled_at` text,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`shipping_address_id`) REFERENCES `order_addresses`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`billing_address_id`) REFERENCES `order_addresses`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "orders_status_check" CHECK("orders"."status" IN ('pending', 'completed', 'draft', 'archived', 'canceled', 'requires_action')),
	CONSTRAINT "orders_currency_code_check" CHECK(length("orders"."currency_code") = 3 AND "orders"."currency_code" = lower("orders"."currency_code"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_active_display_id_unique` ON `orders` (`display_id`) WHERE "orders"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `orders_active_custom_display_id_unique` ON `orders` (`custom_display_id`) WHERE "orders"."deleted_at" IS NULL AND "orders"."custom_display_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `orders_customer_active_idx` ON `orders` (`customer_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `orders_status_active_idx` ON `orders` (`status`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `orders_region_active_idx` ON `orders` (`region_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `orders_sales_channel_active_idx` ON `orders` (`sales_channel_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `orders_draft_active_idx` ON `orders` (`is_draft_order`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `return_items` (
	`id` text PRIMARY KEY NOT NULL,
	`return_id` text NOT NULL,
	`item_id` text NOT NULL,
	`reason_id` text,
	`quantity` integer NOT NULL,
	`received_quantity` integer DEFAULT 0 NOT NULL,
	`damaged_quantity` integer DEFAULT 0 NOT NULL,
	`note` text,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`return_id`) REFERENCES `returns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `order_line_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reason_id`) REFERENCES `return_reasons`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "return_items_quantity_check" CHECK("return_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE INDEX `return_items_return_active_idx` ON `return_items` (`return_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `return_items_item_active_idx` ON `return_items` (`item_id`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `return_reasons` (
	`id` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`label` text NOT NULL,
	`description` text,
	`parent_return_reason_id` text,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`parent_return_reason_id`) REFERENCES `return_reasons`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `return_reasons_active_value_unique` ON `return_reasons` (`value`) WHERE "return_reasons"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `return_reasons_parent_active_idx` ON `return_reasons` (`parent_return_reason_id`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `returns` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`display_id` integer NOT NULL,
	`order_version` integer NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`location_id` text,
	`claim_id` text,
	`exchange_id` text,
	`refund_amount` integer,
	`no_notification` integer,
	`created_by` text,
	`requested_at` text,
	`received_at` text,
	`canceled_at` text,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "returns_status_check" CHECK("returns"."status" IN ('open', 'requested', 'received', 'partially_received', 'canceled'))
);
--> statement-breakpoint
CREATE INDEX `returns_order_active_idx` ON `returns` (`order_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `returns_display_id_active_idx` ON `returns` (`display_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `returns_claim_active_idx` ON `returns` (`claim_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `returns_exchange_active_idx` ON `returns` (`exchange_id`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `cart_payment_collections` (
	`cart_id` text NOT NULL,
	`payment_collection_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`cart_id`, `payment_collection_id`)
);
--> statement-breakpoint
CREATE INDEX `cart_payment_collections_collection_idx` ON `cart_payment_collections` (`payment_collection_id`);--> statement-breakpoint
CREATE TABLE `cart_promotions` (
	`cart_id` text NOT NULL,
	`promotion_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`cart_id`, `promotion_id`)
);
--> statement-breakpoint
CREATE INDEX `cart_promotions_promotion_idx` ON `cart_promotions` (`promotion_id`);--> statement-breakpoint
CREATE TABLE `customer_account_holders` (
	`customer_id` text NOT NULL,
	`account_holder_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`customer_id`, `account_holder_id`)
);
--> statement-breakpoint
CREATE INDEX `customer_account_holders_holder_idx` ON `customer_account_holders` (`account_holder_id`);--> statement-breakpoint
CREATE TABLE `location_fulfillment_providers` (
	`stock_location_id` text NOT NULL,
	`fulfillment_provider_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`stock_location_id`, `fulfillment_provider_id`)
);
--> statement-breakpoint
CREATE INDEX `location_fulfillment_providers_provider_idx` ON `location_fulfillment_providers` (`fulfillment_provider_id`);--> statement-breakpoint
CREATE TABLE `location_fulfillment_sets` (
	`stock_location_id` text NOT NULL,
	`fulfillment_set_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`stock_location_id`, `fulfillment_set_id`)
);
--> statement-breakpoint
CREATE INDEX `location_fulfillment_sets_set_idx` ON `location_fulfillment_sets` (`fulfillment_set_id`);--> statement-breakpoint
CREATE TABLE `order_carts` (
	`order_id` text NOT NULL,
	`cart_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`order_id`, `cart_id`)
);
--> statement-breakpoint
CREATE INDEX `order_carts_cart_idx` ON `order_carts` (`cart_id`);--> statement-breakpoint
CREATE TABLE `order_claim_payment_collections` (
	`claim_id` text NOT NULL,
	`payment_collection_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`claim_id`, `payment_collection_id`)
);
--> statement-breakpoint
CREATE INDEX `order_claim_payment_collections_collection_idx` ON `order_claim_payment_collections` (`payment_collection_id`);--> statement-breakpoint
CREATE TABLE `order_exchange_payment_collections` (
	`exchange_id` text NOT NULL,
	`payment_collection_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`exchange_id`, `payment_collection_id`)
);
--> statement-breakpoint
CREATE INDEX `order_exchange_payment_collections_collection_idx` ON `order_exchange_payment_collections` (`payment_collection_id`);--> statement-breakpoint
CREATE TABLE `order_fulfillments` (
	`order_id` text NOT NULL,
	`fulfillment_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`order_id`, `fulfillment_id`)
);
--> statement-breakpoint
CREATE INDEX `order_fulfillments_fulfillment_idx` ON `order_fulfillments` (`fulfillment_id`);--> statement-breakpoint
CREATE TABLE `order_payment_collections` (
	`order_id` text NOT NULL,
	`payment_collection_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`order_id`, `payment_collection_id`)
);
--> statement-breakpoint
CREATE INDEX `order_payment_collections_collection_idx` ON `order_payment_collections` (`payment_collection_id`);--> statement-breakpoint
CREATE TABLE `order_promotions` (
	`order_id` text NOT NULL,
	`promotion_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`order_id`, `promotion_id`)
);
--> statement-breakpoint
CREATE INDEX `order_promotions_promotion_idx` ON `order_promotions` (`promotion_id`);--> statement-breakpoint
CREATE TABLE `product_sales_channels` (
	`product_id` text NOT NULL,
	`sales_channel_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`product_id`, `sales_channel_id`)
);
--> statement-breakpoint
CREATE INDEX `product_sales_channels_channel_idx` ON `product_sales_channels` (`sales_channel_id`);--> statement-breakpoint
CREATE TABLE `product_shipping_profiles` (
	`product_id` text NOT NULL,
	`shipping_profile_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`product_id`, `shipping_profile_id`)
);
--> statement-breakpoint
CREATE INDEX `product_shipping_profiles_profile_idx` ON `product_shipping_profiles` (`shipping_profile_id`);--> statement-breakpoint
CREATE TABLE `product_variant_inventory_items` (
	`variant_id` text NOT NULL,
	`inventory_item_id` text NOT NULL,
	`required_quantity` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`variant_id`, `inventory_item_id`)
);
--> statement-breakpoint
CREATE INDEX `product_variant_inventory_items_item_idx` ON `product_variant_inventory_items` (`inventory_item_id`);--> statement-breakpoint
CREATE TABLE `product_variant_price_sets` (
	`variant_id` text NOT NULL,
	`price_set_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`variant_id`, `price_set_id`)
);
--> statement-breakpoint
CREATE INDEX `product_variant_price_sets_price_set_idx` ON `product_variant_price_sets` (`price_set_id`);--> statement-breakpoint
CREATE TABLE `publishable_api_key_sales_channels` (
	`api_key_id` text NOT NULL,
	`sales_channel_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`api_key_id`, `sales_channel_id`)
);
--> statement-breakpoint
CREATE INDEX `publishable_api_key_sales_channels_channel_idx` ON `publishable_api_key_sales_channels` (`sales_channel_id`);--> statement-breakpoint
CREATE TABLE `region_payment_providers` (
	`region_id` text NOT NULL,
	`payment_provider_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`region_id`, `payment_provider_id`)
);
--> statement-breakpoint
CREATE INDEX `region_payment_providers_provider_idx` ON `region_payment_providers` (`payment_provider_id`);--> statement-breakpoint
CREATE TABLE `return_fulfillments` (
	`return_id` text NOT NULL,
	`fulfillment_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`return_id`, `fulfillment_id`)
);
--> statement-breakpoint
CREATE INDEX `return_fulfillments_fulfillment_idx` ON `return_fulfillments` (`fulfillment_id`);--> statement-breakpoint
CREATE TABLE `sales_channel_stock_locations` (
	`sales_channel_id` text NOT NULL,
	`stock_location_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`sales_channel_id`, `stock_location_id`)
);
--> statement-breakpoint
CREATE INDEX `sales_channel_stock_locations_location_idx` ON `sales_channel_stock_locations` (`stock_location_id`);--> statement-breakpoint
CREATE TABLE `shipping_option_price_sets` (
	`shipping_option_id` text NOT NULL,
	`price_set_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`shipping_option_id`, `price_set_id`)
);
--> statement-breakpoint
CREATE INDEX `shipping_option_price_sets_price_set_idx` ON `shipping_option_price_sets` (`price_set_id`);--> statement-breakpoint
ALTER TABLE `stores` ADD `default_sales_channel_id` text;--> statement-breakpoint
ALTER TABLE `stores` ADD `default_region_id` text;--> statement-breakpoint
ALTER TABLE `stores` ADD `default_location_id` text;--> statement-breakpoint
ALTER TABLE `stores` ADD `metadata` text;