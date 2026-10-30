/**
 * The Starter's account and order-transfer pages on Themes created without
 * them.
 *
 * Commit f010e91 added `src/routes/account.tsx` and
 * `src/routes/order-transfer.tsx`, and a Header linking to `/account`,
 * without a version bump. Source-first Themes created before it (97e9474 at
 * version 26, 52e760b and 2c49fe5 at 27) never had the pages, and neither
 * their recorded version nor their files tell them from a Theme whose author
 * removed them. The review offers the pages, unselected, and adds them only
 * when the author selects them; until then nothing the upgrade writes links
 * to them.
 *
 * The workspaces are the ones 97e9474, 52e760b and 2c49fe5 created, byte for
 * byte (`__fixtures__/starter-history/v26-97e9474.json`, `v27-52e760b.json`,
 * `v27-2c49fe5.json`; each `sha256` is of `JSON.stringify(files)`).
 */
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
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
  STARTER_OPTIONAL_ROUTES,
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

const FIXTURE_DIR = join(__dirname, "__fixtures__", "starter-history");
const readFixture = (name: string) =>
  JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8")) as Fixture;

/** Every Starter commit whose new Themes lacked the pages, and its fixture. */
const WINDOW = [
  {
    name: "v26-97e9474.json",
    commit: "97e94740da99626ec96415d8d8c9aa655432b8da",
    version: 26,
    files: 23,
  },
  {
    name: "v27-52e760b.json",
    commit: "52e760bcc813228728f4afa768c1ab3f20682038",
    version: 27,
    files: 29,
  },
  {
    name: "v27-2c49fe5.json",
    commit: "2c49fe531a0c7d53a824ebe56690dee3ccab41b8",
    version: 27,
    files: 23,
  },
] as const;

const toFiles = (files: ReadonlyArray<{ path: string; content: string }>) =>
  files.map((file, index) => ({
    id: `file-${index}`,
    path: file.path,
    content: file.content,
    version: 1,
  }));

const CURRENT = STOREFRONT_STARTER_TEMPLATE_VERSION;
const ACCOUNT = "src/routes/account.tsx";
const ORDER_TRANSFER = "src/routes/order-transfer.tsx";
const PAGES = [ACCOUNT, ORDER_TRANSFER];
const HEADER = "src/components/Header.tsx";
const today = new Map(
  starterThemeWorkspaceFiles().map((file) => [file.path, file.content]),
);

