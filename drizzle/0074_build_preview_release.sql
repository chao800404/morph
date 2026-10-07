ALTER TABLE `storefront_build_preview_capabilities` ADD `release_id` text REFERENCES storefront_releases(id) ON DELETE cascade;
