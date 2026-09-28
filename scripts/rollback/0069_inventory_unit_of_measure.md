# Rollback: inventory unit of measure

The migration adds the nullable `inventory_items.unit_of_measure` column. Revert
the application code and keep this additive column in D1; older application
queries do not read it, and leaving it in place preserves any unit labels that
were saved. Do not drop the column as part of an application rollback.

The quantity columns use SQLite's numeric affinity. Existing `INTEGER` columns
can store non-integral values as `REAL`, so the migration does not rebuild or
rewrite stocked, reserved, incoming, reservation, or kit quantities. This keeps
the rollback lossless for fractional values.
