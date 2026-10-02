import { expect, test } from "@playwright/test";
import { EDITOR_PATH, previewFrame } from "./helpers";

test.skip(
  !EDITOR_PATH || process.env.MORPH_E2E_PREVIEW_RUNTIME !== "start",
  "Start preview only",
);

test("Start health identifies the preview without a Theme page or bridge", async ({
  page,
}) => {
  await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
  // The initial about:blank document also has a body. Do not evaluate it
  // while the editor is still assigning the actual preview address.
  await expect.poll(async () => {
    const src = await page.locator("iframe").first().getAttribute("src");
    return Boolean(src && src !== "about:blank" && !src.startsWith("data:"));
  }, { timeout: 45_000 }).toBe(true);
  const frame = previewFrame(page);
  await expect(frame.locator("body")).toBeAttached({ timeout: 45_000 });
  const health = await frame.locator("body").evaluate(async () => {
    const response = await fetch("/__morph_preview_health");
    return {
      status: response.status,
      id: response.headers.get("x-morph-preview-id"),
      cache: response.headers.get("cache-control"),
      body: await response.text(),
      hostname: location.hostname,
    };
  });
  expect(health.status).toBe(204);
  expect(health.id).toMatch(/^[a-f0-9]{32}$/);
  expect(health.hostname).toContain(`5173-${health.id}-`);
  expect(health.cache).toBe("no-store");
  expect(health.body).toBe("");
});
