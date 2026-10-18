import { execFileSync } from "node:child_process";

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

/**
 * Makes an existing Theme record `RECORDED_PREVIEW_RUNTIME` (or none), and
 * reads it back: a Theme that is missing, or did not take the value, fails
 * here rather than letting a run pass on the deployment's runtime instead.
 */
export function recordThemePreviewRuntime(scope: {
  storefrontId: string;
  themeId: string;
}): void {
  const ids = (value: string) => {
    if (!/^[0-9a-f-]{36}$/.test(value)) {
      throw new Error(`Not an id: ${value}`);
    }
    return value;
  };
  const themeId = ids(scope.themeId);
  const storefrontId = ids(scope.storefrontId);
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
}
