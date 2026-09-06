import { test, expect } from "@playwright/test";
import { EDITOR_PATH } from "./helpers";

test.skip(
  !EDITOR_PATH,
  "Set E2E_EDITOR_PATH to a theme whose sales channel has products.",
);

test("catalog routes are provisioned and render public products in the editor", async ({
  page,
}) => {
  const editor = new URL(EDITOR_PATH!, "http://localhost:3000");
  editor.searchParams.set("routePath", "/products");
  page.on("pageerror", (error) => console.error(error.message));
  await page.goto(editor.pathname + editor.search, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByText("Pages & Sections", { exact: true })).toBeVisible(
    { timeout: 45000 },
  );
  const preview = page.frameLocator("iframe").first();
  await expect(
    preview.getByRole("heading", { name: "Our collection" }),
  ).toBeVisible({ timeout: 45000 });
  const images = preview.locator('[data-morph-node="product-card-image"]');
  if (await images.count()) {
    await expect.poll(() => images.first().evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  }
  await page.getByRole("spinbutton", { name: "Canvas zoom percentage" }).fill("60");
  await page.getByRole("spinbutton", { name: "Canvas zoom percentage" }).press("Enter");
  await page.screenshot({
    path: "test-results/catalog-editor.png",
    fullPage: true,
  });
  const card = preview.locator('[data-morph-node="product-card"]').first();
  const title = await card.locator('[data-morph-node="product-card-title"]').innerText();
  await card.evaluate(anchor => (anchor as HTMLAnchorElement).click());
  await expect(preview.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await expect(preview.locator('[data-morph-node="product-detail"]')).toBeVisible();
  await page.screenshot({ path: "test-results/catalog-detail.png", fullPage: true });
  await preview.getByRole("link", { name: "All products", exact: true }).evaluate(anchor => (anchor as HTMLAnchorElement).click());
  await expect(preview.getByRole("heading", { name: "Our collection" })).toBeVisible();
});
