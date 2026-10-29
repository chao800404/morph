/**
 * Whole-workspace history tests for the Starter Theme upgrade.
 *
 * Each fixture under `__fixtures__/starter-history/vN.json` holds the files a
 * new Theme was created with at Starter version N, byte for byte as the commit
 * that set `STOREFRONT_STARTER_TEMPLATE_VERSION` to N produced them. The
 * upgrade rules are exercised against those real old workspaces, not against
 * hand-made miniatures.
 *
 * Where the current upgrade does not do what the product claims, the test
 * says so by name: a pinned behaviour test records what happens today, and an
 * `it.fails` test states the claim and flips the moment the behaviour is
 * fixed. No product code is changed here.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeRevisionSnapshot } from "./compiler/theme-build-materializer";
import { validateThemeStartPackageContract } from "./compiler/theme-start-toolchain";
import {
  starterThemeWorkspaceFiles,
  type StarterThemeWorkspaceUpgradePlan,
} from "./starter-theme-files";
import { reviewStarterThemeUpgrade } from "./starter-theme-upgrade-review";
import { deriveThemeSourceContract } from "./theme-source-contract";

type Fixture = {
  starterVersion: number;
  sourceCommit: string;
  sourcePath: string;
  sha256: string;
  files: { path: string; mimeType: string; content: string }[];
};
type File = { id: string; path: string; content: string; version: number };

const VERSIONS = [11, 15, 20, 26, 28] as const;
const FIXTURE_DIR = join(__dirname, "__fixtures__", "starter-history");
const SOURCE_COMMITS: Record<number, string> = {
  11: "0493527792e42ccec5a6ba2dfbb146bbecc3700c",
  15: "63900d601f3646d6346e843ec842af43279bca8d",
  20: "63d8b5969bff731851b72729665a445e2ed53f38",
  26: "3007c63c10d53fe0593dbd1f2341aa6416a87d8f",
  28: "ca60a9d894c63045cde1d3a4690dbea360849801",
};

const fixtures = new Map<number, Fixture>(
  VERSIONS.map((version) => [
    version,
    JSON.parse(
      readFileSync(join(FIXTURE_DIR, `v${version}.json`), "utf8"),
    ) as Fixture,
  ]),
);

const workspace = (version: number): File[] =>
  fixtures.get(version)!.files.map((file, index) => ({
    id: `file-${index}`,
    path: file.path,
    content: file.content,
    version: 1,
  }));

/**
 * Applies a plan the way the store does: every update must name the file it
 * was planned against (id and version), every create must expect the path to
 * be free, and every delete must name its file. A plan that does not line up
 * with the workspace is a bug, so this throws.
 */
function applyPlan(
  files: File[],
  plan: StarterThemeWorkspaceUpgradePlan,
): File[] {
  const next = new Map(files.map((file) => [file.path, file]));
  for (const deletion of plan.deletions) {
    const existing = next.get(deletion.path);
    expect(existing?.id, `delete ${deletion.path}`).toBe(
      deletion.expectedFileId,
    );
    expect(existing?.version, `delete ${deletion.path}`).toBe(
      deletion.expectedVersion,
    );
    next.delete(deletion.path);
  }
  for (const write of plan.files) {
    const existing = next.get(write.path);
    if (write.expectMissing) {
      expect(existing, `create ${write.path}`).toBeUndefined();
      next.set(write.path, {
        id: `new-${write.path}`,
        path: write.path,
        content: write.content,
        version: 1,
      });
    } else {
      expect(existing, `update ${write.path}`).toBeDefined();
      expect(write.expectedFileId, `update ${write.path}`).toBe(existing!.id);
      expect(write.expectedVersion, `update ${write.path}`).toBe(
        existing!.version,
      );
      next.set(write.path, {
        ...existing!,
        content: write.content,
        version: existing!.version + 1,
      });
    }
  }
  return [...next.values()];
}

/** One upgrade pass: review, then apply the reviewed plan. */
function upgradeOnce(files: File[]) {
  const review = reviewStarterThemeUpgrade(files);
  return { review, files: applyPlan(files, review.plan) };
}

