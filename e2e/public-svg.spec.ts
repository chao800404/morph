import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

import {
  type Browser,
  expect,
  firefox,
  type Page,
  test,
  webkit,
} from "@playwright/test";

import {
  EDITOR_PATH,
  openContentTab,
  openEditor,
  previewFrame,
  saveEditedSource,
} from "./helpers";

/**
 * SVG in a Theme's public/, as an author uses it and as an attacker cannot.
 *
 * Two claims, checked apart because one entry cannot prove both: the ordinary
 * upload refuses a script-carrying SVG, so it can only ever deliver a clean
 * one.
 *
 * - A clean SVG uploaded the ordinary way, referenced by a component at its
 *   root URL, is painted on the canvas as authored, with its bytes intact
 *   and the isolation headers on. Runs on either transport, so CI keeps it.
 * - A script-carrying SVG runs in no browser when opened directly through the
 *   real Sandbox proxy. It is written into this run's own disposable
 *   container by the test, never through a product entry — no upload path
 *   has a way around `validateSvg` — and a control serves the same bytes
 *   without the headers to show the detection works. Needs the container
 *   transport and all three Playwright browsers.
 *
 * Runs against the seeded, disposable store only: it rewrites Theme source,
 * and puts it back. The evidence that opened the gate is in
 * docs/evidence/svg-gate-local-2026-09-27.md.
 */
test.skip(!EDITOR_PATH, "Set E2E_EDITOR_PATH to a seeded editor store.");

const TRANSPORT = process.env.E2E_EXPECT_PREVIEW_TRANSPORT;
const MARK = "data-e2e-public-svg";
const CLEAN = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20" viewBox="0 0 40 20"><rect width="40" height="20" fill="#0a7"/><circle cx="10" cy="10" r="6" fill="#fff"/></svg>',
);
const EVIL = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20" onload="document.documentElement.setAttribute(\'data-ran\',\'onload\')"><script>document.documentElement.setAttribute("data-ran","script")</script><rect width="40" height="20" fill="#c00"/></svg>',
);
const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

/** Through the entry the editor's upload uses, as a new file. */
async function upload(page: Page, path: string, bytes: Buffer) {
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
      { headers: { "content-type": "application/octet-stream" }, data: bytes },
    );
  const first = await send(0);
  if (first.status() !== 409) return first;
  const { message } = (await first.json()) as { message: string };
  const current = /source generation is (\d+)/.exec(message);
  expect(
    current,
    `a conflict that names no generation: ${message}`,
  ).not.toBeNull();
  return send(Number(current![1]));
}

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
  // By keyboard, not by pointer. A save's toast lands over the toolbar, and
  // waiting for "no toast" can pass before it appears; a click then moves the
  // pointer onto it, a hovered toast pauses its own timer, and the click is
  // retried until the test times out (CI, #62). Focus and Enter need no hit
  // test, so the toast neither blocks the button nor gets hovered.
  await page.mouse.move(0, 0);
  await page.getByRole("button", { name: /^Design$/ }).focus();
  await page.keyboard.press("Enter");
}

