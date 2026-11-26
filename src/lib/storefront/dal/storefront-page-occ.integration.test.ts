// @vitest-environment node
/**
 * Optimistic concurrency for the regular CMS Page writes — `update`,
 * `restoreRevision`, `updateMetadata` — on the real D1 engine (Miniflare)
 * with every migration applied.
 *
 * Each write names the draft revision `version` its caller read. It is
 * compared when the write reads the draft, and again inside the write's
 * batch, where a guard over the page's draft pointer refuses anything that
 * moved in between. A refused write leaves every row as it was.
 */
import { randomUUID } from "node:crypto";
import { env } from "cloudflare:workers";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { StorefrontPageDocument } from "@/db/storefront.schema";
import { openMigratedD1 } from "@/lib/test-utils/real-d1";
import { PAGE_DRAFT_VERSION_MISMATCH } from "../page-write-errors";
import { storefrontPageDal } from "./storefront-page.dal";

let harness: Awaited<ReturnType<typeof openMigratedD1>>;
const NOW = "2026-11-26T00:00:00.000Z";

beforeAll(async () => {
  harness = await openMigratedD1("storefront-page-occ");
}, 240_000);

afterAll(async () => {
  await harness?.dispose();
});

const run = (sql: string, ...args: unknown[]) =>
  harness.d1.prepare(sql).bind(...args).run();
const first = <T>(sql: string, ...args: unknown[]) =>
  harness.d1.prepare(sql).bind(...args).first<T>();

/** The newsletter is hidden, as a legacy Page holds it. */
function hiddenDocument(): StorefrontPageDocument {
  return {
    version: 1 as const,
    handle: "about",
    sections: [
      { id: "hero", type: "hero", enabled: true, props: { title: "About" } },
      {
        id: "newsletter",
        type: "newsletter",
        enabled: false,
        props: { heading: "Join the list" },
      },
    ],
  };
}

let storefrontId = "";
let pageId = "";
let handle = "";

beforeEach(async () => {
  storefrontId = randomUUID();
  pageId = randomUUID();
  handle = `about-${pageId.slice(0, 8)}`;
  const revisionId = randomUUID();
  await run(
    `INSERT INTO storefronts (id, sales_channel_id, name, status, created_at, updated_at)
     VALUES (?1, ?2, 'Store', 'active', ?3, ?3)`,
    storefrontId,
    `channel-${storefrontId}`,
    NOW,
  );
  await run(
    `INSERT INTO storefront_pages (id, storefront_id, title, handle, status,
       draft_revision_id, published_revision_id, created_by, metadata, created_at, updated_at)
     VALUES (?1, ?2, 'About', ?3, 'published', ?4, ?4, 'author', '{"a":"1"}', ?5, ?5)`,
    pageId,
    storefrontId,
    handle,
    revisionId,
    NOW,
  );
  await run(
    `INSERT INTO storefront_page_revisions (id, page_id, version, document, created_by, created_at, published_at)
     VALUES (?1, ?2, 3, ?3, 'author', ?4, ?4)`,
    revisionId,
    pageId,
    JSON.stringify({ ...hiddenDocument(), handle }),
    NOW,
  );
});

/** Every row these writes touch. */
async function state() {
  return {
    page: await first(
      `SELECT title, handle, status, draft_revision_id, published_revision_id, metadata, updated_at, deleted_at
         FROM storefront_pages WHERE id = ?1`,
      pageId,
    ),
    revisions: (
      await harness.d1
        .prepare(
          "SELECT id, version, document, published_at FROM storefront_page_revisions WHERE page_id = ?1 ORDER BY version",
        )
        .bind(pageId)
        .all()
    ).results,
  };
}

/** Runs `between` after the write read the draft, right before its batch. */
async function withWriteBetween(
  between: () => Promise<void>,
  write: () => Promise<unknown>,
) {
  const database = env.DATABASE;
  const holder = env as unknown as { DATABASE: D1Database };
  let ran = false;
  holder.DATABASE = new Proxy(database, {
    get(target, key, receiver) {
      if (key !== "batch") return Reflect.get(target, key, receiver);
      return async (statements: D1PreparedStatement[]) => {
        if (!ran) {
          ran = true;
          holder.DATABASE = database;
          try {
            await between();
          } finally {
            holder.DATABASE = receiver as D1Database;
          }
        }
        return target.batch(statements);
      };
    },
  });
  try {
    return await write();
  } finally {
    holder.DATABASE = database;
  }
}

const save = (overrides: Partial<Parameters<typeof storefrontPageDal.update>[0]> = {}) =>
  storefrontPageDal.update({
    id: pageId,
    storefrontId,
    title: "About us",
    handle,
    document: hiddenDocument(),
    publish: false,
    hasPublishedVersion: true,
    createdBy: "merchant",
    expectedDraftVersion: 3,
    ...overrides,
  });

