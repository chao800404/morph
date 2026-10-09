#!/usr/bin/env -S node --import tsx
/**
 * morph-sync: keep a local folder and a Morph Theme's Code workspace in step,
 * both ways (docs/local-code-sync.md). Prototype; run from the Morph repo:
 *
 *   pnpm morph:sync link --dir ../my-theme --origin http://localhost:3000
 *   pnpm morph:sync start --dir ../my-theme
 *   pnpm morph:sync status --dir ../my-theme
 *   pnpm morph:sync resolve src/routes/index.tsx --keep local --dir ../my-theme
 *   pnpm morph:sync logout --dir ../my-theme
 *
 * The token comes from the editor's "Link local folder", via the
 * MORPH_SYNC_TOKEN environment variable or a prompt; it is never taken as a
 * command-line argument, which would leave it in shell history.
 */
import { promises as fs, watch } from "node:fs";
import { homedir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import {
  createThemeSyncClient,
  ThemeSyncApiRefusal,
} from "../src/lib/storefront/local-dev/theme-sync/sync-client";
import { createConfirmPolicy, describeMassDeletion } from "../src/lib/storefront/local-dev/theme-sync/sync-confirm";
import { createLocalSyncFolder, SYNC_DIRECTORY } from "../src/lib/storefront/local-dev/theme-sync/sync-local-fs";
import { themeSyncPathExclusion } from "../src/lib/storefront/local-dev/theme-sync/sync-paths";
import {
  createSyncSession,
  type CyclePlanSummary,
  type SyncState,
} from "../src/lib/storefront/local-dev/theme-sync/sync-session";

const POLL_ACTIVE_MS = 3_000;
// Ten, not thirty: a Design edit waited about forty seconds to come down at
// thirty, which reads as broken while someone is working in Morph.
const POLL_IDLE_MAX_MS = 10_000;
const LOCAL_DEBOUNCE_MS = 400;

const { values: flags, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    dir: { type: "string", default: "." },
    origin: { type: "string" },
    keep: { type: "string" },
    yes: { type: "boolean", default: false },
    "allow-mass-delete": { type: "boolean", default: false },
  },
});
const command = positionals[0] ?? "start";
const root = resolvePath(flags.dir ?? ".");
const statePath = join(root, SYNC_DIRECTORY, "sync-state.json");
const credentialsPath = join(homedir(), ".config", "morph", "sync-credentials.json");

const log = (line: string) => process.stdout.write(`[morph-sync] ${line}\n`);
const fail = (line: string): never => {
  process.stderr.write(`[morph-sync] ${line}\n`);
  process.exit(1);
};

type Credentials = Record<string, { token: string; expiresAt: string }>;
const credentialKey = (origin: string, themeId: string) => `${origin}|${themeId}`;

async function readCredentials(): Promise<Credentials> {
  try {
    return JSON.parse(await fs.readFile(credentialsPath, "utf8")) as Credentials;
  } catch {
    return {};
  }
}

async function writeCredentials(credentials: Credentials) {
  await fs.mkdir(join(homedir(), ".config", "morph"), { recursive: true, mode: 0o700 });
  await fs.writeFile(credentialsPath, JSON.stringify(credentials, null, 2), { mode: 0o600 });
  await fs.chmod(credentialsPath, 0o600);
}

async function readState(): Promise<SyncState> {
  try {
    return JSON.parse(await fs.readFile(statePath, "utf8")) as SyncState;
  } catch {
    return fail(`${root} is not linked. Run: pnpm morph:sync link --dir ${flags.dir} --origin <Morph address>`);
  }
}

