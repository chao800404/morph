/**
 * The Starter upgrade does not replace an untouched home route with one whose
 * imports the workspace cannot satisfy.
 *
 * The current home route imports `content` and `isSectionHidden` from
 * `src/morph/content.ts`, which is the author's file (rule 01 §4.4), and six
 * section components. Replacing the route by its bytes alone wrote those
 * imports into workspaces whose module did not declare them, or whose
 * components had been deleted: a workspace that built before the upgrade did
 * not build after it.
 */
import { describe, expect, it } from "vitest";
import { readContentModuleValueImports } from "./ast/theme-content-module";
import {
  createStarterThemeWorkspaceUpgrade,
  createStarterThemeWorkspaceUpgradePlan,
  STARTER_THEME_FILES_WITH_LEGACY_MANIFEST,
} from "./starter-theme-files";
import {
  LEGACY_STARTER_THEME_CONTENT_MODULE_SOURCE,
  LEGACY_STARTER_THEME_HOME_ROUTE_ALWAYS_VISIBLE_SOURCE,
  STARTER_THEME_CONTENT_MODULE_SOURCE,
  STARTER_THEME_HOME_ROUTE_SOURCE,
} from "./starter-theme-v3-files";

const HOME = "src/routes/index.tsx";
const CONTENT = "src/morph/content.ts";

type File = { id: string; path: string; content: string; version: number };

/**
 * A manifest-era workspace, the shape that still carries the legacy home
 * route, with the route set to the slot-bound, always-visible generation.
 */
const workspace = (...edits: Array<(files: File[]) => File[]>): File[] =>
  edits.reduce(
    (files, edit) => edit(files),
    STARTER_THEME_FILES_WITH_LEGACY_MANIFEST.map((file, index) => ({
      id: `file-${index}`,
      path: file.path,
      content:
        file.path === HOME
          ? LEGACY_STARTER_THEME_HOME_ROUTE_ALWAYS_VISIBLE_SOURCE
          : file.content,
      version: 1,
    })),
  );
const setContent = (path: string, content: string) => (files: File[]) =>
  files.map((file) => (file.path === path ? { ...file, content } : file));
const without = (path: string) => (files: File[]) =>
  files.filter((file) => file.path !== path);

const plannedHome = (files: File[]) =>
  createStarterThemeWorkspaceUpgrade(files).find((file) => file.path === HOME);

