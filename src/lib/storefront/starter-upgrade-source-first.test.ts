import { describe, expect, it } from "vitest";
import { normalizeRevisionSnapshot } from "./compiler/theme-build-materializer";
import { THEME_START_TOOLCHAIN } from "./compiler/theme-start-toolchain";
import {
  STARTER_THEME_FILES_WITH_LEGACY_MANIFEST,
  createStarterThemeWorkspaceUpgradePlan,
  starterThemeWorkspaceFiles,
} from "./starter-theme-files";
import {
  LEGACY_STARTER_THEME_CONTENT_MODULE_V14_SOURCE,
  STARTER_THEME_CONTENT_MODULE_SOURCE,
} from "./starter-theme-v3-files";

/**
 * The Starter upgrade on the workspaces that actually exist, built from the
 * files a store is created with, and from the manifest-era catalog, rather
 * than a hand-picked pair.
 *
 * A two-file workspace with a hand-written manifest once passed here while
 * every real source-first workspace received nothing: they have no
 * morph.theme.json, and the upgrade read "on Start" only from it.
 */

type File = { id: string; path: string; content: string; version: number };

const CONTENT = "src/morph/content.ts";
const OLD_PATH_COMPONENTS = [
  "src/components/EditorialIntro.tsx",
  "src/components/CategoryShowcase.tsx",
  "src/components/ImageWithText.tsx",
  "src/components/Newsletter.tsx",
];

const toFiles = (files: ReadonlyArray<{ path: string; content: string }>) =>
  files.map((file, index) => ({
    id: `file-${index}`,
    path: file.path,
    content: file.content,
    version: 1,
  }));

/** A workspace created today: source-first, no manifest. */
const sourceFirst = (edit: (files: File[]) => File[] = (files) => files) =>
  edit(toFiles(starterThemeWorkspaceFiles()));

/** From before source-first: a manifest, implementations at the old paths. */
const manifestEra = (edit: (files: File[]) => File[] = (files) => files) =>
  edit(toFiles(STARTER_THEME_FILES_WITH_LEGACY_MANIFEST));

const setContent = (path: string, content: string) => (files: File[]) =>
  files.map((file) => (file.path === path ? { ...file, content } : file));
const withContent = (content: string) => setContent(CONTENT, content);
const without = (path: string) => (files: File[]) =>
  files.filter((file) => file.path !== path);
const withFile = (path: string, content: string) => (files: File[]) => [
  ...files.filter((file) => file.path !== path),
  { id: `extra-${path}`, path, content, version: 1 },
];
const editPackage =
  (edit: (pkg: Record<string, Record<string, string>>) => void) =>
  (files: File[]) =>
    files.map((file) => {
      if (file.path !== "package.json") return file;
      const parsed = JSON.parse(file.content);
      edit(parsed);
      return { ...file, content: JSON.stringify(parsed, null, 2) };
    });
const compose =
  (...edits: Array<(files: File[]) => File[]>) =>
  (files: File[]) =>
    edits.reduce((current, edit) => edit(current), files);

const plan = (files: File[]) => createStarterThemeWorkspaceUpgradePlan(files);
const plannedPaths = (files: File[]) => plan(files).files.map((file) => file.path);

/** The workspace after a plan is applied, as the save would leave it. */
function applied(files: File[]): File[] {
  const result = plan(files);
  const next = new Map(files.map((file) => [file.path, file]));
  for (const deletion of result.deletions) next.delete(deletion.path);
  for (const file of result.files) {
    const before = next.get(file.path);
    next.set(file.path, {
      id: before?.id ?? `new-${file.path}`,
      path: file.path,
      content: file.content,
      version: (before?.version ?? 0) + 1,
    });
  }
  return [...next.values()];
}

/** The build's own snapshot step, which refuses an unsupported pin. */
const buildSnapshot = (files: File[]) => () =>
  normalizeRevisionSnapshot(
    files.map((file) => ({ path: file.path, content: file.content })),
    "revision-under-test",
  );

