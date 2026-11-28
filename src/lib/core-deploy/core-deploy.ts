import path from "node:path";
import type { BootstrapApi, InventoryApi } from "./cloudflare-api";
import {
  ARTIFACT_CONFIG_PATH,
  DEPLOY_REDIRECT_PATH,
  checkArtifactConfig,
  checkDeployRedirect,
  checkNormalizedConfig,
  checkSourceConfig,
} from "./deploy-config-guard";
import {
  checkDeployEnvironment,
  checkPinnedTools,
  deployChildEnv,
  wranglerDeployArgv,
  type CoreDeployCommand,
  type RunnerOptions,
} from "./deploy-invocation";
import { parseDeployTarget, type DeployTarget } from "./deploy-target";
import { ensurePlatformBindings } from "./ensure-platform-bindings";
import {
  bindingIdentities,
  compareInventory,
  describeVerdict,
  readInventory,
  reconcile,
  type CompareMode,
  type InventorySnapshot,
  type Verdict,
} from "./inventory";
import { platformManifest, type PlatformManifest } from "./platform-manifest";
import { checkRemoteMigrations } from "./remote-migrations";
import { expectedSnapshotConfig, pathsOutsideSnapshot, type Snapshot } from "./snapshot";

/**
 * The Core deploy flow (design 2, option B), with every effect injected so
 * the order of steps and every refusal can be tested without a network,
 * a build or a Wrangler run.
 *
 *   deploy:  pins → env → target → source guard → lock → clean → migration
 *            check → pre-inventory → build → redirect + artifact guard →
 *            fingerprint → wrangler → fingerprint again → post-inventory
 *            (always, once Wrangler has been started) → unlock
 *   verify:  pins → target → source guard → inventory
 *   ensure-platform-bindings: pins → target → source guard → create-only
 *            bootstrap → strict inventory
 */

export const EXIT = {
  ok: 0,
  refused: 1,
  deployFailed: 2,
  drift: 3,
  transient: 4,
  unavailable: 5,
} as const;

export type RunResult = Readonly<{ exitCode: number; problems: string[] }>;

export type CoreDeployDeps = Readonly<{
  rootDir: string;
  env: Readonly<Record<string, string | undefined>>;
  readText(file: string): string;
  exists(file: string): boolean;
  mtimeMs(file: string): number;
  removeDir(dir: string): void;
  listDir(dir: string): string[];
  /** Creates `dir` exclusively; false when it already exists (another run holds the checkout). */
  lock(dir: string): boolean;
  unlock(dir: string): void;
  parseJsonc(text: string): { ok: true; value: unknown } | { ok: false; error: string };
  /**
   * The private (mode 0700) copy of every path the artifact references, its
   * config rewritten only to point containers into the copy (snapshot.ts).
   * Throws to refuse.
   */
  snapshot(input: { root: string; artifactPath: string; artifactText: string }): Snapshot;
  /** A digest of every file under `dir`: paths and contents. Throws if one cannot be read. */
  hashTree(dir: string): string;
  /** The pinned Wrangler's own reader (`unstable_readConfig`) on exactly this config file. */
  readWranglerConfig(configPath: string): unknown;
  /** Runs a child process with inherited output; resolves with its exit code. */
  run(step: "build" | "wrangler", argv: readonly string[], env: Record<string, string>, cwd?: string): Promise<number>;
  inventoryApi: (accountId: string) => InventoryApi;
  bootstrapApi: (accountId: string) => BootstrapApi;
  writeReport(name: string, data: unknown): void;
  log(line: string): void;
  now(): Date;
  sleep(ms: number): Promise<void>;
  reconcileDelayMs?: number;
}>;

type Prepared = {
  target: DeployTarget;
  source: unknown;
  /** The exact text the source guard checked. */
  sourceText: string;
  manifest: PlatformManifest;
  sourcePath: string;
};

function refuse(deps: CoreDeployDeps, problems: string[]): RunResult {
  for (const problem of problems) deps.log(`[core-deploy] refused: ${problem}`);
  return { exitCode: EXIT.refused, problems };
}

function readJsonFile(deps: CoreDeployDeps, file: string): unknown {
  return JSON.parse(deps.readText(file));
}

