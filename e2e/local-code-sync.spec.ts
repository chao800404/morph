import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { EDITOR_PATH, openEditor } from "./helpers";
import {
  removeThemeFiles,
  themeScopeFromEditorPath,
  writeThemeFiles,
  type ThemeScope,
} from "./native-compat";

test.skip(!EDITOR_PATH, "Requires the disposable editor store.");

/**
 * Local sync, end to end: the editor issues the token, the real `morph-sync`
 * CLI links a temporary folder and keeps it in step with the Theme on this
 * dev server, through the real sync API and the D1 workspace.
 *
 * Morph-side edits are made through the server function Code mode saves
 * with, the store Design writes through as well; Design's own UI is not
 * driven here.
 */

const REPO = process.cwd();
const SERVER_FN_MODULE =
  "/src/server/storefront/storefront-theme-files.serverFn.ts";

type Cli = { child: ChildProcess; output: () => string; stop: () => Promise<void> };

function cliEnv(home: string, token?: string) {
  return {
    ...process.env,
    HOME: home,
    ...(token ? { MORPH_SYNC_TOKEN: token } : {}),
  };
}

function runCli(args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["exec", "tsx", "scripts/morph-sync.ts", ...args], {
      cwd: REPO,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, output }));
  });
}

function startCli(dir: string, env: NodeJS.ProcessEnv, extra: string[] = []): Cli {
  const child = spawn(
    "pnpm",
    ["exec", "tsx", "scripts/morph-sync.ts", "start", "--dir", dir, "--yes", ...extra],
    { cwd: REPO, env, stdio: ["ignore", "pipe", "pipe"], detached: true },
  );
  let output = "";
  child.stdout!.on("data", (chunk) => (output += chunk));
  child.stderr!.on("data", (chunk) => (output += chunk));
  return {
    child,
    output: () => output,
    stop: () =>
      new Promise((resolve) => {
        if (child.exitCode !== null) return resolve();
        child.once("close", () => resolve());
        // The whole group: pnpm, tsx and node.
        process.kill(-child.pid!, "SIGINT");
      }),
  };
}

async function morphFile(page: Page, scope: ThemeScope, path: string) {
  return page.evaluate(
    async ({ module, scope, path }) => {
      const fns = await import(/* @vite-ignore */ module);
      const result = await fns.getStorefrontThemeFile({ data: { ...scope, path } });
      return result?.success
        ? { content: result.data.content as string, version: result.data.version as number }
        : null;
    },
    { module: SERVER_FN_MODULE, scope, path },
  );
}

const readLocal = (dir: string, path: string) =>
  readFile(join(dir, path), "utf8").catch(() => null);

/** Whether the folder's sync state still holds a refused deletion. */
const holdsDeletion = async (dir: string) =>
  "deletionHold" in JSON.parse((await readLocal(dir, ".morph/sync-state.json")) ?? "{}");

async function writeLocal(dir: string, path: string, text: string) {
  await mkdir(dirname(join(dir, path)), { recursive: true });
  await writeFile(join(dir, path), text);
}

/** The editor issues the token: Code mode → Command Palette. */
async function issueTokenFromEditor(page: Page) {
  await openEditor(page);
  await page.getByRole("button", { name: /^Code$/ }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "New file", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Command Palette" }).click();
  await page.getByRole("option", { name: /Theme: Link Local Folder/ }).click();
  await page.getByRole("button", { name: "Create token" }).click();
  const tokenCode = page.locator("code").filter({ hasText: /^mts_[0-9a-f]{40}$/ });
  await expect(tokenCode).toBeVisible();
  const token = (await tokenCode.textContent())!.trim();
  const origin = new URL(page.url()).origin;
  await expect(page.locator("code").filter({ hasText: `--origin ${origin}` })).toBeVisible();
  await page.keyboard.press("Escape");
  return { token, origin };
}

const git = (dir: string, args: string[]) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn("git", ["-c", "user.email=e2e@morph.invalid", "-c", "user.name=e2e", ...args], {
      cwd: dir,
      stdio: "ignore",
    });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`git ${args.join(" ")}: ${code}`))));
  });

async function morphPaths(page: Page, scope: ThemeScope, prefix: string) {
  return page.evaluate(
    async ({ module, scope, prefix }) => {
      const fns = await import(/* @vite-ignore */ module);
      const listed = await fns.listStorefrontThemeFiles({ data: scope });
      return (listed.data.files as Array<{ path: string }>)
        .map((file) => file.path)
        .filter((path) => path.startsWith(prefix));
    },
    { module: SERVER_FN_MODULE, scope, prefix },
  );
}

