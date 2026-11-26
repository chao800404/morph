import { expect, type Page } from "@playwright/test";

/**
 * The editor closed to another account: the reason shown where the editor
 * was, and the editor itself out of reach. (`editAndSave` writes through
 * Monaco's API, which no closed editor can stop; what stops the save then is
 * the write gate, checked separately by counting saves.)
 */
export async function expectClosedToAnotherAccount(page: Page) {
  await expect(
    page.locator('[data-editor-locked="different-account"]'),
  ).toBeVisible();
  await expect(
    page.locator("[data-editor-mode-surface]").first(),
  ).toHaveAttribute("inert", "");
}
