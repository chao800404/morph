# Rollback: normalize variant base prices

Before rolling application code back to a build that reads
`product_variant_prices`, run
[`0067_restore_legacy_variant_base_prices.sql`](./0067_restore_legacy_variant_base_prices.sql)
against the same database. It copies active, untargeted prices without quantity
tiers or price rules back to the legacy table and can be run more than once.

The forward migration keeps the legacy table and all Pricing rows. Do not drop
the Pricing tables or links during an application rollback; price-list prices,
quantity tiers, and rule-based prices have no representation in the legacy
table.