test("deletions en masse stop sync until the developer says so, however they arrive", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const scope = themeScopeFromEditorPath(EDITOR_PATH!);
  const marker = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const folder = `src/sync-probe-${marker}/`;
  const probes = Array.from({ length: 40 }, (_, index) => `${folder}p${String(index).padStart(2, "0")}.ts`);
  const home = await mkdtemp(join(tmpdir(), "morph-sync-home-"));
  const dir = await mkdtemp(join(tmpdir(), "morph-sync-dir-"));
  let cli: Cli | null = null;
  const exited = (running: Cli) =>
    new Promise<number>((resolve) =>
      running.child.exitCode !== null
        ? resolve(running.child.exitCode)
        : running.child.once("exit", (code) => resolve(code ?? -1)),
    );

  try {
    const { token, origin } = await issueTokenFromEditor(page);
    expect(
      await writeThemeFiles(page, scope, probes.map((path) => ({ path, content: `export const p = "${path}";\n` }))),
    ).toMatchObject({ success: true });
    const linked = await runCli(["link", "--dir", dir, "--origin", origin], cliEnv(home, token));
    expect(linked.code).toBe(0);
    cli = startCli(dir, cliEnv(home));
    await expect.poll(() => readLocal(dir, probes[39]!), { timeout: 60_000 }).not.toBeNull();
    await cli.stop();
    cli = null;

    // A branch switch that removes 20 files, under --yes, in a terminal that
    // cannot be asked (stdin is not a TTY here).
    await git(dir, ["init", "-q", "-b", "main"]);
    await git(dir, ["add", "-A"]);
    await git(dir, ["commit", "-q", "-m", "synced"]);
    await git(dir, ["checkout", "-q", "-b", "without-probes"]);
    await git(dir, ["rm", "-q", ...probes.slice(0, 20)]);
    await git(dir, ["commit", "-q", "-m", "drop probes"]);
    await git(dir, ["checkout", "-q", "main"]);
    cli = startCli(dir, cliEnv(home));
    await expect.poll(() => cli!.output(), { timeout: 30_000 }).toContain("Syncing");
    await git(dir, ["checkout", "-q", "without-probes"]);
    expect(await exited(cli)).toBe(1);
    expect(cli.output()).toContain("delete 20 files from the workspace");
    expect(cli.output()).toContain("Not applied. Rerun with --allow-mass-delete");
    // The prompt names where the deletion would happen, and every file.
    expect(cli.output()).toContain(`Store:  ${scope.storefrontId}`);
    expect(cli.output()).toContain(`Theme:  ${scope.themeId}`);
    for (const path of probes.slice(0, 20)) {
      expect(cli.output()).toContain(`delete from Morph: ${path}`);
    }
    cli = null;
    expect(await morphPaths(page, scope, folder)).toHaveLength(40);
    expect(await holdsDeletion(dir), "the refused deletion is held").toBe(true);
    await git(dir, ["checkout", "-q", "main"]);

    // The same files deleted five at a time: each batch alone is small, the
    // fourth makes 20 within the window, and the run stops there.
    cli = startCli(dir, cliEnv(home));
    await expect.poll(() => cli!.output(), { timeout: 30_000 }).toContain("Syncing");
    // "Syncing" is printed before the first cycle has read the folder. Only
    // that cycle, finding the 20 files back, lifts the hold; a batch removed
    // before then is still the held deletion, and stops the run.
    await expect.poll(() => holdsDeletion(dir), { timeout: 30_000 }).toBe(false);
    for (const batch of [0, 1, 2]) {
      const paths = probes.slice(batch * 5, batch * 5 + 5);
      for (const path of paths) await rm(join(dir, path));
      await expect
        .poll(async () => (await morphPaths(page, scope, folder)).length, { timeout: 30_000 })
        .toBe(40 - (batch + 1) * 5);
    }
    for (const path of probes.slice(15, 20)) await rm(join(dir, path));
    expect(await exited(cli)).toBe(1);
    expect(cli.output()).toMatch(/5 more files from the workspace, 20 in the last 15 minutes/);
    cli = null;
    expect(await morphPaths(page, scope, folder)).toHaveLength(25);

    // --allow-mass-delete approves the held deletion once: the 5 go...
    cli = startCli(dir, cliEnv(home), ["--allow-mass-delete"]);
    await expect
      .poll(async () => (await morphPaths(page, scope, folder)).length, { timeout: 30_000 })
      .toBe(20);
    expect(cli.output()).toContain("Approved by --allow-mass-delete, for this deletion only.");
    // ...and a second mass deletion in the same run stops all the same.
    for (const path of probes.slice(20, 35)) await rm(join(dir, path));
    expect(await exited(cli)).toBe(1);
    expect(cli.output()).toContain("it approves one mass deletion");
    cli = null;
    expect(await morphPaths(page, scope, folder)).toHaveLength(20);
  } finally {
    await cli?.stop();
    await removeThemeFiles(page, scope, probes);
    await rm(home, { recursive: true, force: true });
    await rm(dir, { recursive: true, force: true });
  }
});

