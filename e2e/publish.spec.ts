import { expect, test } from "@playwright/test";

/**
 * The publish loop, off by default.
 *
 * Publishing is not a read: it creates a release, moves the storefront's
 * production pointer to it, and — in any environment that has Cloudflare
 * credentials — uploads and deploys the build. That is not something a test
 * run should do because someone typed `pnpm test:e2e`, so it takes an explicit
 * opt-in from whoever knows what their environment is wired to.
 */
const EDITOR_PATH = process.env.E2E_EDITOR_PATH;
const ALLOWED = process.env.E2E_ALLOW_PUBLISH === "1";

test.skip(
  !EDITOR_PATH || !ALLOWED,
  "Set E2E_ALLOW_PUBLISH=1 to run the publish loop. It creates a release and moves production to it.",
);

test.describe("publish loop", () => {
  // A theme build compiles the whole workspace in a container; minutes, not
  // seconds, and nothing is gained by cutting it short.
  test.setTimeout(10 * 60_000);

  test("builds the theme and publishes it as a new release", async ({
    page,
  }) => {
    await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: /^Publish$/ })).toBeVisible({
      timeout: 45_000,
    });
    // The toolbar renders before the page finishes hydrating, and a click in
    // that window is received by nothing at all.
    await page.waitForTimeout(4_000);

    const releasesBefore = await listReleaseLabels(page);

    // Publish is refused when nothing is unpublished, which is correct and
    // means the loop needs a real change to carry. Hiding a section and showing
    // it again is the smallest one available: the document ends up exactly as
    // it started, but the draft revision has moved past the published one — so
    // this publishes the site as it already looks.
    const hide = page.getByRole("button", { name: /^Hide section / }).first();
    await hide.click();
    const show = page.getByRole("button", { name: /^Show section / }).first();
    await expect(show).toBeVisible({ timeout: 30_000 });
    await show.click();
    await expect(
      page.getByRole("button", { name: /^Hide section / }).first(),
    ).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(3_000);

    // Publish refuses without a succeeded build bound to the current source
    // revision, so the build is part of the loop rather than a precondition
    // someone is expected to have arranged.
    // Addressed by its title: a successful build switches the canvas to the
    // immutable preview, which adds a mode toggle with the same visible label.
    const build = page.locator(
      'button[title="Compile and bundle theme into immutable R2 preview build"]',
    );
    await build.click();
    await expect(build).toHaveText(/Building/, { timeout: 30_000 });
    await expect(build).toHaveText(/Build Preview/, { timeout: 9 * 60_000 });

    const publish = page.getByRole("button", { name: /^Publish$/ });
    await expect(publish).toBeEnabled({ timeout: 30_000 });
    await publish.click();

    // The status line is the editor's own answer to "is anything unpublished",
    // which is what a person reads before walking away from the screen.
    await expect(page.getByText("All changes saved")).toBeVisible({
      timeout: 3 * 60_000,
    });

    // Read from a fresh page: the panel keeps what it fetched last time it was
    // opened, and a release created seconds ago can be missing from a list that
    // is still catching up. Reloading asks the server rather than the cache.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: /^Publish$/ })).toBeVisible({
      timeout: 45_000,
    });
    await page.waitForTimeout(4_000);

    const releasesAfter = await listReleaseLabels(page);
    expect(
      releasesAfter.length,
      "publishing did not add a release",
    ).toBeGreaterThan(releasesBefore.length);
    expect(
      releasesAfter[0],
      "the newest release is not at the top of the list",
    ).not.toBe(releasesBefore[0]);
    // The pointer moved with it: the release just created is the live one.
    await page.getByRole("button", { name: /History/ }).click();
    await expect(
      page.getByRole("dialog").first().locator("li").first(),
    ).toContainText("Live");
    await expect(
      page.getByRole("dialog").first().locator("li").first(),
    ).toContainText(releasesAfter[0]);
  });
});

/** Release ids as the history panel lists them, newest first. */
async function listReleaseLabels(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: /History/ }).click();
  const dialog = page.getByRole("dialog").first();
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText(/No releases yet|[0-9a-f]{8}/).first(),
  ).toBeVisible({ timeout: 30_000 });

  const labels = await dialog.locator("code").allInnerTexts();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  return labels.map((label) => label.trim());
}
