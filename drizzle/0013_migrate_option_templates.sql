-- Move the option library from `option_templates` into `product_options`.
--
-- The library used to be a separate table. Medusa models the same idea as one
-- `product_option` table with an `is_exclusive` flag: global options are shared
-- across products, exclusive ones belong to a single product. Aligning avoids
-- maintaining two parallel CRUD paths for the same concept.
--
-- Templates were global by definition, so they arrive with is_exclusive = 0.
INSERT INTO product_options (
  id, product_id, title, is_exclusive, rank, metadata,
  created_by, updated_by, created_at, updated_at, deleted_at
)
SELECT
  id, NULL, title, 0, rank, NULL,
  created_by, updated_by, created_at, updated_at, deleted_at
FROM option_templates;
--> statement-breakpoint
INSERT INTO product_option_values (
  id, option_id, value, rank, metadata, created_at, updated_at, deleted_at
)
SELECT
  v.id, v.template_id, v.value, v.rank, NULL, v.created_at, v.updated_at, NULL
FROM option_template_values v
JOIN option_templates t ON t.id = v.template_id;
