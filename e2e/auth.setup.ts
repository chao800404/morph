import { expect, test as setup } from "@playwright/test";
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
    await probe
      .goto("/dashboard", { waitUntil: "domcontentloaded", timeout: 30_000 })
      .catch(() => undefined);
    const stillSignedIn = !probe.url().includes("sign-in");
    await context.close();
    if (stillSignedIn) return;
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

  fs.mkdirSync(path.dirname(STORAGE_STATE), { recursive: true });
  await page.context().storageState({ path: STORAGE_STATE });
});