/** Pins, target and source guard — everything decided before any remote read. */
function prepare(
  command: CoreDeployCommand,
  options: RunnerOptions,
  deps: CoreDeployDeps,
): { ok: true; prepared: Prepared } | { ok: false; result: RunResult } {
  const problems: string[] = [];
  const root = deps.rootDir;
  try {
    problems.push(
      ...checkPinnedTools({
        packageJson: readJsonFile(deps, path.join(root, "package.json")),
        installedWranglerVersion: (readJsonFile(deps, path.join(root, "node_modules", "wrangler", "package.json")) as { version?: unknown }).version,
        installedVitePluginVersion: (readJsonFile(deps, path.join(root, "node_modules", "@cloudflare", "vite-plugin", "package.json")) as { version?: unknown }).version,
      }),
    );
  } catch (error) {
    problems.push(`Could not read the installed tool versions: ${error instanceof Error ? error.message : String(error)}`);
  }

  const targetPath = options.targetPath ?? deps.env.MORPH_DEPLOY_TARGET ?? null;
  if (!targetPath) {
    problems.push("No deploy target: pass --target <file> or set MORPH_DEPLOY_TARGET (see DEPLOY.md).");
    return { ok: false, result: refuse(deps, problems) };
  }
  let target: DeployTarget | null = null;
  try {
    const parsed = parseDeployTarget(readJsonFile(deps, path.resolve(root, targetPath)));
    if (parsed.ok) target = parsed.value;
    else problems.push(...parsed.problems);
  } catch (error) {
    problems.push(`Could not read the deploy target ${targetPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!target) return { ok: false, result: refuse(deps, problems) };

  problems.push(...checkDeployEnvironment(deps.env, target, { deployToken: command === "deploy" }));
  if (command === "ensure-platform-bindings" && !deps.env.MORPH_BOOTSTRAP_API_TOKEN) {
    problems.push("MORPH_BOOTSTRAP_API_TOKEN (the platform bootstrap credential) is not set.");
  }

  const sourcePath = path.join(root, "wrangler.jsonc");
  let source: unknown = null;
  const sourceText = deps.readText(sourcePath);
  const parsedSource = deps.parseJsonc(sourceText);
  if (!parsedSource.ok) {
    problems.push(`wrangler.jsonc does not parse: ${parsedSource.error}`);
  } else {
    source = parsedSource.value;
    problems.push(...checkSourceConfig(source, target));
  }
  const vars = (source as { vars?: Record<string, unknown> } | null)?.vars;
  const manifest = platformManifest(vars);
  // Manifest problems are already in the source guard's list.
  if (problems.length > 0 || !manifest.ok) return { ok: false, result: refuse(deps, problems) };
  return { ok: true, prepared: { target, source, sourceText, manifest: manifest.value, sourcePath } };
}

async function inventory(
  deps: CoreDeployDeps,
  prepared: Prepared,
  mode: CompareMode,
  baseline?: InventorySnapshot,
): Promise<Verdict> {
  const api = deps.inventoryApi(prepared.target.accountId);
  return reconcile({
    read: () => readInventory(api, prepared.target, prepared.manifest, deps.now),
    compare: (snapshot) =>
      compareInventory({ snapshot, target: prepared.target, manifest: prepared.manifest, mode, ...(baseline ? { baseline } : {}) }),
    delayMs: deps.reconcileDelayMs ?? 3000,
    sleep: deps.sleep,
  });
}

function report(deps: CoreDeployDeps, phase: string, verdict: Verdict, workerName: string) {
  for (const line of describeVerdict(verdict)) deps.log(`[core-deploy] ${phase}: ${line}`);
  deps.writeReport(phase, {
    status: verdict.status,
    ...(verdict.status === "unavailable"
      ? { reason: verdict.reason }
      : {
          bindings: bindingIdentities(verdict.snapshot, workerName),
          ...(verdict.status === "drift" ? { drift: verdict.drift } : {}),
          ...(verdict.status === "drift" || verdict.status === "transient" ? { transient: verdict.transient } : {}),
          tolerated: verdict.tolerated,
          diagnostics: verdict.diagnostics,
        }),
  });
}

function verdictExit(verdict: Verdict): number {
  switch (verdict.status) {
    case "ok":
      return EXIT.ok;
    case "drift":
      return EXIT.drift;
    case "transient":
      return EXIT.transient;
    case "unavailable":
      return EXIT.unavailable;
  }
}

export async function runCoreDeploy(
  command: CoreDeployCommand,
  options: RunnerOptions,
  deps: CoreDeployDeps,
): Promise<RunResult> {
  const ready = prepare(command, options, deps);
  if (!ready.ok) return ready.result;
  const { prepared } = ready;
  const { target } = prepared;

  if (command === "verify") {
    const verdict = await inventory(deps, prepared, "strict");
    report(deps, "verify", verdict, target.workerName);
    return { exitCode: verdictExit(verdict), problems: [] };
  }

  // The two commands that write — the deploy and platform:ensure — run one at
  // a time per checkout. For the deploy, a second run (or its build) would
  // replace the redirect and artifact this one checked; for platform:ensure,
  // two runs would race the same upserting Custom Domain PUT.
  const lockDir = path.join(deps.rootDir, ".wrangler", "core-deploy.lock");
  if (!deps.lock(lockDir)) {
    return refuse(deps, [
      `${path.relative(deps.rootDir, lockDir)} exists: another Core deploy or platform:ensure is running in this checkout. If none is (a killed run), remove it and run again.`,
    ]);
  }
  try {
    return command === "ensure-platform-bindings"
      ? await ensureLocked(deps, prepared)
      : await deployLocked(options, deps, prepared);
  } finally {
    deps.unlock(lockDir);
  }
}

async function ensureLocked(deps: CoreDeployDeps, prepared: Prepared): Promise<RunResult> {
  const { target } = prepared;
  // Everything but the missing platform bindings must already be clean: a
  // storefront domain inside the preview namespace, a foreign binding or an
  // unknown one is reconciled first, never built on.
  const before = await inventory(deps, prepared, "bootstrap");
  report(deps, "ensure-pre", before, target.workerName);
  if (before.status !== "ok") {
    return refuse(deps, [
      before.status === "unavailable"
        ? "The binding inventory could not be read; platform:ensure writes nothing it cannot check."
        : `The binding inventory is not clean apart from missing platform bindings (${before.status}); reconcile it first.`,
    ]);
  }
  const api = deps.inventoryApi(target.accountId);
  let result;
  try {
    result = await ensurePlatformBindings({
      target,
      manifest: prepared.manifest,
      read: () => readInventory(api, target, prepared.manifest, deps.now),
      api: deps.bootstrapApi(target.accountId),
      checkBeforeWrite: (snapshot) =>
        compareInventory({ snapshot, target, manifest: prepared.manifest, mode: "bootstrap" }).discrepancies.map((d) => d.detail),
    });
  } catch (error) {
    deps.log(`[core-deploy] platform:ensure: verification unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return { exitCode: EXIT.unavailable, problems: [] };
  }
  for (const step of result.steps) {
    deps.log(`[core-deploy] platform:ensure: ${step.kind} ${step.subject}: ${step.outcome} — ${step.detail}`);
  }
  deps.writeReport("ensure", result);
  if (result.status === "refused") return { exitCode: EXIT.refused, problems: [] };
  if (result.status === "failed") return { exitCode: EXIT.deployFailed, problems: [] };
  if (result.status === "drift") {
    return { exitCode: EXIT.drift, problems: ["platform:ensure: the created Route shadows a Custom Domain that appeared during the run; nothing was deleted"] };
  }
  const verdict = await inventory(deps, prepared, "strict");
  report(deps, "ensure-verify", verdict, target.workerName);
  if (prepared.manifest.routes.length > 0) {
    deps.log("[core-deploy] platform:ensure: a Route exists; verify the preview namespace's wildcard DNS, TLS and HTTP separately (DEPLOY.md).");
  }
  return { exitCode: verdictExit(verdict), problems: [] };
}

async function deployLocked(options: RunnerOptions, deps: CoreDeployDeps, prepared: Prepared): Promise<RunResult> {
  const { target } = prepared;
  const mode: CompareMode = options.bootstrap ? "bootstrap" : "strict";
  const root = deps.rootDir;
  const childEnv = deployChildEnv(deps.env);

  // A redirect or artifact left by an earlier build must not be what is
  // checked or deployed; the migration check must read wrangler.jsonc, not a
  // stale redirect.
  deps.removeDir(path.join(root, "dist"));
  deps.removeDir(path.join(root, path.dirname(DEPLOY_REDIRECT_PATH)));

  // The migration check reads the validated target's database by id, with the
  // inventory credential, before anything is built.
  const database = ((prepared.source as { d1_databases?: Array<{ binding?: string; migrations_dir?: string }> })
    .d1_databases ?? []).find((entry) => entry.binding === "DATABASE");
  let entries: string[];
  try {
    entries = deps.listDir(path.join(root, database?.migrations_dir ?? "migrations"));
  } catch (error) {
    return refuse(deps, [`Could not list the migrations directory: ${error instanceof Error ? error.message : String(error)}`]);
  }
  const migrations = await checkRemoteMigrations({
    api: deps.inventoryApi(target.accountId),
    databaseId: target.d1Databases.DATABASE!,
    entries,
  });
  for (const line of migrations.lines) deps.log(`[core-deploy] migrations: ${line}`);
  if (!migrations.ok) return refuse(deps, ["The remote D1 migration check did not pass."]);

  const before = await inventory(deps, prepared, mode);
  report(deps, "pre", before, target.workerName);
  if (before.status !== "ok") {
    return refuse(deps, [
      before.status === "unavailable"
        ? "The binding inventory could not be read; a deploy that cannot be checked is not run."
        : `The binding inventory is not clean (${before.status}); reconcile it first${mode === "strict" ? " (a first deploy uses deploy:bootstrap)" : ""}.`,
    ]);
  }

  const buildStartedAt = deps.now().getTime();
  const build = await deps.run("build", ["pnpm", "run", "build"], childEnv);
  if (build !== 0) return refuse(deps, ["The build failed."]);

  // Each file is read once; the guard checks those bytes, and the fingerprint
  // below is taken of the same bytes, so a file replaced after its check is a
  // change, never a new baseline.
  const redirectPath = path.join(root, DEPLOY_REDIRECT_PATH);
  const artifactPath = path.join(root, ARTIFACT_CONFIG_PATH);
  const artifactProblems: string[] = [];
  let redirectText: string | null = null;
  let artifactText: string | null = null;
  try {
    if (!deps.exists(redirectPath)) {
      artifactProblems.push(`The build wrote no ${DEPLOY_REDIRECT_PATH}.`);
    } else {
      redirectText = deps.readText(redirectPath);
      const redirect = checkDeployRedirect(JSON.parse(redirectText), root);
      if (!redirect.ok) {
        artifactProblems.push(...redirect.problems);
      } else if (!deps.exists(artifactPath)) {
        artifactProblems.push(`The build wrote no ${ARTIFACT_CONFIG_PATH}.`);
      } else {
        if (deps.mtimeMs(artifactPath) < buildStartedAt - 1000 || deps.mtimeMs(redirectPath) < buildStartedAt - 1000) {
          artifactProblems.push(`${ARTIFACT_CONFIG_PATH} is older than this build.`);
        }
        artifactText = deps.readText(artifactPath);
        artifactProblems.push(
          ...checkArtifactConfig(JSON.parse(artifactText), prepared.source, target, prepared.sourcePath),
        );
      }
    }
  } catch (error) {
    artifactProblems.push(`Could not read the build's deploy config: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (artifactProblems.length > 0 || redirectText === null || artifactText === null) {
    return refuse(deps, artifactProblems.length > 0 ? artifactProblems : ["The build's deploy config was not read."]);
  }

  // Wrangler reads a private copy of what was checked, never the checkout: a
  // build in the checkout after this point cannot change what is deployed,
  // and with --config naming the copy no redirect is followed and no
  // wrangler.json/wrangler.jsonc is fallen back to. A stray one at the root
  // is refused anyway: it is a config nobody checked, one flag away.
  const stray = ["wrangler.json", "wrangler.toml"].filter((name) => deps.exists(path.join(root, name)));
  if (stray.length > 0) {
    return refuse(deps, [`${stray.join(" and ")} at the checkout root: an unchecked Wrangler config. Remove it.`]);
  }
  // Every path the config references — dist/, the migrations dir, each
  // container's Dockerfile and its COPY sources — goes into the snapshot
  // (snapshot.ts); a reference the snapshot cannot hold is a refusal.
  let snapshotDir: string;
  try {
    snapshotDir = deps.snapshot({ root, artifactPath, artifactText }).dir;
  } catch (error) {
    return refuse(deps, [`Could not snapshot the build output: ${error instanceof Error ? error.message : String(error)}`]);
  }
  try {
    return await deploySnapshot({ deps, prepared, mode, childEnv, before: before.snapshot, artifactText, artifactPath, snapshotDir });
  } finally {
    deps.removeDir(snapshotDir);
  }
}

async function deploySnapshot(input: {
  deps: CoreDeployDeps;
  prepared: Prepared;
  mode: CompareMode;
  childEnv: Record<string, string>;
  before: InventorySnapshot;
  artifactText: string;
  artifactPath: string;
  snapshotDir: string;
}): Promise<RunResult> {
  const { deps, prepared, mode, childEnv, artifactText, snapshotDir } = input;
  const { target } = prepared;
  const snapshotConfig = path.join(snapshotDir, ARTIFACT_CONFIG_PATH);

  // The copy must be byte for byte the artifact the guard read, and Wrangler's
  // own reader must see the same policy in it (prototype keys, inherited
  // routes, unsafe metadata and defaults are its business, not JSON.parse's).
  let checked: string;
  const problems: string[] = [];
  try {
    // The checked artifact, with only its container paths moved into the
    // snapshot; computed here, not taken from the snapshot step.
    if (deps.readText(snapshotConfig) !== expectedSnapshotConfig(artifactText, deps.rootDir, input.artifactPath, snapshotDir)) {
      problems.push("The snapshot's config differs from the artifact the guard checked (the build output changed in between).");
    }
    const normalized = deps.readWranglerConfig(snapshotConfig);
    problems.push(...checkNormalizedConfig(normalized, target));
    problems.push(...pathsOutsideSnapshot(normalized, snapshotDir, snapshotConfig).map((p) => `Wrangler's reader: ${p}`));
    checked = deps.hashTree(snapshotDir);
  } catch (error) {
    return refuse(deps, [
      ...problems,
      `Could not verify the snapshot: ${error instanceof Error ? error.message : String(error)}`,
    ]);
  }
  if (problems.length > 0) return refuse(deps, problems);

  // Immediately before Wrangler starts: unchanged, and readable.
  let current: string | null;
  try {
    current = deps.hashTree(snapshotDir);
  } catch {
    current = null;
  }
  if (current !== checked) return refuse(deps, ["The verified snapshot changed, or could not be read, before Wrangler started."]);

  const wranglerBin = path.join(deps.rootDir, "node_modules", "wrangler", "bin", "wrangler.js");
  let deployExit: number;
  let deployError: string | null = null;
  try {
    deployExit = await deps.run("wrangler", ["node", ...wranglerDeployArgv(wranglerBin, snapshotConfig)], childEnv, snapshotDir);
  } catch (error) {
    deployExit = -1;
    deployError = error instanceof Error ? error.message : String(error);
  }
  if (deployExit !== 0) {
    deps.log(`[core-deploy] wrangler deploy exited ${deployExit}${deployError ? ` (${deployError})` : ""}; the upload may have committed, so the post-check still runs.`);
  }

  // After it: a change, or a file that cannot be read, is reported; the
  // post-deploy inventory runs either way.
  let afterHash: string;
  try {
    afterHash = deps.hashTree(snapshotDir);
  } catch (error) {
    afterHash = `<unreadable: ${error instanceof Error ? error.message : String(error)}>`;
  }
  const changedDuringDeploy = afterHash !== checked;
  if (changedDuringDeploy) {
    deps.log("[core-deploy] the verified snapshot changed while Wrangler ran; what it deployed is not known to be what was checked.");
  }

  // Runs whatever Wrangler did: an upload can commit before a later step fails.
  const after = await inventory(deps, prepared, mode, input.before);
  report(deps, "post", after, target.workerName);
  const deployProblems = [
    ...(deployExit !== 0 ? [`wrangler deploy exited ${deployExit}`] : []),
    ...(changedDuringDeploy ? ["the verified snapshot changed while Wrangler ran"] : []),
  ];
  if (after.status !== "ok") {
    return { exitCode: verdictExit(after), problems: [`post-deploy check: ${after.status}`, ...deployProblems] };
  }
  if (deployProblems.length > 0) return { exitCode: EXIT.deployFailed, problems: deployProblems };
  if (mode === "bootstrap" && after.tolerated.length > 0) {
    deps.log("[core-deploy] bootstrap deploy done; run `pnpm run platform:ensure`, then `pnpm run deploy:verify`.");
  }
  return { exitCode: EXIT.ok, problems: [] };
}
