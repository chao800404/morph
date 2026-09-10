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

/**
 * The flat destination keys, and the declared field each one becomes.
 *
 * `siblings` are the other halves of the same decision. A destination is an
 * address *and* how to open it, and the flat shape kept those in separate
 * props — so moving only the address silently drops the author's choice to
 * open the link in a new tab.
 */
const SCALAR_LINK_KEYS = {
  actionHref: {
    field: "action",
    siblings: { actionTarget: "target", actionRel: "rel" },
  },
};

/** The same, for a key on a repeated row. */
const ROW_LINK_KEYS = {
  href: { field: "link", siblings: { target: "target", rel: "rel" } },
};

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
 * Whether a component declares `fieldKey` as a link field.
 *
 * The content shape belongs to the component, not to this script. A theme is
 * free to declare `items` rows carrying a plain `href` it reads directly, and
 * renaming that to `link` would break a component that never asked for the new
 * shape — the exact failure this migration exists to repair.
 *
 * The check is deliberately narrow: it looks for the declaration inside the
 * component's own `contentFields`, and answers "no" for anything it cannot
 * read. Skipping a component that could have been migrated is a re-run;
 * migrating one that should not have been is data the author has to rebuild.
 */
function declaresLinkIn(text, fieldKey) {
  return new RegExp(
    `\\b${fieldKey}\\s*:\\s*\\{[^}]*type\\s*:\\s*["']link["']`,
  ).test(text);
}

/** The component's own `contentFields` declaration, as text. */
function declarationOf(source) {
  if (typeof source !== "string") return null;
  const start = source.indexOf("contentFields");
  return start === -1 ? null : source.slice(start);
}

function declaresLinkField(source, fieldKey) {
  const declaration = declarationOf(source);
  return declaration ? declaresLinkIn(declaration, fieldKey) : false;
}

/**
 * Moves one flat destination into the declared link field.
 *
 * Returns a description of what moved, or null when there was nothing to move.
 */
function migrateKey(container, from, spec, label, changes) {
  if (!(from in container)) return;
  const { field, siblings } = spec;

  if (field in container) {
    delete container[from];
    changes.push(`${label}: dropped orphaned ${from} (${field} already set)`);
    return;
  }

  const link = toLinkValue(container[from]);
  delete container[from];
  const moved = [from];
  for (const [siblingKey, target] of Object.entries(siblings)) {
    if (!(siblingKey in container)) continue;
    const value = container[siblingKey];
    delete container[siblingKey];
    if (value === null || value === undefined || value === "") continue;
    if (link[target] === undefined) link[target] = value;
    moved.push(siblingKey);
  }
  container[field] = link;
  changes.push(`${label}: ${moved.join(" + ")} → ${field}`);
}

/**
 * Rewrites one document in place and returns what changed.
 *
 * An empty list means the document is already in the new shape, which is what
 * makes re-running this safe. `sourceForSection` answers what a section's
 * component declares; a section it cannot resolve is left alone.
 */
function migrateDocument(document, sourceForSection) {
  const changes = [];
  const skipped = [];
  for (const section of document.sections ?? []) {
    const props = section.props ?? {};
    const id = section.id ?? "(unnamed)";

    const ref = section.componentRef;
    if (ref && COMPONENT_REF_RENAMES[ref]) {
      section.componentRef = COMPONENT_REF_RENAMES[ref];
      changes.push(`${id}: componentRef ${ref} → ${section.componentRef}`);
    }

    const source = sourceForSection(section);

    for (const [from, spec] of Object.entries(SCALAR_LINK_KEYS)) {
      if (!(from in props)) continue;
      if (!declaresLinkField(source, spec.field)) {
        skipped.push(
          `${id}: ${from} kept — the component declares no "${spec.field}" link field`,
        );
        continue;
      }
      migrateKey(props, from, spec, id, changes);
    }

    for (const [propKey, value] of Object.entries(props)) {
      if (!Array.isArray(value)) continue;
      value.forEach((row, index) => {
        if (row === null || typeof row !== "object") return;
        for (const [from, spec] of Object.entries(ROW_LINK_KEYS)) {
          if (!(from in row)) continue;
          if (!declaresRowLinkField(source, propKey, spec.field)) {
            skipped.push(
              `${id}.${propKey}[${index}]: ${from} kept — the row declares no "${spec.field}" link field`,
            );
            continue;
          }
          migrateKey(row, from, spec, `${id}.${propKey}[${index}]`, changes);
        }
      });
    }
  }
  return { changes, skipped };
}