describe("the home route upgrade and what the new route imports", () => {
  it("imports exactly these from the content module, so these are what is checked", () => {
    // Pinned so a Starter that imports something else from the module is a
    // decision, not a silent widening of what the upgrade writes.
    expect(
      readContentModuleValueImports(HOME, STARTER_THEME_HOME_ROUTE_SOURCE),
    ).toEqual(["content", "isSectionHidden"]);
  });

  it("replaces an untouched route when the module declares both functions, guarded by its id and version", () => {
    const files = workspace(
      setContent(CONTENT, STARTER_THEME_CONTENT_MODULE_SOURCE),
    );
    const home = files.find((file) => file.path === HOME)!;
    expect(plannedHome(files)).toMatchObject({
      content: STARTER_THEME_HOME_ROUTE_SOURCE,
      expectedFileId: home.id,
      expectedVersion: home.version,
    });
  });

  it("replaces it when the same plan replaces an untouched module that lacks isSectionHidden", () => {
    expect(LEGACY_STARTER_THEME_CONTENT_MODULE_SOURCE).not.toContain(
      "isSectionHidden",
    );
    const files = workspace(
      setContent(CONTENT, LEGACY_STARTER_THEME_CONTENT_MODULE_SOURCE),
    );
    const upgrades = createStarterThemeWorkspaceUpgrade(files);
    expect(upgrades.find((file) => file.path === CONTENT)?.content).toBe(
      STARTER_THEME_CONTENT_MODULE_SOURCE,
    );
    expect(upgrades.find((file) => file.path === HOME)?.content).toBe(
      STARTER_THEME_HOME_ROUTE_SOURCE,
    );
    // Both in one plan, each guarded by the id and version it was read at,
    // saved as one batch: either both land or neither does.
    for (const path of [CONTENT, HOME]) {
      const before = files.find((file) => file.path === path)!;
      expect(upgrades.find((file) => file.path === path)).toMatchObject({
        expectedFileId: before.id,
        expectedVersion: before.version,
      });
    }
  });

  it("leaves the route when the author's module has no isSectionHidden", () => {
    const authored = `${LEGACY_STARTER_THEME_CONTENT_MODULE_SOURCE}\n// edited by the author\n`;
    expect(authored).not.toContain("isSectionHidden");
    const files = workspace(setContent(CONTENT, authored));
    const upgrades = createStarterThemeWorkspaceUpgrade(files);
    expect(upgrades.find((file) => file.path === HOME)).toBeUndefined();
    // And the author's module is not replaced to make room for it.
    expect(upgrades.find((file) => file.path === CONTENT)).toBeUndefined();
  });

  it("leaves the route when the author's module has no content()", () => {
    const authored = STARTER_THEME_CONTENT_MODULE_SOURCE.replace(
      "export function content(",
      "function readSlot(",
    );
    expect(authored).not.toBe(STARTER_THEME_CONTENT_MODULE_SOURCE);
    expect(
      plannedHome(workspace(setContent(CONTENT, authored))),
    ).toBeUndefined();
  });

  for (const [name, declaration] of [
    ["a value that is not a function", "export const isSectionHidden = true;"],
    [
      "a re-export it cannot follow",
      'export { isSectionHidden } from "./visibility";',
    ],
    ["a factory's result", "export const isSectionHidden = makeVisibility();"],
  ] as const) {
    it(`leaves the route when isSectionHidden is ${name}`, () => {
      const authored = `${LEGACY_STARTER_THEME_CONTENT_MODULE_SOURCE}\n${declaration}\n`;
      expect(
        plannedHome(workspace(setContent(CONTENT, authored))),
      ).toBeUndefined();
    });
  }

  it("checks the module the plan leaves, including one the plan adds back", () => {
    // A manifest-era workspace without the module gets it seeded by the same
    // plan (`expectMissing`), so the route's imports are there afterwards.
    // The guard reads the workspace as the plan leaves it, not as it was.
    const upgrades = createStarterThemeWorkspaceUpgrade(
      workspace(without(CONTENT)),
    );
    expect(upgrades.find((file) => file.path === CONTENT)).toMatchObject({
      expectMissing: true,
    });
    expect(upgrades.find((file) => file.path === HOME)?.content).toBe(
      STARTER_THEME_HOME_ROUTE_SOURCE,
    );
  });

  it("leaves the route when a section component it imports was deleted", () => {
    // Hero has been in every workspace since the first Starter and no upgrade
    // adds it back, so a deleted one stays deleted after the plan.
    const files = workspace(
      setContent(CONTENT, STARTER_THEME_CONTENT_MODULE_SOURCE),
      without("src/components/Hero.tsx"),
    );
    const upgrades = createStarterThemeWorkspaceUpgrade(files);
    expect(
      upgrades.some((file) => file.path === "src/components/Hero.tsx"),
    ).toBe(false);
    expect(upgrades.find((file) => file.path === HOME)).toBeUndefined();
  });

  it("counts a component the same plan adds back", () => {
    // Newsletter at its old path is restored by the manifest-era upgrade, so
    // the route's import of it is satisfied once the plan lands.
    const upgrades = createStarterThemeWorkspaceUpgrade(
      workspace(
        setContent(CONTENT, STARTER_THEME_CONTENT_MODULE_SOURCE),
        without("src/components/Newsletter.tsx"),
      ),
    );
    expect(
      upgrades.find((file) => file.path === "src/components/Newsletter.tsx"),
    ).toMatchObject({ expectMissing: true });
    expect(upgrades.find((file) => file.path === HOME)?.content).toBe(
      STARTER_THEME_HOME_ROUTE_SOURCE,
    );
  });

  it("leaves a route the author edited, whatever the module holds", () => {
    const files = workspace(
      setContent(CONTENT, STARTER_THEME_CONTENT_MODULE_SOURCE),
      setContent(
        HOME,
        `${LEGACY_STARTER_THEME_HOME_ROUTE_ALWAYS_VISIBLE_SOURCE}\n// authored\n`,
      ),
    );
    expect(plannedHome(files)).toBeUndefined();
  });

  it("keeps the full plan consistent: a route left alone is not adopted onto page-owned copies either", () => {
    const authored = `${LEGACY_STARTER_THEME_CONTENT_MODULE_SOURCE}\n// edited by the author\n`;
    const plan = createStarterThemeWorkspaceUpgradePlan(
      workspace(setContent(CONTENT, authored)),
    );
    expect(plan.files.find((file) => file.path === HOME)).toBeUndefined();
  });
});
