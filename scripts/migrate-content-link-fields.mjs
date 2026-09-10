#!/usr/bin/env node
/**
 * Migrates stored content to the unified link shape.
 *
 * Components declare a destination as one `link` field carrying href, target
 * and rel together. Older documents hold the pieces the flat way — a string
 * `actionHref` beside its label, a bare `href` on each repeated row — and a
 * component that no longer reads those keys renders its default instead. The
 * content is not lost; nothing is looking at it.
 *
 * Also normalizes `layout.header` / `layout.footer`, which predate the rule
 * that a section's ref is its type plus `.default`.
 *
 * Idempotent: a document already in the new shape is left untouched, and the
 * script reports zero changes rather than writing a new revision.
 *
 * A revision is immutable. When a template's draft revision needs migrating,
 * this writes a NEW revision and moves the draft pointer to it; the old
 * revision is never edited.
 *
 * Local development only: it reads Miniflare's on-disk state directly. For a
 * remote database, run with `--sql <file>` and apply the statements with
 * `wrangler d1 execute DATABASE --remote --file <file>`.
 *
 * Usage:
 *   node scripts/migrate-content-link-fields.mjs [--dry-run] [--sql <file>]
 */
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const D1_DIR = resolve(
  process.cwd(),
  ".wrangler/state/v3/d1/miniflare-D1DatabaseObject",
);
const DRY_RUN = process.argv.includes("--dry-run");
const SQL_OUT = (() => {
  const index = process.argv.indexOf("--sql");
  return index !== -1 ? process.argv[index + 1] : null;
})();

const COMPONENT_REF_RENAMES = {
  "layout.header": "header.default",
  "layout.footer": "footer.default",
};

/** The flat destination keys, and the declared field each one becomes. */
const SCALAR_LINK_KEYS = { actionHref: "action" };
/** The same, for a key on a repeated row. */
const ROW_LINK_KEYS = { href: "link" };

function locateDatabase() {
  if (!existsSync(D1_DIR)) {
    console.error(
      `[migrate] no local D1 state at ${D1_DIR} — run the dev server at least once`,
    );
    process.exit(2);
  }
  const files = readdirSync(D1_DIR).filter(
    (file) => file.endsWith(".sqlite") && file !== "metadata.sqlite",
  );
  if (files.length !== 1) {
    console.error(
      `[migrate] expected exactly one D1 database in ${D1_DIR}, found ${files.length}`,
    );
    process.exit(2);
  }
  return join(D1_DIR, files[0]);
}

/** A destination already stored as an object is kept as it is. */
function toLinkValue(value) {
  return value !== null && typeof value === "object" ? value : { href: value };
}

/**
 * Rewrites one document in place and returns what changed.
 *
 * An empty list means the document is already in the new shape, which is what
 * makes re-running this safe.
 */
function migrateDocument(document) {
  const changes = [];
  for (const section of document.sections ?? []) {
    const props = section.props ?? {};
    const id = section.id ?? "(unnamed)";

    const ref = section.componentRef;
    if (ref && COMPONENT_REF_RENAMES[ref]) {
      section.componentRef = COMPONENT_REF_RENAMES[ref];
      changes.push(`${id}: componentRef ${ref} → ${section.componentRef}`);
    }

    for (const [from, to] of Object.entries(SCALAR_LINK_KEYS)) {
      // Never overwrite a destination the author has already migrated.
      if (!(from in props)) continue;
      if (to in props) {
        delete props[from];
        changes.push(`${id}: dropped orphaned ${from} (${to} already set)`);
        continue;
      }
      props[to] = toLinkValue(props[from]);
      delete props[from];
      changes.push(`${id}: ${from} → ${to}`);
    }

    for (const value of Object.values(props)) {
      if (!Array.isArray(value)) continue;
      value.forEach((row, index) => {
        if (row === null || typeof row !== "object") return;
        for (const [from, to] of Object.entries(ROW_LINK_KEYS)) {
          if (!(from in row)) continue;
          if (to in row) {
            delete row[from];
            changes.push(`${id}[${index}]: dropped orphaned ${from}`);
            continue;
          }
          row[to] = toLinkValue(row[from]);
          delete row[from];
          changes.push(`${id}[${index}]: ${from} → ${to}`);
        }
      });
    }
  }
  return changes;
}

