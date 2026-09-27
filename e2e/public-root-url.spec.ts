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
 * A public/ file shown in the Live Preview at the URL a Theme writes.
 *
 * TanStack Start and Vite serve `public/icons/x.png` at `/icons/x.png`, and so
 * does the published storefront; the Live Preview's dev server lives under its
 * own base and answered that URL with a 404, so every public/ image a Theme
 * referenced was missing from the canvas. Here a component references a
 * nested file by its root URL, through the editor's own Code save, and the
 * canvas has to show it — with the bytes that were uploaded.
 *
 * Runs against the seeded, disposable store only: it rewrites Theme source,
 * and puts it back.
 */
test.skip(!EDITOR_PATH, "Set E2E_EDITOR_PATH to a seeded editor store.");

const FILE_PATH = "public/icons/nested/root-url.png";
const URL_PATH = "/icons/nested/root-url.png";
const MARK = "data-e2e-root-url";
/** A 1x1 PNG. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==",
  "base64",
);

/** Through the entry the editor's upload uses, as a new file. */
async function upload(page: Page) {
  const match = /\/store\/([^/]+)\/themes\/([^/]+)/.exec(page.url());
  expect(match, `no storefront or theme in ${page.url()}`).not.toBeNull();
  const [, storefrontId, themeId] = match!;
  const send = (expectedSourceGeneration: number) =>
    page.request.post(
      `/api/storefront/theme-binary-file?${new URLSearchParams({
        storefrontId,
        themeId,
        path: FILE_PATH,
        expectedSourceGeneration: String(expectedSourceGeneration),
        expectMissing: "1",
      })}`,
      { headers: { "content-type": "application/octet-stream" }, data: PNG },
    );
  let response = await send(0);
  if (response.status() === 409) {
    const { message } = (await response.json()) as { message: string };
    const current = /source generation is (\d+)/.exec(message);
    expect(
      current,
      `a conflict that names no generation: ${message}`,
    ).not.toBeNull();
    response = await send(Number(current![1]));
  }
  expect(response.status(), await response.text()).toBe(200);
}

/** The hero's source file, opened in Code. */
async function openHeroInCode(page: Page) {
  await page.getByRole("button", { name: "hero", exact: true }).click();
  await openContentTab(page);
  const openInCode = page.locator('button[title$=" in Monaco Code Editor"]');
  const hero = (await openInCode.getAttribute("title"))!
    .replace(/^Open /, "")
    .replace(/ in Monaco Code Editor$/, "");
  expect(hero).toMatch(/^src\/components\/page-sections\/index\//);
  await openInCode.click();
  return hero;
}

async function backToDesign(page: Page) {
  // A save's toast sits over the toolbar; let it go with the pointer elsewhere.
  await page.mouse.move(0, 0);
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, {
    timeout: 15_000,
  });
  await page.getByRole("button", { name: /^Design$/ }).click();
}

test("a public/ file a component references by its root URL shows on the canvas", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await openEditor(page);
  await upload(page);
  // A fresh start carries the new file into the preview workspace.
  await openEditor(page);

  const hero = await openHeroInCode(page);
  const tag = `<img ${MARK}="" src="${URL_PATH}" alt="" width={1} height={1} />`;
  await saveEditedSource(page, hero, (source) => {
    const end = source.lastIndexOf("</section>");
    return `${source.slice(0, end)}${tag}\n${source.slice(end)}`;
  });
  await backToDesign(page);

  const image = previewFrame(page).locator(`img[${MARK}]`);
  await expect(image).toHaveCount(1, { timeout: 45_000 });
  // Loaded and decoded, at the URL as written.
  await expect
    .poll(
      () =>
        image.evaluate((element: HTMLImageElement) => ({
          src: new URL(element.src).pathname,
          complete: element.complete,
          naturalWidth: element.naturalWidth,
        })),
      { timeout: 30_000 },
    )
    .toEqual({ src: URL_PATH, complete: true, naturalWidth: 1 });

  // The bytes the canvas got are the ones uploaded, and a file that is not
  // there is still not found.
  const served = await image.evaluate(
    async (_element, paths) => {
      const read = async (path: string) => {
        const response = await fetch(path, { cache: "no-store" });
        const bytes = new Uint8Array(await response.arrayBuffer());
        const digest = new Uint8Array(
          await crypto.subtle.digest("SHA-256", bytes),
        );
        return {
          status: response.status,
          sha256: [...digest]
            .map((b) => b.toString(16).padStart(2, "0"))
            .join(""),
        };
      };
      return {
        file: await read(paths.file),
        missing: await read(paths.missing),
      };
    },
    { file: URL_PATH, missing: "/icons/nested/missing.png" },
  );
  expect(served.file).toEqual({
    status: 200,
    sha256: createHash("sha256").update(PNG).digest("hex"),
  });
  expect(served.missing.status).toBe(404);

  // Put the hero back for the specs that read it. The save formatted the
  // tag across lines, so it is matched as an element, not as the text added.
  await openHeroInCode(page);
  await saveEditedSource(page, hero, (source) => {
    const without = source.replace(
      new RegExp(`\\s*<img\\s[^>]*${MARK}[^>]*/>`),
      "",
    );
    expect(without, "the hero no longer holds the added tag").not.toBe(source);
    return without;
  });
  await backToDesign(page);
  await expect(image).toHaveCount(0, { timeout: 45_000 });
});
