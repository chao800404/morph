import { expect, test } from "@playwright/test";
import { EDITOR_PATH } from "./helpers";
import {
  restoreHero,
  restoreHeroAfterFailure,
  pausedNotice,
  countSaves,
  editAndSave,
  readSource,
  openHeroInCode,
  sharedEditor,
  signedInEditor,
  signOut,
  signIn,
  MARKER,
  SECOND_EMAIL,
} from "./helpers/editor-writes-paused";
import { expectClosedToAnotherAccount } from "./helpers/editor-writes-account-change";

// Part of the former editor-writes-auth.spec.ts, split for CI shard balance.

test.describe("unsaved work when the signed-in account changes", () => {
  test.skip(!EDITOR_PATH, "Set E2E_EDITOR_PATH to open the editor.");
  restoreHeroAfterFailure();

  test("another account signed in here: the draft is never saved as that account", async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const { context, page } = await signedInEditor(browser);
    const hero = await openHeroInCode(page);
    const original = await readSource(page, hero);
    try {
      // Another tab of the same browser signs out and in as someone else.
      await signOut(context);
      await signIn(context, SECOND_EMAIL);
      // Coming back to the editor is when it looks.
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(pausedNotice(page)).toContainText(
        "A different account is signed in",
      );
      await expectClosedToAnotherAccount(page);

      const saves = countSaves(page, hero);
      await editAndSave(page, hero, `${original}\n/* ${MARKER} other */`);
      await page.waitForTimeout(2_000);
      expect(saves.sent).toBe(0);

      // Checking again as the other account changes nothing.
      await pausedNotice(page)
        .getByRole("button", { name: "Check again" })
        .click();
      await expect(pausedNotice(page)).toContainText(
        "A different account is signed in",
      );
      await expectClosedToAnotherAccount(page);
      expect(saves.sent).toBe(0);
    } finally {
      await context.close();
      await restoreHero(browser);
    }
  });

  test("another account signed in, editor never looked: the server refuses the save", async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const { context, page } = await sharedEditor(browser);
    const hero = await openHeroInCode(page);
    const original = await readSource(page, hero);
    try {
      // Another tab signs this browser in as someone else.
      await signIn(context, SECOND_EMAIL);
      // No focus, no visibility change: the editor has had no reason to
      // ask who is signed in. The save itself says whose it is.
      await editAndSave(page, hero, `${original}\n/* ${MARKER} unasked */`);
      await expect(pausedNotice(page)).toContainText(
        "A different account is signed in",
      );
      // Found by the refused save, it closes the editor all the same, and
      // the draft is still held in it.
      await expectClosedToAnotherAccount(page);
      expect(await readSource(page, hero)).toContain(`${MARKER} unasked`);
    } finally {
      await context.close();
    }
    // Nothing was written as the other account.
    const check = await sharedEditor(browser);
    try {
      await openHeroInCode(check.page);
      expect(await readSource(check.page, hero)).not.toContain(MARKER);
    } finally {
      await check.context.close();
      await restoreHero(browser);
    }
  });

  test("verified, then another account signs in before saving: the save is refused", async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const { context, page } = await sharedEditor(browser);
    const hero = await openHeroInCode(page);
    const original = await readSource(page, hero);
    const session = await context.cookies();
    try {
      await context.clearCookies();
      await editAndSave(page, hero, `${original}\n/* ${MARKER} late */`);
      await expect(pausedNotice(page)).toContainText(
        "Your sign-in has expired",
      );
      await context.addCookies(session);
      // Verified reads everything again (`invalidateQueries`); the preview
      // server's refetch remounts the frame, and the new frame's ready reads
      // the Theme for its content replay. That read must be answered before
      // the other account signs in: sent after it, it is refused as
      // ACCOUNT_CHANGED and closes the editor before Save is pressed, which
      // is a different case (run 44724395884). Waited for, not slept on.
      const replayed = page.waitForEvent("console", {
        predicate: (message) =>
          message.text().startsWith("[preview-instance] content replayed"),
        timeout: 60_000,
      });
      // The same holds for the preview stale probe (`probeThemePreviewAddress`),
      // which runs while the remounted frame is loading-frame/syncing-source:
      // the frame's 404 load-summary brings it forward, and sent after the
      // sign-in it too is refused as ACCOUNT_CHANGED (run 44883777187). So
      // after the replay, wait until either the lifecycle is ready (the probe
      // stops) or a probe has answered "serving" for this account; the next
      // one is then at least the 2 s hint gap / 4 s interval away.
      const probeSettled = new Promise<void>((resolve, reject) => {
        let sawReplay = false;
        let phase: string | null = null;
        const timer = setTimeout(() => {
          page.off("console", onConsole);
          reject(
            new Error(
              `preview probe did not settle after the replay (phase=${phase})`,
            ),
          );
        }, 60_000);
        const done = () => {
          clearTimeout(timer);
          page.off("console", onConsole);
          resolve();
        };
        const onConsole = (message: { text(): string }) => {
          const text = message.text();
          const lifecycle = /^\[preview-lifecycle\] (\S+)/.exec(text);
          if (lifecycle) phase = lifecycle[1] ?? null;
          if (text.startsWith("[preview-instance] content replayed")) {
            sawReplay = true;
          }
          if (!sawReplay) return;
          if (phase === "ready" || text === "[preview-probe] serving") done();
        };
        page.on("console", onConsole);
      });
      // Awaited below; this only keeps an early failure from also reporting
      // an unhandled rejection.
      probeSettled.catch(() => undefined);
      await pausedNotice(page)
        .getByRole("button", { name: "Check again" })
        .click();
      await expect(pausedNotice(page)).toContainText("Signed in again");
      await replayed;
      await probeSettled;
      // Still verified once the frame settled: the Save below is the first
      // thing to meet the account change.
      await expect(
        pausedNotice(page).getByRole("button", { name: "Save my changes" }),
      ).toBeVisible();

      // Between checking and saving, another tab signs in as someone else.
      await signIn(context, SECOND_EMAIL);
      await pausedNotice(page)
        .getByRole("button", { name: "Save my changes" })
        .click();
      await expect(pausedNotice(page)).toContainText(
        "A different account is signed in",
      );
      await expectClosedToAnotherAccount(page);
      expect(await readSource(page, hero)).toContain(`${MARKER} late`);
    } finally {
      await context.close();
    }
    const check = await sharedEditor(browser);
    try {
      await openHeroInCode(check.page);
      expect(await readSource(check.page, hero)).not.toContain(MARKER);
    } finally {
      await check.context.close();
      await restoreHero(browser);
    }
  });
});
