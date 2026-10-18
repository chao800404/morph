import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// 0080 adds the Live Preview runtime a Theme records (R-0, R1). Every Theme
// from before it records none, NULL, and is previewed as the deployment says,
// exactly as it was.
describe("0080 theme preview runtime migration", () => {
  it("leaves every existing Theme recording no runtime", () => {
    const db = new Database(":memory:");
    try {
      db.exec(`CREATE TABLE storefront_themes (
          id text PRIMARY KEY,
          storefront_id text NOT NULL,
          name text NOT NULL,
          framework text,
          metadata text
        );
        INSERT INTO storefront_themes VALUES
          ('start-theme', 'sf', 'Default', NULL, '{"starterTemplateVersion":29}'),
          ('astro-theme', 'sf', 'Astro', 'astro', NULL);`);
      const before = db
        .prepare("SELECT * FROM storefront_themes ORDER BY id")
        .all() as Record<string, unknown>[];

      db.exec(
        readFileSync(
          resolve("drizzle/0080_theme_preview_runtime.sql"),
          "utf8",
        ).replaceAll("--> statement-breakpoint", ""),
      );

      expect(
        db.prepare("SELECT * FROM storefront_themes ORDER BY id").all(),
      ).toEqual(before.map((row) => ({ ...row, preview_runtime: null })));

      db.exec(
        "UPDATE storefront_themes SET preview_runtime = 'start' WHERE id = 'start-theme'",
      );
      expect(
        db
          .prepare(
            "SELECT preview_runtime FROM storefront_themes WHERE id = 'start-theme'",
          )
          .get(),
      ).toEqual({ preview_runtime: "start" });
    } finally {
      db.close();
    }
  });
});