test("a clean SVG from the ordinary upload is painted where a component references it", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await openEditor(page);

  // The same entry refuses a script-carrying SVG, with the validator's reason.
  const refused = await upload(page, "public/icons/refused.svg", EVIL);
  expect(refused.status()).toBe(422);
  expect(await refused.text()).toContain(
    "Event handler attributes are not allowed",
  );

  const accepted = await upload(page, "public/icons/e2e-logo.svg", CLEAN);
  expect(accepted.status(), await accepted.text()).toBe(200);
  expect(
    ((await accepted.json()) as { data: Record<string, unknown> }).data,
  ).toMatchObject({
    blobDigest: sha256(CLEAN),
    mimeType: "image/svg+xml",
    sizeBytes: CLEAN.byteLength,
  });
  // A fresh start carries the new file into the preview workspace.
  await openEditor(page);

  const hero = await openHeroInCode(page);
  await saveEditedSource(page, hero, (source) => {
    const end = source.lastIndexOf("</section>");
    return `${source.slice(0, end)}<img ${MARK}="" src="/icons/e2e-logo.svg" alt="" width={40} height={20} />\n${source.slice(end)}`;
  });
  await backToDesign(page);

  const image = previewFrame(page).locator(`img[${MARK}]`);
  await expect(image).toHaveCount(1, { timeout: 45_000 });
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
    .toEqual({ src: "/icons/e2e-logo.svg", complete: true, naturalWidth: 40 });

  // What the component's own <img> painted, and what it was sent.
  const painted = await image.evaluate((element: HTMLImageElement) => {
    const canvas = document.createElement("canvas");
    canvas.width = element.naturalWidth;
    canvas.height = element.naturalHeight;
    const context = canvas.getContext("2d")!;
    context.drawImage(element, 0, 0);
    const pixel = (x: number, y: number) =>
      [...context.getImageData(x, y, 1, 1).data].join(",");
    return { rect: pixel(30, 10), circle: pixel(10, 10) };
  });
  expect(painted).toEqual({
    rect: "0,170,119,255",
    circle: "255,255,255,255",
  });
  const sent = await image.evaluate(async (element: HTMLImageElement) => {
    const response = await fetch(element.src, { cache: "no-store" });
    const body = new Uint8Array(await response.arrayBuffer());
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", body));
    return {
      status: response.status,
      contentType: response.headers.get("content-type"),
      csp: response.headers.get("content-security-policy"),
      nosniff: response.headers.get("x-content-type-options"),
      sha256: [...digest].map((b) => b.toString(16).padStart(2, "0")).join(""),
    };
  });
  expect(sent).toMatchObject({
    status: 200,
    contentType: expect.stringContaining("image/svg+xml"),
    csp: expect.stringContaining("sandbox"),
    nosniff: "nosniff",
    sha256: sha256(CLEAN),
  });

  // Put the hero back for the specs that read it. The save formatted the tag
  // across lines, so it is matched as an element, not as the text added.
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

test("a script-carrying SVG runs in no browser when opened directly through the Sandbox proxy", async ({
  page,
  browser,
}) => {
  test.skip(
    TRANSPORT !== "cloudflare-sandbox",
    "Plants a file in the preview container; run with MORPH_E2E_TRANSPORT=cloudflare-sandbox.",
  );
  test.setTimeout(240_000);
  await openEditor(page);
  const origin = new URL(
    page
      .frames()
      .find((frame) => frame.url().includes("/__morph-theme-preview__/"))!
      .url(),
  ).origin;

  // This run's own preview container, holding the workspace. The file goes
  // straight in, outside the product. Previews run under PreviewSandbox, and
  // wrangler names the local image after the class.
  const container = execFileSync("docker", [
    "ps",
    "--format",
    "{{.ID}} {{.Image}}",
  ])
    .toString()
    .trim()
    .split("\n")
    .filter((line) => line.includes(" cloudflare-dev/previewsandbox:"))
    .map((line) => line.split(" ")[0]!)
    .find((id) => {
      try {
        execFileSync("docker", ["exec", id, "test", "-d", "/workspace/src"]);
        return true;
      } catch {
        return false;
      }
    });
  expect(container, "this run's Sandbox container").toBeTruthy();
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      container!,
      "sh",
      "-c",
      "mkdir -p /workspace/public/icons && cat > /workspace/public/icons/e2e-evil.svg",
    ],
    { input: EVIL },
  );

  const open = async (target: Browser) => {
    const context = await target.newContext();
    const direct = await context.newPage();
    const served = [];
    for (const url of [
      `${origin}/icons/e2e-evil.svg`,
      `${origin}/__morph-theme-preview__/icons/e2e-evil.svg`,
    ]) {
      const response = await direct.goto(url);
      await direct.waitForTimeout(1_000);
      served.push({
        url: url.slice(origin.length),
        status: response?.status(),
        sameBytes:
          sha256(response ? await response.body() : Buffer.alloc(0)) ===
          sha256(EVIL),
        csp: response?.headers()["content-security-policy"] ?? "",
        nosniff: response?.headers()["x-content-type-options"],
        ran: await direct.evaluate(() =>
          document.documentElement.getAttribute("data-ran"),
        ),
      });
    }
    // Control: the same bytes on the same origin, without the headers.
    await direct.route(`${origin}/__e2e-svg-control.svg`, (route) =>
      route.fulfill({ status: 200, contentType: "image/svg+xml", body: EVIL }),
    );
    await direct.goto(`${origin}/__e2e-svg-control.svg`);
    await direct.waitForTimeout(1_000);
    const control = await direct.evaluate(() =>
      document.documentElement.getAttribute("data-ran"),
    );
    await context.close();
    return { served, control };
  };

  const others = [await firefox.launch(), await webkit.launch()];
  try {
    for (const target of [browser, ...others]) {
      const result = await open(target);
      const name = target.browserType().name();
      expect(
        result.control,
        `${name}: the control runs, so detection works`,
      ).toBe("onload");
      for (const read of result.served) {
        expect(read, `${name}: ${read.url}`).toMatchObject({
          status: 200,
          sameBytes: true,
          csp: expect.stringContaining("sandbox"),
          nosniff: "nosniff",
          ran: null,
        });
      }
    }
  } finally {
    await Promise.all(others.map((other) => other.close()));
  }
});
