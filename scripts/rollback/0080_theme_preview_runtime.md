# Rollback: theme preview runtime

The migration adds the nullable `storefront_themes.preview_runtime` column
(`client`, `start`, or NULL for "inherit the deployment's
`MORPH_THEME_PREVIEW_RUNTIME`"). Nothing else changes: no existing row is
rewritten, and there is no index, foreign key or trigger on the column.

## Default: roll back the code, keep the column

Revert the application code and keep this additive column in D1. Code from
before the column names its columns in every read and write of
`storefront_themes`, so it neither reads nor clears `preview_runtime`, and an
insert it makes leaves the column NULL. Keeping the column keeps every runtime
an author recorded; rolling forward again picks them up unchanged. Do not drop
the column as part of an application rollback.

`src/db/theme-preview-runtime-schema-compat.integration.test.ts` runs that
older code's reads and writes against a database with 0080 applied.

## How to deploy the older code

A checkout without `drizzle/0080_theme_preview_runtime.sql` cannot deploy
through `pnpm run deploy`. Its first step,
`node scripts/check-pending-migrations.mjs --remote`, refuses because the
database has applied a migration that checkout does not have ("This code is
older than the schema"). Do not work around the check. Use one of:

- a revert commit that removes the feature but keeps
  `drizzle/0080_theme_preview_runtime.sql`, its `drizzle/meta/0080_snapshot.json`
  and its `drizzle/meta/_journal.json` entry, then deploy it with
  `pnpm run deploy`;
- `wrangler rollback` to the Worker version deployed before the feature. It
  does not run the repository's check, so confirm the target version is one
  whose code predates the column.

The opposite direction is the one that breaks: code that reads
`preview_runtime` against a database without 0080 fails to load the editor
and to create a storefront ("no such column"). There is no fallback in the
code for that; `pnpm run deploy`'s migration check is what prevents it, so
apply 0080 (`pnpm db:migrate:prod`) before deploying that code, never after.

## Removing the column

Only if the column itself must go, and never as part of the rollback above:

1. Roll back the code first, and confirm no deployed code reads the column.
2. Save the non-NULL values if they may be needed again
   (`SELECT id, preview_runtime FROM storefront_themes WHERE preview_runtime IS NOT NULL`).
3. Drop it with a new forward migration (the next free number), applied like
   any other.

Dropping it loses every recorded runtime: the authors' choices, and, once a
Starter that records `start` ships, every new Theme's `start`. A Theme that
needs the full Start preview then falls back to the deployment's runtime.

## Never

- Edit `d1_migrations` by hand, to "unapply" 0080 or for any other reason.
- Renumber or rewrite `0080_theme_preview_runtime.sql` once it has been
  applied to any database that is kept.
- Drop the column while code that reads it is deployed.
