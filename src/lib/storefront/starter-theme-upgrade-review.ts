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
 */
export type StarterUpgradeKeptReason = "changed" | "missing" | "markers-kept";

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

function planDigest(plan: StarterThemeWorkspaceUpgradePlan): string {
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

/**
 * What a Starter upgrade would do to these files, and what it leaves alone.
 *
 * Read only. The plan is the upgrade's own, with one difference: a file the
 * author changed is never edited, so the marker cleanup that Code mode's
 * bootstrap still does in place is reported as kept instead.
 */
export function reviewStarterThemeUpgrade(
  existingFiles: ExistingFile[],
): StarterUpgradeReview {
  if (!starterUpgradeAppliesTo(existingFiles)) {
    const plan = { files: [], deletions: [] };
    return {
      applies: false,
      plan,
      changes: [],
      kept: [],
      digest: planDigest(plan),
    };
  }
  const existing = new Map(existingFiles.map((file) => [file.path, file]));
  const plan = createStarterThemeWorkspaceUpgradePlan(existingFiles, {
    editAuthoredFiles: false,
  });
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
  const kept = new Map<string, StarterUpgradeKeptReason>();
  for (const file of createStarterThemeWorkspaceUpgradePlan(existingFiles)
    .files) {
    if (!planned.has(file.path)) kept.set(file.path, "markers-kept");
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
    digest: planDigest(plan),
  };
}
