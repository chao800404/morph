import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import * as storefrontSchema from "@/db/storefront.schema";
import { storefrontPreviewContentTicketDal } from "./storefront-preview-content-ticket.dal";

vi.mock("@/db", () => ({ getDb: vi.fn() }));

let sqlite: Database.Database;

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(`
    CREATE TABLE storefronts (id text PRIMARY KEY NOT NULL);
    CREATE TABLE storefront_themes (id text PRIMARY KEY NOT NULL);
    INSERT INTO storefronts VALUES ('store');
    INSERT INTO storefront_themes VALUES ('theme');
    CREATE TABLE storefront_theme_templates (
      id text PRIMARY KEY NOT NULL,
      theme_id text NOT NULL,
      draft_generation integer DEFAULT 1 NOT NULL,
      draft_revision_id text,
      deleted_at text
    );
    CREATE TABLE storefront_pages (
      id text PRIMARY KEY NOT NULL,
      storefront_id text NOT NULL,
      handle text NOT NULL,
      draft_revision_id text,
      updated_at text NOT NULL,
      deleted_at text
    );
    INSERT INTO storefront_theme_templates VALUES ('index', 'theme', 1, 'tr-1', NULL);
    INSERT INTO storefront_pages VALUES ('p', 'store', 'about', 'pr-1', 't1', NULL);
  `);
  // The migration itself, as D1 applies it.
  sqlite.exec(
    readFileSync(
      resolve("drizzle/0079_preview_content_tickets.sql"),
      "utf8",
    ).replaceAll("--> statement-breakpoint", ""),
  );
  vi.mocked(getDb).mockResolvedValue(
    drizzle(sqlite, { schema: storefrontSchema }) as never,
  );
});

afterEach(() => sqlite.close());

const scope = { storefrontId: "store", themeId: "theme" };

describe("preview content tickets", () => {
  it("counts up from 1 per preview, one ticket per call", async () => {
    const tickets = [];
    for (let i = 0; i < 3; i++) {
      tickets.push(
        await storefrontPreviewContentTicketDal.next({ previewId: "a", ...scope }),
      );
    }
    expect(tickets).toEqual([1, 2, 3]);
    expect(
      await storefrontPreviewContentTicketDal.next({ previewId: "b", ...scope }),
    ).toBe(1);
  });

  it("never hands two concurrent callers the same ticket", async () => {
    const tickets = await Promise.all(
      Array.from({ length: 10 }, () =>
        storefrontPreviewContentTicketDal.next({ previewId: "a", ...scope }),
      ),
    );
    expect(new Set(tickets).size).toBe(10);
    expect([...tickets].sort((x, y) => x - y)).toEqual(
      Array.from({ length: 10 }, (_, index) => index + 1),
    );
  });

  it("goes away with its theme", async () => {
    await storefrontPreviewContentTicketDal.next({ previewId: "a", ...scope });
    sqlite.exec("DELETE FROM storefront_themes WHERE id = 'theme'");
    expect(
      sqlite
        .prepare("SELECT COUNT(*) AS count FROM storefront_theme_preview_content_tickets")
        .get(),
    ).toEqual({ count: 0 });
  });
});

describe("the drafts' versions", () => {
  const read = () => storefrontPreviewContentTicketDal.readDraftVersions(scope);

  it("stay the same while nothing is written", async () => {
    expect(await read()).toBe(await read());
  });

  it("move with a template's draft write, and with a page's", async () => {
    const before = await read();
    sqlite.exec(
      "UPDATE storefront_theme_templates SET draft_generation = 2 WHERE id = 'index'",
    );
    const afterTemplate = await read();
    expect(afterTemplate).not.toBe(before);
    sqlite.exec(
      "UPDATE storefront_pages SET draft_revision_id = 'pr-2', updated_at = 't2' WHERE id = 'p'",
    );
    expect(await read()).not.toBe(afterTemplate);
  });

  it("move when a page or template comes or goes", async () => {
    const before = await read();
    sqlite.exec("UPDATE storefront_pages SET deleted_at = 'now' WHERE id = 'p'");
    expect(await read()).not.toBe(before);
  });
});