describe("Starter upgrade on a source-first workspace", () => {
  it("plans nothing for a complete, untouched workspace of the current version", () => {
    const result = plan(sourceFirst());
    expect(result.files).toEqual([]);
    expect(result.deletions).toEqual([]);
  });

  it("replaces only an untouched pre-pages content module, guarded by its id and version", () => {
    const files = sourceFirst(
      withContent(LEGACY_STARTER_THEME_CONTENT_MODULE_V14_SOURCE),
    );
    const contentFile = files.find((file) => file.path === CONTENT)!;

    const result = plan(files);

    expect(result.files).toEqual([
      expect.objectContaining({
        path: CONTENT,
        content: STARTER_THEME_CONTENT_MODULE_SOURCE,
        expectedFileId: contentFile.id,
        expectedVersion: contentFile.version,
      }),
    ]);
    expect(result.deletions).toEqual([]);
  });

  it("plans nothing a second time, once the first plan is applied", () => {
    const once = applied(
      sourceFirst(withContent(LEGACY_STARTER_THEME_CONTENT_MODULE_V14_SOURCE)),
    );
    expect(once.find((file) => file.path === CONTENT)?.content).toBe(
      STARTER_THEME_CONTENT_MODULE_SOURCE,
    );
    expect(plan(once)).toEqual({ files: [], deletions: [] });
  });

  it("leaves a content module the author edited alone", () => {
    expect(
      plannedPaths(
        sourceFirst(
          withContent(LEGACY_STARTER_THEME_CONTENT_MODULE_V14_SOURCE + "\n// mine"),
        ),
      ),
    ).toEqual([]);
  });

  it("does not add the section components back at their old paths", () => {
    const paths = plannedPaths(
      sourceFirst(withContent(LEGACY_STARTER_THEME_CONTENT_MODULE_V14_SOURCE)),
    );
    for (const path of OLD_PATH_COMPONENTS) expect(paths).not.toContain(path);
  });

  it("does not bring back a content module the author deleted", () => {
    // Restoring it is the author's explicit command, not an upgrade side effect.
    expect(plannedPaths(sourceFirst(without(CONTENT)))).not.toContain(CONTENT);
  });

  it("does not bring back a Starter route the author removed", () => {
    expect(
      plannedPaths(sourceFirst(without("src/routes/account.tsx"))),
    ).not.toContain("src/routes/account.tsx");
  });

  describe("toolchain pins", () => {
    // Created between 2026-09-23 and 2026-10-03, when the Starter wrote this.
    const stale = sourceFirst(
      editPackage((pkg) => {
        pkg.devDependencies["@cloudflare/vite-plugin"] = "1.50.0";
      }),
    );

    it("an earlier Starter pin makes the build refuse the workspace", () => {
      expect(buildSnapshot(stale)).toThrow(
        /INVALID_START_PACKAGE: .*@cloudflare\/vite-plugin must equal the supported version 1\.62\.4/,
      );
    });

    it("is brought forward, and the build then accepts the workspace", () => {
      const upgrade = plan(stale).files.find((file) => file.path === "package.json");
      expect(
        JSON.parse(upgrade!.content).devDependencies["@cloudflare/vite-plugin"],
      ).toBe(THEME_START_TOOLCHAIN.cloudflareVite);
      expect(buildSnapshot(applied(stale))).not.toThrow();
    });

    it("leaves a version the author chose, which Morph never wrote", () => {
      const authored = sourceFirst(
        editPackage((pkg) => {
          pkg.dependencies.react = "19.1.0";
          pkg.devDependencies.vite = "7.0.0";
        }),
      );
      expect(plannedPaths(authored)).not.toContain("package.json");
    });

    it("leaves the dependencies Morph does not pin", () => {
      const upgrade = plan(
        compose(
          editPackage((pkg) => {
            pkg.devDependencies["@cloudflare/vite-plugin"] = "1.50.0";
            pkg.dependencies.clsx = "9.9.9";
          }),
        )(sourceFirst()),
      ).files.find((file) => file.path === "package.json");
      expect(JSON.parse(upgrade!.content).dependencies.clsx).toBe("9.9.9");
    });
  });

  describe("telling Start from another framework", () => {
    const v14 = withContent(LEGACY_STARTER_THEME_CONTENT_MODULE_V14_SOURCE);

    it("does not treat Start-shaped files as Start when the manifest declares another framework", () => {
      const declared = withFile(
        "morph.theme.json",
        JSON.stringify({ router: { framework: "astro" }, components: {} }),
      );
      // Not one file: no replacement, no addition, no manifest entry, no
      // deletion. It began as the Starter, but it says it is not Start.
      expect(plan(sourceFirst(compose(v14, declared)))).toEqual({
        files: [],
        deletions: [],
      });
    });

    it("leaves a workspace whose package.json does not depend on Start entirely alone", () => {
      const astroPackage = editPackage((pkg) => {
        delete pkg.dependencies["@tanstack/react-start"];
        delete pkg.dependencies["@tanstack/react-router"];
        pkg.dependencies.astro = "7.3.5";
      });
      // The section components are even missing from their old paths, which
      // a Starter upgrade would otherwise add back.
      expect(
        plan(
          sourceFirst(
            compose(v14, astroPackage, without("src/components/sections/Hero.tsx")),
          ),
        ),
      ).toEqual({ files: [], deletions: [] });
    });

    it("leaves a workspace without Start's router entirely alone", () => {
      expect(
        plan(sourceFirst(compose(v14, without("src/router.tsx")))),
      ).toEqual({ files: [], deletions: [] });
    });

    it("does not infer anything past a manifest that cannot be read", () => {
      expect(
        plannedPaths(
          sourceFirst(compose(v14, withFile("morph.theme.json", "{ not json"))),
        ),
      ).not.toContain(CONTENT);
    });
  });
});

