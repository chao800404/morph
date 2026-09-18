import { test, expect } from "@playwright/test";
import { EDITOR_PATH } from "./helpers";

test.skip(
  !EDITOR_PATH,
  "Set E2E_EDITOR_PATH to a theme whose sales channel has products.",
);

function editorAt(routePath: string): string {
  const editor = new URL(EDITOR_PATH!, "http://localhost:3000");
  editor.searchParams.set("routePath", routePath);
  return editor.pathname + editor.search;
}

/**
 * That the catalog routes exist, reach real published products, and render.
 *
 * Two things this is written around, both learned by watching it fail.
 *
 * It addresses the storefront through its own public markup — headings,
 * anchors and their hrefs — and not through `data-morph-node`. Those markers
 * are in `DERIVABLE_MARKER_ATTRIBUTES`: the compiler derives them, so the
 * starter upgrade removes the hand-written copies, and the generated catalog
 * files carry none today. The forty left in the repository are the frozen
 * legacy sources kept only so the upgrade can recognise what to strip. The
 * previous version reached for `product-card-title` and, worse, guarded its
 * image check with `if (await images.count())` — which a stripped marker
 * satisfies by returning zero, so the assertion was skipped silently and the
 * run died sixty seconds later pointing at the product data instead of at the
 * selector. Nothing here is conditional on a locator matching.
 *
 * And it reaches the detail page by asking the editor for that route, rather
 * than by clicking a product card. The card is a plain `<a href="/products/…">`
 * because that is what makes a catalog work without JavaScript, but the preview
 * router is built with `createMemoryHistory({ initialEntries: ["/"] })`: it has
 * no browser history, it starts at `/`, and it moves only when the editor posts
 * `morph:storefront-preview-set-route`. A real anchor click is a full document
 * navigation, which tears the React tree down and remounts it at `/` — the home
 * page, not the product. That is true of both preview transports, so the click
 * was never testing navigation; it was testing an interaction the preview does
 * not implement. The href is still asserted, because that is the part the
 * published storefront depends on.
 */
test("catalog routes are provisioned and render public products in the editor", async ({
  page,
}) => {
  // The interesting failures happen inside the preview iframe, where a thrown
  // loader shows up only as the Theme's own "temporarily unavailable" copy.
  // These forward what the frame actually said, so a failed run names a cause
  // instead of a missing element.
  page.on("pageerror", (error) => console.error("[pageerror]", error.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") console.error("[console]", msg.text());
  });

  await page.goto(editorAt("/products"), { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Pages & Sections", { exact: true })).toBeVisible(
    { timeout: 45000 },
  );
  const preview = page.frameLocator("iframe").first();
  await expect(
    preview.getByRole("heading", { name: "Our collection" }),
  ).toBeVisible({ timeout: 45000 });

  // A card, by where it points. The trailing slash excludes the detail page's
  // back link (`/products`) and the navigation's "Shop all"
  // (`/collections/all`), so this matches product cards and nothing else.
  const card = preview.locator('a[href^="/products/"]').first();
  await expect(card).toBeVisible();
  const title = (await card.getByRole("heading").innerText()).trim();
  expect(title).not.toBe("");
  const handle = (await card.getAttribute("href"))!.slice("/products/".length);
  expect(handle).not.toBe("");

  // An image only if this product has one, asserted on the element either way:
  // a product without a thumbnail has to prove the placeholder, and one with a
  // thumbnail has to prove the bytes arrived.
  const image = card.locator("img");
  if (await image.count()) {
    await expect
      .poll(() =>
        image.first().evaluate((img) => (img as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
  } else {
    await expect(card.getByText("No image available")).toBeVisible();
  }

  await page
    .getByRole("spinbutton", { name: "Canvas zoom percentage" })
    .fill("60");
  await page
    .getByRole("spinbutton", { name: "Canvas zoom percentage" })
    .press("Enter");
  await page.screenshot({
    path: "test-results/catalog-editor.png",
    fullPage: true,
  });

  // The detail route, addressed the way the editor addresses it.
  await page.goto(editorAt(`/products/${handle}`), {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByText("Pages & Sections", { exact: true })).toBeVisible(
    { timeout: 45000 },
  );
  const detail = page.frameLocator("iframe").first();
  await expect(
    detail.getByRole("heading", { name: title, exact: true, level: 1 }),
  ).toBeVisible({ timeout: 45000 });
  await expect(detail.locator('a[href="/products"]')).toBeVisible();
  await page.screenshot({
    path: "test-results/catalog-detail.png",
    fullPage: true,
  });
});
