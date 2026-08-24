import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { patchThemeInstanceStyleClasses } from "@/lib/storefront/editor/theme-instance-style-source";
import { STARTER_THEME_FILES } from "@/lib/storefront/starter-theme-files";

function applyMigration(db: Database.Database, fileName: string) {
  const sql = fs.readFileSync(
    path.resolve(process.cwd(), "drizzle", fileName),
    "utf8",
  );
  for (const statement of sql.split(/--> statement-breakpoint/)) {
    const trimmed = statement.trim();
    if (trimmed) db.exec(trimmed);
  }
}

describe("starter Principles source migration", () => {
  it("backfills Dawn Starter without overwriting custom source or mappings", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE storefront_themes (
        id text PRIMARY KEY,
        storefront_id text NOT NULL,
        source_generation integer NOT NULL,
        updated_at text NOT NULL,
        deleted_at text
      );
      CREATE TABLE storefront_theme_files (
        id text PRIMARY KEY,
        storefront_id text NOT NULL,
        theme_id text NOT NULL,
        path text NOT NULL,
        content text NOT NULL,
        mime_type text,
        is_entry integer,
        version integer NOT NULL,
        created_at text NOT NULL,
        updated_at text NOT NULL,
        deleted_at text
      );
      CREATE UNIQUE INDEX storefront_theme_files_theme_path_unique
        ON storefront_theme_files (theme_id, path)
        WHERE deleted_at IS NULL;

      INSERT INTO storefront_themes
        (id, storefront_id, source_generation, updated_at)
        VALUES
          ('theme-dawn', 'storefront-a', 3, '2026-01-01'),
          ('theme-custom', 'storefront-b', 5, '2026-01-01'),
          ('theme-other', 'storefront-c', 7, '2026-01-01');

      INSERT INTO storefront_theme_files
        (id, storefront_id, theme_id, path, content, mime_type, is_entry,
         version, created_at, updated_at)
        VALUES
          (
            'manifest-dawn', 'storefront-a', 'theme-dawn',
            'morph.theme.json',
            '{"name":"Dawn Starter","components":{},"sections":{}}',
            'application/json', 0, 1, '2026-01-01', '2026-01-01'
          ),
          (
            'manifest-custom', 'storefront-b', 'theme-custom',
            'morph.theme.json',
            '{"name":"Dawn Starter","components":{"principles.default":{"name":"Custom Principles","source":"src/components/Principles.tsx","sectionType":"principles"}},"sections":{"principles":{"componentRef":"principles.default","source":"src/components/Principles.tsx","variant":"custom"}}}',
            'application/json', 0, 4, '2026-01-01', '2026-01-01'
          ),
          (
            'principles-custom', 'storefront-b', 'theme-custom',
            'src/components/Principles.tsx', 'custom-source',
            'text/typescript', 0, 8, '2026-01-01', '2026-01-01'
          ),
          (
            'manifest-other', 'storefront-c', 'theme-other',
            'morph.theme.json',
            '{"name":"Merchant Theme","components":{},"sections":{}}',
            'application/json', 0, 2, '2026-01-01', '2026-01-01'
          );
    `);

    applyMigration(db, "0050_backfill_starter_principles_source.sql");

    const starterPrinciples = STARTER_THEME_FILES.find(
      (file) => file.path === "src/components/Principles.tsx",
    );
    expect(starterPrinciples).toBeDefined();

    const backfilled = db
      .prepare(
        `SELECT content, mime_type, is_entry, version
           FROM storefront_theme_files
          WHERE theme_id = 'theme-dawn'
            AND path = 'src/components/Principles.tsx'`,
      )
      .get();
    expect(backfilled).toEqual({
      content: expect.any(String),
      mime_type: "text/typescript",
      is_entry: 0,
      version: 1,
    });
    const migratedSource = (backfilled as { content: string }).content;
    expect(migratedSource).toContain('data-morph-node="principle-title"');
    const upgraded = patchThemeInstanceStyleClasses(
      migratedSource,
      {
        sectionId: "starter-principles",
        fieldPath: "items.1.title",
        itemId: "principle-thoughtful-sourcing",
      },
      "principle-title",
      () => "text-5xl",
    );
    expect(upgraded.editable).toBe(true);
    expect(upgraded.code).toContain('import { clsx as cn } from "clsx";');
    expect(upgraded.code).toContain(
      '"principle-thoughtful-sourcing:principle-title": "text-5xl"',
    );
    expect(upgraded.code).toContain(
      "morphInstanceClasses[`${item.id}:principle-title`]",
    );
    expect(upgraded.code).not.toContain("data-storefront-field-path=");

    const dawnManifest = JSON.parse(
      (
        db
          .prepare(
            `SELECT content FROM storefront_theme_files
              WHERE id = 'manifest-dawn'`,
          )
          .get() as { content: string }
      ).content,
    ) as Record<string, Record<string, unknown>>;
    expect(dawnManifest.components["principles.default"]).toEqual({
      name: "Principles",
      source: "src/components/Principles.tsx",
      sectionType: "principles",
    });
    expect(dawnManifest.sections.principles).toEqual({
      componentRef: "principles.default",
      source: "src/components/Principles.tsx",
    });

    expect(
      db
        .prepare(
          `SELECT content, version FROM storefront_theme_files
            WHERE id = 'principles-custom'`,
        )
        .get(),
    ).toEqual({ content: "custom-source", version: 8 });
    const customManifest = JSON.parse(
      (
        db
          .prepare(
            `SELECT content FROM storefront_theme_files
              WHERE id = 'manifest-custom'`,
          )
          .get() as { content: string }
      ).content,
    ) as Record<string, Record<string, unknown>>;
    expect(customManifest.components["principles.default"]).toEqual({
      name: "Custom Principles",
      source: "src/components/Principles.tsx",
      sectionType: "principles",
    });
    expect(customManifest.sections.principles).toEqual({
      componentRef: "principles.default",
      source: "src/components/Principles.tsx",
      variant: "custom",
    });

    expect(
      db
        .prepare(
          `SELECT id FROM storefront_theme_files
            WHERE theme_id = 'theme-other'
              AND path = 'src/components/Principles.tsx'`,
        )
        .get(),
    ).toBeUndefined();
    expect(
      db
        .prepare(
          `SELECT id, source_generation FROM storefront_themes ORDER BY id`,
        )
        .all(),
    ).toEqual([
      { id: "theme-custom", source_generation: 6 },
      { id: "theme-dawn", source_generation: 4 },
      { id: "theme-other", source_generation: 7 },
    ]);

    db.close();
  });
});
