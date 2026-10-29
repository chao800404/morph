import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import {
  RECORD_VERIFIED_FILE,
  WORKER_PREVIEW_RUNTIME_FOR_SPECS_VAR,
  previewedThemeRefusal,
  recordedThemeRefusal,
} from "../../scripts/e2e-preview-runtime-guard.mjs";

/**
 * The Live Preview runtime the Themes a run uses should record (R-0, R1),
 * from `MORPH_E2E_RECORD_PREVIEW_RUNTIME`.
 *
 * Unset — every CI job — records nothing, so each Theme is previewed as the
 * Worker's `MORPH_THEME_PREVIEW_RUNTIME` says, exactly as before Themes could
 * record one. Set to `start` with that variable unset, a run shows that a
 * Theme's record alone selects the full Start preview: the Start specs still
 * read `MORPH_E2E_PREVIEW_RUNTIME=start` for what to expect, and nothing
 * else in them changes.
 *
 * Record mode is checked twice, so a Theme that did not take the record
 * cannot pass on the Worker's default instead: the runner refuses a run
 * whose declared record does not resolve to the specs' runtime, or that
 * selects a spec outside `RECORD_MODE_SPECS`; and here, every Theme a
 * record-mode spec creates or records is read back and resolved with the
 * Worker's rule (`verifyRecordedThemePreviewRuntime`), and `previewFrame`
 * refuses to read the preview of a Theme that was not.
 */
export const RECORDED_PREVIEW_RUNTIME = ((): "client" | "start" | null => {
  const value = process.env.MORPH_E2E_RECORD_PREVIEW_RUNTIME;
  if (value === undefined || value === "") return null;
  if (value === "client" || value === "start") return value;
  throw new Error(
    `MORPH_E2E_RECORD_PREVIEW_RUNTIME must be "client" or "start", not "${value}".`,
  );
})();

/** The value an `INSERT INTO storefront_themes` writes for the record. */
export function recordedPreviewRuntimeSql(): string {
  return RECORDED_PREVIEW_RUNTIME ? `'${RECORDED_PREVIEW_RUNTIME}'` : "NULL";
}

/** One statement against the runner-owned database, its rows as JSON. */
function d1(sql: string): Array<Record<string, unknown>> {
  const stateDir = process.env.MORPH_E2E_STATE_DIR;
  if (!stateDir) {
    throw new Error("Recording a preview runtime needs MORPH_E2E_STATE_DIR.");
  }
  const output = execFileSync(
    "npx",
    [
      "wrangler",
      "d1",
      "execute",
      "DATABASE",
      "--local",
      ...((process.env.MORPH_E2E_TRANSPORT ?? "local-sidecar") ===
      "local-sidecar"
        ? ["--env", "local_preview_e2e"]
        : []),
      "--persist-to",
      stateDir,
      "--json",
      "--command",
      sql,
    ],
    { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" },
  );
  return (
    (
      JSON.parse(output) as Array<{ results?: Array<Record<string, unknown>> }>
    )[0]?.results ?? []
  );
}

function sqlId(value: string): string {
  if (!/^[0-9a-f-]{36}$/.test(value)) {
    throw new Error(`Not an id: ${value}`);
  }
  return value;
}

function verifiedFile(): string {
  const stateDir = process.env.MORPH_E2E_STATE_DIR;
  if (!stateDir) {
    throw new Error("Record mode needs MORPH_E2E_STATE_DIR.");
  }
  return path.join(stateDir, RECORD_VERIFIED_FILE);
}

function verifiedThemeIds(): string[] {
  try {
    return JSON.parse(readFileSync(verifiedFile(), "utf8")) as string[];
  } catch {
    return [];
  }
}

/**
 * In record mode, reads a Theme's stored record back and resolves it with
 * the Worker's own rule and the Worker's actual default; throws unless it is
 * the declared record and resolves, from that record, to the runtime the
 * specs expect. Call it right after creating or recording a Theme, before
 * its preview is read; `previewFrame` refuses a Theme it has not passed.
 * Without record mode it does nothing.
 */
export function verifyRecordedThemePreviewRuntime(scope: {
  storefrontId: string;
  themeId: string;
}): void {
  if (!RECORDED_PREVIEW_RUNTIME) return;
  const themeId = sqlId(scope.themeId);
  const storefrontId = sqlId(scope.storefrontId);
  const refusal = recordedThemeRefusal({
    themeId,
    rows: d1(
      `SELECT preview_runtime FROM storefront_themes WHERE id = '${themeId}' AND storefront_id = '${storefrontId}'`,
    ),
    declared: RECORDED_PREVIEW_RUNTIME,
    workerDefault: process.env[WORKER_PREVIEW_RUNTIME_FOR_SPECS_VAR],
    specValue: process.env.MORPH_E2E_PREVIEW_RUNTIME,
  });
  if (refusal) throw new Error(refusal);
  const ids = verifiedThemeIds();
  if (!ids.includes(themeId)) {
    writeFileSync(verifiedFile(), JSON.stringify([...ids, themeId]));
  }
}

/**
 * In record mode, throws unless the editor page names a Theme that
 * `verifyRecordedThemePreviewRuntime` passed. `previewFrame` calls it, so a
 * record-mode spec cannot read a preview served as the Worker's default.
 * Without record mode it does nothing.
 */
export function assertPreviewedThemeVerified(page: Page): void {
  if (!RECORDED_PREVIEW_RUNTIME) return;
  const refusal = previewedThemeRefusal(page.url(), verifiedThemeIds());
  if (refusal) throw new Error(refusal);
}

/**
 * Makes an existing Theme record `RECORDED_PREVIEW_RUNTIME` (or none), and
 * reads it back: a Theme that is missing, or did not take the value, fails
 * here rather than letting a run pass on the deployment's runtime instead.
 */
export function recordThemePreviewRuntime(scope: {
  storefrontId: string;
  themeId: string;
}): void {
  const themeId = sqlId(scope.themeId);
  const storefrontId = sqlId(scope.storefrontId);
  d1(
    `UPDATE storefront_themes SET preview_runtime = ${recordedPreviewRuntimeSql()} WHERE id = '${themeId}' AND storefront_id = '${storefrontId}'`,
  );
  const rows = d1(
    `SELECT preview_runtime FROM storefront_themes WHERE id = '${themeId}' AND storefront_id = '${storefrontId}'`,
  );
  const stored = rows[0]?.preview_runtime ?? null;
  if (rows.length !== 1 || stored !== RECORDED_PREVIEW_RUNTIME) {
    throw new Error(
      `The Theme ${themeId} records ${JSON.stringify(stored)} (${rows.length} row(s)), not ${JSON.stringify(RECORDED_PREVIEW_RUNTIME)}.`,
    );
  }
  verifyRecordedThemePreviewRuntime(scope);
}
