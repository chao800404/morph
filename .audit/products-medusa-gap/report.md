# Morph Products vs Medusa Products — Gap Audit

Audit date: 2026-08-09

## Scope

Compared the live Morph and Medusa product list, create flow, product detail, and variant detail, then verified the findings against both local codebases.

## Current Morph coverage

- Product list with search, sort, pagination, status and delete.
- Three-step product creation: Details, Organize, Variants; save draft support.
- General information, media selection/upload, collection, type, tags, categories and discountable.
- Product options and variant matrix.
- Variant SKU, barcode, option values, managed inventory, backorder, scalar quantity, dimensional overrides and currency prices.
- Product detail cards for General, Media, Options, Variants, Organization, Attributes and Metadata.
- Dedicated Collections, Categories, Inventory and Options areas.

## Gaps, ordered by impact

### P0 — Product commerce relationships are not connected

1. **Sales Channels**
   - Medusa supports assignment during create, a detail card/editor, list filters and a list column.
   - Morph already has `product_sales_channels`, Sales Channel DAL/server functions and queries, but Product create/detail/list do not expose them.
   - Morph's own Organize UI currently says products are available everywhere after publishing.

2. **Shipping Profile / Shipping configuration**
   - Medusa supports a shipping profile during create and a Shipping configuration card/editor on detail.
   - Morph already has `shipping_profiles` and `product_shipping_profiles`, but Product UI/actions/DTO do not connect them.

3. **Inventory items and stock locations per variant**
   - Medusa links a variant to inventory items and shows stock by location, available/reserved/in-stock quantities, and inventory-kit behavior.
   - Morph schemas already include inventory items, stock locations and `product_variant_inventory_items`, but Product Variant UI currently stores/edits one scalar `inventoryQuantity` only.

4. **Region/rule-aware prices**
   - Medusa supports currency and region price columns and rule-bearing prices.
   - Morph pricing schema already supports price lists, rules and quantity breaks, but the Product Variant editor only exposes one input per store currency.

### P1 — Daily catalogue operations are thinner

5. **Product list filters and richer catalogue columns**
   - Medusa list supports filters such as status, collection, type, tags, sales channel and dates.
   - Medusa list shows thumbnail/Product, Collection, Sales Channels, Variants and Status.
   - Morph currently shows Title, Handle, Status and Updated, with search/sort only.

6. **Import and export**
   - Medusa has CSV import with preview/confirmation and filtered export.
   - No equivalent Product import/export flow was found in Morph.

7. **Variant detail completeness**
   - Medusa variant detail includes dedicated Prices, Inventory, Metadata and JSON sections.
   - Morph edits SKU, one Barcode field, options, quantity, dimensions and currency prices in one surface.
   - Morph schema has EAN, UPC and variant metadata, but no separate EAN/UPC fields or variant metadata editor is wired.
   - Variant-level media/thumbnail associations are represented in the data model, but the current variant table uses a placeholder and no variant media editor was found.

8. **Bulk catalogue actions**
   - Morph's shared table supports selection infrastructure, but Products does not configure bulk selection/actions.
   - Medusa's catalogue workflow is stronger for operating on many products through filters, import/export and table actions.

### P2 — Useful parity, but not required for the first release

9. **JSON inspection card**
   - Medusa exposes raw JSON on product and variant detail; Morph does not.
   - This is mainly an admin/debug convenience and can be intentionally omitted.

10. **Create-time customs/physical fields**
   - Medusa can collect origin country, HS/MID codes and dimensions during create.
   - Morph supports these later through the Product Attributes editor, so this is a workflow gap rather than missing data capability.

## Architecture finding

The highest-value work is mostly integration, not new schema design. Morph already contains:

- `product_sales_channels`
- `product_shipping_profiles`
- inventory items, stock locations and variant inventory links
- price lists, price rules and quantity breaks
- EAN/UPC and variant metadata columns

However, Product DTOs, actions, queries and UI do not consistently surface these capabilities. Some Product comments/UI copy still claim Sales Channels and Shipping Profiles are not modeled, which is now stale relative to the database and server code.

## Recommended delivery order

1. Connect Sales Channels and Shipping Profile through Product create, detail, edit, DTO and actions.
2. Replace scalar variant quantity with inventory-item/location assignments while providing a migration/fallback path.
3. Connect Product pricing to regions and price lists without removing simple currency prices.
4. Upgrade Products list with thumbnail, collection, channel, variant count, filters and bulk actions.
5. Add CSV import/export.
6. Add variant media, metadata, explicit EAN/UPC and optional JSON inspection.

## Evidence limits

- The audit covered visible admin flows and local source code; it did not execute storefront checkout or fulfillment scenarios.
- Responsive behavior was observed at desktop viewport only in this run.
- Keyboard-only navigation, screen-reader announcements and contrast ratios were not measured with dedicated accessibility tooling.
