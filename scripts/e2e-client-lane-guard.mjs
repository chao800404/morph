// @ts-check
/**
 * The client lane: the six editor E2E shards, which run the client-only
 * preview. Its migrated specs open dedicated Themes on the pinned Starter 31
 * workspace (`CLIENT_LANE_STARTER_FIXTURE`), whatever the current Starter is,
 * so that a Starter that makes new Themes record the full Start preview does
 * not quietly move the lane off a real client Theme.
 *
 * How the Themes are made and checked:
 *
 * 1. `e2e/auth.setup.ts`, once the store exists and before any editor opens,
 *    runs `scripts/client-lane-theme/seed.ts`, which seeds one Theme per
 *    `CLIENT_LANE_THEME_SLOTS` entry through the product's DAL in Node against
 *    the run's own D1 (no HTTP entry), reads each back from the SQLite file,
 *    refuses unless `clientLaneThemeRefusal` passes, and writes
 *    `CLIENT_LANE_THEMES_FILE`: each slot's Theme, editor path and what was
 *    read back.
 * 2. A spec takes its slot's Theme through `e2e/helpers/client-lane-theme.ts`,
 *    which appends a line to `CLIENT_LANE_USES_FILE`.
 * 3. After the suite the runner reads each seeded Theme's stored runtime again
 *    and keeps `clientLaneVerdict` beside the report, refusing the run unless
 *    it passes. Specs may edit a Theme's files; its runtime must still be
 *    none, served as the client-only preview by the Worker's own binding.
 * 4. The acceptance job re-checks every shard's verdict against this
 *    checkout's fixture (`clientLaneVerdictsRefusal`) and requires every slot
 *    to have been taken by some shard.
 *
 * Missing or unreadable evidence is a refusal, never a pass.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EDITOR_SHARD_COUNT } from "./editor-e2e-shards.mjs";
import {
  THEME_PREVIEW_RUNTIME_VAR,
  resolveThemePreviewRuntime,
} from "../src/lib/storefront/theme-preview-runtime-default.mjs";

/** Where the seed writes the Themes, for the specs; set by the runner. */
export const CLIENT_LANE_THEMES_VAR = "MORPH_E2E_CLIENT_LANE_THEMES";
/** Where specs record each Theme they take; set by the runner. */
export const CLIENT_LANE_USES_VAR = "MORPH_E2E_CLIENT_LANE_USES";
/**
 * Set in CI on each client shard: the runner refuses the run unless it is a
 * client-lane run, so a shard whose settings moved off the lane fails instead
 * of quietly skipping the lane check.
 */
export const REQUIRE_CLIENT_LANE_VAR = "MORPH_E2E_REQUIRE_CLIENT_LANE";

/** In the run's state directory. */
export const CLIENT_LANE_THEMES_FILE = "client-lane-themes.json";
export const CLIENT_LANE_USES_FILE = "client-lane-uses.jsonl";
/** Beside the Playwright report: `<report>${CLIENT_LANE_VERDICT_SUFFIX}`. */
export const CLIENT_LANE_VERDICT_SUFFIX = ".client-lane.json";

export const CLIENT_LANE_STARTER_VERSION = 31;
export const CLIENT_LANE_STARTER_FIXTURE =
  "src/lib/storefront/__fixtures__/starter-workspace/v31.json";

/**
 * One dedicated Theme per slot, each taken by the spec named in it. A spec
 * that needs a Theme no other spec has touched takes a slot of its own.
 */
export const CLIENT_LANE_THEME_SLOTS = /** @type {const} */ ([
  // editor.spec.ts: create/populate/remove a page; a style edit and undo.
  "editor",
  // selection-field-frame-navigated.spec.ts, one per describe block (the
  // last block takes a fresh Theme per test).
  "selection-field/typing",
  "selection-field/adopting",
  "selection-field/adopted-after-move",
  "selection-field/return-paths",
  "selection-field/keyboard-append-1",
  "selection-field/keyboard-append-2",
]);

