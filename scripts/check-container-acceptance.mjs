// @ts-check
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * @typedef {{file: string, title: string, titlePath: string, statuses: string[], retries: number[], project: string}} ReportRecord
 */

/**
 * Every test in a Playwright JSON report. `titlePath` is the describe path
 * and the test title joined with " › ", without the file: the file-level
 * suite is the report's top level.
 * @param {any} report
 * @returns {ReportRecord[]}
 */
function reportRecords(report) {
  /** @type {ReportRecord[]} */
  const records = [];

  /**
   * @param {any} suite
   * @param {string} currentFile
   * @param {string[]} describes
   */
  function collect(suite, currentFile = "", describes = []) {
    const file = suite.file ? suite.file.replace(/\\/g, "/") : currentFile;
    if (suite.specs) {
      for (const spec of suite.specs) {
        const specFile = spec.file ? spec.file.replace(/\\/g, "/") : file;
        for (const test of spec.tests ?? []) {
          const results = test.results ?? [];
          records.push({
            file: specFile,
            title: spec.title ?? "",
            titlePath: [...describes, spec.title ?? ""].join(" › "),
            statuses: results.map((/** @type {any} */ r) => r.status),
            retries: results.map((/** @type {any} */ r) => r.retry ?? 0),
            project: test.projectName ?? "",
          });
        }
      }
    }
    if (suite.suites) {
      for (const child of suite.suites) {
        collect(child, file, [...describes, child.title ?? ""]);
      }
    }
  }

  for (const suite of report.suites) {
    collect(suite);
  }
  return records;
}

/**
 * Validates that the M1 container lifecycle acceptance test actually ran,
 * passed, had zero retries, and had zero skips in the Playwright JSON report.
 *
 * @param {any} report
 * @param {string} [targetFile]
 */
export function verifyContainerReport(
  report,
  targetFile = "m1-container-lifecycle-acceptance.spec.ts",
) {
  assert.ok(report && typeof report === "object", "Report must be an object");
  assert.ok(Array.isArray(report.suites), "Report must contain suites array");

  const records = reportRecords(report);

  const editorRecords = records.filter(
    (r) => r.project === "editor" || !r.project,
  );
  const targetRecords = editorRecords.filter((r) =>
    r.file.endsWith(targetFile),
  );

  assert.ok(
    targetRecords.length > 0,
    `CONTAINER_ACCEPTANCE_SPEC_MISSING: ${targetFile} was not found in the test report. Found files: ${[...new Set(editorRecords.map((r) => r.file))].join(", ") || "none"}`,
  );

  for (const record of targetRecords) {
    const { title, statuses } = record;
    assert.ok(
      statuses.length > 0,
      `CONTAINER_ACCEPTANCE_NO_RESULT: ${title} ended without any result statuses.`,
    );
    assert.equal(
      statuses.length,
      1,
      `CONTAINER_ACCEPTANCE_RETRY_DETECTED: ${title} had ${statuses.length} attempts (${statuses.join(", ")}); zero retry is required.`,
    );
    assert.ok(
      !statuses.includes("skipped"),
      `CONTAINER_ACCEPTANCE_SKIPPED: ${title} was skipped; zero skip is required for closed-loop verification.`,
    );
    assert.ok(
      statuses.every((s) => s === "passed"),
      `CONTAINER_ACCEPTANCE_FAILED: ${title} ended with status ${statuses.join(", ")}; must pass.`,
    );
  }

  if (report.stats) {
    assert.equal(
      report.stats.unexpected ?? 0,
      0,
      `Unexpected failures detected in report stats: ${report.stats.unexpected}`,
    );
    assert.equal(
      report.stats.flaky ?? 0,
      0,
      `Flaky tests detected in report stats: ${report.stats.flaky}`,
    );
  }

  return { passedCount: targetRecords.length };
}

/**
 * Validates that a container step ran exactly the listed tests of one spec
 * file, each once, in the `editor` project, passed on its first and only
 * attempt. The list is matched by full title (describe path and test title),
 * so a renamed, filtered-out or added test fails instead of being counted.
 * Tests of other files (the auth setup, the transport precondition) are
 * neither counted nor required.
 *
 * @param {any} report
 * @param {{file: string, titles: readonly string[]}} target
 */
