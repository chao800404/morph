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
import { afterEach, describe, expect, it } from "vitest";
import { normalizeRevisionSnapshot } from "./compiler/theme-build-materializer";
import { validateThemeStartPackageContract } from "./compiler/theme-start-toolchain";
import { STOREFRONT_STARTER_TEMPLATE_VERSION } from "./default-storefront-document";
import {
  createStarterThemeWorkspaceUpgradePlan,
  starterThemeWorkspaceFiles,
  type StarterThemeWorkspaceUpgradePlan,
} from "./starter-theme-files";
import {
  reviewStarterThemeUpgrade,
  STARTER_FILES_SHIPPED,
} from "./starter-theme-upgrade-review";
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

// Every test here is synchronous and CPU-bound, and in a full run the file
// takes about a minute. Vitest's runner reaches no macrotask between
// synchronous tests, so for that whole time the worker could not read the
// replies to its RPC calls; past vitest's 60 s RPC timeout the run ended with
// an unhandled "Timeout calling onTaskUpdate", every test passing. Each test
// now ends on a real turn of the event loop. Cases and assertions are as they
// were.
afterEach(() => new Promise<void>((resolve) => setImmediate(resolve)));
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

const CURRENT = STOREFRONT_STARTER_TEMPLATE_VERSION;

/**
 * One upgrade pass: review, then apply the reviewed plan. `version` is the
 * Starter version the Theme records; a fixture's own, until an applied
 * upgrade records the current one.
 */
function upgradeOnce(files: File[], version: number) {
  const review = reviewStarterThemeUpgrade(files, { storedVersion: version });
  return { review, files: applyPlan(files, review.plan) };
}