test("a local folder and the Theme's Code workspace stay in step both ways", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const scope = themeScopeFromEditorPath(EDITOR_PATH!);
  const marker = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const probe = `src/components/SyncProbe${marker}.tsx`;
  const home = await mkdtemp(join(tmpdir(), "morph-sync-home-"));
  const dir = await mkdtemp(join(tmpdir(), "morph-sync-dir-"));
  let cli: Cli | null = null;

  try {
    const { token, origin } = await issueTokenFromEditor(page);

    expect(
      await writeThemeFiles(page, scope, [{ path: probe, content: `export const v = "${marker}-1";\n` }]),
    ).toMatchObject({ success: true });

    // Link: the token is read from the environment and kept outside the folder.
    const linked = await runCli(["link", "--dir", dir, "--origin", origin], cliEnv(home, token));
    expect(linked.output).toContain(`Linked ${dir}`);
    expect(linked.code).toBe(0);
    const credentials = join(home, ".config", "morph", "sync-credentials.json");
    expect((await stat(credentials)).mode & 0o777).toBe(0o600);
    expect(await readFile(join(dir, ".morph", "sync-state.json"), "utf8")).not.toContain(token);

    // First sync brings the workspace down.
    cli = startCli(dir, cliEnv(home));
    await expect.poll(() => readLocal(dir, probe), { timeout: 60_000 }).toBe(
      `export const v = "${marker}-1";\n`,
    );
    await expect.poll(() => readLocal(dir, "package.json")).not.toBeNull();

    // Morph → local: an edit saved in Morph is written to the folder.
    expect(
      await writeThemeFiles(page, scope, [{ path: probe, content: `export const v = "${marker}-2 from Morph";\n` }]),
    ).toMatchObject({ success: true });
    await expect.poll(() => readLocal(dir, probe), { timeout: 60_000 }).toBe(
      `export const v = "${marker}-2 from Morph";\n`,
    );

    // Local → Morph: an edit in the folder reaches the workspace.
    await writeLocal(dir, probe, `export const v = "${marker}-3 from my editor";\n`);
    await expect
      .poll(async () => (await morphFile(page, scope, probe))?.content, { timeout: 30_000 })
      .toBe(`export const v = "${marker}-3 from my editor";\n`);
    const afterUpload = await morphFile(page, scope, probe);

    // The same text in CRLF is not a change: nothing goes up.
    await writeLocal(dir, probe, `export const v = "${marker}-3 from my editor";\r\n`);
    await page.waitForTimeout(6_000);
    expect((await morphFile(page, scope, probe))?.version).toBe(afterUpload!.version);

    // A platform file in the folder never reaches the workspace.
    await writeLocal(dir, "__entry.tsx", `// ${marker} must not upload\n`);
    await page.waitForTimeout(3_000);
    expect((await morphFile(page, scope, "__entry.tsx"))?.content ?? "").not.toContain(marker);

    await cli.stop();
    cli = null;

    // Both sides change while sync is stopped: a conflict, both kept.
    await writeLocal(dir, probe, `export const v = "${marker}-mine";\n`);
    expect(
      await writeThemeFiles(page, scope, [{ path: probe, content: `export const v = "${marker}-theirs";\n` }]),
    ).toMatchObject({ success: true });
    cli = startCli(dir, cliEnv(home));
    await expect.poll(() => cli!.output(), { timeout: 60_000 }).toContain(`CONFLICT ${probe}`);
    expect(await readLocal(dir, probe)).toBe(`export const v = "${marker}-mine";\n`);
    expect(await readLocal(dir, `${probe}.morph-remote`)).toBe(`export const v = "${marker}-theirs";\n`);
    expect((await morphFile(page, scope, probe))?.content).toBe(`export const v = "${marker}-theirs";\n`);
    await cli.stop();
    cli = null;

    // Keep the local copy: it goes up over Morph's, against Morph's version.
    const resolved = await runCli(["resolve", probe, "--keep", "local", "--dir", dir], cliEnv(home));
    expect(resolved.code).toBe(0);
    cli = startCli(dir, cliEnv(home));
    await expect
      .poll(async () => (await morphFile(page, scope, probe))?.content, { timeout: 60_000 })
      .toBe(`export const v = "${marker}-mine";\n`);
    expect(await readLocal(dir, `${probe}.morph-remote`)).toBeNull();
    await cli.stop();
    cli = null;

    // Logout revokes the token on the server.
    const loggedOut = await runCli(["logout", "--dir", dir], cliEnv(home));
    expect(loggedOut.code).toBe(0);
    const whoami = await page.request.get("/api/storefront/theme-sync/whoami", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(whoami.status()).toBe(401);
  } finally {
    await cli?.stop();
    await removeThemeFiles(page, scope, [probe]);
    await rm(home, { recursive: true, force: true });
    await rm(dir, { recursive: true, force: true });
  }
});