describe("Starter upgrade on a manifest-era workspace", () => {
  it("still replaces an untouched pre-pages content module", () => {
    expect(
      plan(manifestEra(withContent(LEGACY_STARTER_THEME_CONTENT_MODULE_V14_SOURCE)))
        .files.find((file) => file.path === CONTENT)?.content,
    ).toBe(STARTER_THEME_CONTENT_MODULE_SOURCE);
  });

  describe("a missing section component next to its sections/ file", () => {
    const missing = "src/components/EditorialIntro.tsx";
    const section = "src/components/sections/EditorialIntro.tsx";
    const planned = (sectionContent: string) =>
      plannedPaths(
        manifestEra(compose(without(missing), setContent(section, sectionContent))),
      );

    it("adds it back when that file is the Starter's own re-export, byte for byte", () => {
      // Morph wrote both the entry and the component it imports, so the
      // missing component is Morph's to restore.
      expect(
        planned('export { contentFields, default } from "../EditorialIntro";\n'),
      ).toContain(missing);
    });

    it.each([
      [
        "a re-export the author wrote with comments",
        '// The section library entry.\n/* keep */ export { contentFields, default } from "../EditorialIntro"; // done\n',
      ],
      [
        "a re-export the author wrote over several lines",
        'export {\n  contentFields,\n  default,\n} from "../EditorialIntro";\n',
      ],
      [
        "a re-export of everything",
        'export * from "../EditorialIntro";\nexport { default } from "../EditorialIntro";\n',
      ],
      [
        "an implementation",
        "export default function EditorialIntro() { return null; }\n",
      ],
      [
        "an implementation that also re-exports",
        'export { contentFields } from "../EditorialIntro";\nexport default function EditorialIntro() { return null; }\n',
      ],
      ["a file that does not parse", "export default function ( {\n"],
    ])("does not add it when that file is %s", (_label, content) => {
      // The author's file: a missing import is theirs to resolve, and the
      // build reports it. Restoring the Starter's component is not implied.
      expect(planned(content)).not.toContain(missing);
    });
  });
});