/** The templates every seeded Theme holds exactly one of. */
export const CLIENT_LANE_TEMPLATE_TYPES = /** @type {const} */ ([
  "index",
  "layout",
  "product",
]);

/**
 * SHA-256 of a text file's bytes as UTF-8, the way both sides hash it.
 * @param {string} content
 */
export function contentSha256(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * @typedef {{ path: string, mimeType: unknown, encoding: unknown, isEntry: boolean, sha256: string }} FileDigest
 */

/**
 * The fixture's files as digests, in path order. Throws unless it records
 * Starter 31 and names each path once: the lane would have nothing to compare
 * against.
 *
 * @param {string} fixtureText
 * @returns {FileDigest[]}
 */
export function fixtureFileDigests(fixtureText) {
  const fixture = JSON.parse(fixtureText);
  if (fixture?.starterVersion !== CLIENT_LANE_STARTER_VERSION) {
    throw new Error(
      `CLIENT_LANE_FIXTURE: ${CLIENT_LANE_STARTER_FIXTURE} records Starter ${JSON.stringify(fixture?.starterVersion)}, not ${CLIENT_LANE_STARTER_VERSION}.`,
    );
  }
  const files = Array.isArray(fixture.files) ? fixture.files : [];
  /** @type {FileDigest[]} */
  const digests = files.map((/** @type {any} */ file) => {
    if (typeof file?.path !== "string" || typeof file?.content !== "string") {
      throw new Error(
        `CLIENT_LANE_FIXTURE: ${CLIENT_LANE_STARTER_FIXTURE} holds a file without a path or text content.`,
      );
    }
    return {
      path: file.path,
      mimeType: file.mimeType ?? null,
      encoding: file.encoding ?? null,
      isEntry: file.isEntry === true,
      sha256: contentSha256(file.content),
    };
  });
  digests.sort((a, b) => byteOrder(a.path, b.path));
  for (let index = 1; index < digests.length; index += 1) {
    if (digests[index].path === digests[index - 1].path) {
      throw new Error(
        `CLIENT_LANE_FIXTURE: ${CLIENT_LANE_STARTER_FIXTURE} names ${digests[index].path} twice.`,
      );
    }
  }
  if (digests.length === 0) {
    throw new Error(`CLIENT_LANE_FIXTURE: ${CLIENT_LANE_STARTER_FIXTURE} holds no files.`);
  }
  return digests;
}

/** @param {string} [root] The checkout; the current directory by default. */
export function readFixtureFileDigests(root = process.cwd()) {
  return fixtureFileDigests(
    readFileSync(path.join(root, CLIENT_LANE_STARTER_FIXTURE), "utf8"),
  );
}

/**
 * Null when what was read back for a seeded Theme is a client Theme on the
 * Starter 31 workspace: one row in its storefront, not deleted, recording no
 * runtime and no framework (TanStack Start), Starter 31 recorded, exactly
 * the fixture's paths with the same bytes, MIME type, encoding and entry
 * flag, and one index, layout and product template. Else the refusal,
 * naming everything that differs.
 *
 * @param {any} theme `readClientLaneTheme`'s result.
 * @param {readonly FileDigest[]} expected `fixtureFileDigests`.
 * @returns {string | null}
 */
export function clientLaneThemeRefusal(theme, expected) {
  const id = typeof theme?.themeId === "string" ? theme.themeId : "(no id)";
  /** @type {string[]} */
  const failures = [];
  if (theme?.rows !== 1) {
    failures.push(`${JSON.stringify(theme?.rows ?? null)} rows in storefront_themes, not one`);
  } else {
    if (theme.rowStorefrontId !== theme.storefrontId) {
      failures.push(`belongs to storefront ${JSON.stringify(theme.rowStorefrontId)}, not ${JSON.stringify(theme.storefrontId)}`);
    }
    if (theme.deletedAt !== null) failures.push("is deleted");
    if (theme.previewRuntime !== null) {
      failures.push(`records preview runtime ${JSON.stringify(theme.previewRuntime)}; the lane needs none`);
    }
    if (theme.framework !== null) {
      failures.push(`records framework ${JSON.stringify(theme.framework)}; the lane needs none (TanStack Start)`);
    }
    if (theme.starterTemplateVersion !== CLIENT_LANE_STARTER_VERSION) {
      failures.push(`records Starter ${JSON.stringify(theme.starterTemplateVersion)}, not ${CLIENT_LANE_STARTER_VERSION}`);
    }
  }
  const files = Array.isArray(theme?.files) ? theme.files : [];
  const stored = new Map(files.map((/** @type {any} */ file) => [file?.path, file]));
  if (stored.size !== files.length) failures.push("names a file path twice");
  const wanted = new Map(expected.map((file) => [file.path, file]));
  const extra = [...stored.keys()].filter((p) => !wanted.has(p));
  const missing = [...wanted.keys()].filter((p) => !stored.has(p));
  if (extra.length > 0) {
    failures.push(`holds files Starter ${CLIENT_LANE_STARTER_VERSION} does not: ${extra.join(", ")}`);
  }
  if (missing.length > 0) {
    failures.push(`lacks files of Starter ${CLIENT_LANE_STARTER_VERSION}: ${missing.join(", ")}`);
  }
  for (const want of expected) {
    const have = stored.get(want.path);
    if (!have) continue;
    for (const key of /** @type {const} */ (["sha256", "mimeType", "encoding", "isEntry"])) {
      if (have[key] !== want[key]) {
        failures.push(`${want.path}: ${key} ${JSON.stringify(have[key])}, not ${JSON.stringify(want[key])}`);
      }
    }
  }
  const templates = Array.isArray(theme?.templates) ? theme.templates : [];
  for (const type of CLIENT_LANE_TEMPLATE_TYPES) {
    const found = templates.filter(
      (/** @type {any} */ template) => template?.type === type && template?.routePath === null,
    ).length;
    if (found !== 1) failures.push(`${found} ${type} templates, not one`);
  }
  return failures.length === 0
    ? null
    : `CLIENT_LANE_THEME_NOT_STARTER_${CLIENT_LANE_STARTER_VERSION}: Theme ${id} ${failures.join("; ")}.`;
}

/**
 * The editor path of a seeded Theme, on its index template.
 * @param {{ storefrontId: string, themeId: string, indexTemplateId: string }} theme
 */
export function clientLaneEditorPath(theme) {
  return `/store/${theme.storefrontId}/themes/${theme.themeId}/editor?templateId=${theme.indexTemplateId}`;
}

/**
 * Whether a run is on the client lane: the specs take their client-only
 * branches (`MORPH_E2E_PREVIEW_RUNTIME` absent, empty or `client`), no
 * record mode is declared, and the preview comes from the local sidecar (the
 * six shards' transport; the container jobs are left as they are).
 *
 * @param {{ runtime: string }} spec `readSpecPreviewRuntime`.
 * @param {unknown} record `readRecordedPreviewRuntime`.
 * @param {boolean} usesSidecar
 */
export function isClientLaneRun(spec, record, usesSidecar) {
  return spec.runtime === "client" && record === undefined && usesSidecar;
}

/**
 * Null unless `MORPH_E2E_REQUIRE_CLIENT_LANE` asks for the client lane and
 * the run is not on it; then the refusal.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {{ runtime: string }} spec
 * @param {unknown} record
 * @param {boolean} usesSidecar
 * @returns {string | null}
 */
export function requiredClientLaneRefusal(env, spec, record, usesSidecar) {
  const required = env[REQUIRE_CLIENT_LANE_VAR];
  if (required === undefined || required === "") return null;
  if (required !== "1") {
    return `CLIENT_LANE_REQUIRED: ${REQUIRE_CLIENT_LANE_VAR}=${JSON.stringify(required)}; it is "1" or unset. Nothing was changed.`;
  }
  if (isClientLaneRun(spec, record, usesSidecar)) return null;
  return `CLIENT_LANE_REQUIRED: ${REQUIRE_CLIENT_LANE_VAR}=1, but the specs run the ${spec.runtime} preview${record === undefined ? "" : " in record mode"}${usesSidecar ? "" : " over the container transport"}, so this is not a client-lane run and its Themes would not be checked against Starter ${CLIENT_LANE_STARTER_VERSION}. Nothing was changed.`;
}

/**
 * @typedef {{
 *   themesText: string | undefined,
 *   usesText: string | undefined,
 *   afterSuite: ReadonlyArray<{ themeId: string, rows: number, previewRuntime: unknown }>,
 *   workerValue: string | undefined,
 *   expected: readonly FileDigest[],
 * }} ClientLaneInput `themesText`/`usesText`: the files' text, undefined when
 *   missing. `afterSuite`: each seeded Theme's row as the runner read it after
 *   the suite. `workerValue`: the Worker's `MORPH_THEME_PREVIEW_RUNTIME`.
 */

/**
 * The seeded Themes from `themesText`, or a refusal.
 * @param {string | undefined} themesText
 * @returns {{ themes: any[] } | { refusal: string }}
 */
export function parseClientLaneThemes(themesText) {
  if (themesText === undefined) {
    return { refusal: `the run left no ${CLIENT_LANE_THEMES_FILE}, so no dedicated Theme was seeded before the suite` };
  }
  let parsed;
  try {
    parsed = JSON.parse(themesText);
  } catch {
    return { refusal: `${CLIENT_LANE_THEMES_FILE} is not JSON` };
  }
  if (
    parsed?.version !== 1 ||
    parsed?.starterVersion !== CLIENT_LANE_STARTER_VERSION ||
    !Array.isArray(parsed?.themes)
  ) {
    return { refusal: `${CLIENT_LANE_THEMES_FILE} is not a version 1 record of Starter ${CLIENT_LANE_STARTER_VERSION} Themes` };
  }
  return { themes: parsed.themes };
}

/**
 * Null when the run's evidence shows every slot seeded as a Starter 31 client
 * Theme before the suite, still recording no runtime after it and served the
 * client-only preview by the Worker's binding, and every Theme a spec took
 * being its slot's seeded one; else the refusal.
 *
 * @param {ClientLaneInput} input
 * @returns {string | null}
 */
export function clientLaneEvidenceRefusal({ themesText, usesText, afterSuite, workerValue, expected }) {
  const prefix = `CLIENT_LANE_UNVERIFIED: the client lane runs dedicated Starter ${CLIENT_LANE_STARTER_VERSION} Themes (${CLIENT_LANE_STARTER_FIXTURE}) on the client-only preview, and`;
  const read = parseClientLaneThemes(themesText);
  if ("refusal" in read) return `${prefix} ${read.refusal}.`;
  /** @type {string[]} */
  const failures = [];
  /** @type {Map<string, any>} */
  const bySlot = new Map();
  for (const entry of read.themes) {
    const slot = entry?.slot;
    if (typeof slot !== "string" || !CLIENT_LANE_THEME_SLOTS.includes(/** @type {any} */ (slot))) {
      failures.push(`an unknown slot ${JSON.stringify(slot ?? null)} was seeded`);
      continue;
    }
    if (bySlot.has(slot)) failures.push(`slot ${slot} was seeded twice`);
    bySlot.set(slot, entry);
  }
  for (const slot of CLIENT_LANE_THEME_SLOTS) {
    if (!bySlot.has(slot)) failures.push(`slot ${slot} was not seeded`);
  }
  const themeIds = new Set();
  for (const [slot, entry] of bySlot) {
    const seeded = entry.seeded;
    if (themeIds.has(entry.themeId)) failures.push(`slot ${slot} shares Theme ${entry.themeId} with another slot`);
    themeIds.add(entry.themeId);
    if (
      typeof entry.themeId !== "string" ||
      seeded?.themeId !== entry.themeId ||
      seeded?.storefrontId !== entry.storefrontId
    ) {
      failures.push(`slot ${slot}: what was read back is not its Theme`);
      continue;
    }
    const refusal = clientLaneThemeRefusal(seeded, expected);
    if (refusal) failures.push(`slot ${slot} before the suite: ${refusal}`);
    const index = (Array.isArray(seeded.templates) ? seeded.templates : []).find(
      (/** @type {any} */ template) => template?.type === "index" && template?.routePath === null,
    );
    if (
      !index ||
      entry.indexTemplateId !== index.id ||
      entry.editorPath !== clientLaneEditorPath(entry)
    ) {
      failures.push(`slot ${slot}: its editor path does not open its own index template`);
    }
    const after = afterSuite.filter((row) => row.themeId === entry.themeId);
    if (after.length !== 1 || after[0].rows !== 1) {
      failures.push(`slot ${slot}: Theme ${entry.themeId} was not read back after the suite`);
      continue;
    }
    const stored = after[0].previewRuntime ?? null;
    const resolved = resolveThemePreviewRuntime({
      recorded: typeof stored === "string" ? stored : null,
      deploymentEnvValue: workerValue,
    });
    if (stored !== null || resolved.runtime !== "client") {
      failures.push(
        `slot ${slot}: after the suite Theme ${entry.themeId} records ${JSON.stringify(stored)}, which the Worker (${THEME_PREVIEW_RUNTIME_VAR}=${JSON.stringify(workerValue ?? null)}) serves as ${resolved.runtime}; the lane needs no record and the client-only preview`,
      );
    }
  }
  const lines = (usesText ?? "").split("\n").filter((line) => line.trim() !== "");
  for (const [index, line] of lines.entries()) {
    let use;
    try {
      use = JSON.parse(line);
    } catch {
      use = undefined;
    }
    const seeded = bySlot.get(use?.slot);
    if (!seeded) {
      failures.push(`use ${index + 1} names no seeded slot: ${line.slice(0, 200)}`);
    } else if (use.themeId !== seeded.themeId) {
      failures.push(`use ${index + 1} took Theme ${JSON.stringify(use.themeId)} for slot ${use.slot}, not its seeded ${seeded.themeId}`);
    }
  }
  return failures.length === 0 ? null : `${prefix} ${failures.join("; ")}.`;
}

/**
 * The slots a run's specs took, from its uses file's text.
 * @param {string | undefined} usesText
 */
export function usedClientLaneSlots(usesText) {
  const slots = new Set();
  for (const line of (usesText ?? "").split("\n")) {
    if (!line.trim()) continue;
    try {
      const slot = JSON.parse(line)?.slot;
      if (typeof slot === "string") slots.add(slot);
    } catch {
      // Refused by clientLaneEvidenceRefusal.
    }
  }
  return slots;
}

/**
 * The verdict the runner keeps beside the report. It carries the evidence
 * itself, so the acceptance job checks every shard again rather than trusting
 * `ok`.
 *
 * @param {ClientLaneInput} input
 */
export function clientLaneVerdict(input) {
  const refusal = clientLaneEvidenceRefusal(input);
  return {
    lane: "client",
    starterVersion: CLIENT_LANE_STARTER_VERSION,
    ok: refusal === null,
    refusal,
    workerValue: input.workerValue ?? null,
    themes: input.themesText ?? null,
    uses: input.usesText ?? null,
    afterSuite: input.afterSuite,
  };
}

/**
 * Null when the latest attempt of every one of `count` shards kept exactly
 * one client lane verdict, marked ok, whose evidence passes again against
 * `expected` (this checkout's fixture), and every slot was taken by a spec in
 * some shard; else the refusal. Files are found as CI downloads them:
 * `editor-e2e-results-<shard>-attempt-<attempt>/shard-<shard>.json.client-lane.json`.
 *
 * @param {readonly string[]} files Every downloaded file.
 * @param {readonly FileDigest[]} expected
 * @param {number} [count]
 * @returns {string | null}
 */
export function clientLaneVerdictsRefusal(files, expected, count = EDITOR_SHARD_COUNT) {
  /** @type {Map<number, { attempt: number, files: string[] }>} */
  const latest = new Map();
  for (const file of files) {
    const artifact = /^editor-e2e-results-(\d+)-attempt-(\d+)$/.exec(
      path.basename(path.dirname(file)),
    );
    if (!artifact) continue;
    const shard = Number(artifact[1]);
    const attempt = Number(artifact[2]);
    const current = latest.get(shard);
    if (!current || attempt > current.attempt) {
      latest.set(shard, { attempt, files: [file] });
    } else if (attempt === current.attempt) {
      current.files.push(file);
    }
  }
  /** @type {string[]} */
  const failures = [];
  const used = new Set();
  for (let shard = 1; shard <= count; shard += 1) {
    const found = latest.get(shard);
    const name = `shard-${shard}.json${CLIENT_LANE_VERDICT_SUFFIX}`;
    const verdicts = (found?.files ?? []).filter((file) => path.basename(file) === name);
    if (!found || verdicts.length !== 1) {
      failures.push(
        `shard ${shard}: ${verdicts.length} ${name} in its latest artifact${found ? ` (attempt ${found.attempt})` : ""}, not one`,
      );
      continue;
    }
    let verdict;
    try {
      verdict = JSON.parse(readFileSync(verdicts[0], "utf8"));
    } catch {
      failures.push(`shard ${shard}: ${name} is not JSON`);
      continue;
    }
    const again = clientLaneEvidenceRefusal({
      themesText: typeof verdict?.themes === "string" ? verdict.themes : undefined,
      usesText: typeof verdict?.uses === "string" ? verdict.uses : undefined,
      afterSuite: Array.isArray(verdict?.afterSuite) ? verdict.afterSuite : [],
      workerValue: typeof verdict?.workerValue === "string" ? verdict.workerValue : undefined,
      expected,
    });
    if (again !== null) {
      failures.push(`shard ${shard}: ${again}`);
    } else if (verdict?.lane !== "client" || verdict?.ok !== true) {
      failures.push(
        `shard ${shard}: verdict ${JSON.stringify({ lane: verdict?.lane ?? null, ok: verdict?.ok ?? null })}, not an ok client lane verdict`,
      );
    } else {
      for (const slot of usedClientLaneSlots(verdict.uses)) used.add(slot);
    }
  }
  if (failures.length === 0) {
    const unused = CLIENT_LANE_THEME_SLOTS.filter((slot) => !used.has(slot));
    if (unused.length > 0) {
      failures.push(`no shard's specs took the dedicated Theme of ${unused.join(", ")}`);
    }
  }
  return failures.length === 0
    ? null
    : `CLIENT_LANE_SHARDS: every client shard must show its dedicated Themes seeded on Starter ${CLIENT_LANE_STARTER_VERSION} and served the client-only preview: ${failures.join(" | ")}`;
}

/**
 * @param {string} a
 * @param {string} b
 */
function byteOrder(a, b) {
  return Buffer.compare(Buffer.from(a), Buffer.from(b));
}

/** @param {string} directory */
function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(
    /** @returns {string[]} */ (entry) => {
      const target = path.join(directory, entry.name);
      return entry.isDirectory() ? listFiles(target) : [target];
    },
  );
}

// node scripts/e2e-client-lane-guard.mjs client-lane-verdicts <downloaded-artifacts-dir>
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [command, directory] = process.argv.slice(2);
  if (command !== "client-lane-verdicts" || !directory || !existsSync(directory)) {
    console.error(
      "usage: node scripts/e2e-client-lane-guard.mjs client-lane-verdicts <downloaded-artifacts-dir>",
    );
    process.exit(2);
  }
  const refusal = clientLaneVerdictsRefusal(listFiles(directory), readFixtureFileDigests());
  if (refusal) {
    console.error(refusal);
    process.exit(1);
  }
  console.log(
    `client lane: all ${EDITOR_SHARD_COUNT} shards seeded every dedicated Theme on Starter ${CLIENT_LANE_STARTER_VERSION}, served it the client-only preview, and every slot was taken`,
  );
}
