import { expect, test, type Browser, type Page } from "@playwright/test";
import { EDITOR_PATH } from "./helpers";

import {
  restoreHero,
  pausedNotice,
  countFileSaves,
  nextFileSave,
  isFileSave,
  editAndSave,
  readSource,
  openHeroInCode,
  sharedEditor,
  MARKER,
} from "./helpers/editor-writes-paused";

test.describe("a refusal that arrives after the sign-in was verified", () => {
  test.skip(!EDITOR_PATH, "Set E2E_EDITOR_PATH to open the editor.");

  /**
   * Holds the next save of `path`. `sendSignedOut` sends it to the server
   * while the browser holds no session, so the server really refuses it and
   * writes nothing; `release` delivers that answer to the page, late.
   */
  async function holdNextSave(page: Page, path: string) {
    let intercepted!: () => void;
    let send!: () => void;
    let sent!: (body: string) => void;
    let release!: () => void;
    const held = new Promise<void>((resolve) => (intercepted = resolve));
    const sendNow = new Promise<void>((resolve) => (send = resolve));
    const answer = new Promise<string>((resolve) => (sent = resolve));
    const released = new Promise<void>((resolve) => (release = resolve));
    let taken = false;
    await page.route("**/_serverFn/**", async (route) => {
      const request = route.request();
      if (taken || !isFileSave(request.url(), request.postData() ?? "", path)) {
        return route.fallback();
      }
      taken = true;
      intercepted();
      await sendNow;
      // The cookies the request was made with are left out, and the browser
      // has none now: the server answers as it would a signed-out request.
      const headers = { ...(await request.allHeaders()) };
      delete headers.cookie;
      const response = await route.fetch({ headers });
      sent(await response.text());
      await released;
      await route.fulfill({ response });
    });
    return {
      held,
      release,
      /** Sends the held save now; resolves to the server's answer. */
      sendSignedOut: () => {
        send();
        return answer;
      },
    };
  }

  /**
   * A save in flight, then signed out, writes paused, signed in again and
   * verified — with the save's answer still not delivered.
   *
   * The save is made before the cookies go: made after, the preview's own
   * sync is refused first and pauses writes before the save is sent at all.
   * It goes to the server while signed out, as a save made then would.
   */
  async function heldThroughVerification(browser: Browser) {
    const { context, page } = await sharedEditor(browser);
    const hero = await openHeroInCode(page);
    const original = await readSource(page, hero);
    const session = await context.cookies();
    const save = await holdNextSave(page, hero);

    await editAndSave(page, hero, `${original}\n/* ${MARKER} earlier */`);
    await save.held;
    await context.clearCookies();
    expect(await save.sendSignedOut(), "the server's own answer").toContain(
      "AUTH_REQUIRED",
    );
    // The editor asks who is signed in when it comes back into view.
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(pausedNotice(page)).toContainText("Your sign-in has expired");

    await context.addCookies(session);
    await pausedNotice(page)
      .getByRole("button", { name: "Check again" })
      .click();
    await expect(pausedNotice(page)).toContainText("Signed in again");
    return { context, page, hero, original, session, save };
  }

  /** Delivers the held save's answer and waits for the page to get it. */
  async function releaseRefused(
    page: Page,
    hero: string,
    save: { release: () => void },
  ) {
    const answer = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        isFileSave(
          response.request().url(),
          response.request().postData() ?? "",
          hero,
        ),
      { timeout: 30_000 },
    );
    save.release();
    expect(await (await answer).text()).toContain("AUTH_REQUIRED");
  }

  test("arriving after Check again, it leaves the verification standing and the draft unsaved", async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const run = await heldThroughVerification(browser);
    try {
      await releaseRefused(run.page, run.hero, run.save);
      await run.page.waitForTimeout(1_500);
      // Still verified: the old refusal did not undo it.
      await expect(pausedNotice(run.page)).toHaveAttribute(
        "data-editor-writes-paused",
        "verified",
      );
      expect(await readSource(run.page, run.hero)).toContain(
        `${MARKER} earlier`,
      );

      await pausedNotice(run.page)
        .getByRole("button", { name: "Save my changes" })
        .click();
      await expect(pausedNotice(run.page)).toHaveCount(0, {
        timeout: 30_000,
      });
      const check = await sharedEditor(browser);
      try {
        await openHeroInCode(check.page);
        expect(await readSource(check.page, run.hero)).toContain(
          `${MARKER} earlier`,
        );
      } finally {
        await check.context.close();
      }
    } finally {
      await run.page.unrouteAll({ behavior: "ignoreErrors" });
      await run.context.close();
      await restoreHero(browser, run.hero);
    }
  });

  test("arriving once writes are open again, it is reported as failed, kept, not resent, and saved on the author's next save", async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const run = await heldThroughVerification(browser);
    try {
      const saves = countFileSaves(run.page, run.hero);
      // Writes open again before the old answer arrives.
      await pausedNotice(run.page)
        .getByRole("button", { name: "Save my changes" })
        .click();
      await expect(pausedNotice(run.page)).toHaveCount(0, { timeout: 30_000 });
      await releaseRefused(run.page, run.hero, run.save);

      // Said as that save's failure; writes stay open; the draft is kept and
      // nothing sends it again on its own.
      await expect(
        run.page.getByText("An earlier save was refused").first(),
      ).toBeVisible({ timeout: 15_000 });
      await run.page.waitForTimeout(3_000);
      await expect(pausedNotice(run.page)).toHaveCount(0);
      expect(saves.sent, "no save sent again on its own").toBe(0);
      expect(await readSource(run.page, run.hero)).toContain(
        `${MARKER} earlier`,
      );
      const before = await sharedEditor(browser);
      try {
        await openHeroInCode(before.page);
        expect(await readSource(before.page, run.hero)).not.toContain(
          `${MARKER} earlier`,
        );
      } finally {
        await before.context.close();
      }

      // The author saves again: that one lands.
      const landed = nextFileSave(run.page, run.hero);
      await run.page.keyboard.press("Control+s");
      expect(await landed, "the author's next save").toBe(true);
      const check = await sharedEditor(browser);
      try {
        await openHeroInCode(check.page);
        expect(await readSource(check.page, run.hero)).toContain(
          `${MARKER} earlier`,
        );
      } finally {
        await check.context.close();
      }
    } finally {
      await run.page.unrouteAll({ behavior: "ignoreErrors" });
      await run.context.close();
      await restoreHero(browser, run.hero);
    }
  });

  test("a sign-in check sent after the verification still stops resuming", async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const run = await heldThroughVerification(browser);
    try {
      // Signed out again, and asked after the verification began.
      await run.context.clearCookies();
      await run.page.waitForTimeout(2_100);
      await run.page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(pausedNotice(run.page)).not.toHaveAttribute(
        "data-editor-writes-paused",
        "verified",
        { timeout: 15_000 },
      );
      await expect(
        pausedNotice(run.page).getByRole("button", {
          name: "Save my changes",
        }),
      ).toHaveCount(0);
    } finally {
      run.save.release();
      await run.page.unrouteAll({ behavior: "ignoreErrors" });
      await run.context.addCookies(run.session);
      await run.context.close();
      await restoreHero(browser, run.hero);
    }
  });
});
