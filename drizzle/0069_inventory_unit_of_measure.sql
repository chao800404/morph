-- D1 uses SQLite numeric affinity; the existing INTEGER-affinity quantity
-- columns already store non-integral values as REAL, so no data rewrite is
-- needed when the Drizzle declarations switch to real().
ALTER TABLE `inventory_items`
ADD COLUMN `unit_of_measure` text;
