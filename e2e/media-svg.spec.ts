import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { EDITOR_PATH } from "./helpers";

/**
 * SVG uploads to the media library, through the running app: the upload is
 * judged by the shared parser (`validateSvg`, running in the Worker), and an
 * accepted file is served inline only because it recorded the version of
 * the rules it passed, with the isolation headers every SVG carries.
 *
 * Runs against the seeded, disposable store only: it adds library assets.
 */
test.skip(!EDITOR_PATH, "Set E2E_EDITOR_PATH to a seeded editor store.");

const DRAWING = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#2563eb"/></svg>`;
const SCRIPTED = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><script>fetch('/ran')</script></svg>`;

async function upload(page: Page, name: string, svg: string) {
  await page.goto("/dashboard/assets/create?variant=upload", {
    waitUntil: "domcontentloaded",
  });
  // The form opens over the Assets list, which has its own Create menu and
  // drop zone: everything is looked for inside it.
  const form = page.getByLabel("Create Asset");
  // A file chosen before the form hydrates is dropped, so it is chosen
  // again until the form shows it — once only, since each choice adds a file
  // — and the form must hold that file alone, nothing left from before.
  await expect(async () => {
    if ((await form.getByRole("img", { name }).count()) === 0) {
      await form.locator('input[type="file"]').setInputFiles({
        name,
        mimeType: "image/svg+xml",
        buffer: Buffer.from(svg),
      });
    }
    await expect(form.getByRole("img")).toHaveCount(1, { timeout: 3_000 });
    await expect(form.getByRole("img", { name })).toHaveCount(1);
  }).toPass({ timeout: 45_000 });
  // By keyboard: the dev server's TanStack Devtools button sits over the
  // form's bottom-right corner, where Create is, and takes the click.
  await form.getByRole("button", { name: "Create", exact: true }).focus();
  await page.keyboard.press("Enter");
}

test("an SVG upload is parsed, recorded, and served isolated", async ({
  page,
}) => {
  const run = randomUUID().slice(0, 8);

  await upload(page, `e2e-scripted-${run}.svg`, SCRIPTED);
  await expect(
    page.getByText(/This element is not allowed in an SVG here/).first(),
  ).toBeVisible({ timeout: 45_000 });
  await expect(page).toHaveURL(/\/dashboard\/assets\/create/);

  const name = `e2e-drawing-${run}`;
  await upload(page, `${name}.svg`, DRAWING);
  await expect(page).toHaveURL(/\/dashboard\/assets\/?(\?.*)?$/, {
    timeout: 45_000,
  });

  const image = page.locator(`img[alt^="${name}"]`).first();
  await expect(image).toBeVisible({ timeout: 45_000 });
  const src = await image.getAttribute("src");
  expect(src).toMatch(/\/assets\/[0-9a-f-]+\.svg/);

  const served = await page.request.get(src!);
  expect(served.status()).toBe(200);
  expect(served.headers()["content-type"]).toMatch(/^image\/svg\+xml/);
  // Passed the current rules, so it may be shown when opened directly —
  // and is isolated all the same.
  expect(served.headers()["content-disposition"]).toBe("inline");
  expect(served.headers()["content-security-policy"]).toContain("sandbox");
  expect(served.headers()["x-content-type-options"]).toBe("nosniff");
  expect(await served.text()).toBe(DRAWING);
});
