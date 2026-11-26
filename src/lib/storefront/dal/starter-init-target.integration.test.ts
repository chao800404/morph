// @vitest-environment node
/**
 * The two optional parameters the client E2E lane's seeding passes, on the
 * real D1 engine (Miniflare) with every migration applied:
 * `storefrontThemeFileDal.initStarterTheme(..., { files })` and
 * `ensureStarterHomeDocument(..., { targetVersion })`.
 *
 * Without them both behave as before; the existing DAL tests
 * (`storefront-theme-file.dal.test.ts`, `storefront.dal.test.ts`,
 * `storefront-starter-upgrade-record.dal.test.ts`) and
 * `starter-workspace-v31.test.ts` pin that. Here: what the parameters change,
 * and that every guard still runs on a given file set.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDb } from "@/db";
import { storefrontThemes } from "@/db/storefront.schema";
import { openMigratedD1 } from "@/lib/test-utils/real-d1";
import { STOREFRONT_STARTER_TEMPLATE_VERSION } from "../default-storefront-document";
import { starterThemeWorkspaceFiles } from "../starter-theme-files";
import { ensureStarterHomeDocument, storefrontDal } from "./storefront.dal";
import { storefrontThemeFileDal } from "./storefront-theme-file.dal";

let harness: Awaited<ReturnType<typeof openMigratedD1>>;
let storefrontId = "";

beforeAll(async () => {
  harness = await openMigratedD1("starter-init-target");
  await storefrontDal.ensureDefault("starter-init-target-channel");
  const row = await harness.d1
    .prepare("SELECT id FROM storefronts WHERE sales_channel_id = ?1")
    .bind("starter-init-target-channel")
    .first<{ id: string }>();
  storefrontId = row!.id;
}, 240_000);

afterAll(async () => {
  await harness?.dispose();
});

async function emptyTheme(previewRuntime: "start" | null = null) {
  const themeId = randomUUID();
  const now = new Date().toISOString();
  const db = await getDb();
  await db.insert(storefrontThemes).values({
    id: themeId,
    storefrontId,
    name: `init-target-${themeId}`,
    previewRuntime,
    metadata: {},
    createdAt: now,
    updatedAt: now,
  });
  return themeId;
}

async function storedFiles(themeId: string) {
  const { results } = await harness.d1
    .prepare(
      `SELECT path, content, mime_type, is_entry FROM storefront_theme_files
       WHERE theme_id = ?1 AND deleted_at IS NULL ORDER BY path`,
    )
    .bind(themeId)
    .all<{ path: string; content: string; mime_type: string; is_entry: number }>();
  return results;
}

async function sourceGeneration(themeId: string) {
  const row = await harness.d1
    .prepare("SELECT source_generation AS g FROM storefront_themes WHERE id = ?1")
    .bind(themeId)
    .first<{ g: number }>();
  return row!.g;
}

const GIVEN = [
  {
    path: "src/routes/index.tsx",
    content: "export default function Home() {\n  return <main>given</main>;\n}\n",
    mimeType: "text/typescript",
    isEntry: true,
  },
  {
    path: "src/styles/global.css",
    content: "body { margin: 0; }\n",
    mimeType: "text/css",
  },
];

/** Imports a server function builder: only the full Start preview runs it. */
const START_ONLY = {
  path: "src/routes/server-only.tsx",
  content:
    'import { createServerFn } from "@tanstack/react-start";\nexport const read = createServerFn().handler(async () => 1);\n',
  mimeType: "text/typescript",
};