/**
 * Whether a component declares `fieldKey` as a link inside the row shape of
 * the array field `arrayKey`.
 *
 * Scoped to that array's own `fields` block, so a link declared elsewhere in
 * the component cannot vouch for a row that has none.
 */
function declaresRowLinkField(source, arrayKey, fieldKey) {
  const declaration = declarationOf(source);
  if (!declaration) return false;
  const arrayAt = declaration.search(new RegExp(`\\b${arrayKey}\\s*:\\s*\\{`));
  if (arrayAt === -1) return false;
  const fieldsAt = declaration.indexOf("fields", arrayAt);
  if (fieldsAt === -1) return false;
  // Searches the slice directly: handing it back to `declaresLinkField` would
  // look for the word `contentFields` inside a slice that starts after it, and
  // answer "not declared" for every row link there is.
  return declaresLinkIn(declaration.slice(fieldsAt), fieldKey);
}

/**
 * Answers which component renders a given section, as source text.
 *
 * Reads the theme's own manifest and workspace files, so the answer is what
 * this storefront actually ships rather than what the starter happens to
 * contain.
 */
function buildSourceResolver(database) {
  const rows = database
    .prepare(
      "SELECT path, content FROM storefront_theme_files WHERE deleted_at IS NULL",
    )
    .all();
  const byPath = new Map(rows.map((row) => [row.path, row.content]));

  let manifest = {};
  try {
    manifest = JSON.parse(byPath.get("morph.theme.json") ?? "{}");
  } catch {
    manifest = {};
  }

  return (section) => {
    const ref = section.componentRef;
    const path =
      (ref && manifest.components?.[ref]?.source) ||
      manifest.sections?.[section.type]?.source ||
      null;
    return path ? (byPath.get(path) ?? null) : null;
  };
}

function main() {
  const database = new Database(locateDatabase(), { readonly: DRY_RUN });
  const now = new Date().toISOString();
  const statements = [];
  let changed = 0;
  const sourceForSection = buildSourceResolver(database);

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
    const { changes, skipped } = migrateDocument(source, sourceForSection);
    for (const note of skipped) console.log(`[migrate] ${label}: ${note}`);
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
      // Guarded by the generation and revision this document was read at. The
      // editor writes through the same optimistic check, so a save landing
      // between the read above and this write makes the update match no row
      // rather than overwriting it — which matters most with `--sql`, where
      // the statements may be applied minutes or days later.
      statements.push(
        "UPDATE storefront_theme_templates SET draft_revision_id = ?," +
          " document = ?, draft_generation = draft_generation + 1, updated_at = ?" +
          " WHERE id = ? AND draft_generation = ? AND draft_revision_id = ?;",
        [
          revisionId,
          payload,
          now,
          template.id,
          template.draft_generation,
          revision.id,
        ],
      );
    } else {
      statements.push(
        "UPDATE storefront_theme_templates SET document = ?," +
          " draft_generation = draft_generation + 1, updated_at = ?" +
          " WHERE id = ? AND draft_generation = ? AND draft_revision_id IS NULL;",
        [payload, now, template.id, template.draft_generation],
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
    lines.push(
      "-- Generated by scripts/migrate-content-link-fields.mjs.",
      "-- Each UPDATE is guarded by the draft generation its document was read",
      "-- at. If a template is saved before this file is applied, that UPDATE",
      "-- matches no row and the template keeps its content: regenerate then.",
    );
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
      "[migrate] each UPDATE is guarded by the generation it was read at:" +
        " if the template is saved before you apply this, that UPDATE matches" +
        " no row and the template keeps its content — re-run to regenerate.",
    );
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
      const sql = statements[index];
      const result = database.prepare(sql).run(...statements[index + 1]);
      // A guarded UPDATE that matches nothing means someone saved between the
      // read and this write. Throwing rolls the whole transaction back, which
      // is the honest outcome: re-run and the migration sees the new content.
      if (sql.startsWith("UPDATE") && result.changes !== 1) {
        throw new Error(
          "template changed while migrating — nothing was written, re-run the migration",
        );
      }
    }
  });
  apply();
  console.log(`[migrate] migrated ${changed} template(s)`);
  database.close();
}

main();
