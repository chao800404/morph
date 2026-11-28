/**
 * Morph Core deploy, platform bootstrap and binding verification.
 *
 *   pnpm run deploy                 guarded deploy (strict: every binding present)
 *   pnpm run deploy:bootstrap       guarded deploy that tolerates missing platform bindings
 *   pnpm run platform:ensure        create-only bootstrap/repair of platform bindings
 *   pnpm run deploy:verify          read-only binding inventory
 *
 * Each takes only `--target <file>` (or MORPH_DEPLOY_TARGET); nothing is
 * forwarded to Wrangler. See DEPLOY.md "Core deploy and hostname bindings" and
 * src/lib/core-deploy/ for the rules.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The repo's own JSONC reader for wrangler.jsonc; a plain .mjs with no types.
// @ts-expect-error TS7016
import { parseJsonc } from "./theme-runtime-wiring-scan.mjs";

import { createBootstrapApi, createInventoryApi } from "../src/lib/core-deploy/cloudflare-api";
import { EXIT, runCoreDeploy } from "../src/lib/core-deploy/core-deploy";
import {
  CLOUDFLARE_API_BASE_URL,
  parseRunnerArgs,
  type CoreDeployCommand,
} from "../src/lib/core-deploy/deploy-invocation";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const COMMANDS: readonly CoreDeployCommand[] = ["deploy", "ensure-platform-bindings", "verify"];

const [commandArg, ...rest] = process.argv.slice(2);
const command = COMMANDS.find((name) => name === commandArg);
if (!command) {
  console.error(`[core-deploy] usage: tsx scripts/core-deploy.ts <${COMMANDS.join("|")}> [--target <file>]`);
  process.exit(EXIT.refused);
}
const args = parseRunnerArgs(command, rest);
if (!args.ok) {
  for (const problem of args.problems) console.error(`[core-deploy] refused: ${problem}`);
  process.exit(EXIT.refused);
}

const reportDir = path.join(ROOT, ".wrangler", "core-deploy", new Date().toISOString().replace(/[:.]/g, "-"));

const result = await runCoreDeploy(command, args.options, {
  rootDir: ROOT,
  env: process.env,
  readText: (file) => readFileSync(file, "utf8"),
  exists: (file) => existsSync(file),
  mtimeMs: (file) => statSync(file).mtimeMs,
  removeDir: (dir) => rmSync(dir, { recursive: true, force: true }),
  parseJsonc: (text) => parseJsonc(text),
  run: (step, argv, env) =>
    new Promise((resolve, reject) => {
      console.log(`[core-deploy] ${step}: ${argv.join(" ")}`);
      const child = spawn(argv[0]!, argv.slice(1), { cwd: ROOT, env, stdio: "inherit" });
      child.on("error", reject);
      child.on("close", (code, signal) => resolve(code ?? (signal ? 128 : 1)));
    }),
  inventoryApi: (accountId) =>
    createInventoryApi({ baseUrl: CLOUDFLARE_API_BASE_URL, token: process.env.MORPH_INVENTORY_API_TOKEN ?? "", accountId }),
  bootstrapApi: (accountId) =>
    createBootstrapApi({ baseUrl: CLOUDFLARE_API_BASE_URL, token: process.env.MORPH_BOOTSTRAP_API_TOKEN ?? "", accountId }),
  writeReport: (name, data) => {
    mkdirSync(reportDir, { recursive: true });
    const file = path.join(reportDir, `${name}.json`);
    writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
    console.log(`[core-deploy] ${name} report: ${path.relative(ROOT, file)}`);
  },
  log: (line) => console.log(line),
  now: () => new Date(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});
process.exit(result.exitCode);