/** Upgrades until a pass changes nothing; reports how many passes changed. */
function upgradeToFixedPoint(files: File[], version: number, maxPasses = 5) {
  let current = files;
  const passes: string[][] = [];
  for (let pass = 0; pass < maxPasses; pass += 1) {
    const step = upgradeOnce(current, pass === 0 ? version : CURRENT);
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
    // Every version ends where v26 does: the v11 home route and flat
    // components, and the v15/v20 Header and Footer, are recognised as the
    // byte-sets those versions shipped (starter-theme-legacy-byte-sets.ts),
    // so they are brought to the current Starter and v11 gets its page-owned
    // sections.
    11: {
      extra: [MANIFEST, ...FLAT_COMPONENTS],
      differs: ["package.json", ...SECTION_REEXPORTS],
      missing: [],
    },
    15: {
      extra: [MANIFEST, ...FLAT_COMPONENTS],
      differs: ["package.json", ...SECTION_REEXPORTS],
      missing: [],
    },
    20: {
      extra: [MANIFEST, ...FLAT_COMPONENTS],
      differs: ["package.json", ...SECTION_REEXPORTS],
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
    // 2 since v11's flat components are recognised: the manifest second pass
    // that v15 and v20 already had (pinned below) now reaches v11 too.
    11: 2,
    15: 2,
    20: 2,
    26: 1,
    28: 1,
  };

  describe.each(VERSIONS)("from Starter v%i", (v) => {
    it("applies as a plan that lines up with the workspace it was made for", () => {
      const before = workspace(v);
      const review = reviewStarterThemeUpgrade(before, { storedVersion: v });
      expect(review.applies).toBe(true);
      expect(review.changes.length).toBeGreaterThan(0);
      // applyPlan throws when an expected id, version or free path is wrong.
      const after = applyPlan(before, review.plan);
      expect(after.length).toBeGreaterThanOrEqual(before.length);
    });

    it("leaves exactly the documented differences from the current Starter", () => {
      const settled = upgradeToFixedPoint(workspace(v), v);
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
    // nothing. Versions 11, 15 and 20 break it: the manifest is rewritten
    // again (a known gap, pinned below).
    (PASSES_TO_SETTLE[v] === 1 ? it : it.fails)(
      "plans nothing the second time",
      () => {
        const once = upgradeOnce(workspace(v), v);
        const again = reviewStarterThemeUpgrade(once.files, {
          storedVersion: CURRENT,
        });
        expect(again.plan.files).toEqual([]);
        expect(again.plan.deletions).toEqual([]);
        expect(again.changes).toEqual([]);
      },
    );

    it("settles, and a settled workspace plans nothing", () => {
      const settled = upgradeToFixedPoint(workspace(v), v);
      const again = reviewStarterThemeUpgrade(settled.files, {
        storedVersion: CURRENT,
      });
      expect(again.changes).toEqual([]);
      expect(again.plan).toEqual({ files: [], deletions: [] });
    });

    it("produces a workspace the build contract accepts, where the old one may not", () => {
      const settled = upgradeToFixedPoint(workspace(v), v);
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
      const settled = upgradeToFixedPoint(workspace(v), v);
      const pkg = settled.files.find((file) => file.path === "package.json")!;
      const current = currentStarter.get("package.json")!;
      expect(JSON.parse(pkg.content)).toEqual(JSON.parse(current));
      if (v === 28) expect(pkg.content).toBe(current);
      // The upgrade serialises with a trailing newline; a new Theme has none.
      else expect(pkg.content).toBe(`${current}\n`);
    });
  });

  describe("pristine Starter files of every shipped generation are recognised", () => {
    // These pinned the old gap: the files below were the exact bytes their
    // version shipped, yet were kept as author-changed. Since the T1 inventory
    // (2026-10-29) those byte-sets are recognised, so the upgrade replaces
    // them and the review no longer lists them as kept.
    const upgraded = (v: number, path: string) => {
      const settled = upgradeToFixedPoint(workspace(v), v);
      const original = fixtures.get(v)!.files.find((f) => f.path === path)!;
      const result = settled.files.find((f) => f.path === path)!;
      return {
        unchanged: result.content === original.content,
        kept: reviewStarterThemeUpgrade(settled.files, {
          storedVersion: CURRENT,
        }).kept.find((k) => k.path === path)?.reason,
      };
    };

    it("a pristine v15 Header and Footer are upgraded and not listed as kept", () => {
      for (const path of [
        "src/components/Header.tsx",
        "src/components/Footer.tsx",
      ]) {
        expect(upgraded(15, path), path).toEqual({
          unchanged: false,
          kept: undefined,
        });
      }
    });

    it("a pristine v20 Header and Footer are upgraded and not listed as kept", () => {
      for (const path of [
        "src/components/Header.tsx",
        "src/components/Footer.tsx",
      ]) {
        expect(upgraded(20, path), path).toEqual({
          unchanged: false,
          kept: undefined,
        });
      }
    });

    it("a pristine v11 home route is upgraded, with the page-owned sections added", () => {
      expect(upgraded(11, "src/routes/index.tsx")).toEqual({
        unchanged: false,
        kept: undefined,
      });
      expect(upgraded(11, "src/components/Hero.tsx").unchanged).toBe(false);
      const settled = upgradeToFixedPoint(workspace(11), 11);
      const result = new Map(settled.files.map((f) => [f.path, f.content]));
      for (const path of ["src/routes/index.tsx", ...PAGE_SECTIONS]) {
        expect(result.get(path), path).toBe(currentStarter.get(path));
      }
    });

    // The claim: a Starter file nobody touched is brought to the current
    // Starter, wherever it sits in the Starter's history.
    it("brings every pristine v15 and v20 Starter file to the current one", () => {
      for (const v of [15, 20]) {
        const settled = upgradeToFixedPoint(workspace(v), v);
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
    });
  });

  // Known gap, not fixed here: once a flat component reaches the Starter's
  // bytes, the next pass drops its now-redundant contentFields fallback from
  // the manifest. v11 joined 15 and 20 when its flat components became
  // recognised (T1, 2026-10-29).
  describe("pinned: the manifest on versions 11, 15 and 20 is rewritten on a second pass", () => {
    it.each([11, 15, 20])(
      "v%i: pass two rewrites only morph.theme.json, pass three nothing",
      (v) => {
        const first = upgradeOnce(workspace(v), v);
        const second = upgradeOnce(first.files, CURRENT);
        expect(
          second.review.changes.map((c) => `${c.operation} ${c.path}`),
        ).toEqual([`update ${MANIFEST}`]);
        expect(upgradeOnce(second.files, CURRENT).review.changes).toEqual([]);
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
          const review = reviewStarterThemeUpgrade(before, {
            storedVersion: v,
          });
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
        const settled = upgradeToFixedPoint(before, v);
        const pkg = settled.files.find((f) => f.path === "package.json")!;
        if (v === 28) {
          // Pins are current: nothing to correct, so the bytes are the author's.
          expect(pkg.content).toBe(edited);
          expect(
            reviewStarterThemeUpgrade(before, { storedVersion: v }).kept,
          ).toContainEqual({
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
        const settled = upgradeToFixedPoint(before, v);
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

  describe("files the author removed, with no Starter version recorded", () => {
    const pending = (files: File[]) =>
      reviewStarterThemeUpgrade(files, { storedVersion: null });

    it.each(VERSIONS)("v%i: puts nothing back that the author removed", (v) => {
      for (const file of fixtures.get(v)!.files) {
        const without = workspace(v).filter((f) => f.path !== file.path);
        const reviewed = pending(without);
        expect(
          reviewed.changes.filter((change) => change.path === file.path),
          `v${v} without ${file.path}`,
        ).toEqual([]);
        if (!reviewed.applies) continue;
        if (
          STARTER_FILES_SHIPPED.some((entry) => entry.paths.includes(file.path))
        ) {
          // The rest of its group is there, so the Theme had the group.
          expect(reviewed.kept, `v${v} without ${file.path}`).toContainEqual({
            path: file.path,
            reason: "missing",
          });
        }
      }
    });

    it("does not add a group the Theme has none of, and says why", () => {
      // An untouched v26 workspace has no section files: whether it never had
      // them or its author removed them all, the files cannot tell.
      const reviewed = pending(workspace(26));
      const created = reviewed.changes
        .filter((change) => change.operation === "create")
        .map((change) => change.path);
      for (const path of [...SECTION_REEXPORTS, ...PAGE_SECTIONS]) {
        expect(created, path).not.toContain(path);
      }
      expect(reviewed.kept).toContainEqual({
        path: SECTION_REEXPORTS[0]!,
        reason: "origin-unknown",
      });
      // Recorded at 26, the same files are known to be new, and are added.
      const recorded = reviewStarterThemeUpgrade(workspace(26), {
        storedVersion: 26,
      });
      expect(
        recorded.changes
          .filter((change) => change.operation === "create")
          .map((change) => change.path),
      ).toEqual(expect.arrayContaining(SECTION_REEXPORTS));
    });

    it("never recreates a removed Header, Footer, stylesheet or package.json", () => {
      for (const v of VERSIONS) {
        for (const path of [
          "src/components/Header.tsx",
          "src/components/Footer.tsx",
          "src/styles/global.css",
          "package.json",
        ]) {
          const without = workspace(v).filter((f) => f.path !== path);
          for (const storedVersion of [null, v]) {
            const review = reviewStarterThemeUpgrade(without, {
              storedVersion,
            });
            expect(
              review.changes.filter((c) => c.path === path),
              `v${v} (${storedVersion}) ${path}`,
            ).toEqual([]);
          }
        }
      }
    });
  });

  describe("files the author removed, on a Theme that records its Starter version", () => {
    const review = (files: File[], v: number) =>
      reviewStarterThemeUpgrade(files, { storedVersion: v });

    /** Relative imports in the workspace that name no file in it. */
    function danglingImports(files: File[]) {
      const have = new Set(files.map((file) => file.path));
      const out = new Set<string>();
      for (const file of files) {
        if (!/\.(ts|tsx)$/.test(file.path)) continue;
        for (const match of file.content.matchAll(
          /(?:\bfrom\s*|\bimport\s*\(?\s*)["'](\.{1,2}\/[^"']+)["']/g,
        )) {
          const parts = file.path.split("/").slice(0, -1);
          for (const part of match[1]!.split("/")) {
            if (part === "." || part === "") continue;
            if (part === "..") parts.pop();
            else parts.push(part);
          }
          const base = parts.join("/");
          const found = [
            base,
            ...[".ts", ".tsx", "/index.ts", "/index.tsx"].map(
              (ext) => base + ext,
            ),
          ].some((path) => have.has(path));
          if (!found) out.add(`${file.path} -> ${match[1]}`);
        }
      }
      return out;
    }

    it.each(VERSIONS)(
      "v%i: an untouched workspace gets the upgrade's own plan",
      (v) => {
        expect(review(workspace(v), v).plan).toEqual(
          createStarterThemeWorkspaceUpgradePlan(workspace(v), {
            editAuthoredFiles: false,
          }),
        );
      },
    );

    it.each(VERSIONS)(
      "v%i: puts nothing back that the author removed, and lists it as missing",
      (v) => {
        for (const file of fixtures.get(v)!.files) {
          const without = workspace(v).filter((f) => f.path !== file.path);
          const reviewed = review(without, v);
          expect(
            reviewed.changes.filter((change) => change.path === file.path),
            `v${v} without ${file.path}`,
          ).toEqual([]);
          // Without its router, a workspace is no longer a Start Starter, and
          // the review offers nothing at all.
          if (!reviewed.applies) continue;
          if (
            STARTER_FILES_SHIPPED.some((entry) =>
              entry.paths.includes(file.path),
            )
          ) {
            expect(reviewed.kept, `v${v} without ${file.path}`).toContainEqual({
              path: file.path,
              reason: "missing",
            });
          }
        }
      },
    );

    it.each(VERSIONS)(
      "v%i: an upgrade with a file removed points no new import at nothing",
      (v) => {
        for (const file of fixtures.get(v)!.files) {
          const without = workspace(v).filter((f) => f.path !== file.path);
          const before = danglingImports(without);
          const after = danglingImports(
            applyPlan(without, review(without, v).plan),
          );
          for (const dangling of after) {
            expect(before, `v${v} without ${file.path}`).toContain(dangling);
          }
        }
      },
    );

    it("holds back a section entry whose component the author removed", () => {
      const without = workspace(15).filter(
        (file) => file.path !== "src/components/Newsletter.tsx",
      );
      const reviewed = review(without, 15);
      const paths = reviewed.changes.map((change) => change.path);
      expect(paths).not.toContain("src/components/Newsletter.tsx");
      expect(paths).not.toContain("src/components/sections/Newsletter.tsx");
      expect(reviewed.kept).toContainEqual({
        path: "src/components/Newsletter.tsx",
        reason: "missing",
      });
      expect(reviewed.kept).toContainEqual({
        path: "src/components/sections/Newsletter.tsx",
        reason: "needs-missing",
      });
      // The rest of the upgrade still goes ahead.
      expect(paths).toContain("src/components/sections/Hero.tsx");
    });

    it("says which versions shipped each file only as far as the fixtures show", () => {
      for (const v of VERSIONS) {
        const have = new Set(fixtures.get(v)!.files.map((file) => file.path));
        for (const entry of STARTER_FILES_SHIPPED) {
          const shipped = v >= entry.from && (entry.to ?? v) >= v;
          for (const path of entry.paths) {
            expect(have.has(path), `v${v} ${path}`).toBe(shipped);
          }
        }
      }
    });
  });
});