describe("storefrontPageDal.update", () => {
  it("saves against the draft it read, and the next save continues from it", async () => {
    expect(await save()).toBe(4);
    expect(await save({ title: "Again", expectedDraftVersion: 4 })).toBe(5);
    expect((await state()).page).toMatchObject({ title: "Again" });
  });

  it("refuses a stale tab's save and writes nothing", async () => {
    await save();
    const before = await state();
    // A second tab still holds version 3.
    await expect(save({ title: "Stale tab" })).rejects.toThrow(
      PAGE_DRAFT_VERSION_MISMATCH,
    );
    expect(await state()).toEqual(before);
  });

  it("refuses a title save hide-checked against the old draft once Show again has committed", async () => {
    // The Codex ordering: the save reads the hidden draft (v3), its hide
    // check passes because the newsletter was hidden already; Show again
    // commits v4 with the newsletter shown; then the save's batch runs.
    let shown: unknown;
    await expect(
      withWriteBetween(
        async () => {
          shown = await storefrontPageDal.showSectionAgain({
            id: pageId,
            storefrontId,
            sectionId: "newsletter",
            expectedDraftVersion: 3,
            createdBy: "merchant",
          });
        },
        () => save({ publish: true }),
      ),
    ).rejects.toThrow(PAGE_DRAFT_VERSION_MISMATCH);
    expect(shown).toMatchObject({ kind: "shown", version: 4 });
    const after = await state();
    // The draft is Show again's, the newsletter shown; nothing was
    // published, the title is unchanged, and no v5 exists.
    expect(after.revisions.map((r) => (r as { version: number }).version)).toEqual([3, 4]);
    const draft = after.revisions[1] as { id: string; document: string };
    expect(after.page).toMatchObject({
      title: "About",
      draft_revision_id: draft.id,
      published_revision_id: (after.revisions[0] as { id: string }).id,
    });
    expect(JSON.parse(draft.document).sections[1].enabled).toBe(true);
  });

  it("judges a hide against the draft whose version it was given", async () => {
    const shownDraft = hiddenDocument();
    shownDraft.sections[1]!.enabled = true;
    // Stale basis: refused as a conflict, not judged against a newer draft.
    await expect(
      save({ document: shownDraft, expectedDraftVersion: 2 }),
    ).rejects.toThrow(PAGE_DRAFT_VERSION_MISMATCH);
  });
});

describe("storefrontPageDal.restoreRevision", () => {
  const restore = async (expectedDraftVersion = 4) => {
    const oldest = (await state()).revisions[0] as { id: string };
    return storefrontPageDal.restoreRevision({
      id: pageId,
      storefrontId,
      revisionId: oldest.id,
      createdBy: "merchant",
      expectedDraftVersion,
    });
  };

  it("restores against the draft it read", async () => {
    await save();
    expect(await restore()).toEqual({ version: 5 });
  });

  it("refuses a stale draft version and writes nothing", async () => {
    await save();
    const before = await state();
    await expect(restore(3)).rejects.toThrow(PAGE_DRAFT_VERSION_MISMATCH);
    expect(await state()).toEqual(before);
  });

  it("writes nothing for a page deleted between its read and its write", async () => {
    await save();
    await expect(
      withWriteBetween(
        async () => {
          await run(
            "UPDATE storefront_pages SET deleted_at = ?1 WHERE id = ?2",
            NOW,
            pageId,
          );
        },
        () => restore(),
      ),
    ).rejects.toThrow(PAGE_DRAFT_VERSION_MISMATCH);
    const after = await state();
    expect(after.revisions).toHaveLength(2);
    expect(after.page).toMatchObject({
      deleted_at: NOW,
      draft_revision_id: (after.revisions[1] as { id: string }).id,
    });
  });

  it("answers null for a deleted page and writes nothing", async () => {
    await run("UPDATE storefront_pages SET deleted_at = ?1 WHERE id = ?2", NOW, pageId);
    const before = await state();
    expect(await restore(3)).toBeNull();
    expect(await state()).toEqual(before);
  });
});

describe("storefrontPageDal.updateMetadata", () => {
  it("writes against the draft it read", async () => {
    await storefrontPageDal.updateMetadata(pageId, storefrontId, { b: "2" }, 3);
    expect((await state()).page).toMatchObject({ metadata: '{"b":"2"}' });
  });

  it("refuses a stale draft version and writes nothing", async () => {
    await save();
    const before = await state();
    await expect(
      storefrontPageDal.updateMetadata(pageId, storefrontId, { b: "2" }, 3),
    ).rejects.toThrow(PAGE_DRAFT_VERSION_MISMATCH);
    expect(await state()).toEqual(before);
  });
});