export function verifyContainerTitles(report, target) {
  assert.ok(report && typeof report === "object", "Report must be an object");
  assert.ok(Array.isArray(report.suites), "Report must contain suites array");
  assert.ok(
    target && typeof target.file === "string" && target.file.length > 0,
    "Target must name a spec file",
  );
  assert.ok(
    Array.isArray(target.titles) && target.titles.length > 0,
    "Target must list at least one expected title",
  );
  assert.equal(
    new Set(target.titles).size,
    target.titles.length,
    "Target lists a title twice",
  );

  const inFile = reportRecords(report).filter((r) =>
    r.file.endsWith(target.file),
  );
  assert.deepEqual(
    inFile
      .filter((r) => r.project !== "editor")
      .map((r) => `${r.project || "(no project)"}: ${r.titlePath}`),
    [],
    `CONTAINER_ACCEPTANCE_WRONG_PROJECT: ${target.file} ran outside the editor project`,
  );
  assert.deepEqual(
    inFile
      .filter((r) => !target.titles.includes(r.titlePath))
      .map((r) => r.titlePath),
    [],
    `CONTAINER_ACCEPTANCE_UNLISTED: ${target.file} ran tests that are not on the list; the step must select exactly the listed tests`,
  );

  for (const title of target.titles) {
    const found = inFile.filter((r) => r.titlePath === title);
    assert.ok(
      found.length > 0,
      `CONTAINER_ACCEPTANCE_MISSING: ${title} is not in the report`,
    );
    assert.equal(
      found.length,
      1,
      `CONTAINER_ACCEPTANCE_DUPLICATE: ${title} appears ${found.length} times in the report`,
    );
    const [{ statuses, retries }] = found;
    assert.ok(
      statuses.length > 0,
      `CONTAINER_ACCEPTANCE_NO_RESULT: ${title} ended without any result statuses.`,
    );
    assert.ok(
      statuses.length === 1 && retries[0] === 0,
      `CONTAINER_ACCEPTANCE_RETRY_DETECTED: ${title} had ${statuses.length} attempt(s) (${statuses.join(", ")}; retry ${retries.join(", ")}); zero retry is required.`,
    );
    assert.notEqual(
      statuses[0],
      "skipped",
      `CONTAINER_ACCEPTANCE_SKIPPED: ${title} was skipped; zero skip is required for closed-loop verification.`,
    );
    assert.equal(
      statuses[0],
      "passed",
      `CONTAINER_ACCEPTANCE_FAILED: ${title} ended with status ${statuses[0]}; must pass.`,
    );
  }

  if (report.stats) {
    assert.equal(
      report.stats.unexpected ?? 0,
      0,
      `Unexpected failures detected in report stats: ${report.stats.unexpected}`,
    );
    assert.equal(
      report.stats.flaky ?? 0,
      0,
      `Flaky tests detected in report stats: ${report.stats.flaky}`,
    );
  }

  return { passedCount: target.titles.length };
}

/**
 * A top-level skip call (`test.skip` at column 0) whose condition holds whenever
 * the container transport is not in use. Every CI editor shard sets a
 * transport (the runner defaults to local-sidecar), so a spec carrying one
 * skips on every shard, and only a container step ever runs it. The
 * condition is the call's first argument, up to its first comma; a skip
 * inside a test or a describe is indented and not matched.
 */