async function saveState(state: SyncState) {
  await fs.mkdir(join(root, SYNC_DIRECTORY), { recursive: true });
  const temporary = `${statePath}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(state, null, 2));
  await fs.rename(temporary, statePath);
}

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

async function clientFor(state: SyncState) {
  const credentials = (await readCredentials())[credentialKey(state.origin, state.themeId)];
  if (!credentials) fail("No token for this Theme. Run link again.");
  return createThemeSyncClient({ origin: state.origin, token: credentials!.token });
}

function printSummary(summary: CyclePlanSummary) {
  const list = (label: string, paths: readonly string[]) => {
    if (paths.length === 0) return;
    log(`${label} (${paths.length}):`);
    for (const path of paths.slice(0, 20)) log(`  ${path}`);
    if (paths.length > 20) log(`  … and ${paths.length - 20} more`);
  };
  list("upload to Morph", summary.uploads);
  list("delete from Morph", summary.remoteDeletions);
  list("write locally", summary.downloads);
  list("delete locally (moved to .morph/trash)", summary.localDeletions);
  list("CONFLICT, both sides kept", summary.conflicts.map((c) => `${c.path} (${c.reason})`));
  if (summary.massDeletion) log(`WARNING: ${summary.massDeletion}`);
}

async function link() {
  const origin = flags.origin ? new URL(flags.origin).origin : fail("Name the Morph address with --origin.");
  const token = process.env.MORPH_SYNC_TOKEN?.trim() || (await ask("Paste the token from the editor's Link local folder: "));
  const client = createThemeSyncClient({ origin, token });
  const who = await client.whoami().catch((error: unknown) =>
    fail(`The token was refused: ${error instanceof Error ? error.message : String(error)}`),
  );
  const credentials = await readCredentials();
  credentials[credentialKey(origin, who.themeId)] = { token, expiresAt: who.expiresAt };
  await writeCredentials(credentials);
  await fs.mkdir(join(root, SYNC_DIRECTORY), { recursive: true });
  await fs.writeFile(join(root, SYNC_DIRECTORY, ".gitignore"), "*\n");
  let existing: SyncState | null = null;
  try {
    existing = JSON.parse(await fs.readFile(statePath, "utf8")) as SyncState;
  } catch {
    existing = null;
  }
  // Relinking the same Theme keeps the base; another Theme starts over.
  const keepBase = existing && existing.origin === origin && existing.themeId === who.themeId;
  await saveState({
    protocol: 1,
    origin,
    storefrontId: who.storefrontId,
    themeId: who.themeId,
    sourceGeneration: keepBase ? existing!.sourceGeneration : null,
    files: keepBase ? existing!.files : {},
  });
  log(`Linked ${root} to Theme ${who.themeId} at ${origin} (token valid until ${who.expiresAt}).`);
  log("The token is stored in ~/.config/morph/sync-credentials.json, not in this folder.");
}

function sessionFor(state: SyncState, client: ReturnType<typeof createThemeSyncClient>, dryRun: boolean) {
  // One policy per run: --allow-mass-delete approves the first mass deletion
  // of this run and no other (sync-confirm.ts).
  const policy = createConfirmPolicy({
    yes: flags.yes ?? false,
    allowMassDelete: flags["allow-mass-delete"] ?? false,
    interactive: Boolean(process.stdin.isTTY),
    dryRun,
  });
  return createSyncSession({
    client,
    folder: createLocalSyncFolder(root),
    state,
    saveState,
    confirm: async (summary, why) => {
      if (why === "mass-deletion") {
        const listFile = join(root, SYNC_DIRECTORY, "pending-deletions.txt");
        const described = describeMassDeletion({
          origin: state.origin,
          storefrontId: state.storefrontId,
          themeId: state.themeId,
          folder: root,
          summary,
          listFile,
        });
        if (described.fileContent !== null) {
          await fs.mkdir(join(root, SYNC_DIRECTORY), { recursive: true });
          await fs.writeFile(listFile, described.fileContent);
        }
        for (const line of described.lines) log(line);
      } else {
        printSummary(summary);
      }
      const decision = policy.decide(why);
      if (decision === "yes") {
        if (why === "mass-deletion") log("Approved by --allow-mass-delete, for this deletion only.");
        return true;
      }
      if (decision === "no") {
        if (!dryRun) {
          log(why === "startup"
            ? "Changes made while sync was not running need confirming; rerun with --yes or in a terminal."
            : "Not applied. Rerun with --allow-mass-delete if this is intended; it approves one mass deletion.");
        }
        return false;
      }
      const answer = await ask(why === "startup" ? "Apply these changes? [y/N] " : "Delete these files? [y/N] ");
      return /^y(es)?$/i.test(answer);
    },
  });
}

async function status() {
  const state = await readState();
  const session = sessionFor(state, await clientFor(state), true);
  const result = await session.runCycle();
  if (result.status === "applied") log("In step: nothing to do.");
  if (result.status === "retry") log(`The workspace changed while reading (${result.reason}); run again.`);
}

async function resolveConflict() {
  const path = positionals[1] ?? fail("Name the file: resolve <path> --keep local|remote");
  const keep = flags.keep === "local" || flags.keep === "remote" ? flags.keep : fail("Choose --keep local or --keep remote.");
  const state = await readState();
  const session = sessionFor(state, await clientFor(state), false);
  await session.resolve(path, keep);
  log(`Will keep the ${keep} copy of ${path} on the next sync.`);
}

async function logout() {
  const state = await readState();
  const credentials = await readCredentials();
  const key = credentialKey(state.origin, state.themeId);
  if (credentials[key]) {
    await createThemeSyncClient({ origin: state.origin, token: credentials[key].token })
      .logout()
      .catch(() => undefined);
    delete credentials[key];
    await writeCredentials(credentials);
  }
  log("Token revoked and removed from this machine.");
}

async function start() {
  const state = await readState();
  const client = await clientFor(state);
  const session = sessionFor(state, client, false);
  const reportedConflicts = new Set<string>();
  let reportedSkips = false;
  let dirty = true;
  let delay = POLL_ACTIVE_MS;
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let stopped = false;

  const cycle = async () => {
    const result = await session.runCycle();
    const { summary } = result;
    if (result.status === "declined") {
      log("Nothing applied. Stopping.");
      stopped = true;
      process.exit(1);
    }
    if (result.status === "retry") {
      log(`Morph changed meanwhile; planning again (${result.reason}).`);
      dirty = true;
      return true;
    }
    for (const path of summary.uploads) log(`↑ ${path}`);
    for (const path of summary.remoteDeletions) log(`↑ deleted ${path}`);
    for (const path of summary.downloads) log(`↓ ${path}`);
    for (const path of summary.localDeletions) log(`↓ deleted ${path} (kept in .morph/trash)`);
    const current = new Set(summary.conflicts.map((conflict) => conflict.path));
    for (const conflict of summary.conflicts) {
      if (reportedConflicts.has(conflict.path)) continue;
      reportedConflicts.add(conflict.path);
      log(`CONFLICT ${conflict.path} (${conflict.reason}). Morph's copy is in ${conflict.path}.morph-remote; settle with: pnpm morph:sync resolve ${conflict.path} --keep local|remote --dir ${flags.dir}`);
    }
    for (const path of reportedConflicts) if (!current.has(path)) reportedConflicts.delete(path);
    if (!reportedSkips && (summary.localSkipped.length || summary.binarySkipped.length)) {
      reportedSkips = true;
      const counts = new Map<string, number>();
      for (const skip of summary.localSkipped) {
        const key = skip.detail ?? skip.reason;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      if (summary.binarySkipped.length) counts.set("binary in Morph", summary.binarySkipped.length);
      log(`Not synced: ${[...counts].map(([reason, count]) => `${count} ${reason}`).join(", ")}.`);
    }
    return (
      summary.uploads.length + summary.remoteDeletions.length + summary.downloads.length + summary.localDeletions.length > 0
    );
  };

  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try {
      let active = false;
      if (dirty) {
        dirty = false;
        active = await cycle();
      } else if ((await client.generation()) !== state.sourceGeneration) {
        active = await cycle();
      }
      delay = active ? POLL_ACTIVE_MS : Math.min(Math.round(delay * 1.5), POLL_IDLE_MAX_MS);
    } catch (error) {
      if (error instanceof ThemeSyncApiRefusal && error.status === 401) {
        fail(`Morph refused the token (${error.message}). Link again from the editor.`);
      }
      log(`Sync failed, retrying: ${error instanceof Error ? error.message : String(error)}`);
      delay = Math.min(delay * 2, POLL_IDLE_MAX_MS);
    } finally {
      running = false;
      schedule(delay);
    }
  };

  const schedule = (ms: number) => {
    if (timer) clearTimeout(timer);
    if (!stopped) timer = setTimeout(() => void tick(), ms);
  };

  watch(root, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    const path = filename.toString().split("\\").join("/");
    if (themeSyncPathExclusion(path) === "local-only") return;
    dirty = true;
    delay = POLL_ACTIVE_MS;
    schedule(LOCAL_DEBOUNCE_MS);
  });

  process.on("SIGINT", () => {
    stopped = true;
    log("Stopped.");
    process.exit(0);
  });

  log(`Syncing ${root} with Theme ${state.themeId} at ${state.origin}. Ctrl-C to stop.`);
  await tick();
}

const commands: Record<string, () => Promise<void>> = {
  link,
  start,
  status,
  resolve: resolveConflict,
  logout,
};

const run = commands[command] ?? (() => fail(`Unknown command ${command}. Use link, start, status, resolve or logout.`));
await run();
