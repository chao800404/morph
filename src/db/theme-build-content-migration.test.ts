import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("0071 theme build content binding migration", () => {
  it("preserves source-only builds and prevents deletion of bound publications", () => {
    const db = new Database(":memory:");
    try {
      db.pragma("foreign_keys = ON");
      db.exec(`CREATE TABLE storefront_content_publications (id text PRIMARY KEY);
        CREATE TABLE storefront_theme_builds (id text PRIMARY KEY, status text);
        INSERT INTO storefront_theme_builds VALUES ('legacy', 'succeeded');`);
      db.exec(
        readFileSync(
          resolve("drizzle/0071_theme_build_content_publication.sql"),
          "utf8",
        ),
      );
      expect(db.prepare("SELECT * FROM storefront_theme_builds").get()).toEqual(
        { id: "legacy", status: "succeeded", content_publication_id: null },
      );
      db.exec(
        "INSERT INTO storefront_content_publications VALUES ('publication-a')",
      );
      db.exec(
        "INSERT INTO storefront_theme_builds VALUES ('bound', 'queued', 'publication-a')",
      );
      expect(() =>
        db.exec(
          "DELETE FROM storefront_content_publications WHERE id = 'publication-a'",
        ),
      ).toThrow();
      expect(() =>
        db.exec(
          "INSERT INTO storefront_theme_builds VALUES ('invalid', 'queued', 'missing')",
        ),
      ).toThrow();
    } finally {
      db.close();
    }
  });
});
