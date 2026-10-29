import crypto from "node:crypto";
import {
  createStarterThemeWorkspaceUpgradePlan,
  starterThemeWorkspaceFiles,
  starterUpgradeAppliesTo,
  type StarterThemeWorkspaceUpgradePlan,
} from "./starter-theme-files";

type ExistingFile = Parameters<
  typeof createStarterThemeWorkspaceUpgradePlan
>[0][number];

/** One file the upgrade would write or delete, with its text before and after. */
export type StarterUpgradeChange = {
  path: string;
  operation: "create" | "update" | "delete";
  before: string | null;
  after: string | null;
};

/**
 * Why a Starter file is left as it is.
 *
 * - `changed`: its bytes match no Starter copy Morph knows. Either the author
 *   changed it, a formatter included, or it is an older copy Morph cannot
 *   recognise. Either way it is the author's now.
 * - `missing`: the Theme does not have it, and the upgrade does not add it
 *   back.
 * - `markers-kept`: the author changed it, and it still has `data-*` markers
 *   the compiler can derive. They keep working; the upgrade does not edit the
 *   file to remove them.
 * - `needs-missing`: its upgrade would import a file the author removed, so
 *   it is left as it is rather than written to point at nothing.
 * - `origin-unknown`: the Theme does not record which Starter it came from,
 *   and has none of the files this one shipped with, so whether it never had
 *   them or the author removed them all cannot be told. It is not added.
 */
export type StarterUpgradeKeptReason =
  "changed" | "missing" | "markers-kept" | "needs-missing" | "origin-unknown";

export type StarterUpgradeKept = {
  path: string;
  reason: StarterUpgradeKeptReason;
};

export type StarterUpgradeReview = {
  /** False for a workspace of another framework: nothing here is for it. */
  applies: boolean;
  plan: StarterThemeWorkspaceUpgradePlan;
  changes: StarterUpgradeChange[];
  kept: StarterUpgradeKept[];
  /**
   * Names exactly this plan, guards included. Apply re-plans and refuses when
   * it differs, so what is written is what the author saw.
   */
  digest: string;
};

/**
 * Names a plan exactly, guards included. Shared by the Starter upgrade and
 * the product catalog, so both parts of a review are checked the same way.
 */
export function reviewPlanDigest(
  plan: StarterThemeWorkspaceUpgradePlan,
): string {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        files: plan.files.map((file) => [
          file.path,
          file.content,
          file.mimeType,
          file.expectMissing === true,
          file.expectedFileId ?? null,
          file.expectedVersion ?? null,
        ]),
        deletions: plan.deletions.map((file) => [
          file.path,
          file.expectedFileId,
          file.expectedVersion,
        ]),
      }),
    )
    .digest("hex");
}

const byPath = <T extends { path: string }>(a: T, b: T) =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

const FLAT_SECTION_COMPONENTS = [
  "CategoryShowcase",
  "EditorialIntro",
  "Hero",
  "ImageWithText",
  "Newsletter",
  "Principles",
];
const PAGE_SECTION_SLOTS = [
  "starter-categories",
  "starter-hero",
  "starter-introduction",
  "starter-newsletter",
  "starter-principles",
  "starter-story",
];

/**
 * The Starter versions each file the upgrade can create shipped in.
 *
 * Taken from the history fixtures (versions 11, 15, 20, 26 and 28), and only
 * as wide as they prove: a version between two fixtures counts only where both
 * neighbours had the file. A Theme recorded at one of these versions started
 * with the file, or received it from a recorded upgrade, so its absence is
 * the author's removal.
 */
export const STARTER_FILES_SHIPPED: ReadonlyArray<{
  paths: readonly string[];
  from: number;
  to?: number;
}> = [
  {
    from: 11,
    paths: [
      "src/morph/content.ts",
      "src/router.tsx",
      "src/layouts/StorefrontLayout.tsx",
      "src/routes/__root.tsx",
      "src/routes/index.tsx",
    ],
  },
  {
    from: 11,
    to: 26,
    paths: FLAT_SECTION_COMPONENTS.map((name) => `src/components/${name}.tsx`),
  },
  {
    from: 20,
    paths: ["src/morph/content-fields.ts", "src/morph/link.tsx"],
  },
  {
    from: 28,
    paths: [
      ...FLAT_SECTION_COMPONENTS.map(
        (name) => `src/components/sections/${name}.tsx`,
      ),
      ...PAGE_SECTION_SLOTS.map(
        (slot) => `src/components/page-sections/index/${slot}/index.tsx`,
      ),
    ],
  },
];

function shippedIn(path: string, version: number): boolean {
  return STARTER_FILES_SHIPPED.some(
    (entry) =>
      entry.paths.includes(path) &&
      version >= entry.from &&
      (entry.to === undefined || version <= entry.to),
  );
}

