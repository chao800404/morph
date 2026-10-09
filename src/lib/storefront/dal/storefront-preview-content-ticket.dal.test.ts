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
