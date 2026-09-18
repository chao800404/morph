-- Repairs sales channel timestamps written in SQLite's own format.
--
-- `0024_remarkable_omega_flight.sql` set `updated_at` with `CURRENT_TIMESTAMP`
-- on two statements. That column is `text` holding ISO-8601, the shape
-- `new Date().toISOString()` produces, and `CURRENT_TIMESTAMP` produces
-- `2026-09-18 07:39:52` instead: same instant, since SQLite's clock is UTC,
-- but a format `new Date()` reads as *local* time. A row written that way comes
-- back shifted by whatever offset the reader happens to be in, and sorts before
-- every ISO value for the same day, because a space precedes `T`.
--
-- Lossless, and only because the instant survived: the repair is the format.
-- A space becomes `T`, and `.000Z` states the UTC the value always was.
--
-- A no-op on most databases. Both statements in 0024 were conditional — one on
-- a list of ids, one on `name = 'Default Sales Channel'` — so a store whose
-- channel row was created after that migration ran was never touched. Every
-- database observable from here is in that group. This exists for the ones that
-- are not, because nothing else will ever repair them.
--
-- Matched by shape rather than by pattern. `YYYY-MM-DD HH:MM:SS` is nineteen
-- characters with a space eleventh; an ISO value is twenty-four with a `T`
-- there, so neither test can catch one and repair it twice. The first draft
-- used a GLOB of character classes and D1 refused the migration outright with
-- "LIKE or GLOB pattern too complex" — on every database, not just a damaged
-- one. `length` and `instr` ask the same question without a pattern engine.
UPDATE `sales_channels`
SET `updated_at` = replace(`updated_at`, ' ', 'T') || '.000Z'
WHERE length(`updated_at`) = 19 AND instr(`updated_at`, ' ') = 11;
--> statement-breakpoint
UPDATE `sales_channels`
SET `created_at` = replace(`created_at`, ' ', 'T') || '.000Z'
WHERE length(`created_at`) = 19 AND instr(`created_at`, ' ') = 11;
