import { expect, test, type Browser, type Page } from "@playwright/test";
import { EDITOR_PATH, openEditor } from "./helpers";

import {
  restoreHero,
  writeSectionField,
  writeHeroField,
  sectionContentField,
  heroContentField,
  unconfirmedNotice,
  pausedNotice,
  countContentWrites,
  nextContentWrite,
  nextFileSave,
  isServerFn,
  editAndSave,
  readSource,
  openHeroInCode,
  sharedEditor,
  MARKER,
} from "./helpers/editor-writes-paused";

test.describe("unsaved work when the signed-in account changes", () => {
  test.skip(!EDITOR_PATH, "Set E2E_EDITOR_PATH to open the editor.");

  /**
   * A content write lands and its answer is cut off; meanwhile another tab
   * writes `theirs` into `other`. Checks what the author is left with: their
   * newest edit, the other tab's, and nothing dropped.
   */
  async function landedThenAnotherWriter(
    browser: Browser,
    other: { section: string; index: number },
  ) {
    const { context, page } = await sharedEditor(browser);
    let otherTab: Awaited<ReturnType<typeof sharedEditor>> | null = null;
    const originals = {
      mine: await (await heroContentField(page, 0)).inputValue(),
      theirs: await (
        await sectionContentField(page, other.section, other.index)
      ).inputValue(),
    };
    const stamp = Date.now();
    const value = (name: string) => `${MARKER} ${name} ${stamp}`;
    const writes = countContentWrites(page);
    try {
      // A write answered normally first, so this tab holds the document's
      // generation from its own writes.
      await writeHeroField(page, 0, value("first"));

      // The next write is made; its answer is cut off.
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
      const field = await heroContentField(page, 0);
      await field.fill(value("landed"));
      await field.press("Tab");
      await expect(unconfirmedNotice(page)).toBeVisible({ timeout: 15_000 });
      await page.unrouteAll({ behavior: "ignoreErrors" });
      const afterLanded = writes.sent;

      // Meanwhile another tab, opened on the document as it is now, writes.
      otherTab = await sharedEditor(browser);
      await writeSectionField(
        otherTab.page,
        other.section,
        other.index,
        value("theirs"),
      );

      const resend = nextContentWrite(page).catch(() => "none" as const);
      await unconfirmedNotice(page)
        .getByRole("button", { name: "Check and save" })
        .click();
      await expect(unconfirmedNotice(page)).toHaveCount(0, { timeout: 30_000 });
      await page.waitForTimeout(2_000);
      const afterCheck = writes.sent;
      const checkAnswer = afterCheck > afterLanded ? await resend : "none";

      return {
        page,
        value,
        resentByCheck: afterCheck - afterLanded,
        checkAnswer,
        finish: async () => {
          // Whatever the path, the author's newest edit and the other tab's
          // are both what the server holds, once each.
          const check = await sharedEditor(browser);
          try {
            await expect(await heroContentField(check.page, 0)).toHaveValue(
              value("next"),
            );
            await expect(
              await sectionContentField(check.page, other.section, other.index),
            ).toHaveValue(value("theirs"));
          } finally {
            await check.context.close();
          }
        },
        cleanup: async () => {
          await page.unrouteAll({ behavior: "ignoreErrors" });
          await otherTab?.context.close();
          await context.close();
          const restore = await sharedEditor(browser);
          try {
            await writeHeroField(restore.page, 0, originals.mine);
            await writeSectionField(
              restore.page,
              other.section,
              other.index,
              originals.theirs,
            );
          } finally {
            await restore.context.close();
          }
        },
      };
    } catch (error) {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await otherTab?.context.close();
      await context.close();
      throw error;
    }
  }

  /** Edits the hero again, expects the conflict, and loads the latest. */
  async function nextEditThroughConflict(page: Page, next: string) {
    const field = await heroContentField(page, 0);
    const refused = nextContentWrite(page);
    await field.fill(next);
    await field.press("Tab");
    expect(await refused, "the next edit, sent").toBe("conflict");
    await expect(page.locator("[data-editor-save-status]")).toHaveAttribute(
      "aria-label",
      "Out of date",
      { timeout: 30_000 },
    );
    // Refused, and kept: the newest edit is still here.
    await expect(await heroContentField(page, 0)).toHaveValue(next);
    await loadLatestKeepMine(page);
  }

  /** Presses Load latest, keep mine, and waits for the rebased write to land. */
  async function loadLatestKeepMine(page: Page) {
    const rebased = nextContentWrite(page);
    await page.getByRole("button", { name: "Load latest, keep mine" }).click();
    expect(await rebased, "the rebased write").toBe("saved");
    await expect(page.locator("[data-editor-save-status]")).toHaveAttribute(
      "aria-label",
      /^(Unpublished|Published)$/,
      { timeout: 30_000 },
    );
  }

  /** Edits the hero again; resolves a conflict if there is one. */
  async function nextEditThroughConflictOrSave(page: Page, next: string) {
    const field = await heroContentField(page, 0);
    const answer = nextContentWrite(page);
    await field.fill(next);
    await field.press("Tab");
    const first = await answer;
    expect(first, "the next edit, sent").not.toBe("failed");
    if (first === "conflict") await loadLatestKeepMine(page);
  }

  test("after a landed write is confirmed, the next edit meets the conflict and keeps both writers' changes", async ({
    browser,
  }) => {
    test.setTimeout(420_000);
    // The other tab writes another section: the hero write stays provable.
    const run = await landedThenAnotherWriter(browser, {
      section: "editorial-intro",
      index: 0,
    });
    try {
      // Confirmed by the check: nothing sent again.
      expect(run.resentByCheck).toBe(0);
      // This tab never took the document's generation from the check, and
      // the other tab moved it again: the next edit is refused, kept, and
      // rebased on a press.
      await nextEditThroughConflict(run.page, run.value("next"));
      await run.finish();
    } finally {
      await run.cleanup();
    }
  });

  test("a landed write that another writer changed around cannot be confirmed: sent once, refused, rebased without overwriting", async ({
    browser,
  }) => {
    test.setTimeout(420_000);
    // The other tab writes another field of the same section. A content
    // write carries the section's whole props, so the server no longer holds
    // every value this tab sent and the check cannot say it landed.
    const run = await landedThenAnotherWriter(browser, {
      section: "hero",
      index: 1,
    });
    try {
      // Sent once more, under the generation this tab holds: refused.
      expect(run.resentByCheck).toBe(1);
      expect(run.checkAnswer).toBe("conflict");
      await expect(
        run.page.locator("[data-editor-save-status]"),
      ).toHaveAttribute("aria-label", "Out of date", { timeout: 30_000 });
      await loadLatestKeepMine(run.page);
      await nextEditThroughConflictOrSave(run.page, run.value("next"));
      await run.finish();
    } finally {
      await run.cleanup();
    }
  });

  test("another tab saved the same file first: resuming does not overwrite it", async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const { context, page } = await sharedEditor(browser);
    const hero = await openHeroInCode(page);
    const original = await readSource(page, hero);
    const mine = `${original}\n/* ${MARKER} mine */`;
    const theirs = `${original}\n/* ${MARKER} theirs */`;
    const other = await sharedEditor(browser);
    const session = await context.cookies();
    try {
      await context.clearCookies();
      await editAndSave(page, hero, mine);
      await expect(pausedNotice(page)).toContainText(
        "Your sign-in has expired",
      );

      // Meanwhile the file is saved from elsewhere.
      await openHeroInCode(other.page);
      const landed = nextFileSave(other.page, hero);
      await editAndSave(other.page, hero, theirs);
      expect(await landed, "the other tab's save").toBe(true);

      // Signed in again: the browser has its session back.
      await context.addCookies(session);
      await pausedNotice(page)
        .getByRole("button", { name: "Check again" })
        .click();
      await expect(pausedNotice(page)).toContainText("Signed in again");
      await pausedNotice(page)
        .getByRole("button", { name: "Save my changes" })
        .click();

      // The other save moved the file on, so this tab's edit is not written
      // over it: it comes back under one of the existing conflict notices —
      // the file's own, when the file list refreshed after checking found the
      // newer version first, or the Theme's, when the save itself was refused
      // first — still here, unsaved, for the author to decide on.
      //
      // The file's notice is two spans, "Conflict:" and "Server conflict
      // (vN)…", with no space between them in the document, so it is matched
      // by the second span alone.
      await expect(
        page
          .getByText("Remote source changes detected in this theme")
          .or(page.getByText(/^Server conflict \(v\d+\)/)),
      ).toBeVisible({ timeout: 30_000 });
      const kept = await readSource(page, hero);
      expect(kept).toContain(`${MARKER} mine`);
      expect(kept).not.toContain(`${MARKER} theirs`);
      await openEditor(other.page);
      await openHeroInCode(other.page);
      await expect
        .poll(() => readSource(other.page, hero))
        .toContain(`${MARKER} theirs`);
      expect(await readSource(other.page, hero)).not.toContain(
        `${MARKER} mine`,
      );
    } finally {
      await other.context.close();
      await context.close();
      await restoreHero(browser, hero);
    }
  });
});