/** Applies a plan as the store does; a plan that does not line up throws. */
function applyPlan(
  files: File[],
  plan: StarterThemeWorkspaceUpgradePlan,
): File[] {
  const next = new Map(files.map((file) => [file.path, file]));
  for (const deletion of plan.deletions) {
    expect(next.get(deletion.path)?.id).toBe(deletion.expectedFileId);
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
      expect(write.expectedFileId, `update ${write.path}`).toBe(existing?.id);
      expect(write.expectedVersion, `update ${write.path}`).toBe(
        existing?.version,
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

/** Files that link to `/account` or `/order-transfer`, path → routes. */
function linksToPages(files: File[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const file of files) {
    const routes = STARTER_OPTIONAL_ROUTES.filter(
      ({ path, route }) =>
        path !== file.path &&
        new RegExp(`["'\`]${route}(?:[/?#][^"'\`]*)?["'\`]`).test(file.content),
    ).map(({ route }) => route);
    if (routes.length > 0) out.set(file.path, routes);
  }
  return out;
}

/** Links to a page the workspace does not have. */
function danglingPageLinks(files: File[]): string[] {
  const have = new Set(files.map((file) => file.path));
  const out: string[] = [];
  for (const [path, routes] of linksToPages(files)) {
    for (const route of routes) {
      const page = STARTER_OPTIONAL_ROUTES.find((r) => r.route === route)!;
      if (!have.has(page.path)) out.push(`${path} -> ${route}`);
    }
  }
  return out.sort();
}

function expectBuildContract(files: File[]) {
  const snapshot = files.map((file) => ({
    path: file.path,
    content: file.content,
  }));
  const built = normalizeRevisionSnapshot(snapshot, "rev");
  expect(built.framework).toBe("tanstack-start");
  expect(validateThemeStartPackageContract(built.files)).toEqual([]);
  const contract = deriveThemeSourceContract(snapshot);
  expect(contract.diagnostics).toEqual([]);
  expect(contract.complete).toBe(true);
}

describe.each(WINDOW)("the $name workspace fixture", (entry) => {
  const fixture = readFixture(entry.name);

  it("is the workspace that commit created, and names its source", () => {
    expect(fixture.starterVersion).toBe(entry.version);
    expect(fixture.sourceCommit).toBe(entry.commit);
    expect(fixture.sourcePath).toContain(
      "src/lib/storefront/starter-theme-files.ts",
    );
    expect(
      crypto
        .createHash("sha256")
        .update(JSON.stringify(fixture.files))
        .digest("hex"),
    ).toBe(fixture.sha256);
    expect(fixture.files).toHaveLength(entry.files);
  });

  it("is source-first, without the pages, and links to neither", () => {
    const paths = fixture.files.map((file) => file.path);
    expect(paths).not.toContain("morph.theme.json");
    expect(paths).not.toContain("src/pages/index.tsx");
    for (const path of PAGES) expect(paths).not.toContain(path);
    expect(linksToPages(toFiles(fixture.files))).toEqual(new Map());
  });
});

describe("the pages and the version window", () => {
  it("the pages are the ones today's Starter has, and only its Header links to them", () => {
    for (const { path } of STARTER_OPTIONAL_ROUTES) {
      expect(today.has(path), path).toBe(true);
    }
    expect([
      ...linksToPages(toFiles(starterThemeWorkspaceFiles())).keys(),
    ]).toEqual([HEADER]);
  });

  it("the version cannot tell: 26 and 27 each span Themes with and without them", () => {
    const has = (name: string) =>
      readFixture(name).files.some((file) => file.path === ACCOUNT);
    // 3007c63 (26, manifest-era) and the three source-first commits lack
    // them; v28 has them. f010e91, still 27, added them (not a fixture).
    expect(has("v26.json")).toBe(false);
    for (const { name } of WINDOW) expect(has(name), name).toBe(false);
    expect(has("v28.json")).toBe(true);
  });

  it("says what each page is for", () => {
    expect(
      STARTER_OPTIONAL_ROUTES.map(({ path, route }) => [path, route]),
    ).toEqual([
      [ACCOUNT, "/account"],
      [ORDER_TRANSFER, "/order-transfer"],
    ]);
    expect(STARTER_OPTIONAL_ROUTES[0]!.purpose).toMatch(
      /^Customer account page/,
    );
    expect(STARTER_OPTIONAL_ROUTES[1]!.purpose).toMatch(
      /^Order transfer confirmation page/,
    );
  });
});

describe.each(WINDOW)("a Theme created without the pages ($name)", (entry) => {
  const fixture = readFixture(entry.name);
  const beforePages = (): File[] => toFiles(fixture.files);
  const BEFORE_PAGES = fixture;

  describe.each([entry.version, null])("recorded at %s", (storedVersion) => {
    const review = () =>
      reviewStarterThemeUpgrade(beforePages(), { storedVersion });

    it("offers the pages, unselected: the plan does not create them", () => {
      const reviewed = review();
      expect(reviewed.optional?.paths).toEqual(PAGES);
      expect(reviewed.optional?.pages).toEqual(STARTER_OPTIONAL_ROUTES);
      for (const path of PAGES) {
        expect(reviewed.plan.files.map((file) => file.path)).not.toContain(
          path,
        );
        expect(reviewed.changes.map((change) => change.path)).not.toContain(
          path,
        );
        expect(reviewed.kept).toContainEqual({
          path,
          reason: "new-in-starter",
        });
      }
    });

    it("holds the Header back, as needing a page, rather than linking to /account", () => {
      const reviewed = review();
      expect(reviewed.changes.map((change) => change.path)).not.toContain(
        HEADER,
      );
      expect(reviewed.kept).toContainEqual({
        path: HEADER,
        reason: "needs-route",
      });
      // The upgrade's own plan would have linked it.
      expect(
        createStarterThemeWorkspaceUpgradePlan(beforePages(), {
          editAuthoredFiles: false,
        }).files.find((file) => file.path === HEADER)?.content,
      ).toBe(today.get(HEADER));
    });

    it("applied without the pages: none is created, and no link points at a missing page", () => {
      const reviewed = review();
      const after = applyPlan(beforePages(), reviewed.plan);
      const paths = after.map((file) => file.path);
      for (const path of PAGES) expect(paths).not.toContain(path);
      expect(danglingPageLinks(after)).toEqual([]);
      expect(after.find((file) => file.path === HEADER)?.content).toBe(
        BEFORE_PAGES.files.find((file) => file.path === HEADER)!.content,
      );
      expectBuildContract(after);
    });

    it("with the pages selected: creates both, and updates the Header as the upgrade always did", () => {
      const reviewed = review();
      const selected = reviewed.optional!;
      expect(selected.digest).not.toBe(reviewed.digest);
      const created = selected.changes.filter(
        (change) => change.operation === "create",
      );
      for (const path of PAGES) {
        expect(created).toContainEqual({
          path,
          operation: "create",
          before: null,
          after: today.get(path),
        });
      }
      expect(selected.changes).toContainEqual(
        expect.objectContaining({
          path: HEADER,
          operation: "update",
          after: today.get(HEADER),
        }),
      );
      for (const item of selected.kept) {
        expect(["new-in-starter", "needs-route"]).not.toContain(item.reason);
      }
      // Everything else is the same plan.
      const others = (changes: { path: string }[]) =>
        changes
          .map((change) => change.path)
          .filter((path) => path !== HEADER && !PAGES.includes(path));
      expect(others(selected.changes)).toEqual(others(reviewed.changes));

      const after = applyPlan(beforePages(), selected.plan);
      for (const path of PAGES) {
        expect(after.find((file) => file.path === path)?.content).toBe(
          today.get(path),
        );
      }
      expect(after.find((file) => file.path === HEADER)?.content).toBe(
        today.get(HEADER),
      );
      expect(danglingPageLinks(after)).toEqual([]);
      expectBuildContract(after);
    });
  });

  it("once added and recorded, a review offers and holds nothing about them", () => {
    const reviewed = reviewStarterThemeUpgrade(beforePages(), {
      storedVersion: entry.version,
    });
    const after = applyPlan(beforePages(), reviewed.optional!.plan);
    const again = reviewStarterThemeUpgrade(after, { storedVersion: CURRENT });
    expect(again.optional).toBeNull();
    expect(again.changes).toEqual([]);
    for (const item of again.kept) {
      expect(PAGES.concat(HEADER)).not.toContain(item.path);
    }
  });

  // Not selecting them is "not this time": the version is recorded as
  // current, and the next review, opened from the Command Palette since no
  // notice shows, offers them again, in the same words.
  it.each([entry.version, null])(
    "declined at %s, then recorded: the next review still offers them, and selecting them adds them and the Header",
    (storedVersion) => {
      const first = reviewStarterThemeUpgrade(beforePages(), { storedVersion });
      const declined = applyPlan(beforePages(), first.plan);
      const again = reviewStarterThemeUpgrade(declined, {
        storedVersion: CURRENT,
      });
      expect(again.changes).toEqual([]);
      expect(again.optional?.paths).toEqual(PAGES);
      for (const path of PAGES) {
        expect(again.kept).toContainEqual({ path, reason: "new-in-starter" });
        expect(again.kept).not.toContainEqual({ path, reason: "missing" });
      }
      expect(again.kept).toContainEqual({
        path: HEADER,
        reason: "needs-route",
      });

      const added = applyPlan(declined, again.optional!.plan);
      for (const path of [...PAGES, HEADER]) {
        expect(added.find((file) => file.path === path)?.content, path).toBe(
          today.get(path),
        );
      }
      expect(
        again.optional!.changes.map((c) => `${c.operation} ${c.path}`).sort(),
      ).toEqual(
        [`update ${HEADER}`, ...PAGES.map((path) => `create ${path}`)].sort(),
      );
      expect(danglingPageLinks(added)).toEqual([]);
      expectBuildContract(added);
      const settled = reviewStarterThemeUpgrade(added, {
        storedVersion: CURRENT,
      });
      expect(settled.optional).toBeNull();
      expect(settled.changes).toEqual([]);
    },
  );
});

describe("Themes that may have had the pages", () => {
  const sourceFirstToday = (edit: (files: File[]) => File[]) =>
    edit(toFiles(starterThemeWorkspaceFiles()));
  const without =
    (...paths: string[]) =>
    (files: File[]) =>
      files.filter((file) => !paths.includes(file.path));

  // The files cannot tell a Theme whose author removed both from one that
  // never had them, whatever version it records: both are offered, never
  // added unasked, and never said to be removed.
  it.each([27, 28, CURRENT, null])(
    "recorded at %s and without both: offered, not created, not called missing",
    (storedVersion) => {
      const reviewed = reviewStarterThemeUpgrade(
        sourceFirstToday(without(...PAGES)),
        { storedVersion },
      );
      expect(reviewed.optional?.paths).toEqual(PAGES);
      expect(reviewed.changes).toEqual([]);
      for (const path of PAGES) {
        expect(reviewed.kept).toContainEqual({
          path,
          reason: "new-in-starter",
        });
      }
    },
  );

  it.each([26, 27, 28, CURRENT, null])(
    "recorded at %s with one of them: the other is not offered, and not called missing",
    (storedVersion) => {
      const reviewed = reviewStarterThemeUpgrade(
        sourceFirstToday(without(ACCOUNT)),
        { storedVersion },
      );
      expect(reviewed.optional).toBeNull();
      expect(reviewed.kept).toContainEqual({
        path: ACCOUNT,
        reason: "page-not-in-theme",
      });
      expect(reviewed.kept).not.toContainEqual({
        path: ACCOUNT,
        reason: "missing",
      });
    },
  );

  it("a manifest-era v26 Theme still gets them from the upgrade's own plan, unasked", () => {
    const manifestEra = toFiles(readFixture("v26.json").files);
    const reviewed = reviewStarterThemeUpgrade(manifestEra, {
      storedVersion: 26,
    });
    expect(reviewed.optional).toBeNull();
    const created = reviewed.changes
      .filter((change) => change.operation === "create")
      .map((change) => change.path);
    for (const path of PAGES) expect(created).toContain(path);
  });
});
