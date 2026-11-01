// @ts-check
/**
 * The CI rules: the files that decide which checks a merge needs and what
 * counts as passing them. A head that changes any of them needs the user's
 * approval for that head and its rules fingerprint.
 *
 * The merge tools read this list from both the main commit and the head
 * commit and use the union, so a head cannot hide a change by dropping a file
 * from the list; the algorithm itself is always main's. This file is on the
 * list, so changing the list or the algorithm is a rules change too.
 *
 *   node scripts/ci-rules.mjs <repo> <main-sha> <head-sha> [<extra-rules.json>]
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const CI_RULES_FINGERPRINT_VERSION = 2;

/**
 * A path ending in "/" covers every file below it. The runners are on it:
 * they choose the runtime, transport, Playwright arguments, minimum run
 * count, the files a shard runs and the exit code, so they decide whether a
 * check really tested anything and whether a failure is kept.
 */
export const CI_RULE_PATHS = Object.freeze([
  ".github/workflows/ci.yml",
  "playwright.config.ts",
  "scripts/check-container-acceptance.mjs",
  "scripts/check-e2e-shards.mjs",
  "scripts/check-e2e-start.mjs",
  "scripts/ci-required-checks.mjs",
  "scripts/ci-rules.mjs",
  "scripts/ci-workflow.mjs",
  "scripts/container-acceptance-targets/",
  "scripts/e2e-preview-runtime-guard.mjs",
  "scripts/editor-e2e-shards.mjs",
  "scripts/editor-e2e-start.mjs",
  "scripts/run-editor-e2e.mjs",
  "scripts/run-start-preview-shard.mjs",
  "scripts/verify-published-artifact.mjs",
  // Which preview runtime the runner expects a run to have used.
  "src/lib/storefront/theme-preview-runtime-default.mjs",
]);

/**
 * Local modules a rule file imports that are not rules themselves, each with
 * the reason. A rule file's import must be on one list or the other, so a new
 * dependency is decided, not missed.
 */
export const NOT_CI_RULES = Object.freeze({
  "scripts/e2e-machine-lock.mjs":
    "serialises local runs on one machine; it does not choose what runs or how it exits",
  "scripts/rebalance-e2e-shards.mjs":
    "the shard guard reads its budget projection as advisory annotations only; it fails nothing",
  "scripts/sidecar-observe-record.mjs":
    "records the local preview sidecar for diagnosis; never read for a result",
});

/**
 * @param {string} file
 * @param {readonly string[]} rules
 */
export function isRulePath(file, rules) {
  return rules.some((rule) =>
    rule.endsWith("/") ? file.startsWith(rule) : file === rule,
  );
}

/**
 * Both lists, each path once, in byte order.
 * @param {readonly string[]} rules
 * @param {readonly unknown[]} extra
 */
export function unionRules(rules, extra) {
  for (const rule of extra) {
    if (typeof rule !== "string" || !rule || rule.startsWith("/")) {
      throw new Error(`invalid rule path ${JSON.stringify(rule)}`);
    }
  }
  return [...new Set([...rules, .../** @type {string[]} */ (extra)])].sort(
    byteOrder,
  );
}

/**
 * The fingerprint of the rule files present in one tree. Each file counts
 * with its path and blob id, so an added, removed, renamed or edited rule
 * file changes it; the order is by path, whatever order git listed them in.
 * @param {ReadonlyArray<{path: string, blob: string}>} entries
 */
export function rulesFingerprint(entries) {
  const sorted = [...entries].sort((a, b) => byteOrder(a.path, b.path));
  const digest = createHash("sha256");
  digest.update(`morph-ci-rules:v${CI_RULES_FINGERPRINT_VERSION}\n`);
  sorted.forEach((entry, index) => {
    if (!/^[0-9a-f]{40,64}$/.test(entry.blob)) {
      throw new Error(`invalid blob id for ${entry.path}`);
    }
    if (index > 0 && sorted[index - 1].path === entry.path) {
      throw new Error(`${entry.path} is listed twice`);
    }
    digest.update(`${entry.path}\0${entry.blob}\n`);
  });
  return digest.digest("hex");
}

/**
 * Blob entries of `git ls-tree -r -z` output.
 * @param {string} output
 */
export function parseLsTree(output) {
  return output
    .split("\0")
    .filter(Boolean)
    .map((line) => {
      const match = /^\d+ (\w+) ([0-9a-f]+)\t(.+)$/s.exec(line);
      if (!match)
        throw new Error(`unexpected ls-tree line ${JSON.stringify(line)}`);
      return { type: match[1], blob: match[2], path: match[3] };
    })
    .filter((entry) => entry.type === "blob")
    .map(({ path, blob }) => ({ path, blob }));
}

/**
 * What a head changes in the rules relative to main, and the fingerprint the
 * user approves. `extraRules` is the head's CI_RULE_PATHS.
 * @param {{repo: string, main: string, head: string, extraRules?: readonly unknown[]}} options
 */
export function ciRulesReport({ repo, main, head, extraRules = [] }) {
  for (const sha of [main, head]) {
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`not a full sha: ${sha}`);
  }
  const git = (/** @type {string[]} */ ...args) =>
    execFileSync("git", ["-C", repo, ...args], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  const rules = unionRules(CI_RULE_PATHS, extraRules);
  const files = parseLsTree(git("ls-tree", "-r", "-z", "--full-tree", head))
    .filter((entry) => isRulePath(entry.path, rules))
    .sort((a, b) => byteOrder(a.path, b.path));
  // --no-renames: a renamed rule file shows as its old path removed and its
  // new path added, so moving a file out of the list is still a change.
  const changed = git(
    "diff",
    "--name-only",
    "-z",
    "--no-renames",
    `${main}...${head}`,
  )
    .split("\0")
    .filter((file) => file && isRulePath(file, rules))
    .sort(byteOrder);
  return {
    version: CI_RULES_FINGERPRINT_VERSION,
    rules,
    files,
    changedRules: changed,
    rulesSha256: rulesFingerprint(files),
  };
}

/**
 * @param {string} a
 * @param {string} b
 */
function byteOrder(a, b) {
  return Buffer.compare(Buffer.from(a), Buffer.from(b));
}

// Exact match: an importer whose own arguments end in "ci-rules.mjs" (the
// merge tools read CI_RULE_PATHS that way) must not run the command line.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [repo, main, head, extraFile] = process.argv.slice(2);
  if (!repo || !main || !head) {
    console.error(
      "Usage: node scripts/ci-rules.mjs <repo> <main-sha> <head-sha> [<extra-rules.json>]",
    );
    process.exit(1);
  }
  const extraRules = extraFile
    ? JSON.parse(readFileSync(extraFile, "utf8"))
    : [];
  if (!Array.isArray(extraRules))
    throw new Error("extra rules must be an array");
  console.log(
    JSON.stringify(ciRulesReport({ repo, main, head, extraRules }), null, 2),
  );
}
