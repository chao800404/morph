import { expect, test as setup, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const STORAGE_STATE = "e2e/.auth/user.json";

/**
 * Signs in once and saves the session for every other test.
 *
 * The credentials come from the environment, never from this repository: a
 * password committed to a project is a password leaked, and the local database
 * belongs to whoever is running the tests.
 */
/**
 * Opens a page that makes the store exist, and says whether it got there.
 *
 * The editor does not create a storefront or a theme. It fills a workspace and
 * a home document for one that is already there, while the rows themselves are
 * written by `ensureDefault`, which only the currency and sales-channel paths
 * reach. On a developer's machine that ran long ago and is invisible; on the
 * empty database an end-to-end run starts from, going straight to the editor
 * finds nothing to edit.
 *
 * So the run arrives the way a person does, through a page that asks for the
 * store. Doing it here rather than in a seed keeps provisioning in one place:
 * if what triggers it ever moves, this follows the application instead of
 * drifting from it.
 *
 * It waits for the settings URL rather than for the absence of `/sign-in`.
 * A negative assertion is satisfied the instant the navigation commits, which
 * is before the client decides there is no session and redirects — so an
 * unauthenticated run passed this check, saved a storage state that had never
 * worked, and handed the suite a browser sitting on the sign-in page. The
 * first two accessibility specs then passed against that page, because
 * scanning it for violations and for unnamed controls is something a sign-in
 * form does well, and the failure only surfaced on the third spec as a missing
 * Publish button. `/dashboard/settings` redirects to `/dashboard/settings/store`,
 * which no unauthenticated visit reaches.
 */
const STORE_SETTINGS_URL = /\/dashboard\/settings\//;

async function reachedStoreSettings(page: Page): Promise<boolean> {
  await page
    .goto("/dashboard/settings", { waitUntil: "domcontentloaded" })
    .catch(() => undefined);
  return page
    .waitForURL(STORE_SETTINGS_URL, { timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
}

setup("authenticate", async ({ page, browser, baseURL }) => {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  setup.skip(
    !email || !password,
    "Set E2E_EMAIL and E2E_PASSWORD to run browser tests.",
  );

  // Reuse a session that still works. Logging in on every run is slower and,
  // because the app rate-limits sign-in attempts, eventually gets refused —
  // which shows up as a whole suite failing for a reason unrelated to it.
  if (fs.existsSync(STORAGE_STATE)) {
    const context = await browser.newContext({
      storageState: STORAGE_STATE,
      baseURL,
    });
    const probe = await context.newPage();
    // Verified, not assumed: a stored session belongs to whichever database
    // was standing when it was written, and an end-to-end run lays out a new
    // one every time. A cookie from the previous run's database is a file of
    // the right shape and no use at all.
    const reusable = await reachedStoreSettings(probe);
    await context.close();
    if (reusable) return;
  }

  await page.goto("/sign-in");

  // Submitting before React has hydrated triggers a native form submit, which
  // is a different code path from the one under test — and until the forms
  // were given `method="post"` it also put the password in the URL. Waiting
  // for React to claim the input is the deterministic signal; a fixed delay
  // would only make the race rarer.
  await page.waitForFunction(() => {
    const input = document.querySelector('input[name="email"]');
    return (
      !!input &&
      Object.keys(input).some(
        (key) => key.startsWith("__reactFiber$") || key.startsWith("__reactProps$"),
      )
    );
  }, undefined, { timeout: 30_000 });

  await page.getByPlaceholder("Email").fill(email!);
  await page.getByPlaceholder("Password").fill(password!);
  await page.getByRole("button", { name: /sign in/i }).click();

  // Landing anywhere other than the sign-in page is what proves the session
  // exists; the destination differs by role and by what was requested.
  await expect(page).not.toHaveURL(/sign-in/, { timeout: 30_000 });

  expect(
    await reachedStoreSettings(page),
    "signed in, but never reached the store settings page, so the store was not provisioned",
  ).toBe(true);

  fs.mkdirSync(path.dirname(STORAGE_STATE), { recursive: true });
  await page.context().storageState({ path: STORAGE_STATE });
});
