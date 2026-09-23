import { describe, expect, it } from "vitest";
import { readThemeFileImportTargets } from "./ast/theme-file-move";
import { deriveThemeRouteSections } from "./compiler/theme-route-sections";
import { listSectionTemplateSourcePaths } from "./editor/page-section-copy";
import {
  createStarterThemeWorkspaceBootstrapPlan,
  createStarterThemeWorkspaceUpgradePlan,
  STARTER_THEME_FILES,
  starterThemeWorkspaceFiles,
} from "./starter-theme-files";
import { STARTER_THEME_HOME_ROUTE_SOURCE } from "./starter-theme-v3-files";

const HOME = "src/routes/index.tsx";

function asExisting(files: ReadonlyArray<{ path: string; content: string }>) {
  return files.map((file, index) => ({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    path: file.path,
    content: file.content,
    version: 1,
  }));
}

/** Every home section renders source Design mode may write. */
function expectEditableHome(
  files: ReadonlyArray<{ path: string; content: string }>,
) {
  const sections = deriveThemeRouteSections(files, HOME);
  expect(sections.diagnostics).toEqual([]);
  expect(sections.sections).toHaveLength(6);
  const templates = listSectionTemplateSourcePaths(files);
  for (const section of sections.sections) {
    expect(section.componentSourcePath).toBe(
      `src/components/page-sections/index/${section.slotId}/index.tsx`,
    );
    expect(templates.has(section.componentSourcePath)).toBe(false);
  }
}

describe("Starter home on page-owned sections", () => {
  it("starts new workspaces with every home section on its own copy", () => {
    const files = starterThemeWorkspaceFiles();
    expectEditableHome(files);
    // The library is still there to add from, and nothing live renders it.
    const home = files.find((file) => file.path === HOME)!.content;
    expect(home).not.toContain("../components/Hero\"");
    expect(
      files.some((file) => file.path === "src/components/sections/Hero.tsx"),
    ).toBe(true);
  });

  it("keeps the section implementations in the library itself", () => {
    const files = starterThemeWorkspaceFiles();
    const paths = new Set(files.map((file) => file.path));
    for (const name of [
      "Hero",
      "EditorialIntro",
      "CategoryShowcase",
      "ImageWithText",
      "Principles",
      "Newsletter",
    ]) {
      expect(paths.has(`src/components/${name}.tsx`)).toBe(false);
      const entry = files.find(
        (file) => file.path === `src/components/sections/${name}.tsx`,
      );
      expect(entry?.content).toContain("export default function");
    }
  });

  it("leaves no import pointing at a file the workspace does not have", () => {
    const files = starterThemeWorkspaceFiles();
    const paths = new Set(files.map((file) => file.path));
    const broken: string[] = [];
    for (const file of files) {
      if (!/\.(tsx|ts)$/.test(file.path)) continue;
      const targets = readThemeFileImportTargets(file.path, file.content, paths);
      expect(targets, `${file.path} parses`).not.toBeNull();
      for (const target of targets ?? []) {
        // The route tree is generated at build time, never stored.
        if (target.specifier.endsWith("/routeTree.gen")) continue;
        if (target.specifier.startsWith(".") && target.resolvedPath === null) {
          broken.push(`${file.path} -> ${target.specifier}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it("copies the implementation, not the library's re-export", () => {
    const hero = starterThemeWorkspaceFiles().find(
      (file) =>
        file.path === "src/components/page-sections/index/starter-hero/index.tsx",
    );
    expect(hero?.content).toContain("export default function Hero");
    expect(hero?.content).toContain("export const contentFields");
  });

  it("adopts an existing workspace whose home route is untouched", () => {
    const existing = asExisting(STARTER_THEME_FILES);
    const plan = createStarterThemeWorkspaceUpgradePlan(existing);
    const byPath = new Map(existing.map((file) => [file.path, file.content]));
    for (const file of plan.files) byPath.set(file.path, file.content);
    expectEditableHome(
      [...byPath].map(([path, content]) => ({ path, content })),
    );

    const route = plan.files.find((file) => file.path === HOME);
    expect(route).toMatchObject({ expectedVersion: 1 });
    expect(
      plan.files
        .filter((file) => file.path.includes("/page-sections/"))
        .every((file) => file.expectMissing === true),
    ).toBe(true);
  });

  it("is idempotent once the home route has been adopted", () => {
    const plan = createStarterThemeWorkspaceUpgradePlan(
      asExisting(starterThemeWorkspaceFiles()),
    );
    expect(
      plan.files.filter(
        (file) =>
          file.path === HOME || file.path.includes("/page-sections/"),
      ),
    ).toEqual([]);
  });

  it("leaves an authored home route to its author", () => {
    const authored = STARTER_THEME_FILES.map((file) =>
      file.path === HOME
        ? { ...file, content: `${STARTER_THEME_HOME_ROUTE_SOURCE}// mine\n` }
        : file,
    );
    const plan = createStarterThemeWorkspaceUpgradePlan(asExisting(authored));
    expect(
      plan.files.filter(
        (file) =>
          file.path === HOME || file.path.includes("/page-sections/"),
      ),
    ).toEqual([]);
  });

  it("adopts the home route the one-click bootstrap creates", () => {
    const plan = createStarterThemeWorkspaceBootstrapPlan([]);
    expectEditableHome(plan.files);
  });
});
