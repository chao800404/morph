// @vitest-environment node
/**
 * The client lane's seeding (`client-lane-theme-seed.ts`), as
 * `scripts/client-lane-theme/seed.ts` runs it per slot, on the real D1 engine
 * (Miniflare) with every migration applied, judged by the guard's own
 * `clientLaneThemeRefusal` against the pinned Starter 31 fixture.
 *
 * It must produce exactly the fixture and the three templates, and it must
 * fail, saying why, when the file set is not Starter 31's: the negative
 * controls mix in a later-only file, a Start-only file, and a changed byte.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CLIENT_LANE_STARTER_FIXTURE,
  CLIENT_LANE_STARTER_VERSION as GUARD_STARTER_VERSION,
  clientLaneThemeRefusal,
  contentSha256,
  fixtureFileDigests,
} from "../../../scripts/e2e-client-lane-guard.mjs";
import { STOREFRONT_STARTER_TEMPLATE_VERSION } from "@/lib/storefront/default-storefront-document";
import { storefrontDal } from "@/lib/storefront/dal/storefront.dal";
import {
  LEGACY_STARTER_THEME_CONTENT_MODULE_V31_SOURCE,
  STARTER_THEME_CONTENT_MODULE_SOURCE,
} from "@/lib/storefront/starter-theme-v3-files";
import {
  CLIENT_LANE_STARTER_VERSION,
  readClientLaneTheme,
  seedVerifiedClientLaneTheme,
  type ClientLaneQuery,
} from "./client-lane-theme-seed";
import { openMigratedD1 } from "./real-d1";
import type {
  StarterWorkspaceFile,
  StarterWorkspaceFixture,
} from "./starter-workspace-d1";

const fixtureText = readFileSync(
  join(process.cwd(), CLIENT_LANE_STARTER_FIXTURE),
  "utf8",
);
const fixture = JSON.parse(fixtureText) as StarterWorkspaceFixture;
const expected = fixtureFileDigests(fixtureText);

let harness: Awaited<ReturnType<typeof openMigratedD1>>;
let storefrontId = "";
let query: ClientLaneQuery;

beforeAll(async () => {
  harness = await openMigratedD1("client-lane-seed");
  await storefrontDal.ensureDefault("client-lane-seed-channel");
  const row = await harness.d1
    .prepare("SELECT id FROM storefronts WHERE sales_channel_id = ?1")
    .bind("client-lane-seed-channel")
    .first<{ id: string }>();
  storefrontId = row!.id;
  query = async (sql, params) =>
    (
      await harness.d1
        .prepare(sql)
        .bind(...params)
        .all<Record<string, unknown>>()
    ).results;
}, 240_000);

afterAll(async () => {
  await harness?.dispose();
});

function seed(files: readonly StarterWorkspaceFile[]) {
  const themeId = randomUUID();
  return {
    themeId,
    run: seedVerifiedClientLaneTheme(
      {
        storefrontId,
        themeId,
        name: `client-lane-${themeId}`,
        createdBy: "client-lane-seed-user",
        files,
      },
      {
        query,
        sha256: contentSha256,
        refusal: (evidence) => clientLaneThemeRefusal(evidence, expected),
      },
    ),
  };
}

const file = (path: string, content: string): StarterWorkspaceFile => ({
  path,
  mimeType: "text/typescript",
  encoding: "utf8",
  isEntry: false,
  content,
});

describe("seeding a client-lane Theme", () => {
  it("produces exactly the Starter 31 fixture, no recorded runtime, Starter 31 and the three templates", async () => {
    const { themeId, run } = seed(fixture.files);
    const { seeded, indexTemplateId } = await run;
    expect(seeded.rows).toBe(1);
    expect(seeded.previewRuntime).toBeNull();
    expect(seeded.framework).toBeNull();
    expect(seeded.starterTemplateVersion).toBe(31);
    expect(seeded.files).toEqual(expected);
    expect(
      seeded.templates.map((template) => [template.type, template.routePath]),
    ).toEqual([
      ["index", null],
      ["layout", null],
      ["product", null],
    ]);
    expect(indexTemplateId).toBe(
      seeded.templates.find((template) => template.type === "index")!.id,
    );
    // The bytes themselves, not only their hashes.
    const { results } = await harness.d1
      .prepare(
        "SELECT path, content FROM storefront_theme_files WHERE theme_id = ?1 AND deleted_at IS NULL ORDER BY path",
      )
      .bind(themeId)
      .all<{ path: string; content: string }>();
    expect(results).toEqual(
      [...fixture.files]
        .sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)))
        .map(({ path, content }) => ({ path, content })),
    );
    // The init revision is recorded under the given user.
    const revision = await harness.d1
      .prepare("SELECT created_by FROM storefront_theme_revisions WHERE theme_id = ?1")
      .bind(themeId)
      .first<{ created_by: string }>();
    expect(revision).toEqual({ created_by: "client-lane-seed-user" });
  });

  it("refuses, naming the file, when a file Starter 31 does not have is mixed in", async () => {
    const { run } = seed([
      ...fixture.files,
      file(
        "src/routes/later-only.tsx",
        "export default function LaterOnly() {\n  return null;\n}\n",
      ),
    ]);
    await expect(run).rejects.toThrow(
      /^CLIENT_LANE_THEME_NOT_STARTER_31: Theme [0-9a-f-]{36} holds files Starter 31 does not: src\/routes\/later-only\.tsx\.$/,
    );
  });

  it("refuses a Start-only file before writing anything: the Theme records no runtime", async () => {
    const { themeId, run } = seed([
      ...fixture.files,
      file(
        "src/routes/server-read.tsx",
        'import { createServerFn } from "@tanstack/react-start";\nexport const read = createServerFn().handler(async () => 1);\n',
      ),
    ]);
    await expect(run).rejects.toThrow(
      /^PREVIEW_RUNTIME_START_REQUIRED: src\/routes\/server-read\.tsx need/,
    );
    const evidence = await readClientLaneTheme(
      query,
      { storefrontId, themeId },
      contentSha256,
    );
    expect(evidence.files).toEqual([]);
    expect(clientLaneThemeRefusal(evidence, expected)).toMatch(
      /lacks files of Starter 31/,
    );
  });

  it("stays on Starter 31 while the current Starter is 32", () => {
    // The bump to 32 moves neither the lane's version nor its fixture.
    expect(STOREFRONT_STARTER_TEMPLATE_VERSION).toBe(32);
    expect(CLIENT_LANE_STARTER_VERSION).toBe(31);
    expect(GUARD_STARTER_VERSION).toBe(31);
    expect(fixture.starterVersion).toBe(31);
    expect(
      fixture.files.find((entry) => entry.path === "src/morph/content.ts")
        ?.content,
    ).toBe(LEGACY_STARTER_THEME_CONTENT_MODULE_V31_SOURCE);
  });

  it("refuses Starter 32's own content module before writing anything, and the guard names it", async () => {
    // The fixture with the shipped (Starter 32) module in place of 31's: the
    // seed's init refuses it on a Theme that records no runtime, and a Theme
    // holding it is not the lane's.
    const files = fixture.files.map((entry) =>
      entry.path === "src/morph/content.ts"
        ? { ...entry, content: STARTER_THEME_CONTENT_MODULE_SOURCE }
        : entry,
    );
    const { themeId, run } = seed(files);
    await expect(run).rejects.toThrow(
      /^PREVIEW_RUNTIME_START_REQUIRED: src\/morph\/content\.ts need/,
    );
    const evidence = await readClientLaneTheme(
      query,
      { storefrontId, themeId },
      contentSha256,
    );
    expect(evidence.files).toEqual([]);

    const holdingV32 = {
      ...evidence,
      starterTemplateVersion: 31,
      files: expected.map((entry) =>
        entry.path === "src/morph/content.ts"
          ? { ...entry, sha256: contentSha256(STARTER_THEME_CONTENT_MODULE_SOURCE) }
          : entry,
      ),
    };
    expect(clientLaneThemeRefusal(holdingV32, expected)).toMatch(
      /src\/morph\/content\.ts: sha256 "[0-9a-f]{64}", not "[0-9a-f]{64}"/,
    );
  });

  it("refuses a changed byte, naming the file", async () => {
    const files = fixture.files.map((entry) =>
      entry.path === "src/morph/content.ts"
        ? { ...entry, content: `${entry.content}\n` }
        : entry,
    );
    const { run } = seed(files);
    await expect(run).rejects.toThrow(
      /src\/morph\/content\.ts: sha256 "[0-9a-f]{64}", not "[0-9a-f]{64}"/,
    );
  });
});