const CONTAINER_ONLY_SKIP =
  /^test\.skip\(\s*([^,]*!==\s*"cloudflare-sandbox")\s*,/m;

/**
 * Whether a spec's source skips the whole file off the container transport.
 * @param {string} source
 */
export function isContainerOnlySpec(source) {
  return CONTAINER_ONLY_SKIP.test(source);
}

/**
 * Container-only specs no target module names, each with the reason it
 * runs outside a target module or not in CI at all. Nothing else may be
 * container-only without a target module (findUncoveredContainerSpecs).
 * A spec that gains a target module, or loses its container-only skip,
 * must leave this list in the same change.
 *
 * Exemptions: the spec is run by CI another way, or genuinely cannot run in
 * CI today.
 * @type {Readonly<Record<string, string>>}
 */
export const CONTAINER_SPEC_EXEMPTIONS = Object.freeze({
  "m1-container-lifecycle-acceptance.spec.ts":
    "Run by editor-e2e-container in file mode: its check is this script's default target, every test of the file passed once with zero skip and zero retry.",
  "astro-island-hmr.spec.ts":
    "Astro container E2E is local only for M2 (owner decision D4, 2026-11-26), and no CI job sets MORPH_ASTRO_THEMES=1; the CI job that wires Astro adds its target.",
  "astro-preview-container.spec.ts":
    "Astro container E2E is local only for M2 (owner decision D4, 2026-11-26), and no CI job sets MORPH_ASTRO_THEMES=1; the CI job that wires Astro adds its target.",
  "astro-publish-acceptance.spec.ts":
    "Astro container E2E is local only for M2 (owner decision D4, 2026-11-26), and no CI job sets MORPH_ASTRO_THEMES=1; the CI job that wires Astro adds its target.",
});

/**
 * Container-only specs found without a target module when this check was
 * added (2026-11-28). Nothing is known to stop them running in CI; they are
 * listed so the check can start enforcing, not because they may stay. Each
 * leaves this list in the change that gives it a target module and a CI
 * step. Never add to it: a new container-only spec needs a target module.
 * @type {Readonly<Record<string, string>>}
 */
export const UNWIRED_CONTAINER_SPECS = Object.freeze({
  "build-preview-isolated.spec.ts":
    "The isolated Build Preview in a real container; no target module or CI step yet.",
  "publish-layout-edit.spec.ts":
    "A shared layout edit published; no target module or CI step yet.",
  "publish.spec.ts":
    "The publish loop; its skip spares an unset transport, but every CI shard sets one. No target module or CI step yet.",
  "source-asset-publish.spec.ts":
    "src/ binaries through build, publish and rollback; no target module or CI step yet.",
});

/**
 * The container-only specs that no target module names and no list above
 * accounts for, and the list entries that no longer apply.
 *
 * @param {{
 *   specs: readonly {file: string, source: string}[],
 *   targetFiles: readonly string[],
 *   exemptions?: Readonly<Record<string, string>>,
 *   unwired?: Readonly<Record<string, string>>,
 * }} input `file` is the spec's base name, as target modules name it.
 */
export function findUncoveredContainerSpecs({
  specs,
  targetFiles,
  exemptions = CONTAINER_SPEC_EXEMPTIONS,
  unwired = UNWIRED_CONTAINER_SPECS,
}) {
  const named = new Set(targetFiles);
  const listed = { ...exemptions, ...unwired };
  const containerOnly = specs
    .filter(({ source }) => isContainerOnlySpec(source))
    .map(({ file }) => file);
  const uncovered = containerOnly
    .filter((file) => !named.has(file) && !(file in listed))
    .sort();
  /** @type {string[]} */
  const stale = [];
  for (const file of Object.keys(listed).sort()) {
    if (file in exemptions && file in unwired) {
      stale.push(`${file}: listed both as an exemption and as unwired`);
    } else if (named.has(file)) {
      stale.push(`${file}: a target module names it now`);
    } else if (!containerOnly.includes(file)) {
      stale.push(`${file}: no longer a container-only spec (or gone)`);
    }
  }
  for (const [file, reason] of Object.entries(listed)) {
    if (typeof reason !== "string" || reason.trim().length === 0) {
      stale.push(`${file}: listed without a reason`);
    }
  }
  return { uncovered, stale };
}

/**
 * Every spec under `<root>/e2e` and every target module's `file` under
 * `<root>/scripts/container-acceptance-targets`, read from disk.
 * @param {string} root
 */
export async function readContainerCoverage(root) {
  const e2e = path.join(root, "e2e");
  const specs = readdirSync(e2e, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".spec.ts"))
    .map((name) => ({
      file: path.basename(name),
      source: readFileSync(path.join(e2e, name), "utf8"),
    }));
  const targetsDir = path.join(root, "scripts", "container-acceptance-targets");
  /** @type {string[]} */
  const targetFiles = [];
  for (const name of readdirSync(targetsDir).filter((n) => n.endsWith(".mjs"))) {
    const { TARGET } = await import(
      pathToFileURL(path.join(targetsDir, name)).href
    );
    targetFiles.push(TARGET.file);
  }
  return { specs, targetFiles };
}

if (
  process.argv[1] &&
  process.argv[1].endsWith("check-container-acceptance.mjs") &&
  process.argv[2] === "--coverage"
) {
  // node scripts/check-container-acceptance.mjs --coverage [<repo root>]
  const root = path.resolve(process.argv[3] ?? ".");
  const { uncovered, stale } = findUncoveredContainerSpecs(
    await readContainerCoverage(root),
  );
  for (const file of uncovered) {
    console.error(
      `CONTAINER_SPEC_UNCOVERED: e2e/${file} skips off the container transport at file level, so every CI editor shard skips it, and no container target module (scripts/container-acceptance-targets/) names it. Add a target module and a container CI step for it.`,
    );
  }
  for (const entry of stale) {
    console.error(`CONTAINER_SPEC_LIST_STALE: ${entry}`);
  }
  if (uncovered.length > 0 || stale.length > 0) process.exit(1);
  console.log(
    "Every container-only spec is named by a container target module or listed with its reason.",
  );
} else if (
  process.argv[1] &&
  process.argv[1].endsWith("check-container-acceptance.mjs")
) {
  const [reportPath, targetPath] = process.argv.slice(2);
  if (!reportPath) {
    console.error(
      "Usage: node scripts/check-container-acceptance.mjs <report-path> [<target-module>.mjs | <spec-file>]",
    );
    process.exit(1);
  }
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  if (!targetPath || !targetPath.endsWith(".mjs")) {
    // File mode, kept for compatibility: every test of one spec file (the
    // lifecycle spec by default) must have passed. New CI steps use a target
    // module instead, which also refuses a missing or unlisted test.
    const { passedCount } = verifyContainerReport(report, targetPath);
    console.log(
      `${targetPath ?? "M1 container lifecycle"} acceptance verified: ${passedCount} target test(s) passed with zero skip and zero retry.`,
    );
  } else {
    // A target module exports TARGET = { file, titles }: the exact tests one
    // container step must run, reviewed with that step
    // (scripts/container-acceptance-targets/).
    const { TARGET } = await import(
      pathToFileURL(path.resolve(targetPath)).href
    );
    const { passedCount } = verifyContainerTitles(report, TARGET);
    console.log(
      `Container acceptance verified for ${TARGET.file}: all ${passedCount} listed test(s) passed once, with zero skip and zero retry.`,
    );
  }
}
