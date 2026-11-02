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
 * - `new-in-starter`: a page the Starter has now and this Theme does not
 *   (`STARTER_OPTIONAL_ROUTES`). It is added only when the author selects it
 *   (`StarterUpgradeReview.optional`); nothing says the author removed it.
 * - `needs-route`: its upgrade would add a link to one of those pages while
 *   the Theme does not have it, so it is left as it is rather than written to
 *   link to nothing.
 * - `page-not-in-theme`: one of those pages, absent while the Theme has the
 *   other. It is not added and not offered, and nothing says why it is
 *   absent: the files cannot tell a removal from a page that was never there.
 */
export type StarterUpgradeKeptReason =
  | "changed"
  | "missing"
  | "markers-kept"
  | "needs-missing"
  | "origin-unknown"
  | "new-in-starter"
  | "needs-route"
  | "page-not-in-theme";

export type StarterUpgradeKept = {
  path: string;
  reason: StarterUpgradeKeptReason;
};

/** One reviewed plan: what it writes, what it keeps, and its digest. */
export type StarterUpgradePlanReview = {
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
 * The same review with the Starter's new pages selected. Its own plan and
 * digest: applying it is the author sending this digest instead of the
 * review's, so a selection is never inferred, and never outlives the plan it
 * was made against.
 */
export type StarterUpgradeOptionalAdd = StarterUpgradePlanReview & {
  /** The pages it adds, each `new-in-starter` in the review without it. */
  paths: string[];
  /** Each page it adds, with the path it serves and what it is for. */
  pages: StarterOptionalRoute[];
};

/** A Starter page that is only ever added when the author selects it. */
export type StarterOptionalRoute = {
  path: string;
  route: string;
  /** What the page is for, as the review tells the author. */
  purpose: string;
};

export type StarterUpgradeReview = StarterUpgradePlanReview & {
  /** False for a workspace of another framework: nothing here is for it. */
  applies: boolean;
  /**
   * The Starter's new pages, offered for the author to select; `null` when
   * none is offered. Not part of `plan`: without the author's selection they
   * are not created.
   */
  optional: StarterUpgradeOptionalAdd | null;
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

/**
 * Pages the Starter has now that some Themes never started with, and the
 * path each serves.
 *
 * Both were added by commit f010e91 without a version bump: version 27 spans
 * source-first Themes created without them (52e760b, 2c49fe5) and with them
 * (f010e91 on), and version 26 spans 97e9474, created without them. So
 * neither the recorded version nor the files can tell a Theme that never had
 * them from one whose author removed them, and a version recorded by a later
 * upgrade says nothing about them either. A source-first Theme without them
 * is offered them, unselected, at every review; only the author's selection
 * adds them, and not selecting them is never read as having removed them.
 */
export const STARTER_OPTIONAL_ROUTES: ReadonlyArray<StarterOptionalRoute> = [
  {
    path: "src/routes/account.tsx",
    route: "/account",
    purpose:
      "Customer account page (/account): the signed-in customer's details, addresses and orders. The Starter's Header links to it.",
  },
  {
    path: "src/routes/order-transfer.tsx",
    route: "/order-transfer",
    purpose:
      "Order transfer confirmation page (/order-transfer): where a customer accepts or declines an order transfer. The confirmation links Morph sends point to it.",
  },
];

/**
 * Whether a source file names `route` as a link target: a string literal that
 * is the path itself, or the path followed by `/`, `?` or `#`. Only ever asked
 * of Starter-written bytes, which link with plain literals.
 */
function linksToRoute(content: string, route: string): boolean {
  const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(["'\`])${escaped}(?:[/?#][^"'\`]*)?\\1`).test(content);
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
 * - The Starter's new pages the author selected (`add`) are created; those
 *   offered and not selected are `new-in-starter`.
 * - A planned file that would import any of those is held back, as
 *   `needs-missing`, and one whose new bytes add a link to a page in
 *   `STARTER_OPTIONAL_ROUTES` the Theme will not have is held back, as
 *   `needs-route`, until nothing left in the plan points at a file that is
 *   not there.
 *
 * A workspace still on the pages entry the route contract replaces predates
 * every group, so the upgrade's own plan stands: nothing there was removed.
 */
function withoutRemovedFiles(
  plan: StarterThemeWorkspaceUpgradePlan,
  existing: ReadonlyMap<string, ExistingFile>,
  storedVersion: number | null,
  offered: readonly string[],
  add: readonly string[],
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
  const todayFiles = new Map(
    starterThemeWorkspaceFiles().map((file) => [file.path, file] as const),
  );
  for (const path of offered) {
    const file = todayFiles.get(path);
    if (!add.includes(path) || !file || existing.has(path)) {
      kept.set(path, "new-in-starter");
      continue;
    }
    files.push({
      path,
      content: file.content,
      mimeType: file.mimeType,
      expectMissing: true,
    });
  }
  for (;;) {
    const present = new Set([
      ...existing.keys(),
      ...files.map((file) => file.path),
    ]);
    const importsAbsent = (file: (typeof files)[number]) =>
      relativeImports(file.content).some((specifier) => {
        const candidates = importCandidates(file.path, specifier);
        return (
          !candidates.some((path) => present.has(path)) &&
          candidates.some((path) => absent.has(path))
        );
      });
    // A link the file does not have today, to a page the Theme will not have.
    const linksAbsentRoute = (file: (typeof files)[number]) => {
      const before = existing.get(file.path)?.content ?? "";
      return STARTER_OPTIONAL_ROUTES.some(
        ({ path, route }) =>
          !present.has(path) &&
          linksToRoute(file.content, route) &&
          !linksToRoute(before, route),
      );
    };
    const held: {
      file: (typeof files)[number];
      reason: StarterUpgradeKeptReason;
    }[] = [];
    for (const file of files) {
      if (importsAbsent(file)) held.push({ file, reason: "needs-missing" });
      else if (linksAbsentRoute(file))
        held.push({ file, reason: "needs-route" });
    }
    if (held.length === 0) break;
    for (const { file, reason } of held) {
      kept.set(file.path, reason);
      if (file.expectMissing) absent.add(file.path);
    }
    const heldPaths = new Set(held.map(({ file }) => file.path));
    files = files.filter((file) => !heldPaths.has(file.path));
  }
  return { plan: { files, deletions: plan.deletions }, kept };
}

/**
 * The Starter's new pages this Theme is offered: those it does not have, on
 * a source-first workspace whose upgrade would not add them by itself.
 *
 * Decided from the files alone. The recorded version does not enter into it:
 * 26 and 27 span Themes with and without them, and a Theme that declined
 * them still records the current version afterwards. Not offered when the
 * Theme has one of them; the other is `page-not-in-theme`.
 */
function offeredStarterRoutes(
  existing: ReadonlyMap<string, ExistingFile>,
  plan: StarterThemeWorkspaceUpgradePlan,
): string[] {
  if (existing.has("src/pages/index.tsx")) return [];
  if (STARTER_OPTIONAL_ROUTES.some(({ path }) => existing.has(path))) return [];
  const planned = new Set(plan.files.map((file) => file.path));
  const today = new Set(starterThemeWorkspaceFiles().map((file) => file.path));
  return STARTER_OPTIONAL_ROUTES.map(({ path }) => path).filter(
    (path) => today.has(path) && !planned.has(path),
  );
}

/** The review of one plan: its changes, its kept files and its digest. */
function reviewPlan(
  existingFiles: ExistingFile[],
  existing: ReadonlyMap<string, ExistingFile>,
  plan: StarterThemeWorkspaceUpgradePlan,
  kept: Map<string, StarterUpgradeKeptReason>,
): StarterUpgradePlanReview {
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
  // Against the files a Theme starts with today. The Starter's new pages
  // are not counted as removed: the files cannot tell.
  const optional = new Set(STARTER_OPTIONAL_ROUTES.map(({ path }) => path));
  for (const target of starterThemeWorkspaceFiles()) {
    if (planned.has(target.path) || kept.has(target.path)) continue;
    const file = existing.get(target.path);
    if (!file)
      kept.set(
        target.path,
        optional.has(target.path) ? "page-not-in-theme" : "missing",
      );
    else if (file.content !== target.content) kept.set(target.path, "changed");
  }

  return {
    plan,
    changes,
    kept: [...kept].map(([path, reason]) => ({ path, reason })).sort(byPath),
    digest: reviewPlanDigest(plan),
  };
}

/**
 * What a Starter upgrade would do to these files, and what it leaves alone.
 *
 * Read only. The plan is the upgrade's own, with two differences: a file the
 * author changed is never edited, so the marker cleanup that Code mode's
 * bootstrap still does in place is reported as kept instead; and a file the
 * author removed, or may have removed, is not put back (see
 * `withoutRemovedFiles`).
 *
 * The Starter's new pages a Theme may never have had are not in the plan.
 * When offered, `optional` is the same review with them selected: its own
 * plan, which creates them and lets through what links to them, and its own
 * digest.
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
      optional: null,
    };
  }
  const existing = new Map(existingFiles.map((file) => [file.path, file]));
  const upgrade = createStarterThemeWorkspaceUpgradePlan(existingFiles, {
    editAuthoredFiles: false,
  });
  const offered = offeredStarterRoutes(existing, upgrade);
  const variant = (add: readonly string[]) => {
    const { plan, kept } = withoutRemovedFiles(
      upgrade,
      existing,
      options.storedVersion,
      offered,
      add,
    );
    return reviewPlan(existingFiles, existing, plan, kept);
  };
  return {
    applies: true,
    ...variant([]),
    optional:
      offered.length === 0
        ? null
        : {
            ...variant(offered),
            paths: offered,
            pages: STARTER_OPTIONAL_ROUTES.filter(({ path }) =>
              offered.includes(path),
            ),
          },
  };
}
