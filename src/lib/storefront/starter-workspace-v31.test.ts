// @vitest-environment node
/**
 * Pins `__fixtures__/starter-workspace/v31.json` to the workspace a new
 * Theme really starts with at Starter version 31.
 *
 * The fixture is not assembled from the Starter's source lists: it is what
 * the product's own initialisation (`storefrontDal.ensureDefault` ->
 * `ensureStarterThemeWorkspace` -> `storefrontThemeFileDal.initStarterTheme`)
 * stored in `storefront_theme_files` on a fresh, fully migrated local D1
 * (`src/lib/test-utils/starter-workspace-d1.ts`). This test runs that same
 * init again and requires the same paths and the same bytes, file by file.
 *
 * Every run writes what the init produced to `PRODUCED_FIXTURE_PATH` in the
 * fixture's format; that is how the fixture is regenerated (copy it over the
 * fixture, set `sourceCommit`), and only while the Starter is version 31.
 *
 * When the Starter version is bumped past 31 the "is what the init produces
 * today" cases are expected to change (the version case fails first); the
 * fixture itself never changes, because the client-runtime CI lane keeps its
 * shared Theme on what Starter 31 really created.
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
import { STARTER_THEME_CONTENT_MODULE_SOURCE } from "./starter-theme-v3-files";

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

  it("is what the init produces while the Starter is version 31", () => {
    expect(STOREFRONT_STARTER_TEMPLATE_VERSION).toBe(31);
    expect(produced.metadata.starterTemplateVersion).toBe(31);

    expect(produced.files.map((file) => file.path).sort()).toEqual(
      fixture.files.map((file) => file.path).sort(),
    );
    const byPath = new Map(produced.files.map((file) => [file.path, file]));
    for (const file of fixture.files) {
      const actual = byPath.get(file.path)!;
      expect(actual.content, file.path).toBe(file.content);
      expect(actual.mimeType, file.path).toBe(file.mimeType);
      expect(actual.encoding, file.path).toBe(file.encoding);
      expect(actual.isEntry, file.path).toBe(file.isEntry);
    }
    expect(filesSha256(produced.files)).toBe(fixture.sha256);
  });

  it("holds the content module the init writes", () => {
    const pinned = fixture.files.find(
      (file) => file.path === CONTENT_MODULE_PATH,
    );
    const written = produced.files.find(
      (file) => file.path === CONTENT_MODULE_PATH,
    );
    expect(pinned).toBeDefined();
    expect(written).toBeDefined();
    expect(pinned!.content).toBe(written!.content);
    expect(pinned!.content).toBe(STARTER_THEME_CONTENT_MODULE_SOURCE);
  });
});
