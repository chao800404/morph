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
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The pinned Wrangler's own config reader: the guard also runs on what it
// reads from the snapshot (parser parity).
const { unstable_readConfig: readWranglerConfig } = createRequire(import.meta.url)("wrangler") as {
  unstable_readConfig: (args: { config: string }, options: { hideWarnings: boolean }) => unknown;
};

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
  listDir: (dir) => readdirSync(dir),
  lock: (dir) => {
    mkdirSync(path.dirname(dir), { recursive: true });
    try {
      mkdirSync(dir);
    } catch {
      return false;
    }
    writeFileSync(path.join(dir, "pid"), `${process.pid}\n`);
    return true;
  },
  unlock: (dir) => rmSync(dir, { recursive: true, force: true }),
  parseJsonc: (text) => parseJsonc(text),
  snapshot: (from, dirs) => {
    // mkdtemp creates the directory 0700: only this user can change the copy.
    const dir = mkdtempSync(path.join(tmpdir(), "morph-core-deploy-"));
    chmodSync(dir, 0o700);
    for (const rel of dirs) {
      cpSync(path.join(from, rel), path.join(dir, rel), { recursive: true, dereference: true, errorOnExist: true });
    }
    return dir;
  },
  hashTree: (dir) => {
    const hash = createHash("sha256");
    const walk = (current: string) => {
      for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const file = path.join(current, entry.name);
        if (entry.isDirectory()) walk(file);
        else hash.update(path.relative(dir, file)).update("\0").update(readFileSync(file)).update("\0");
      }
    };
    walk(dir);
    return hash.digest("hex");
  },
  readWranglerConfig: (configPath) => readWranglerConfig({ config: configPath }, { hideWarnings: true }),
  run: (step, argv, env, cwd) =>
    new Promise((resolve, reject) => {
      console.log(`[core-deploy] ${step}: ${argv.join(" ")}`);
      const child = spawn(argv[0]!, argv.slice(1), { cwd: cwd ?? ROOT, env, stdio: "inherit" });
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
