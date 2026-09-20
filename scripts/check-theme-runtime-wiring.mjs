/**
 * Reports whether Morph Core's Theme Worker transport is wired.
 *
 * The rules live in `theme-runtime-wiring-scan.mjs` and are tested by
 * `theme-runtime-wiring-scan.test.mjs`; this file only decides what to read and
 * what to say. Same split as `check-like-tokens.mjs`, for the same reason: the
 * scanner is a pure function, its tests are an independent witness, and a guard
 * whose tests live inside it cannot be checked by the thing it is checking.
 *
 * Exit codes: 0 for `PASS`, 1 for `PENDING` and for `FAIL`.
 *
 * `PENDING` exiting non-zero is the whole point of the three-state design. The
 * production request path currently falls through to `UnavailableThemeRuntime`
 * and answers 503 for every storefront request, so "nothing is configured" is
 * not a state that may report success — a guard that goes green when nothing is
 * wired encodes 未完成 as 已驗證, which is the defect
 * `docs/visual-editor-progress.md` names.
 *
 * **Deliberately not wired into the required CI job yet.** Adding it to
 * `architecture-guards` today would make the required check red for the very
 * pull request that supplies the binding, and with `enforce_admins: true` that
 * pull request could not merge — a deadlock, not a forcing function. Add the
 * one line to `ci.yml` in the same change that declares the binding, so the
 * claim and the assertion it describes land together.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PENDING,
  PASS,
  evaluateThemeRuntimeWiring,
  parseJsonc,
  readDefaultThemeServiceBinding,
} from "./theme-runtime-wiring-scan.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const CONFIG_PATH = "wrangler.jsonc";
const RUNTIME_SOURCE_PATH =
  "src/lib/storefront/service/storefront-request-routing.ts";

const read = (relativePath) =>
  readFileSync(join(projectRoot, relativePath), "utf8");

const parsed = parseJsonc(read(CONFIG_PATH));
if (!parsed.ok) {
  console.error(
    `[check-theme-runtime-wiring] FAIL — ${CONFIG_PATH} could not be read as JSONC: ${parsed.error}`,
  );
  process.exit(1);
}

const verdict = evaluateThemeRuntimeWiring({
  config: parsed.value,
  defaultBindingName: readDefaultThemeServiceBinding(read(RUNTIME_SOURCE_PATH)),
});

if (verdict.state === PASS) {
  console.log(`[check-theme-runtime-wiring] PASS — ${verdict.message}`);
  process.exit(0);
}

console.error(
  `\n[check-theme-runtime-wiring] ${verdict.state} — ${verdict.message}\n`,
);

if (verdict.state === PENDING) {
  console.error(
    "PENDING is not a pass. The artifact can be built and uploaded while the request\n" +
      "path still ends in a 503, so nothing may describe the build artifact as a live\n" +
      "runtime until this line reports PASS. When it does, add\n" +
      "  pnpm check:theme-runtime-wiring\n" +
      "to the architecture-guards job in .github/workflows/ci.yml in the same change\n" +
      "that declared the binding.\n",
  );
}

process.exit(1);
