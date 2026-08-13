import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = ["0032_bored_smasher.sql", "0033_blushing_landau.sql"]
  .map((file) => readFileSync(join(process.cwd(), "drizzle", file), "utf8"))
  .join("\n")
  .replaceAll("--> statement-breakpoint", "");

const setup = () => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec("CREATE TABLE storefronts (id text PRIMARY KEY NOT NULL)");
  db.exec(migration);
  db.prepare("INSERT INTO storefronts (id) VALUES (?)").run("storefront-1");
  return db;
};

describe("storefront page migration", () => {
  it("protects active handles and revision versions", () => {
    const db = setup();
    const insertPage = db.prepare(`
      INSERT INTO storefront_pages
        (id, storefront_id, title, handle, status, created_by, created_at, updated_at)
      VALUES (?, 'storefront-1', ?, 'about', 'draft', 'user-1', 'now', 'now')
    `);
    insertPage.run("page-1", "About");
    expect(() => insertPage.run("page-2", "About again")).toThrow();

    const insertRevision = db.prepare(`
      INSERT INTO storefront_page_revisions
        (id, page_id, version, document, created_by, created_at)
      VALUES (?, 'page-1', 1, '{"version":1,"sections":[]}', 'user-1', 'now')
    `);
    insertRevision.run("revision-1");
    expect(() => insertRevision.run("revision-2")).toThrow();
    db.close();
  });

  it("removes a page's revisions with the page", () => {
    const db = setup();
    db.exec(`
      INSERT INTO storefront_pages
        (id, storefront_id, title, handle, status, created_by, created_at, updated_at)
      VALUES ('page-1', 'storefront-1', 'About', 'about', 'draft', 'user-1', 'now', 'now');
      INSERT INTO storefront_page_revisions
        (id, page_id, version, document, created_by, created_at)
      VALUES ('revision-1', 'page-1', 1, '{"version":1,"sections":[]}', 'user-1', 'now');
      DELETE FROM storefront_pages WHERE id = 'page-1';
    `);
    const result = db
      .prepare("SELECT count(*) AS value FROM storefront_page_revisions")
      .get() as { value: number };
    expect(result.value).toBe(0);
    db.close();
  });

  it("stores page metadata independently from immutable revisions", () => {
    const db = setup();
    db.exec(`
      INSERT INTO storefront_pages
        (id, storefront_id, title, handle, status, created_by, metadata, created_at, updated_at)
      VALUES ('page-1', 'storefront-1', 'About', 'about', 'draft', 'user-1', '{"audience":"retail"}', 'now', 'now');
    `);
    const result = db
      .prepare("SELECT metadata FROM storefront_pages WHERE id = 'page-1'")
      .get() as { metadata: string };
    expect(JSON.parse(result.metadata)).toEqual({ audience: "retail" });
    db.close();
  });
});
