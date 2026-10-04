import { execFileSync } from "node:child_process";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { openContentTab, openEditor, settleSelection } from "../helpers";

/**
 * What the editor does with unsaved work when who is signed in changes.
 *
 * Each case edits the seeded home page's hero in Code, where the draft is
 * plain to read back from Monaco — by the marker comments it carries, since
 * saving from Code formats the source first, and checks four things the author depends
 * on: nothing is sent while writes are paused, the draft stays, saving waits
 * for the author to confirm, and what is saved is the newest draft — never
 * an older copy, never over someone else's newer save, never as another
 * account.
 *
 * Sessions: a case that signs out signs in a context of its own first, so
 * the session it ends is its own — the stored one in `e2e/.auth/user.json` is
 * shared by every other spec and is never signed out here. A case that only
 * needs the browser to stop sending a session clears its cookies instead,
 * which ends nothing on the server; putting them back is signing in again.
 * Sign-in is rate limited (five a minute), which is the other reason to use
 * it only where signing out is the point.
 */

/** Seeded by `scripts/seed-e2e.mjs`, with the same password. */
export const SECOND_EMAIL = "e2e-second-admin@morph.invalid";
export const MARKER = "editor-writes-paused";

export const email = () => process.env.E2E_EMAIL!;
export const password = () => process.env.E2E_PASSWORD!;

export const STORAGE_STATE = "e2e/.auth/user.json";

export async function signIn(context: BrowserContext, address: string) {
  const origin = new URL(test.info().project.use.baseURL!).origin;
  for (let attempt = 0; ; attempt += 1) {
    const response = await context.request.post("/api/auth/sign-in/email", {
      data: { email: address, password: password() },
      headers: { origin },
    });
    // Rate limited: wait for the window rather than fail on it.
    if (response.status() === 429 && attempt < 6) {
      await new Promise((resolve) => setTimeout(resolve, 15_000));
      continue;
    }
    expect(response.ok(), `sign-in as ${address}`).toBe(true);
    return;
  }
}

export async function signOut(context: BrowserContext) {
  const origin = new URL(test.info().project.use.baseURL!).origin;
  const response = await context.request.post("/api/auth/sign-out", {
    data: {},
    headers: { origin },
  });
  expect(response.ok(), "sign-out").toBe(true);
}

/** An editor on a session of its own, for a case that signs out. */
export async function signedInEditor(browser: Browser, address = email()) {
  const { baseURL } = test.info().project.use;
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1600, height: 950 },
  });
  await signIn(context, address);
  const page = await context.newPage();
  await openEditor(page);
  return { context, page };
}

/** An editor on the shared session, for a case that never signs out. */
export async function sharedEditor(browser: Browser) {
  const { baseURL } = test.info().project.use;
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1600, height: 950 },
    storageState: STORAGE_STATE,
  });
  const page = await context.newPage();
  await openEditor(page);
  return { context, page };
}

/** Opens the hero in Code and returns its path. */
export async function openHeroInCode(page: Page) {
  await page.getByRole("button", { name: "hero", exact: true }).click();
  await openContentTab(page);
  const openInCode = page.locator('button[title$=" in Monaco Code Editor"]');
  const hero = (await openInCode.getAttribute("title"))!
    .replace(/^Open /, "")
    .replace(/ in Monaco Code Editor$/, "");
  await openInCode.click();
  await expect
    .poll(() => readSource(page, hero).catch(() => null), { timeout: 30_000 })
    .not.toBeNull();
  return hero;
}

export function readSource(page: Page, path: string) {
  return page.evaluate(
    (target) =>
      (window as any).monaco.editor
        .getModels()
        .find((model: any) => model.uri.path.endsWith(target))
        .getValue() as string,
    path,
  );
}

export async function editAndSave(page: Page, path: string, next: string) {
  await page.evaluate(
    ({ target, value }) =>
      (window as any).monaco.editor
        .getModels()
        .find((model: any) => model.uri.path.endsWith(target))
        .setValue(value),
    { target: path, value: next },
  );
  await page.keyboard.press("Control+s");
}

/**
 * Whether a request is a call of the Theme file save itself.
 *
 * A server function's id is base64 JSON naming its export; reading it is how
 * the save is told apart from the preview's file sync, which carries the same
 * path in its body.
 */
export function isFileSave(url: string, body: string, path: string) {
  return body.includes(path) && isServerFn(url, "saveStorefrontThemeFile");
}

/** Whether a request calls the server function exported as `name`. */
export function isServerFn(url: string, name: string) {
  const id = url.split("/_serverFn/")[1]?.split(/[/?]/)[0];
  if (!id) return false;
  try {
    const decoded = JSON.parse(
      Buffer.from(id.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
        "utf8",
      ),
    ) as { export?: string };
    return (decoded.export ?? "").startsWith(`${name}_`);
  } catch {
    return false;
  }
}

/**
 * The next answer to a save of `path` itself — not the preview's file sync,
 * which carries the same path. Resolves to whether it landed: a refused save
 * is answered with 200 too, and only the body tells them apart.
 */
