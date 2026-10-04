import { expect, test } from "@playwright/test";
import { EDITOR_PATH } from "./helpers";

import {
  writeSectionField,
  writeHeroField,
  sectionContentField,
  heroContentField,
  openRename,
  nextRename,
  sharedEditor,
  MARKER,
} from "./helpers/editor-writes-paused";

test.describe("a structural edit after the page moved elsewhere", () => {
  test.skip(!EDITOR_PATH, "Set E2E_EDITOR_PATH to open the editor.");

  test("a rename refused for a moved page keeps the name typed, and the next press applies it on the latest version", async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const { context, page } = await sharedEditor(browser);
    let other: Awaited<ReturnType<typeof sharedEditor>> | null = null;
    const stamp = Date.now();
    const value = (name: string) => `${MARKER} ${name} ${stamp}`;
    const name = `Hero ${stamp}`;
    const originals = {
      mine: await (await heroContentField(page, 0)).inputValue(),
      theirs: "",
    };
    let renamed = false;
    try {
      // A write answered here, so this tab holds the page's generation.
      await writeHeroField(page, 0, value("mine"));

      // Another tab changes another section of the same page.
      other = await sharedEditor(browser);
      originals.theirs = await (
        await sectionContentField(other.page, "editorial-intro", 0)
      ).inputValue();
      await writeSectionField(
        other.page,
        "editorial-intro",
        0,
        value("theirs"),
      );

      // The rename is refused: the page moved. The dialog stays, with the
      // name typed, and says why.
      const input = await openRename(page, "hero");
      await input.fill(name);
      const refused = nextRename(page);
      await page.locator("[data-editor-rename-confirm]").click();
      expect(await refused, "the first rename").toBe("conflict");
      await expect(
        page.getByText("This page was changed elsewhere").first(),
      ).toBeVisible();
      await expect(page.getByLabel("Section name")).toHaveValue(name);

      // Pressed again: applied on the latest version.
      const applied = nextRename(page);
      await page.locator("[data-editor-rename-confirm]").click();
      expect(await applied, "the second rename").toBe("saved");
      renamed = true;
      await expect(page.getByLabel("Section name")).toHaveCount(0);

      // A fresh load holds the name and the other tab's change.
      const check = await sharedEditor(browser);
      try {
        await expect(
          check.page.getByRole("button", { name, exact: true }),
        ).toBeVisible({ timeout: 30_000 });
        await expect(
          await sectionContentField(check.page, "editorial-intro", 0),
        ).toHaveValue(value("theirs"));
      } finally {
        await check.context.close();
      }
    } finally {
      await other?.context.close();
      await context.close();
      const restore = await sharedEditor(browser);
      try {
        if (renamed) {
          const input = await openRename(restore.page, name);
          await input.fill("");
          const back = nextRename(restore.page);
          await restore.page.locator("[data-editor-rename-confirm]").click();
          expect(await back, "the name restored").toBe("saved");
        }
        await writeHeroField(restore.page, 0, originals.mine);
        if (originals.theirs) {
          await writeSectionField(
            restore.page,
            "editorial-intro",
            0,
            originals.theirs,
          );
        }
      } finally {
        await restore.context.close();
      }
    }
  });
});
