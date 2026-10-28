import { expect, test, type Browser, type Page } from "@playwright/test";
import { EDITOR_PATH, openEditor } from "./helpers";

import {
  restoreHero,
  restoreHeroAfterFailure,
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

async function expectConflictNotice(page: Page, timeout = 30_000) {
  const theme = page.getByText("Remote source changes detected in this theme");
  const file = page.getByText(/^Server conflict \(v\d+\)/);
  const message =
    "Expected Remote source changes detected in this theme or Server conflict (vN)";

  // The notices can appear together: a union locator would fail strict mode.
  await expect
    .poll(async () => (await theme.isVisible()) || (await file.isVisible()), {
      timeout,
      message,
    })
    .toBe(true);
  const themeVisible = await theme.isVisible();
  const fileVisible = await file.isVisible();
  const visibleNotices = [
    {
      locator: theme,
      visible: themeVisible,
      text: "Remote source changes detected in this theme",
    },
    { locator: file, visible: fileVisible, text: /^Server conflict \(v\d+\)/ },
  ].filter((notice) => notice.visible);
  expect(visibleNotices.length, message).toBeGreaterThan(0);
  for (const notice of visibleNotices) {
    await expect(notice.locator).toHaveText(notice.text);
  }
}

test.describe("conflict notice assertion", () => {
  for (const [name, theme, file] of [
    ["theme only", true, false],
    ["file only", false, true],
    ["both", true, true],
    ["neither", false, false],
  ] as const) {
    test(name, async ({ page }) => {
      await page.setContent(`
        ${theme ? '<div role="status"><p class="font-medium text-foreground">Remote source changes detected in this theme</p></div>' : ""}
        ${file ? '<div><span class="font-semibold">Conflict:</span><span>Server conflict (v4). Reload remote or explicitly overwrite.</span></div>' : ""}
      `);
      if (theme || file) {
        await expectConflictNotice(page, 1_000);
      } else {
        const missing = expectConflictNotice(page, 1_000);
        await expect(missing).rejects.toThrow(
          "Remote source changes detected in this theme",
        );
        await expect(missing).rejects.toThrow("Server conflict");
      }
    });
  }
});

test.describe("unsaved work when the signed-in account changes", () => {
  test.skip(!EDITOR_PATH, "Set E2E_EDITOR_PATH to open the editor.");
  restoreHeroAfterFailure();

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
        writes,
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

  /**
   * Edits the hero again after the check read the document back, and expects
   * exactly that edit to be sent and saved: it was typed on the document the
   * check read, which already holds the other tab's change.
   */
  async function nextEditSavedOnReadBack(
    page: Page,
    writes: { sent: number },
    next: string,
  ) {
    const before = writes.sent;
    const field = await heroContentField(page, 0);
    const answer = nextContentWrite(page);
    await field.fill(next);
    await field.press("Tab");
    expect(await answer, "the next edit, sent").toBe("saved");
    await expect(page.locator("[data-editor-save-status]")).toHaveAttribute(
      "aria-label",
      /^(Unpublished|Published)$/,
      { timeout: 30_000 },
    );
    await page.waitForTimeout(2_000);
    // That edit alone: the write the check confirmed is not sent again.
    expect(writes.sent - before, "writes for the next edit").toBe(1);
  }

  /** What the server holds in one of a section's fields, read from a new tab. */
  async function storedField(browser: Browser, section: string, index: number) {
    const check = await sharedEditor(browser);
    try {
      return await (
        await sectionContentField(check.page, section, index)
      ).inputValue();
    } finally {
      await check.context.close();
    }
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

  test("after a landed write is confirmed, the next edit is saved on the document the check read and keeps both writers' changes", async ({
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
      // The check read the document, the other tab's change included, and
      // this tab composes on what it read: the next edit, typed after that,
      // is saved as it is, with nothing of the other tab's written over.
      await nextEditSavedOnReadBack(run.page, run.writes, run.value("next"));
      await run.finish();
    } finally {
      await run.cleanup();
    }
  });

  test("a landed write is confirmed when another writer changed another field of its section", async ({
    browser,
  }) => {
    test.setTimeout(420_000);
    // The other tab writes another field of the same section. A content
    // write carries only the fields typed into, so the server still holds
    // every value this tab sent and the check can say it landed.
    const run = await landedThenAnotherWriter(browser, {
      section: "hero",
      index: 1,
    });
    try {
      // Confirmed by the check: nothing sent again.
      expect(run.resentByCheck).toBe(0);
      // The next edit is composed on the document the check read, so it is
      // saved and carries the other tab's field as that tab wrote it. Both
      // writers' changes are what the server holds.
      await nextEditSavedOnReadBack(run.page, run.writes, run.value("next"));
      await run.finish();
    } finally {
      await run.cleanup();
    }
  });

  test("a landed write that another writer overwrote cannot be confirmed: refused before it is sent, kept, written only on the author's choice", async ({
    browser,
  }) => {
    test.setTimeout(420_000);
    // The other tab writes the very field this tab's unanswered write wrote,
    // so the server no longer holds the value this tab sent and the check
    // cannot say it landed.
    const run = await landedThenAnotherWriter(browser, {
      section: "hero",
      index: 0,
    });
    try {
      // The input was made on a copy older than the other tab's change, so
      // it is refused before it is sent, not resent for the server to refuse.
      expect(run.resentByCheck).toBe(0);
      expect(run.checkAnswer).toBe("none");
      await expect(
        run.page.locator("[data-editor-save-status]"),
      ).toHaveAttribute("aria-label", "Out of date", { timeout: 30_000 });
      // Refused, and kept: the author's edit is still here.
      await expect(await heroContentField(run.page, 0)).toHaveValue(
        run.value("landed"),
      );
      // Nothing was written over the other tab's value, and nothing goes out
      // while the author has not chosen.
      expect(await storedField(browser, "hero", 0)).toBe(run.value("theirs"));
      const waiting = run.writes.sent;
      await run.page.waitForTimeout(3_000);
      expect(run.writes.sent, "writes before the author chooses").toBe(waiting);

      // Keeping mine on the same field replaces the other tab's value: the
      // author chose it on the conflict, nothing did it silently. One write.
      await loadLatestKeepMine(run.page);
      await run.page.waitForTimeout(2_000);
      expect(run.writes.sent - waiting, "writes for keep mine").toBe(1);
      expect(await storedField(browser, "hero", 0)).toBe(run.value("landed"));

      // The edit after that is composed on its own saved document: saved.
      await nextEditSavedOnReadBack(run.page, run.writes, run.value("next"));
      expect(await storedField(browser, "hero", 0)).toBe(run.value("next"));
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
      await expectConflictNotice(page);
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
      await restoreHero(browser);
    }
  });
});
