import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// 0076 adds a build's inputHash format and toolchain identity. Every build
// from before it is legacy: verified as it always was, never rewritten, and a
// release that points at one rolls back to it exactly as before. Rollback
// reads the release's build and its stored artifact; it does not re-hash.
describe("0076 theme build toolchain migration", () => {
  it("leaves legacy builds and the releases that point at them as they were", () => {
    const db = new Database(":memory:");
    try {
      db.pragma("foreign_keys = ON");
      db.exec(`CREATE TABLE storefront_theme_builds (
          id text PRIMARY KEY,
          status text,
          input_hash text,
          compiler_id text,
          compiler_version text,
          framework text,
          artifact_prefix text
        );
        CREATE TABLE storefront_releases (
          id text PRIMARY KEY,
          theme_build_id text REFERENCES storefront_theme_builds(id)
        );
        INSERT INTO storefront_theme_builds VALUES
          ('legacy', 'succeeded', '${"a".repeat(64)}', 'tanstack-start-native', '1.168.32', NULL, 'artifacts/legacy');
        INSERT INTO storefront_releases VALUES ('release-old', 'legacy');`);
      const before = db.prepare("SELECT * FROM storefront_theme_builds").get();

      db.exec(
        readFileSync(
          resolve("drizzle/0076_build_toolchain.sql"),
          "utf8",
        ).replaceAll("--> statement-breakpoint", ""),
      );

      const after = db
        .prepare("SELECT * FROM storefront_theme_builds")
        .get() as Record<string, unknown>;
      // Every existing column exactly as it was; the new ones NULL (legacy).
      expect(after).toEqual({
        ...(before as object),
        input_hash_format: null,
        toolchain_id: null,
      });
      expect(
        db
          .prepare(
            "SELECT b.artifact_prefix, b.input_hash FROM storefront_releases r JOIN storefront_theme_builds b ON b.id = r.theme_build_id WHERE r.id = 'release-old'",
          )
          .get(),
      ).toEqual({
        artifact_prefix: "artifacts/legacy",
        input_hash: "a".repeat(64),
      });

      // A new build records both.
      db.exec(
        `INSERT INTO storefront_theme_builds (id, status, framework, input_hash_format, toolchain_id) VALUES ('new', 'queued', 'tanstack-start', 2, '${"b".repeat(64)}')`,
      );
      expect(
        db
          .prepare(
            "SELECT input_hash_format, toolchain_id FROM storefront_theme_builds WHERE id = 'new'",
          )
          .get(),
      ).toEqual({ input_hash_format: 2, toolchain_id: "b".repeat(64) });
    } finally {
      db.close();
    }
  });
});
