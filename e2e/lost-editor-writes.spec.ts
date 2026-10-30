// Kept away from the auth spec in file order so whole-file sharding can spread
// the long write-recovery scenarios without parallel workers in one database.
import { expect, test } from "@playwright/test";
import { EDITOR_PATH, decodeServerFnResult, openEditor } from "./helpers";

import {
  restoreHero,
  restoreHeroAfterFailure,
  heroContentField,
  unconfirmedNotice,
  pausedNotice,
  countFileSaves,
  countContentWrites,
  nextContentWrite,
  isServerFn,
  isFileSave,
  editAndSave,
  readSource,
  openHeroInCode,
  sharedEditor,
  MARKER,
} from "./helpers/editor-writes-paused";

test.describe("unsaved work when the signed-in account changes", () => {
  test.skip(!EDITOR_PATH, "Set E2E_EDITOR_PATH to open the editor.");
  restoreHeroAfterFailure();

  test("connection lost before the save arrived: not resent on its own, checked, then sent once", async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const { context, page } = await sharedEditor(browser);
    const hero = await openHeroInCode(page);
    const original = await readSource(page, hero);
    try {
      const saves = countFileSaves(page, hero);
      // The save's request fails in the network, with no answer at all.
      // Only the save: the preview's own sync is left alone.
      await page.route("**/_serverFn/**", (route) =>
        isFileSave(
          route.request().url(),
          route.request().postData() ?? "",
          hero,
        )
          ? route.abort("internetdisconnected")
          : route.fallback(),
      );
      await editAndSave(page, hero, `${original}\n/* ${MARKER} offline */`);
      await expect.poll(() => saves.sent, { timeout: 15_000 }).toBe(1);
      // Long enough for autosave (700 ms, 250 ms behind a save in flight) to
      // have gone several times over, had it been allowed to.
      await page.waitForTimeout(5_000);

      // Not a sign-in problem, the draft is still here, and nothing went
      // again on its own.
      await expect(pausedNotice(page)).toHaveCount(0);
      await expect(unconfirmedNotice(page)).toBeVisible();
      expect(saves.sent).toBe(1);
      expect(await readSource(page, hero)).toContain(`${MARKER} offline`);

      // Back online. Switching to Design is not asking to save: it stops
      // and says why, sends nothing, and leaves the author in Code.
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await page.getByRole("button", { name: "Design", exact: true }).click();
      await expect(
        page.getByText("It could not be confirmed whether an earlier save"),
      ).toBeVisible();
      await page.waitForTimeout(2_000);
      expect(saves.sent).toBe(1);
      expect(await readSource(page, hero)).toContain(`${MARKER} offline`);

      // The author checks: the server does not hold it, so it is sent — once.
      await unconfirmedNotice(page)
        .getByRole("button", { name: "Check and save" })
        .click();
      await expect(unconfirmedNotice(page)).toHaveCount(0, { timeout: 30_000 });
      expect(saves.sent).toBe(2);

      const check = await sharedEditor(browser);
      try {
        await openHeroInCode(check.page);
        expect(await readSource(check.page, hero)).toContain(
          `${MARKER} offline`,
        );
      } finally {
        await check.context.close();
      }
    } finally {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await context.close();
      await restoreHero(browser);
    }
  });

  test("the save landed and only its answer was lost: checked, not sent again", async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const { context, page } = await sharedEditor(browser);
    const hero = await openHeroInCode(page);
    const original = await readSource(page, hero);
    try {
      const saves = countFileSaves(page, hero);
      // The save reaches the server and is made; the answer is cut off on
      // its way back. Only the first one: anything after it would pass.
      let cut = false;
      await page.route("**/_serverFn/**", async (route) => {
        const request = route.request();
        if (cut || !isFileSave(request.url(), request.postData() ?? "", hero)) {
          return route.fallback();
        }
        cut = true;
        const response = await route.fetch();
        expect(response.ok(), "the save itself was made").toBe(true);
        await route.abort("connectionreset");
      });
      await editAndSave(page, hero, `${original}\n/* ${MARKER} landed */`);
      await expect.poll(() => saves.sent, { timeout: 15_000 }).toBe(1);
      await page.waitForTimeout(5_000);

      await expect(pausedNotice(page)).toHaveCount(0);
      await expect(unconfirmedNotice(page)).toBeVisible();
      expect(saves.sent).toBe(1);

      // Checking finds the save on the server: recorded as saved, and not
      // sent again — no second write, and no conflict with itself.
      await unconfirmedNotice(page)
        .getByRole("button", { name: "Check and save" })
        .click();
      await expect(unconfirmedNotice(page)).toHaveCount(0, { timeout: 30_000 });
      await page.waitForTimeout(2_000);
      expect(saves.sent).toBe(1);
      await expect(
        page.getByText("Remote source changes detected in this theme"),
      ).toHaveCount(0);
      expect(await readSource(page, hero)).toContain(`${MARKER} landed`);

      const check = await sharedEditor(browser);
      try {
        await openHeroInCode(check.page);
        const held = await readSource(check.page, hero);
        // Applied once: the marker is there, and only once.
        expect(held.split(`${MARKER} landed`).length - 1).toBe(1);
      } finally {
        await check.context.close();
      }

      // The next save. This tab did not take the Theme's source generation
      // from the check, so it may meet the source-conflict notice once; it
      // must go through on that press and overwrite nothing. Which of the
      // two happened is the save's own answer, not what the page shows a
      // fixed time later: a conflict answered after that time (3.3 s in CI
      // run 41023540723) was read as saved directly. The answer is held
      // back 4 s here, past where that wait ended, so a late answer is what
      // every run decides on.
      const before = saves.sent;
      const nextMarker = `${MARKER} next`;
      const isNextSave = (url: string, body: string) =>
        isFileSave(url, body, hero) && body.includes(nextMarker);
      let held = false;
      await page.route("**/_serverFn/**", async (route) => {
        const request = route.request();
        if (held || !isNextSave(request.url(), request.postData() ?? "")) {
          return route.fallback();
        }
        held = true;
        const response = await route.fetch();
        await new Promise((resolve) => setTimeout(resolve, 4_000));
        await route.fulfill({ response });
      });
      const answered = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          isNextSave(
            response.request().url(),
            response.request().postData() ?? "",
          ),
        { timeout: 30_000 },
      );
      await editAndSave(
        page,
        hero,
        `${await readSource(page, hero)}\n/* ${nextMarker} */`,
      );
      await expect.poll(() => saves.sent, { timeout: 15_000 }).toBe(before + 1);
      const answer = await answered;
      expect(answer.ok()).toBe(true);
      const decoded = decodeServerFnResult(await answer.text());
      expect(
        typeof decoded === "object" &&
          decoded !== null &&
          !Array.isArray(decoded),
        `the next save's answer is an object (got ${decoded === null ? "null" : typeof decoded})`,
      ).toBe(true);
      const result = decoded as { success?: unknown; error?: unknown };
      const sourceConflict = page.getByText(
        "Remote source changes detected in this theme",
      );
      if (result.success === true) {
        test.info().annotations.push({
          type: "next-save",
          description: "saved-directly",
        });
        await expect(sourceConflict).toHaveCount(0);
      } else {
        const code =
          typeof result.error === "string" &&
          /^[A-Z][A-Z0-9_]{0,63}$/.test(result.error)
            ? result.error
            : `(${typeof result.error})`;
        // The one refusal this step allows; anything else fails here.
        expect(code, "the next save was refused for another reason").toBe(
          "SOURCE_GENERATION_CONFLICT",
        );
        test.info().annotations.push({
          type: "next-save",
          description: "source-conflict-once",
        });
        await expect(sourceConflict).toBeVisible({ timeout: 30_000 });
        // Nothing goes again until the author says so.
        expect(saves.sent).toBe(before + 1);
        await page
          .getByRole("status")
          .filter({ hasText: "Remote source changes detected" })
          .getByRole("button", { name: "Save my changes" })
          .click();
        await expect(sourceConflict).toHaveCount(0, { timeout: 30_000 });
        // Sent once more, on that press, and only once.
        await expect
          .poll(() => saves.sent, { timeout: 15_000 })
          .toBe(before + 2);
        await page.waitForTimeout(2_000);
        expect(saves.sent).toBe(before + 2);
      }
      const after = await sharedEditor(browser);
      try {
        await openHeroInCode(after.page);
        const held = await readSource(after.page, hero);
        expect(held.split(`${MARKER} landed`).length - 1).toBe(1);
        expect(held.split(`${MARKER} next`).length - 1).toBe(1);
      } finally {
        await after.context.close();
      }
    } finally {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await context.close();
      await restoreHero(browser);
    }
  });

  test("a content write that landed with its answer lost is not sent again", async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const { context, page } = await sharedEditor(browser);
    const field = await heroContentField(page);
    const original = await field.inputValue();
    const marker = `${MARKER} content ${Date.now()}`;
    try {
      const writes = countContentWrites(page);
      let cut = false;
      await page.route("**/_serverFn/**", async (route) => {
        if (
          cut ||
          !isServerFn(
            route.request().url(),
            "updateStorefrontThemeSectionProps",
          )
        ) {
          return route.fallback();
        }
        cut = true;
        const response = await route.fetch();
        expect(response.ok(), "the write itself was made").toBe(true);
        await route.abort("connectionreset");
      });
      await field.fill(marker);
      await field.press("Tab");
      await expect.poll(() => writes.sent, { timeout: 15_000 }).toBe(1);
      await page.waitForTimeout(5_000);

      // Not retried on its own, and the edit is kept.
      expect(writes.sent).toBe(1);
      await expect(unconfirmedNotice(page)).toBeVisible();
      await expect(pausedNotice(page)).toHaveCount(0);

      // Publishing is not asking to save: it cannot be started until the
      // unanswered write is checked.
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await expect(
        page.getByRole("button", { name: /^Publish$/ }),
      ).toBeDisabled();
      expect(writes.sent).toBe(1);

      await unconfirmedNotice(page)
        .getByRole("button", { name: "Check and save" })
        .click();
      await expect(unconfirmedNotice(page)).toHaveCount(0, { timeout: 30_000 });
      await expect(page.locator("[data-editor-save-status]")).toHaveAttribute(
        "aria-label",
        /^(Unpublished|Published)$/,
        { timeout: 30_000 },
      );
      await page.waitForTimeout(2_000);
      // Found on the server, so nothing was sent again, and the author is
      // not asked to resolve a conflict with their own write.
      expect(writes.sent).toBe(1);
      await expect(
        page.getByRole("button", { name: "Load latest, keep mine" }),
      ).toHaveCount(0);

      // And it is what the server holds.
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await openEditor(page);
      await expect(await heroContentField(page)).toHaveValue(marker);
    } finally {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      const restore = await heroContentField(page).catch(() => null);
      if (restore && (await restore.inputValue()) !== original) {
        const answer = nextContentWrite(page);
        await restore.fill(original);
        await restore.press("Tab");
        expect(await answer, "the field restored").toBe("saved");
      }
      await context.close();
    }
  });
});