/** Upgrades until a pass changes nothing; reports how many passes changed. */
function upgradeToFixedPoint(files: File[], maxPasses = 5) {
  let current = files;
  const passes: string[][] = [];
  for (let pass = 0; pass < maxPasses; pass += 1) {
    const step = upgradeOnce(current);
    if (step.review.changes.length === 0) return { files: current, passes };
    passes.push(step.review.changes.map((change) => change.path));
    current = step.files;
  }
  throw new Error(`The upgrade did not settle within ${maxPasses} passes.`);
}

const currentStarter = new Map(
  starterThemeWorkspaceFiles().map((file) => [file.path, file.content]),
);

/** How a workspace differs from the files a Theme starts with today. */
function diffAgainstCurrent(files: File[]) {
  const have = new Map(files.map((file) => [file.path, file.content]));
  return {
    extra: [...have.keys()].filter((path) => !currentStarter.has(path)).sort(),
    differs: [...have]
      .filter(
        ([path, content]) =>
          currentStarter.has(path) && currentStarter.get(path) !== content,
      )
      .map(([path]) => path)
      .sort(),
    missing: [...currentStarter.keys()]
      .filter((path) => !have.has(path))
      .sort(),
  };
}

const sorted = (paths: string[]) => [...paths].sort();

// --- Paths the expectations below talk about -------------------------------

const FLAT_COMPONENTS = [
  "CategoryShowcase",
  "EditorialIntro",
  "Hero",
  "ImageWithText",
  "Newsletter",
  "Principles",
].map((name) => `src/components/${name}.tsx`);
const SECTION_REEXPORTS = [
  "CategoryShowcase",
  "EditorialIntro",
  "Hero",
  "ImageWithText",
  "Newsletter",
  "Principles",
].map((name) => `src/components/sections/${name}.tsx`);
const PAGE_SECTIONS = [
  "starter-categories",
  "starter-hero",
  "starter-introduction",
  "starter-newsletter",
  "starter-principles",
  "starter-story",
].map((slot) => `src/components/page-sections/index/${slot}/index.tsx`);
const MANIFEST = "morph.theme.json";

describe("Starter history fixtures", () => {
  it.each(VERSIONS)("v%i is recorded with its source and is intact", (v) => {
    const fixture = fixtures.get(v)!;
    expect(fixture.starterVersion).toBe(v);
    expect(fixture.sourceCommit).toBe(SOURCE_COMMITS[v]);
    expect(fixture.sourcePath).toContain(
      "src/lib/storefront/starter-theme-files.ts",
    );
    expect(new Set(fixture.files.map((file) => file.path)).size).toBe(
      fixture.files.length,
    );
    // The whole workspace of that version, not a subset.
    expect(fixture.files.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        "package.json",
        "src/morph/content.ts",
        "src/router.tsx",
        "src/routes/__root.tsx",
        "src/routes/index.tsx",
      ]),
    );
  });

  it("v28 is the current Starter apart from the one file version 29 changed", () => {
    const { differs, extra, missing } = diffAgainstCurrent(workspace(28));
    expect({ differs, extra, missing }).toEqual({
      differs: ["src/layouts/StorefrontLayout.tsx"],
      extra: [],
      missing: [],
    });
  });
});

