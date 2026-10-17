// @ts-check
/**
 * Reading `.github/workflows/ci.yml` one job at a time.
 *
 * The static guards compare the workflow with plans it cannot import. Matching
 * against the whole file let a spelling in one job satisfy a rule about
 * another, so each rule reads the block of the job it is about.
 */
import assert from "node:assert/strict";

/**
 * The job's block of ci.yml: from its key to the next top-level job.
 * @param {string} workflow
 * @param {string} key
 */
export function jobBlock(workflow, key) {
  const start = workflow.indexOf(`\n  ${key}:\n`);
  assert.ok(start >= 0, `ci.yml must define the ${key} job`);
  const rest = workflow.slice(start + 1);
  const next = /\n {2}[A-Za-z0-9_-]+:\n/.exec(rest.slice(1));
  return next ? rest.slice(0, next.index + 1) : rest;
}

/**
 * A block without its comment lines, so a comment quoting a rule's spelling
 * cannot satisfy that rule.
 * @param {string} block
 */
export function withoutComments(block) {
  return block
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
}

/**
 * The keys of every job under `jobs:`, in file order.
 * @param {string} workflow
 */
export function jobKeys(workflow) {
  const start = workflow.indexOf("\njobs:\n");
  assert.ok(start >= 0, "ci.yml must have a jobs: section");
  return [
    ...workflow.slice(start).matchAll(/^ {2}([A-Za-z0-9_-]+):[ \t]*$/gm),
  ].map((match) => match[1]);
}

/**
 * The check names a job reports: its `name:` (its key when it has none), with
 * `${{ matrix.shard }}` expanded over the job's own `shard:` matrix. Other
 * expressions stay as written, so a name built from one cannot match a plan.
 * @param {string} workflow
 * @param {string} key
 */
export function jobCheckNames(workflow, key) {
  const block = withoutComments(jobBlock(workflow, key));
  const name = /^ {4}name:[ \t]*(.+?)[ \t]*$/m.exec(block)?.[1] ?? key;
  if (!name.includes("${{ matrix.shard }}")) return [name];
  const matrix = /^\s+shard:\s*\[([^\]]*)\]/m.exec(block);
  if (!matrix) return [name];
  return matrix[1]
    .split(",")
    .map((value) => name.replaceAll("${{ matrix.shard }}", value.trim()));
}

/**
 * Every check name the workflow's jobs report.
 * @param {string} workflow
 */
export function workflowCheckNames(workflow) {
  return jobKeys(workflow).flatMap((key) => jobCheckNames(workflow, key));
}
