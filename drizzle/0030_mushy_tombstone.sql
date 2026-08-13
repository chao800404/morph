PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_promotion_campaign_budget_usages` (
	`id` text PRIMARY KEY NOT NULL,
	`budget_id` text NOT NULL,
	`attribute_value` text NOT NULL,
	`used` integer DEFAULT 0 NOT NULL,
	`limit` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`budget_id`) REFERENCES `promotion_campaign_budgets`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "promotion_campaign_budget_usages_limit_check" CHECK("__new_promotion_campaign_budget_usages"."limit" IS NULL OR "__new_promotion_campaign_budget_usages"."used" <= "__new_promotion_campaign_budget_usages"."limit")
);
--> statement-breakpoint
INSERT INTO `__new_promotion_campaign_budget_usages`("id", "budget_id", "attribute_value", "used", "created_at", "updated_at", "deleted_at") SELECT "id", "budget_id", "attribute_value", "used", "created_at", "updated_at", "deleted_at" FROM `promotion_campaign_budget_usages`;--> statement-breakpoint
UPDATE `__new_promotion_campaign_budget_usages` SET `limit` = (SELECT `promotion_campaign_budgets`.`limit` FROM `promotion_campaign_budgets` WHERE `promotion_campaign_budgets`.`id` = `__new_promotion_campaign_budget_usages`.`budget_id`);--> statement-breakpoint
DROP TABLE `promotion_campaign_budget_usages`;--> statement-breakpoint
ALTER TABLE `__new_promotion_campaign_budget_usages` RENAME TO `promotion_campaign_budget_usages`;--> statement-breakpoint
CREATE UNIQUE INDEX `promotion_campaign_budget_usages_unique` ON `promotion_campaign_budget_usages` (`attribute_value`,`budget_id`) WHERE "promotion_campaign_budget_usages"."deleted_at" IS NULL;--> statement-breakpoint
CREATE TABLE `__new_promotion_campaign_budgets` (
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
	CONSTRAINT "promotion_campaign_budgets_type_check" CHECK("__new_promotion_campaign_budgets"."type" IN ('spend', 'usage', 'use_by_attribute', 'spend_by_attribute')),
	CONSTRAINT "promotion_campaign_budgets_limit_check" CHECK("__new_promotion_campaign_budgets"."limit" IS NULL OR "__new_promotion_campaign_budgets"."used" <= "__new_promotion_campaign_budgets"."limit")
);
--> statement-breakpoint
INSERT INTO `__new_promotion_campaign_budgets`("id", "campaign_id", "type", "currency_code", "limit", "used", "attribute", "created_at", "updated_at", "deleted_at") SELECT "id", "campaign_id", "type", "currency_code", "limit", "used", "attribute", "created_at", "updated_at", "deleted_at" FROM `promotion_campaign_budgets`;--> statement-breakpoint
DROP TABLE `promotion_campaign_budgets`;--> statement-breakpoint
ALTER TABLE `__new_promotion_campaign_budgets` RENAME TO `promotion_campaign_budgets`;--> statement-breakpoint
CREATE UNIQUE INDEX `promotion_campaign_budgets_campaign_unique` ON `promotion_campaign_budgets` (`campaign_id`) WHERE "promotion_campaign_budgets"."deleted_at" IS NULL;--> statement-breakpoint
CREATE TABLE `__new_promotions` (
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
	CONSTRAINT "promotions_type_check" CHECK("__new_promotions"."type" IN ('standard', 'buyget')),
	CONSTRAINT "promotions_status_check" CHECK("__new_promotions"."status" IN ('draft', 'active', 'inactive')),
	CONSTRAINT "promotions_used_check" CHECK("__new_promotions"."used" >= 0),
	CONSTRAINT "promotions_limit_check" CHECK("__new_promotions"."limit" IS NULL OR "__new_promotions"."used" <= "__new_promotions"."limit")
);
--> statement-breakpoint
INSERT INTO `__new_promotions`("id", "code", "type", "status", "is_automatic", "is_tax_inclusive", "limit", "used", "campaign_id", "metadata", "created_at", "updated_at", "deleted_at") SELECT "id", "code", "type", "status", "is_automatic", "is_tax_inclusive", "limit", "used", "campaign_id", "metadata", "created_at", "updated_at", "deleted_at" FROM `promotions`;--> statement-breakpoint
DROP TABLE `promotions`;--> statement-breakpoint
ALTER TABLE `__new_promotions` RENAME TO `promotions`;--> statement-breakpoint
CREATE UNIQUE INDEX `promotions_active_code_unique` ON `promotions` (`code`) WHERE "promotions"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `promotions_automatic_active_idx` ON `promotions` (`is_automatic`,`status`) WHERE "promotions"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `promotions_campaign_active_idx` ON `promotions` (`campaign_id`,`deleted_at`);
--> statement-breakpoint
PRAGMA foreign_keys=ON;