describe("upgrading whole Starter workspaces from history", () => {
  // What a workspace of each version looks like after the upgrade has settled,
  // against the files a Theme starts with today. Every path not listed here
  // equals the current Starter byte for byte. Each list is what the upgrade
  // does today; the causes are noted where a list is not obviously intended.
  const EXPECTED_AFTER_UPGRADE: Record<
    number,
    { extra: string[]; differs: string[]; missing: string[] }
  > = {
    // Flat components are the author's own location; the sections/ files that
    // the upgrade adds re-export them, so those differ from the current
    // Starter's real copies. The legacy manifest is kept and merged.
    // Not recognised as a Starter copy (see the pinned tests below), so left
    // as they were: src/routes/index.tsx, and with it no page-owned sections.
    11: {
      extra: [MANIFEST, ...FLAT_COMPONENTS],
      differs: ["package.json", ...SECTION_REEXPORTS, "src/routes/index.tsx"],
      missing: PAGE_SECTIONS,
    },
    // The pristine v15 Header and Footer are not recognised: left as they were.
    15: {
      extra: [MANIFEST, ...FLAT_COMPONENTS],
      differs: [
        "package.json",
        "src/components/Footer.tsx",
        "src/components/Header.tsx",
        ...SECTION_REEXPORTS,
      ],
      missing: [],
    },
    // The pristine v20 Header and Footer are not recognised: left as they
    // were. The categories page section is copied from the v20 flat
    // CategoryShowcase, which stays at its v20 bytes.
    20: {
      extra: [MANIFEST, ...FLAT_COMPONENTS],
      differs: [
        "package.json",
        "src/components/Footer.tsx",
        "src/components/Header.tsx",
        "src/components/page-sections/index/starter-categories/index.tsx",
        ...SECTION_REEXPORTS,
      ],
      missing: [],
    },
    26: {
      extra: [MANIFEST, ...FLAT_COMPONENTS],
      differs: ["package.json", ...SECTION_REEXPORTS],
      missing: [],
    },
    28: { extra: [], differs: [], missing: [] },
  };

  /** Passes that changed something before the workspace stopped changing. */
  const PASSES_TO_SETTLE: Record<number, number> = {
    11: 1,
    15: 2,
    20: 2,
    26: 1,
    28: 1,
  };

  describe.each(VERSIONS)("from Starter v%i", (v) => {
    it("applies as a plan that lines up with the workspace it was made for", () => {
      const before = workspace(v);
      const review = reviewStarterThemeUpgrade(before);
      expect(review.applies).toBe(true);
      expect(review.changes.length).toBeGreaterThan(0);
      // applyPlan throws when an expected id, version or free path is wrong.
      const after = applyPlan(before, review.plan);
      expect(after.length).toBeGreaterThanOrEqual(before.length);
    });

    it("leaves exactly the documented differences from the current Starter", () => {
      const settled = upgradeToFixedPoint(workspace(v));
      const { extra, differs, missing } = diffAgainstCurrent(settled.files);
      const expected = EXPECTED_AFTER_UPGRADE[v];
      expect({ extra, differs, missing }).toEqual({
        extra: sorted(expected.extra),
        differs: sorted(expected.differs),
        missing: sorted(expected.missing),
      });
      expect(settled.passes.length).toBe(PASSES_TO_SETTLE[v]);
    });

    // The claim: after the upgrade is applied, planning it again changes
    // nothing. Versions 15 and 20 break it: the manifest is rewritten again.
    (PASSES_TO_SETTLE[v] === 1 ? it : it.fails)(
      "plans nothing the second time",
      () => {
        const once = upgradeOnce(workspace(v));
        const again = reviewStarterThemeUpgrade(once.files);
        expect(again.plan.files).toEqual([]);
        expect(again.plan.deletions).toEqual([]);
        expect(again.changes).toEqual([]);
      },
    );

    it("settles, and a settled workspace plans nothing", () => {
      const settled = upgradeToFixedPoint(workspace(v));
      const again = reviewStarterThemeUpgrade(settled.files);
      expect(again.changes).toEqual([]);
      expect(again.plan).toEqual({ files: [], deletions: [] });
    });

    it("produces a workspace the build contract accepts, where the old one may not", () => {
      const settled = upgradeToFixedPoint(workspace(v));
      const snapshot = (files: File[]) =>
        files.map((file) => ({ path: file.path, content: file.content }));
      const built = normalizeRevisionSnapshot(snapshot(settled.files), "rev");
      expect(built.framework).toBe("tanstack-start");
      expect(built.entry).toBe("src/routes/index.tsx");
      expect(built.files.length).toBe(settled.files.length);
      expect(validateThemeStartPackageContract(built.files)).toEqual([]);

      const contract = deriveThemeSourceContract(snapshot(settled.files));
      expect(contract.diagnostics).toEqual([]);
      expect(contract.complete).toBe(true);
      expect(contract.contract.entry).toBe("src/routes/index.tsx");
      expect(contract.contract.documentLayout).toEqual({
        source: "src/layouts/StorefrontLayout.tsx",
        export: "default",
      });

      // The toolchain pins it ships with moved after v26, so the old
      // workspace is refused until the upgrade corrects them.
      const old = () =>
        normalizeRevisionSnapshot(snapshot(workspace(v)), "rev");
      if (v === 28) expect(old).not.toThrow();
      else expect(old).toThrow(/INVALID_START_PACKAGE/);
    });

    it("only rewrites package.json for the pins, keeping its JSON equal to the current Starter's", () => {
      const settled = upgradeToFixedPoint(workspace(v));
      const pkg = settled.files.find((file) => file.path === "package.json")!;
      const current = currentStarter.get("package.json")!;
      expect(JSON.parse(pkg.content)).toEqual(JSON.parse(current));
      if (v === 28) expect(pkg.content).toBe(current);
      // The upgrade serialises with a trailing newline; a new Theme has none.
      else expect(pkg.content).toBe(`${current}\n`);
    });
  });

  describe("pinned: workspace files the upgrade does not recognise as Starter copies", () => {
    const stays = (v: number, path: string) => {
      const settled = upgradeToFixedPoint(workspace(v));
      const original = fixtures.get(v)!.files.find((f) => f.path === path)!;
      const result = settled.files.find((f) => f.path === path)!;
      return {
        unchanged: result.content === original.content,
        kept: reviewStarterThemeUpgrade(settled.files).kept.find(
          (k) => k.path === path,
        )?.reason,
      };
    };

    it("a pristine v15 Header and Footer stay as they were and read as author-changed", () => {
      for (const path of [
        "src/components/Header.tsx",
        "src/components/Footer.tsx",
      ]) {
        expect(stays(15, path), path).toEqual({
          unchanged: true,
          kept: "changed",
        });
      }
    });

    it("a pristine v20 Header and Footer stay as they were and read as author-changed", () => {
      for (const path of [
        "src/components/Header.tsx",
        "src/components/Footer.tsx",
      ]) {
        expect(stays(20, path), path).toEqual({
          unchanged: true,
          kept: "changed",
        });
      }
    });

    it("a pristine v11 home route stays as it was, with no page-owned sections added", () => {
      expect(stays(11, "src/routes/index.tsx")).toEqual({
        unchanged: true,
        kept: "markers-kept",
      });
      expect(stays(11, "src/components/Hero.tsx").unchanged).toBe(true);
    });

    // The claim: a Starter file nobody touched is brought to the current
    // Starter, wherever it sits in the Starter's history.
    it.fails(
      "brings every pristine v15 and v20 Starter file to the current one",
      () => {
        for (const v of [15, 20]) {
          const settled = upgradeToFixedPoint(workspace(v));
          const result = new Map(settled.files.map((f) => [f.path, f.content]));
          for (const path of [
            "src/components/Header.tsx",
            "src/components/Footer.tsx",
          ]) {
            expect(result.get(path), `v${v} ${path}`).toBe(
              currentStarter.get(path),
            );
          }
        }
      },
    );
  });

  describe("pinned: the manifest on versions 15 and 20 is rewritten on a second pass", () => {
    it.each([15, 20])(
      "v%i: pass two rewrites only morph.theme.json, pass three nothing",
      (v) => {
        const first = upgradeOnce(workspace(v));
        const second = upgradeOnce(first.files);
        expect(
          second.review.changes.map((c) => `${c.operation} ${c.path}`),
        ).toEqual([`update ${MANIFEST}`]);
        expect(upgradeOnce(second.files).review.changes).toEqual([]);
      },
    );
  });

  describe("author edits survive the upgrade", () => {
    const EDIT = "\n// author edit: keep this line\n";

    // The classes of file the Starter ships, by what the author would do to
    // them. A path with no class is a failure of this test, not of the Theme.
    const classOf = (path: string): string => {
      if (path === "package.json" || path === MANIFEST) return "config";
      if (path === "src/morph/content.ts") return "content module";
      if (path.startsWith("src/morph/")) return "platform helper";
      if (path.startsWith("src/routes/")) return "route";
      if (path.startsWith("src/layouts/")) return "layout";
      if (path === "src/router.tsx") return "router";
      if (path.endsWith(".css")) return "stylesheet";
      if (path.startsWith("src/components/page-sections/"))
        return "page section";
      if (path.startsWith("src/components/sections/")) return "section";
      if (path.startsWith("src/components/")) return "component";
      return "unclassified";
    };

    it.each(VERSIONS)(
      "v%i: an edit to any source file stays byte-identical and is listed as kept",
      (v) => {
        const problems: string[] = [];
        const classes = new Set<string>();
        for (const file of fixtures.get(v)!.files) {
          const cls = classOf(file.path);
          if (cls === "config") continue; // covered by the config tests below
          classes.add(cls);
          const edited = file.content + EDIT;
          const before = workspace(v).map((f) =>
            f.path === file.path ? { ...f, content: edited } : f,
          );
          const review = reviewStarterThemeUpgrade(before);
          const touched = review.changes.find((c) => c.path === file.path);
          if (touched)
            problems.push(`${file.path}: planned ${touched.operation}`);
          const after = applyPlan(before, review.plan).find(
            (f) => f.path === file.path,
          );
          if (after?.content !== edited)
            problems.push(`${file.path}: bytes changed`);
          // Listed as kept whenever the current Starter has a file there. A
          // flat component of an older layout has no counterpart to compare.
          if (currentStarter.has(file.path)) {
            const kept = review.kept.find((k) => k.path === file.path);
            if (!kept || kept.reason === "missing")
              problems.push(
                `${file.path}: not listed as kept (${kept?.reason})`,
              );
          }
        }
        expect(problems).toEqual([]);
        // The classes this version has, so a class that disappears from a
        // fixture cannot silently thin the test.
        expect(classes).toContain("content module");
        expect(classes).toContain("component");
        expect(classes).toContain("route");
        expect(classes).toContain("layout");
        expect(classes).toContain("router");
        expect(classes).toContain("stylesheet");
        expect(classes).not.toContain("unclassified");
      },
    );

    it.each(VERSIONS)(
      "v%i: an edited package.json keeps the author's dependency",
      (v) => {
        const original = fixtures
          .get(v)!
          .files.find((file) => file.path === "package.json")!.content;
        const parsed = JSON.parse(original);
        parsed.dependencies["author-dep"] = "^1.0.0";
        parsed.scripts.lint = "eslint .";
        const edited = JSON.stringify(parsed, null, 2);
        const before = workspace(v).map((f) =>
          f.path === "package.json" ? { ...f, content: edited } : f,
        );
        const settled = upgradeToFixedPoint(before);
        const pkg = settled.files.find((f) => f.path === "package.json")!;
        if (v === 28) {
          // Pins are current: nothing to correct, so the bytes are the author's.
          expect(pkg.content).toBe(edited);
          expect(reviewStarterThemeUpgrade(before).kept).toContainEqual({
            path: "package.json",
            reason: "changed",
          });
        } else {
          // Stale pins are platform-owned and corrected, so the file is merged
          // rather than kept byte for byte. The author's additions survive.
          const merged = JSON.parse(pkg.content);
          expect(merged.dependencies["author-dep"]).toBe("^1.0.0");
          expect(merged.scripts.lint).toBe("eslint .");
          expect(
            validateThemeStartPackageContract([
              { path: "package.json", content: pkg.content },
            ]),
          ).toEqual([]);
        }
      },
    );

    it.each([11, 15, 20, 26])(
      "v%i: an edited morph.theme.json keeps the author's own keys",
      (v) => {
        const original = fixtures
          .get(v)!
          .files.find((file) => file.path === MANIFEST)!.content;
        const edited = JSON.stringify(
          { ...JSON.parse(original), authorNote: "mine" },
          null,
          2,
        );
        const before = workspace(v).map((f) =>
          f.path === MANIFEST ? { ...f, content: edited } : f,
        );
        const settled = upgradeToFixedPoint(before);
        const manifest = settled.files.find((f) => f.path === MANIFEST)!;
        expect(JSON.parse(manifest.content).authorNote).toBe("mine");
        // The manifest is merged, not kept byte for byte, on v11, v15 and v20
        // (v20: on the second pass; it drops a contentFields entry and adds a
        // trailing newline). Only v26's is never touched.
        if (v === 26) expect(manifest.content).toBe(edited);
        else expect(manifest.content).not.toBe(edited);
      },
    );
  });

  describe("files the author removed", () => {
    /** Removed paths whose removal makes the plan create that same path. */
    const readded = (v: number) => {
      const out: string[] = [];
      for (const file of fixtures.get(v)!.files) {
        const without = workspace(v).filter((f) => f.path !== file.path);
        const review = reviewStarterThemeUpgrade(without);
        if (
          review.changes.some(
            (c) => c.path === file.path && c.operation === "create",
          )
        )
          out.push(file.path);
      }
      return out.sort();
    };

    const CORE = [
      "src/layouts/StorefrontLayout.tsx",
      "src/morph/content.ts",
      "src/router.tsx",
      "src/routes/__root.tsx",
    ];
    // Pinned: what the upgrade puts back today. Version 28 is source-first and
    // does not put back its core files; the others do.
    const READDED: Record<number, string[]> = {
      11: [
        ...CORE,
        "src/routes/index.tsx",
        ...FLAT_COMPONENTS.filter((p) => !p.endsWith("/Principles.tsx")),
      ].filter((p) => !p.endsWith("/Hero.tsx")),
      15: [
        ...CORE,
        "src/routes/index.tsx",
        ...FLAT_COMPONENTS.filter(
          (p) => !p.endsWith("/Principles.tsx") && !p.endsWith("/Hero.tsx"),
        ),
      ],
      20: [
        ...CORE,
        "src/routes/index.tsx",
        "src/morph/content-fields.ts",
        "src/morph/link.tsx",
        ...FLAT_COMPONENTS.filter(
          (p) => !p.endsWith("/Principles.tsx") && !p.endsWith("/Hero.tsx"),
        ),
      ],
      26: [
        ...CORE,
        "src/routes/index.tsx",
        "src/morph/content-fields.ts",
        "src/morph/link.tsx",
        ...FLAT_COMPONENTS.filter(
          (p) => !p.endsWith("/Principles.tsx") && !p.endsWith("/Hero.tsx"),
        ),
      ],
      28: [
        "src/morph/content-fields.ts",
        "src/morph/link.tsx",
        ...SECTION_REEXPORTS,
      ],
    };

    it.each(VERSIONS)(
      "v%i: pins which removed files the upgrade puts back",
      (v) => {
        // v11 keeps its Hero and Principles flat files out of the plan; the
        // lists above are written per version for exactly that reason.
        const expected = READDED[v];
        expect(readded(v)).toEqual(sorted(expected));
      },
    );

    // The claim: a file the author removed is not added back.
    it.fails.each(VERSIONS)(
      "v%i: puts nothing back that the author removed",
      (v) => {
        expect(readded(v)).toEqual([]);
      },
    );

    it("never recreates a removed Header, Footer, stylesheet or package.json", () => {
      for (const v of VERSIONS) {
        for (const path of [
          "src/components/Header.tsx",
          "src/components/Footer.tsx",
          "src/styles/global.css",
          "package.json",
        ]) {
          const without = workspace(v).filter((f) => f.path !== path);
          const review = reviewStarterThemeUpgrade(without);
          expect(
            review.changes.filter((c) => c.path === path),
            `v${v} ${path}`,
          ).toEqual([]);
        }
      }
    });
  });
});
