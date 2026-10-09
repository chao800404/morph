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

function startCli(dir: string, env: NodeJS.ProcessEnv): Cli {
  const child = spawn(
    "pnpm",
    ["exec", "tsx", "scripts/morph-sync.ts", "start", "--dir", dir, "--yes"],
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

async function writeLocal(dir: string, path: string, text: string) {
  await mkdir(dirname(join(dir, path)), { recursive: true });
  await writeFile(join(dir, path), text);
}

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
    // The editor issues the token: Code mode → Command Palette.
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
    await expect(
      page.locator("code").filter({ hasText: `--origin ${origin}` }),
    ).toBeVisible();
    await page.keyboard.press("Escape");

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
