// @ts-check
/**
 * Every check a pull request's CI run must report before `pnpm ship` merges.
 *
 * One list, read by `decide()` in ship.mjs and compared with ci.yml's job names
 * by check-e2e-shards.mjs (verifyCheckNameContract). Without it, ship waited
 * only for the checks already in the rollup: a job renamed, removed or never
 * created simply stopped being waited for, and a green partial rollup merged.
 *
 * Adding, renaming or removing a CI job means changing this list in the same
 * pull request; the name contract fails otherwise.
 */
import { EDITOR_SHARD_COUNT } from "./editor-e2e-shards.mjs";
import {
  START_PREVIEW_JOB_NAME,
  START_PREVIEW_SHARD_COUNT,
} from "./editor-e2e-start.mjs";

/**
 * The one check `main`'s branch protection requires, spelled the way GitHub
 * reports it. See the note above `name: Architecture guards` in ci.yml: the
 * branch protection rule holds another copy that nothing here can check.
 */
export const REQUIRED_CHECK = "Architecture guards";

export const VALIDATE_CHECK = "Typecheck, test, build";
export const VALIDATION_CHECKS = [
  "Validation typecheck",
  "Validation tests",
  "Validation build",
];

/** The aggregate job that says every shard ran (`needs:` the shard matrix). */
export const E2E_ACCEPTANCE_CHECK =
  "Editor end-to-end (local preview transport)";

export const CONTAINER_ACCEPTANCE_CHECK =
  "Editor E2E container lifecycle acceptance";

/** @param {number} shard @param {number} [count] */
export const editorShardCheckName = (shard, count = EDITOR_SHARD_COUNT) =>
  `Editor E2E shard ${shard}/${count}`;

/** One name per planned shard, derived from the plan rather than written out. */
export const EDITOR_SHARD_CHECKS = Array.from(
  { length: EDITOR_SHARD_COUNT },
  (_, index) => editorShardCheckName(index + 1),
);

export const START_PREVIEW_SHARD_CHECKS = Array.from(
  { length: START_PREVIEW_SHARD_COUNT },
  (_, index) =>
    `Editor E2E full Start shard ${index + 1}/${START_PREVIEW_SHARD_COUNT}`,
);

/** Every one of these must be present and report SUCCESS itself. */
export const EXPECTED_CI_CHECKS = [
  REQUIRED_CHECK,
  VALIDATE_CHECK,
  ...VALIDATION_CHECKS,
  START_PREVIEW_JOB_NAME,
  ...START_PREVIEW_SHARD_CHECKS,
  ...EDITOR_SHARD_CHECKS,
  E2E_ACCEPTANCE_CHECK,
  CONTAINER_ACCEPTANCE_CHECK,
];

/**
 * A check GitHub creates only once the checks it `needs:` have finished. While
 * those are all present and green, its absence means "not created yet" rather
 * than "gone", so ship waits for it (bounded by ship's deadline) instead of
 * refusing in the seconds between the last shard and the acceptance job.
 * @type {Record<string, string[]>}
 */
export const CHECK_DEPENDENCIES = {
  [VALIDATE_CHECK]: VALIDATION_CHECKS,
  [E2E_ACCEPTANCE_CHECK]: EDITOR_SHARD_CHECKS,
  [START_PREVIEW_JOB_NAME]: START_PREVIEW_SHARD_CHECKS,
};
