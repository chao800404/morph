/**
 * Pins `__fixtures__/starter-history/v31.json` to the Starter this branch
 * ships.
 *
 * The fixture holds the files a new Theme was created with at Starter version
 * 31 (the files of e26882e, the commit before Starter 32 shipped). While
 * `STOREFRONT_STARTER_TEMPLATE_VERSION` is 31 the current Starter IS that
 * workspace, so the fixture must equal it byte for byte, content module
 * included. The client-runtime CI lane keeps its shared Theme on these files
 * after the current Starter moves on, so the fixture must not drift from what
 * Starter 31 really was.
 *
 * When the Starter version is bumped past 31 this file's "is the current
 * Starter" cases are expected to be replaced by "is the current Starter apart
 * from ..." ones (as `starter-history-upgrade.test.ts` does for 28 and 29);
 * the fixture itself never changes.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { STOREFRONT_STARTER_TEMPLATE_VERSION } from "./default-storefront-document";
import { STARTER_THEME_CATALOG_FILES } from "./starter-theme-catalog-files";
import {
  STARTER_THEME_FILES,
  starterThemeWorkspaceFiles,
} from "./starter-theme-files";

type Fixture = {
  starterVersion: number;
  sourceCommit: string;
  sourcePath: string;
  sha256: string;
  files: { path: string; mimeType: string; content: string }[];
};

const CONTENT_MODULE_PATH = "src/morph/content.ts";

/**
 * The sources the fixture was taken from (its `sourcePath`): the Starter's
 * files and the catalog files. `starterThemeWorkspaceFiles()` adds the
 * page-owned section files the home route adopts on top of these; those are
 * checked separately, by the content module case below.
 */
function currentStarterFiles(): Array<{
  path: string;
  content: string;
  mimeType: string;
}> {
  return [...STARTER_THEME_FILES, ...STARTER_THEME_CATALOG_FILES];
}

const fixture = JSON.parse(
  readFileSync(
    join(__dirname, "__fixtures__", "starter-history", "v31.json"),
    "utf8",
  ),
) as Fixture;

describe("Starter 31 history fixture", () => {
  it("records Starter 31 and the commit it was taken from", () => {
    expect(fixture.starterVersion).toBe(31);
    expect(fixture.sourceCommit).toBe(
      "e26882ec59c69c258e065fc56e3be5d8ff6a3c2e",
    );
    expect(fixture.sourcePath).toContain("STARTER_THEME_FILES");
    expect(fixture.sourcePath).toContain("STARTER_THEME_CATALOG_FILES");
    expect(new Set(fixture.files.map((file) => file.path)).size).toBe(
      fixture.files.length,
    );
  });

  it("keeps the bytes its recorded hash names", () => {
    const hash = createHash("sha256")
      .update(JSON.stringify(fixture.files), "utf8")
      .digest("hex");
    expect(hash).toBe(fixture.sha256);
  });

  it("is the current Starter's files and catalog files while the Starter is version 31", () => {
    expect(STOREFRONT_STARTER_TEMPLATE_VERSION).toBe(31);
    const current = new Map(
      currentStarterFiles().map((file) => [file.path, file]),
    );
    expect([...current.keys()].sort()).toEqual(
      fixture.files.map((file) => file.path).sort(),
    );
    for (const file of fixture.files) {
      expect(file.content, file.path).toBe(current.get(file.path)!.content);
      expect(file.mimeType, file.path).toBe(current.get(file.path)!.mimeType);
    }
  });

  it("holds the content module the current Starter ships", () => {
    const pinned = fixture.files.find(
      (file) => file.path === CONTENT_MODULE_PATH,
    );
    const current = starterThemeWorkspaceFiles().find(
      (file) => file.path === CONTENT_MODULE_PATH,
    );
    expect(pinned).toBeDefined();
    expect(current).toBeDefined();
    expect(pinned!.content).toBe(current!.content);
  });
});