export async function nextFileSave(page: Page, path: string) {
  const response = await page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      isFileSave(
        response.request().url(),
        response.request().postData() ?? "",
        path,
      ),
    { timeout: 30_000 },
  );
  expect(response.ok()).toBe(true);
  return (await response.text()).includes("Theme file saved");
}

/**
 * The next answer to a section content write: "saved", "conflict" (the
 * document moved), or "failed".
 */
export async function nextContentWrite(page: Page) {
  const response = await page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      isServerFn(response.request().url(), "updateStorefrontThemeSectionProps"),
    { timeout: 30_000 },
  );
  expect(response.ok()).toBe(true);
  const body = await response.text();
  if (body.includes("Theme section props updated")) return "saved" as const;
  if (body.includes("TEMPLATE_DRAFT_CONFLICT")) return "conflict" as const;
  return "failed" as const;
}

/** The next answer to a section rename: "saved", "conflict" or "failed". */
export async function nextRename(page: Page) {
  const response = await page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      isServerFn(response.request().url(), "renameStorefrontThemeSection"),
    { timeout: 30_000 },
  );
  expect(response.ok()).toBe(true);
  const body = await response.text();
  if (body.includes("Section renamed")) return "saved" as const;
  if (body.includes("TEMPLATE_DRAFT_CONFLICT")) return "conflict" as const;
  return "failed" as const;
}

/** Opens the rename dialog of a section from its row in the tree. */
export async function openRename(page: Page, section: string) {
  await page
    .getByRole("button", { name: section, exact: true })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename" }).click();
  const input = page.getByLabel("Section name");
  await expect(input).toBeVisible();
  return input;
}

/** Counts the calls of the section content write, from now on. */
export function countContentWrites(page: Page) {
  const counter = { sent: 0 };
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      isServerFn(request.url(), "updateStorefrontThemeSectionProps")
    ) {
      counter.sent += 1;
    }
  });
  return counter;
}

/** Counts the calls of the file save itself for `path`, from now on. */
export function countFileSaves(page: Page, path: string) {
  const counter = { sent: 0 };
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      isFileSave(request.url(), request.postData() ?? "", path)
    ) {
      counter.sent += 1;
    }
  });
  return counter;
}

/** Counts the saves of `path` this page sends to the server from now on. */
export function countSaves(page: Page, path: string) {
  const counter = { sent: 0 };
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().includes("/_serverFn/") &&
      (request.postData() ?? "").includes(path)
    ) {
      counter.sent += 1;
    }
  });
  return counter;
}

export const pausedNotice = (page: Page) =>
  page.locator("[data-editor-writes-paused]");

export const unconfirmedNotice = (page: Page) =>
  page.locator("[data-editor-unconfirmed-saves]");

/** One of the hero's content fields in Design, the first by default. */
export function heroContentField(page: Page, index = 0) {
  return sectionContentField(page, "hero", index);
}

/** One of a section's text content fields in Design. */
export async function sectionContentField(
  page: Page,
  section: string,
  index = 0,
) {
  await page.getByRole("button", { name: section, exact: true }).click();
  await settleSelection(page);
  await openContentTab(page);
  const field = page
    .locator('[data-slot="inspector-content-field"] input')
    .nth(index);
  await expect(field).toBeVisible({ timeout: 30_000 });
  return field;
}

/** Writes a hero content field and waits for the write to land. */
export function writeHeroField(page: Page, index: number, value: string) {
  return writeSectionField(page, "hero", index, value);
}

/** Writes a section's content field and waits for the write to land. */
export async function writeSectionField(
  page: Page,
  section: string,
  index: number,
  value: string,
) {
  const field = await sectionContentField(page, section, index);
  if ((await field.inputValue()) === value) return;
  const answer = nextContentWrite(page);
  await field.fill(value);
  await field.press("Tab");
  expect(await answer, `the write of ${value}`).toBe("saved");
}

export const withoutMarkers = (source: string) =>
  source
    .split("\n")
    .filter((line) => !line.includes(MARKER))
    .join("\n");

/** Puts the hero back as it was, from a session of its own. */
export async function restoreHero(browser: Browser, hero: string) {
  const { context, page } = await sharedEditor(browser);
  try {
    await openHeroInCode(page);
    const source = await readSource(page, hero);
    if (withoutMarkers(source) === source) return;
    const landed = nextFileSave(page, hero);
    await editAndSave(page, hero, withoutMarkers(source));
    expect(await landed, "the hero restored").toBe(true);
  } finally {
    await context.close();
  }
}

/** The run's own database, as `scripts/seed-e2e.mjs` reaches it. */
export function runSql(command: string) {
  const env =
    (process.env.MORPH_E2E_TRANSPORT ?? "local-sidecar") === "local-sidecar"
      ? ["--env", "local_preview_e2e"]
      : [];
  execFileSync(
    "npx",
    [
      "wrangler",
      "d1",
      "execute",
      "DATABASE",
      "--local",
      ...env,
      "--persist-to",
      process.env.MORPH_E2E_STATE_DIR!,
      "--command",
      command,
    ],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
}
