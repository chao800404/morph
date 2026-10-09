import type { CyclePlanSummary } from "./sync-session";

/**
 * What `morph-sync` may approve without a person, and what a person is shown
 * when they are asked.
 *
 * - `--yes` approves only the changes made while sync was not running. It
 *   never approves a mass deletion.
 * - `--allow-mass-delete` approves one mass deletion: the first one of this
 *   run. A second one in the same run stops like any other, so the flag
 *   cannot become a standing permission.
 * - A terminal that cannot be asked gets "no".
 */

export type ConfirmReason = "startup" | "mass-deletion";
export type ConfirmDecision = "yes" | "no" | "ask";

export function createConfirmPolicy(options: {
  yes: boolean;
  allowMassDelete: boolean;
  interactive: boolean;
  dryRun?: boolean;
}) {
  let massApprovalsLeft = options.allowMassDelete ? 1 : 0;
  return {
    decide(why: ConfirmReason): ConfirmDecision {
      if (options.dryRun) return "no";
      if (why === "startup") {
        if (options.yes) return "yes";
        return options.interactive ? "ask" : "no";
      }
      if (massApprovalsLeft > 0) {
        massApprovalsLeft -= 1;
        return "yes";
      }
      return options.interactive ? "ask" : "no";
    },
  };
}

/** Above this many, the deletion list goes to a file instead of the screen. */
export const INLINE_DELETION_LIMIT = 50;

/**
 * The lines shown before a mass deletion is approved: where it would happen
 * (Morph address, store, Theme, folder) and every file it would delete. A
 * list too long for the screen is written to `listFile` in full and named.
 */
export function describeMassDeletion(input: {
  origin: string;
  storefrontId: string;
  themeId: string;
  folder: string;
  summary: CyclePlanSummary;
  listFile: string;
}): { lines: string[]; fileContent: string | null } {
  const { summary } = input;
  const deletions = [
    ...summary.remoteDeletions.map((path) => `delete from Morph: ${path}`),
    ...summary.localDeletions.map((path) => `delete locally:    ${path}`),
  ];
  const lines = [
    `Mass deletion: ${summary.massDeletion ?? "deletions need a yes"}`,
    `  Morph:  ${input.origin}`,
    `  Store:  ${input.storefrontId}`,
    `  Theme:  ${input.themeId}`,
    `  Folder: ${input.folder}`,
    `  ${summary.remoteDeletions.length} from Morph, ${summary.localDeletions.length} locally:`,
  ];
  if (deletions.length <= INLINE_DELETION_LIMIT) {
    return { lines: [...lines, ...deletions.map((line) => `    ${line}`)], fileContent: null };
  }
  return {
    lines: [...lines, `    all ${deletions.length} are listed in ${input.listFile}`],
    fileContent: `${deletions.join("\n")}\n`,
  };
}
