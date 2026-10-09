import { createHash } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import {
  EDITOR_PATH,
  openContentTab,
  openEditor,
  previewFrame,
  saveEditedSource,
} from "./helpers";

/**
 * A binary file kept under src/ (docs/astro-theme-plan.md 5.2.5), the way an
 * author uses one: uploaded through the entry Code mode's upload uses, then
 * imported by a component in Code. The canvas has to show it with the bytes
 * that were uploaded. The entry still refuses an SVG there.
 *
 * Runs against the seeded, disposable store only: it rewrites Theme source,
 * and puts it back.
 */
test.skip(!EDITOR_PATH, "Set E2E_EDITOR_PATH to a seeded editor store.");

const MARK = "data-e2e-source-asset";
/** A 1x1 PNG. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==",
  "base64",
);

/** Through the entry Code mode's upload uses, as a new file. */
async function upload(page: Page, path: string, data: Buffer) {
  const match = /\/store\/([^/]+)\/themes\/([^/]+)/.exec(page.url());
  expect(match, `no storefront or theme in ${page.url()}`).not.toBeNull();
  const [, storefrontId, themeId] = match!;
  const send = (expectedSourceGeneration: number) =>
    page.request.post(
      `/api/storefront/theme-binary-file?${new URLSearchParams({
        storefrontId,
        themeId,
        path,
        expectedSourceGeneration: String(expectedSourceGeneration),
        expectMissing: "1",
      })}`,
      { headers: { "content-type": "application/octet-stream" }, data },
    );
  let response = await send(0);
  if (response.status() === 409) {
    const { message } = (await response.json()) as { message: string };
    const current = /source generation is (\d+)/.exec(message);
    if (current) response = await send(Number(current[1]));
  }
  return response;
}

async function openHeroInCode(page: Page) {
  await page.getByRole("button", { name: "hero", exact: true }).click();
  await openContentTab(page);
  const openInCode = page.locator('button[title$=" in Monaco Code Editor"]');
  const hero = (await openInCode.getAttribute("title"))!
    .replace(/^Open /, "")
    .replace(/ in Monaco Code Editor$/, "");
  expect(hero).toMatch(/^src\//);
  await openInCode.click();
  return hero;
}

async function backToDesign(page: Page) {
  // By keyboard: a save's toast can sit over the toolbar (see
  // public-root-url.spec.ts).
  await page.mouse.move(0, 0);
  await page.getByRole("button", { name: /^Design$/ }).focus();
  await page.keyboard.press("Enter");
}

test("a src/ image a component imports shows on the canvas with its uploaded bytes", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await openEditor(page);
  const file = `src/assets/e2e-source-asset-${Date.now()}.png`;
  const uploaded = await upload(page, file, PNG);
  expect(uploaded.status(), await uploaded.text()).toBe(200);

  // Never SVG under src/, whatever public/ allows.
  const svg = await upload(
    page,
    "src/assets/e2e-logo.svg",
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
  );
  expect(svg.status()).toBe(422);
  expect(await svg.text()).toContain("keep them in public/");

  // A fresh start carries the new file into the preview workspace.
  await openEditor(page);
  const hero = await openHeroInCode(page);
  const relative = `${"../".repeat(hero.split("/").length - 2)}${file.slice("src/".length)}`;
  await saveEditedSource(page, hero, (source) => {
    const end = source.lastIndexOf("</section>");
    const tag = `<img ${MARK}="" src={e2eSourceAsset} alt="" width={1} height={1} />`;
    return `import e2eSourceAsset from "${relative}";\n${source.slice(0, end)}${tag}\n${source.slice(end)}`;
  });
  await backToDesign(page);

  const image = previewFrame(page).locator(`img[${MARK}]`);
  await expect(image).toHaveCount(1, { timeout: 45_000 });
  await expect
    .poll(
      () =>
        image.evaluate((element: HTMLImageElement) => ({
          complete: element.complete,
          naturalWidth: element.naturalWidth,
        })),
      { timeout: 30_000 },
    )
    .toEqual({ complete: true, naturalWidth: 1 });
  const served = await image.evaluate(async (element: HTMLImageElement) => {
    const response = await fetch(element.src, { cache: "no-store" });
    const bytes = new Uint8Array(await response.arrayBuffer());
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    return {
      status: response.status,
      sha256: [...digest].map((b) => b.toString(16).padStart(2, "0")).join(""),
    };
  });
  expect(served).toEqual({
    status: 200,
    sha256: createHash("sha256").update(PNG).digest("hex"),
  });

  // Put the hero back for the specs that read it.
  await openHeroInCode(page);
  await saveEditedSource(page, hero, (source) => {
    const without = source
      .replace(/^import e2eSourceAsset from "[^"]+";\n/m, "")
      .replace(new RegExp(`\\s*<img\\s[^>]*${MARK}[^>]*/>`), "");
    expect(without, "the hero no longer holds the added import and tag").not.toBe(source);
    return without;
  });
  await backToDesign(page);
  await expect(image).toHaveCount(0, { timeout: 45_000 });
});