/** Relative module specifiers a source file imports or re-exports. */
function relativeImports(content: string): string[] {
  const out: string[] = [];
  for (const match of content.matchAll(
    /(?:\bfrom\s*|\bimport\s*\(?\s*)["'](\.{1,2}\/[^"']+)["']/g,
  )) {
    out.push(match[1]!);
  }
  return out;
}

/** The workspace paths a relative specifier from `fromPath` could name. */
function importCandidates(fromPath: string, specifier: string): string[] {
  const parts = fromPath.split("/").slice(0, -1);
  for (const part of specifier.split("/")) {
    if (part === "." || part === "") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  const base = parts.join("/");
  return [
    base,
    ...[".ts", ".tsx", "/index.ts", "/index.tsx"].map((ext) => base + ext),
  ];
}

/**
 * The plan without what would put back a file the author removed.
 *
 * Which files a Theme started with comes from its recorded Starter version.
 * With none recorded, it comes from the files themselves, one shipped group
 * at a time, and where they cannot tell, nothing is added:
 *
 * - Recorded version: a file that version shipped with and the Theme no
 *   longer has is the author's removal. It is `missing`, and not created.
 *   A file today's Starter does not have is not created either: on a Theme
 *   that started after it, it is only an intermediate of an older upgrade.
 * - No version, and the Theme has part of a group: it had the group, so the
 *   rest was removed. Those files are `missing`, and not created.
 * - No version, and the Theme has none of a group: it may never have had it,
 *   or the author removed all of it. The plan's files from it are not
 *   created; they are `origin-unknown`.
 * - A planned file that would import any of those is held back, as
 *   `needs-missing`, until nothing left in the plan points at a file that is
 *   not there.
 *
 * A workspace still on the pages entry the route contract replaces predates
 * every group, so the upgrade's own plan stands: nothing there was removed.
 */
function withoutRemovedFiles(
  plan: StarterThemeWorkspaceUpgradePlan,
  existing: ReadonlyMap<string, ExistingFile>,
  storedVersion: number | null,
): {
  plan: StarterThemeWorkspaceUpgradePlan;
  kept: Map<string, StarterUpgradeKeptReason>;
} {
  const kept = new Map<string, StarterUpgradeKeptReason>();
  if (existing.has("src/pages/index.tsx")) return { plan, kept };
  const today = new Set(starterThemeWorkspaceFiles().map((file) => file.path));
  const planned = new Set(plan.files.map((file) => file.path));
  const absent = new Set<string>();
  for (const entry of STARTER_FILES_SHIPPED) {
    const missing = entry.paths.filter((path) => !existing.has(path));
    if (storedVersion !== null) {
      for (const path of missing) {
        if (!shippedIn(path, storedVersion)) continue;
        absent.add(path);
        kept.set(path, "missing");
      }
    } else if (missing.length < entry.paths.length) {
      for (const path of missing) {
        absent.add(path);
        kept.set(path, "missing");
      }
    } else {
      for (const path of missing) {
        absent.add(path);
        if (planned.has(path)) kept.set(path, "origin-unknown");
      }
    }
  }
  let files = plan.files.filter((file) => {
    if (!file.expectMissing) return true;
    if (absent.has(file.path)) return false;
    if (storedVersion !== null && !today.has(file.path)) {
      absent.add(file.path);
      return false;
    }
    return true;
  });
  for (;;) {
    const present = new Set([
      ...existing.keys(),
      ...files.map((file) => file.path),
    ]);
    const held = files.filter((file) =>
      relativeImports(file.content).some((specifier) => {
        const candidates = importCandidates(file.path, specifier);
        return (
          !candidates.some((path) => present.has(path)) &&
          candidates.some((path) => absent.has(path))
        );
      }),
    );
    if (held.length === 0) break;
    for (const file of held) {
      kept.set(file.path, "needs-missing");
      if (file.expectMissing) absent.add(file.path);
    }
    const heldPaths = new Set(held.map((file) => file.path));
    files = files.filter((file) => !heldPaths.has(file.path));
  }
  return { plan: { files, deletions: plan.deletions }, kept };
}

/**
 * What a Starter upgrade would do to these files, and what it leaves alone.
 *
 * Read only. The plan is the upgrade's own, with two differences: a file the
 * author changed is never edited, so the marker cleanup that Code mode's
 * bootstrap still does in place is reported as kept instead; and a file the
 * author removed, or may have removed, is not put back (see
 * `withoutRemovedFiles`).
 */
export function reviewStarterThemeUpgrade(
  existingFiles: ExistingFile[],
  options: {
    /** The recorded Starter version; `null` when none is recorded. */
    storedVersion: number | null;
  },
): StarterUpgradeReview {
  if (!starterUpgradeAppliesTo(existingFiles)) {
    const plan = { files: [], deletions: [] };
    return {
      applies: false,
      plan,
      changes: [],
      kept: [],
      digest: reviewPlanDigest(plan),
    };
  }
  const existing = new Map(existingFiles.map((file) => [file.path, file]));
  const { plan, kept } = withoutRemovedFiles(
    createStarterThemeWorkspaceUpgradePlan(existingFiles, {
      editAuthoredFiles: false,
    }),
    existing,
    options.storedVersion,
  );
  const changes: StarterUpgradeChange[] = [
    ...plan.files.map((file) => ({
      path: file.path,
      operation: file.expectMissing ? ("create" as const) : ("update" as const),
      before: existing.get(file.path)?.content ?? null,
      after: file.content,
    })),
    ...plan.deletions.map((file) => ({
      path: file.path,
      operation: "delete" as const,
      before: existing.get(file.path)?.content ?? null,
      after: null,
    })),
  ].sort(byPath);

  const planned = new Set(changes.map((change) => change.path));
  for (const file of createStarterThemeWorkspaceUpgradePlan(existingFiles)
    .files) {
    if (!planned.has(file.path) && !kept.has(file.path)) {
      kept.set(file.path, "markers-kept");
    }
  }
  // Against the files a Theme starts with today.
  for (const target of starterThemeWorkspaceFiles()) {
    if (planned.has(target.path) || kept.has(target.path)) continue;
    const file = existing.get(target.path);
    if (!file) kept.set(target.path, "missing");
    else if (file.content !== target.content) kept.set(target.path, "changed");
  }

  return {
    applies: true,
    plan,
    changes,
    kept: [...kept].map(([path, reason]) => ({ path, reason })).sort(byPath),
    digest: reviewPlanDigest(plan),
  };
}
