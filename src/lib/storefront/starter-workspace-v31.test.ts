// @vitest-environment node
/**
 * Pins `__fixtures__/starter-workspace/v31.json` to the workspace a new
 * Theme really starts with at Starter version 31.
 *
 * The fixture is not assembled from the Starter's source lists: it is what
 * the product's own initialisation (`storefrontDal.ensureDefault` ->
 * `ensureStarterThemeWorkspace` -> `storefrontThemeFileDal.initStarterTheme`)
 * stored in `storefront_theme_files` on a fresh, fully migrated local D1
 * (`src/lib/test-utils/starter-workspace-d1.ts`), at `sourceCommit`, while
 * the Starter was version 31.
 *
 * The Starter is 32 now, and the fixture never changes: the client-runtime
 * CI lane keeps its dedicated Themes on what Starter 31 really created. This
 * test runs today's init again and requires that it differs from the fixture
 * only where Starter 32 changed the Starter: the same paths, and the same
 * bytes file by file except `src/morph/content.ts`, which is Starter 31's
 * module (kept verbatim as LEGACY_STARTER_THEME_CONTENT_MODULE_V31_SOURCE) in
 * the fixture and 32's in today's workspace.
 *
 * Every run writes what the init produced to `PRODUCED_FIXTURE_PATH` in the
 * fixture's format, for a reader comparing the two; it is not copied over
 * this fixture.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import {
  canonicalFiles,
  filesSha256,
  PRODUCED_BY,
  PRODUCED_FIXTURE_PATH,
  produceStarterWorkspace,
  type ProducedStarterWorkspace,
  type StarterWorkspaceFixture,
} from "@/lib/test-utils/starter-workspace-d1";
import { STOREFRONT_STARTER_TEMPLATE_VERSION } from "./default-storefront-document";
import {
  LEGACY_STARTER_THEME_CONTENT_MODULE_V31_SOURCE,
  STARTER_THEME_CONTENT_MODULE_SOURCE,
} from "./starter-theme-v3-files";

const CONTENT_MODULE_PATH = "src/morph/content.ts";

const fixture = JSON.parse(
  readFileSync(
    join(__dirname, "__fixtures__", "starter-workspace", "v31.json"),
    "utf8",
  ),
) as StarterWorkspaceFixture;

let produced: ProducedStarterWorkspace;

beforeAll(async () => {
  produced = await produceStarterWorkspace();
  const regenerated: StarterWorkspaceFixture = {
    starterVersion: Number(produced.metadata.starterTemplateVersion),
    sourceCommit: "",
    producedBy: PRODUCED_BY,
    sha256: filesSha256(produced.files),
    files: JSON.parse(canonicalFiles(produced.files)),
  };
  writeFileSync(
    PRODUCED_FIXTURE_PATH,
    `${JSON.stringify(regenerated, null, 2)}\n`,
  );
}, 240_000);

describe("Starter 31 workspace fixture", () => {
  it("records Starter 31, how and where it was produced", () => {
    expect(fixture.starterVersion).toBe(31);
    expect(fixture.sourceCommit).toBe(
      "163085ca675edc692cf48099cd1b738b46d3df44",
    );
    expect(fixture.producedBy).toBe(PRODUCED_BY);
    expect(new Set(fixture.files.map((file) => file.path)).size).toBe(
      fixture.files.length,
    );
  });

  it("keeps the bytes its recorded hash names", () => {
    expect(filesSha256(fixture.files)).toBe(fixture.sha256);
  });

  it("differs from what the init produces at Starter 32 only in the content module", () => {
    expect(STOREFRONT_STARTER_TEMPLATE_VERSION).toBe(32);
    expect(produced.metadata.starterTemplateVersion).toBe(32);

    expect(produced.files.map((file) => file.path).sort()).toEqual(
      fixture.files.map((file) => file.path).sort(),
    );
    const byPath = new Map(produced.files.map((file) => [file.path, file]));
    const differing: string[] = [];
    for (const file of fixture.files) {
      const actual = byPath.get(file.path)!;
      if (actual.content !== file.content) differing.push(file.path);
      expect(actual.mimeType, file.path).toBe(file.mimeType);
      expect(actual.encoding, file.path).toBe(file.encoding);
      expect(actual.isEntry, file.path).toBe(file.isEntry);
    }
    expect(differing).toEqual([CONTENT_MODULE_PATH]);
    expect(filesSha256(produced.files)).not.toBe(fixture.sha256);
  });

  it("holds Starter 31's content module, and the init writes 32's", () => {
    const pinned = fixture.files.find(
      (file) => file.path === CONTENT_MODULE_PATH,
    );
    const written = produced.files.find(
      (file) => file.path === CONTENT_MODULE_PATH,
    );
    expect(pinned).toBeDefined();
    expect(written).toBeDefined();
    expect(pinned!.content).toBe(LEGACY_STARTER_THEME_CONTENT_MODULE_V31_SOURCE);
    expect(written!.content).toBe(STARTER_THEME_CONTENT_MODULE_SOURCE);
    expect(pinned!.content).not.toBe(written!.content);
  });
});