describe("initStarterTheme with a given file set", () => {
  it("writes exactly the given files, a revision and the next source generation", async () => {
    const themeId = await emptyTheme();
    const before = await sourceGeneration(themeId);
    await storefrontThemeFileDal.initStarterTheme(
      storefrontId,
      themeId,
      "init-target-user",
      { files: GIVEN },
    );
    expect(await storedFiles(themeId)).toEqual([
      {
        path: "src/routes/index.tsx",
        content: GIVEN[0]!.content,
        mime_type: "text/typescript",
        is_entry: 1,
      },
      {
        path: "src/styles/global.css",
        content: GIVEN[1]!.content,
        mime_type: "text/css",
        is_entry: 0,
      },
    ]);
    expect(await sourceGeneration(themeId)).toBe(before + 1);
    const revisions = await harness.d1
      .prepare(
        "SELECT created_by FROM storefront_theme_revisions WHERE theme_id = ?1",
      )
      .bind(themeId)
      .all<{ created_by: string }>();
    expect(revisions.results).toEqual([{ created_by: "init-target-user" }]);
  });

  it("without the option writes the current Starter, as before", async () => {
    // From Starter 32 the current Starter's content module needs the full
    // Start preview, so its init is held to a Theme that records start (the
    // given-file cases keep a Theme that records none).
    const themeId = await emptyTheme("start");
    await storefrontThemeFileDal.initStarterTheme(storefrontId, themeId);
    const expected = [...starterThemeWorkspaceFiles()].sort((a, b) =>
      a.path < b.path ? -1 : 1,
    );
    const stored = await storedFiles(themeId);
    expect(stored.map((file) => file.path)).toEqual(
      expected.map((file) => file.path),
    );
    for (const [index, file] of expected.entries()) {
      expect(stored[index]!.content, file.path).toBe(file.content);
    }
  });

  it("refuses a Start-only file for a Theme that does not record start, and writes nothing", async () => {
    const themeId = await emptyTheme(null);
    const before = await sourceGeneration(themeId);
    await expect(
      storefrontThemeFileDal.initStarterTheme(storefrontId, themeId, undefined, {
        files: [...GIVEN, START_ONLY],
      }),
    ).rejects.toThrow(
      /^PREVIEW_RUNTIME_START_REQUIRED: src\/routes\/server-only\.tsx need/,
    );
    expect(await storedFiles(themeId)).toEqual([]);
    expect(await sourceGeneration(themeId)).toBe(before);
  });

  it("takes the Start-only file for a Theme that records start", async () => {
    const themeId = await emptyTheme("start");
    await storefrontThemeFileDal.initStarterTheme(storefrontId, themeId, undefined, {
      files: [...GIVEN, START_ONLY],
    });
    expect((await storedFiles(themeId)).map((file) => file.path)).toEqual([
      "src/routes/index.tsx",
      "src/routes/server-only.tsx",
      "src/styles/global.css",
    ]);
  });

  it("writes nothing into a workspace that has files", async () => {
    const themeId = await emptyTheme();
    await storefrontThemeFileDal.initStarterTheme(storefrontId, themeId, undefined, {
      files: GIVEN.slice(0, 1),
    });
    const generation = await sourceGeneration(themeId);
    const returned = await storefrontThemeFileDal.initStarterTheme(
      storefrontId,
      themeId,
      undefined,
      { files: GIVEN },
    );
    expect(returned.map((file) => file.path)).toEqual(["src/routes/index.tsx"]);
    expect((await storedFiles(themeId)).map((file) => file.path)).toEqual([
      "src/routes/index.tsx",
    ]);
    expect(await sourceGeneration(themeId)).toBe(generation);
  });

  it("refuses a Theme of another storefront", async () => {
    const themeId = await emptyTheme();
    await expect(
      storefrontThemeFileDal.initStarterTheme(randomUUID(), themeId, undefined, {
        files: GIVEN,
      }),
    ).rejects.toThrow("Theme not found or does not belong to storefront");
    expect(await storedFiles(themeId)).toEqual([]);
  });
});

describe("ensureStarterHomeDocument with a target version", () => {
  async function metadataOf(themeId: string) {
    const row = await harness.d1
      .prepare("SELECT metadata FROM storefront_themes WHERE id = ?1")
      .bind(themeId)
      .first<{ metadata: string }>();
    return JSON.parse(row!.metadata) as Record<string, unknown>;
  }

  async function templateTypes(themeId: string) {
    const { results } = await harness.d1
      .prepare(
        "SELECT type FROM storefront_theme_templates WHERE theme_id = ?1 AND deleted_at IS NULL ORDER BY type",
      )
      .bind(themeId)
      .all<{ type: string }>();
    return results.map((row) => row.type);
  }

  it("records the target, not the current Starter, and creates the three templates", async () => {
    const themeId = await emptyTheme();
    const db = await getDb();
    const outcome = await ensureStarterHomeDocument(db, themeId, {
      filesSaved: true,
      storefrontId,
      record: true,
      targetVersion: 7,
    });
    expect(outcome).toEqual({
      status: "recorded",
      version: 7,
      revision: 1,
      attempts: 1,
    });
    expect(await metadataOf(themeId)).toEqual({
      starterTemplateVersion: 7,
      starterUpgradeRecordRevision: 1,
    });
    expect(await templateTypes(themeId)).toEqual(["index", "layout", "product"]);

    // At or above its target the record is left alone (its CAS rule).
    expect(
      await ensureStarterHomeDocument(db, themeId, {
        filesSaved: true,
        storefrontId,
        record: true,
        targetVersion: 7,
      }),
    ).toEqual({ status: "already-current", storedVersion: 7 });
    expect(await templateTypes(themeId)).toEqual(["index", "layout", "product"]);
  });

  it("without a target records the current Starter, as before", async () => {
    const themeId = await emptyTheme();
    const db = await getDb();
    const outcome = await ensureStarterHomeDocument(db, themeId, {
      filesSaved: true,
      storefrontId,
      record: true,
    });
    expect(outcome).toMatchObject({
      status: "recorded",
      version: STOREFRONT_STARTER_TEMPLATE_VERSION,
    });
    expect((await metadataOf(themeId)).starterTemplateVersion).toBe(
      STOREFRONT_STARTER_TEMPLATE_VERSION,
    );
  });

  it("never lowers a recorded version to the target", async () => {
    const themeId = await emptyTheme();
    const db = await getDb();
    await ensureStarterHomeDocument(db, themeId, {
      filesSaved: true,
      storefrontId,
      record: true,
      targetVersion: 9,
    });
    expect(
      await ensureStarterHomeDocument(db, themeId, {
        filesSaved: true,
        storefrontId,
        record: true,
        targetVersion: 3,
      }),
    ).toEqual({ status: "already-current", storedVersion: 9 });
    expect((await metadataOf(themeId)).starterTemplateVersion).toBe(9);
  });
});