function main() {
  const database = new Database(locateDatabase(), { readonly: DRY_RUN });
  const now = new Date().toISOString();
  const statements = [];
  let changed = 0;

  const templates = database
    .prepare(
      "SELECT id, type, document, draft_revision_id, draft_generation" +
        " FROM storefront_theme_templates WHERE deleted_at IS NULL",
    )
    .all();

  for (const template of templates) {
    const label = `${template.type} ${template.id.slice(0, 8)}…`;

    // The draft revision is what the editor and the runtime actually read, so
    // migrating only the template's own document column leaves the app showing
    // the old shape while the row beside it looks correct.
    let revision = null;
    if (template.draft_revision_id) {
      revision = database
        .prepare(
          "SELECT id, version, document, created_by" +
            " FROM storefront_theme_template_revisions WHERE id = ?",
        )
        .get(template.draft_revision_id);
    }

    const source = JSON.parse(revision ? revision.document : template.document);
    const changes = migrateDocument(source);
    if (changes.length === 0) {
      console.log(`[migrate] ${label}: already migrated`);
      continue;
    }

    changed += 1;
    console.log(`[migrate] ${label}:`);
    for (const change of changes) console.log(`             ${change}`);

    const payload = JSON.stringify(source);
    if (revision) {
      const revisionId = randomUUID();
      statements.push(
        [
          "INSERT INTO storefront_theme_template_revisions",
          " (id, template_id, version, document, created_by, created_at, published_at)",
          " VALUES (?, ?, ?, ?, ?, ?, NULL);",
        ].join(""),
        [
          revisionId,
          template.id,
          revision.version + 1,
          payload,
          revision.created_by,
          now,
        ],
      );
      statements.push(
        "UPDATE storefront_theme_templates SET draft_revision_id = ?," +
          " document = ?, draft_generation = draft_generation + 1, updated_at = ?" +
          " WHERE id = ?;",
        [revisionId, payload, now, template.id],
      );
    } else {
      statements.push(
        "UPDATE storefront_theme_templates SET document = ?," +
          " draft_generation = draft_generation + 1, updated_at = ? WHERE id = ?;",
        [payload, now, template.id],
      );
    }
  }

  if (changed === 0) {
    console.log("[migrate] nothing to do");
    database.close();
    return;
  }

  if (DRY_RUN) {
    console.log(`[migrate] --dry-run: ${changed} template(s) would change`);
    database.close();
    return;
  }

  if (SQL_OUT) {
    const lines = [];
    for (let index = 0; index < statements.length; index += 2) {
      const sql = statements[index];
      const parameters = statements[index + 1];
      let position = -1;
      lines.push(
        sql.replace(/\?/g, () => {
          position += 1;
          const value = parameters[position];
          return value === null
            ? "NULL"
            : `'${String(value).replaceAll("'", "''")}'`;
        }),
      );
    }
    writeFileSync(SQL_OUT, lines.join("\n") + "\n");
    console.log(`[migrate] wrote ${lines.length} statement(s) to ${SQL_OUT}`);
    console.log(
      "[migrate] apply with: wrangler d1 execute DATABASE --remote --file " +
        SQL_OUT,
    );
    database.close();
    return;
  }

  // All or nothing: a half-migrated document would leave the editor reading a
  // revision whose pointer never moved.
  const apply = database.transaction(() => {
    for (let index = 0; index < statements.length; index += 2) {
      database.prepare(statements[index]).run(...statements[index + 1]);
    }
  });
  apply();
  console.log(`[migrate] migrated ${changed} template(s)`);
  database.close();
}

main();
