import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { expect, test, type Frame, type Page } from "@playwright/test";

import {
  EDITOR_PATH,
  clickExposedElement,
  enableSelection,
  isServerFunctionCall,
  openContentTab,
  previewFrame,
  settleSelection,
} from "./helpers";
import { savedField, signedInPage } from "./native-acceptance";
import {
  removeThemeFiles,
  themeScopeFromEditorPath,
  uploadThemeBinary,
  writeThemeFiles,
} from "./native-compat";
import {
  LEGACY_STARTER_THEME_CONTENT_MODULE_V14_SOURCE,
  STARTER_THEME_CONTENT_MODULE_SOURCE,
} from "../src/lib/storefront/starter-theme-v3-files";

/**
 * The Starter upgrade to version 28 on the workspace the editor provisions,
 * loaded the way an author loads it: by opening the editor.
 *
 *   A. a new Starter: Live Preview shows a value typed in Design, and a route
 *      calling morph.pages.get reads it;
 *   D. the same workspace marked 27: the upgrade runs and changes no file;
 *   B. the pre-pages content module, untouched, on 27: only content.ts is
 *      replaced, a second load changes nothing, and the Theme is on 28;
 *   E. a toolchain pin an earlier Starter wrote: the build refuses it, and
 *      builds once the upgrade brings it forward (containers only);
 *   C. the pre-pages module as the author edited it, on 27: nothing changes.
 *
 * Markers are random, so no component default can produce them. With the
 * container transport each case also builds and checks the isolated Build
 * Preview reads the build's sealed snapshot.
 *
 * The workspace is shared with the specs that run after this one, so the
 * state it changes is put back afterwards.
 */

const TRANSPORT = process.env.E2E_EXPECT_PREVIEW_TRANSPORT;
const CONTAINERS = TRANSPORT === "cloudflare-sandbox";
const STATE_DIR = process.env.MORPH_E2E_STATE_DIR;
const scope = EDITOR_PATH ? themeScopeFromEditorPath(EDITOR_PATH) : null;
const SERVER_FN_MODULE =
  "/src/server/storefront/storefront-theme-files.serverFn.ts";

const CONTENT_MODULE = "src/morph/content.ts";
const PACKAGE = "package.json";
const PROBE_ROUTE = "src/routes/pages-probe.tsx";
const PROBE_FILE = {
  path: PROBE_ROUTE,
  content: `import { createFileRoute } from "@tanstack/react-router";
import { morph } from "../morph/content";

export const Route = createFileRoute("/pages-probe")({
  loader: async () => {
    try {
      return { read: JSON.stringify(await morph.pages.get("/")) };
    } catch (error) {
      return { read: "PAGES_GET_FAILED " + String((error as { code?: string }).code ?? error) };
    }
  },
  component: () => <pre data-pages-probe="">{Route.useLoaderData().read}</pre>,
});
`,
};
const OLD_PATH_COMPONENTS = [
  "src/components/EditorialIntro.tsx",
  "src/components/CategoryShowcase.tsx",
  "src/components/ImageWithText.tsx",
  "src/components/Newsletter.tsx",
];
const UPLOADED_IMAGE = "public/starter-upgrade-check.png";
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);
const EDITED_PRE_PAGES_MODULE =
  LEGACY_STARTER_THEME_CONTENT_MODULE_V14_SOURCE + "\n// edited by the author\n";

test.skip(
  !EDITOR_PATH || !STATE_DIR,
  "Set E2E_EDITOR_PATH, or run through scripts/run-editor-e2e.mjs.",
);

/** The local D1 the run's dev server uses. No server function sets these. */
function d1(sql: string): Array<Record<string, unknown>> {
  const output = execFileSync(
    "npx",
    [
      "wrangler",
      "d1",
      "execute",
      "DATABASE",
      "--local",
      ...(CONTAINERS ? [] : ["--env", "local_preview_e2e"]),
      "--persist-to",
      STATE_DIR!,
      "--json",
      "--command",
      sql,
    ],
    { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" },
  );
  return (
    (JSON.parse(output) as Array<{ results?: Array<Record<string, unknown>> }>)[0]
      ?.results ?? []
  );
}

function setStarterVersion(version: number) {
  d1(
    `UPDATE storefront_themes SET metadata = json_set(COALESCE(metadata, '{}'), '$.starterTemplateVersion', ${Number(version)}) WHERE id = '${scope!.themeId}'`,
  );
}

const starterVersion = () =>
  Number(
    d1(
      `SELECT json_extract(metadata, '$.starterTemplateVersion') AS version FROM storefront_themes WHERE id = '${scope!.themeId}'`,
    )[0]?.version,
  );

const latestBuild = () =>
  d1(
    `SELECT status, error_message FROM storefront_theme_builds WHERE theme_id = '${scope!.themeId}' ORDER BY created_at DESC LIMIT 1`,
  )[0] as { status: string; error_message: string | null } | undefined;

/** Every text file, path → content. */
async function workspace(page: Page): Promise<Record<string, string>> {
  return page.evaluate(
    async ({ module, scope }) => {
      const fns = await import(/* @vite-ignore */ module);
      const listed = await fns.listStorefrontThemeFiles({ data: scope });
      return Object.fromEntries(
        (listed?.data?.files ?? []).map(
          (file: { path: string; content: string }) => [file.path, file.content],
        ),
      );
    },
    { module: SERVER_FN_MODULE, scope: scope! },
  );
}

async function save(page: Page, files: Array<{ path: string; content: string }>) {
  const saved = await writeThemeFiles(page, scope!, files);
  expect(saved.success, JSON.stringify(saved)).toBe(true);
}

/** Opening the editor is what runs the Starter upgrade. */
async function openEditor(page: Page, routePath?: string) {
  const url = new URL(EDITOR_PATH!, "http://placeholder");
  if (routePath) url.searchParams.set("routePath", routePath);
  await page.goto(`${url.pathname}${url.search}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByRole("button", { name: /^Publish$/ })).toBeVisible({
    timeout: 45_000,
  });
  // The toolbar renders before the page hydrates; see build-preview-isolated.
  await page.waitForTimeout(4_000);
}

/** Types a marker into the hero, as build-preview-isolated.spec.ts does. */
async function typeHeroMarker(page: Page, marker: string) {
  await enableSelection(page);
  const field = page
    .locator('[data-slot="inspector-content-field"] input')
    .first();
  const section = page.getByRole("button", { name: "hero", exact: true });
  if (await section.isVisible().catch(() => false)) {
    await section.click();
    await settleSelection(page);
    await openContentTab(page);
  }
  if (!(await field.isVisible().catch(() => false))) {
    const selected = await clickExposedElement(
      page,
      previewFrame(page).locator(
        "h1[data-storefront-field], h2[data-storefront-field], p[data-storefront-field]",
      ),
    );
    expect(
      selected,
      "neither the section tree nor the canvas exposed an editable text field",
    ).not.toBeNull();
    await openContentTab(page);
  }
  await expect(field).toBeVisible({ timeout: 30_000 });
  // The edit is saved after the editor's debounce, not when the canvas shows
  // it. "Unpublished" is no evidence either: the save status already says so
  // before the edit and does not show Saving… while the debounce runs. A
  // test that navigates on either leaves before the save is sent, and the
  // marker never reaches the server (CI run 37964261465). So it waits for
  // the save carrying the marker, and reads the draft back.
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      isServerFunctionCall(response.url(), "updateStorefrontThemeSectionProps") &&
      (response.request().postData() ?? "").includes(marker),
    { timeout: 30_000 },
  );
  await field.fill(marker);
  await field.press("Tab");
  await expect(
    previewFrame(page).getByText(marker, { exact: false }).first(),
  ).toBeVisible({ timeout: 30_000 });
  const response = await saved;
  expect(response.ok()).toBe(true);
  // A refused write still answers 200; the refusal is in the body.
  expect(await response.text()).not.toMatch(/"success":\s*false/);
  await savedField(page, scope!, marker);
}

async function expectLiveProbe(page: Page, marker: string) {
  await openEditor(page, "/pages-probe");
  const probe = previewFrame(page).locator("[data-pages-probe]");
  await expect(probe).toContainText(marker, { timeout: 90_000 });
  await expect(probe).not.toContainText("PAGES_GET_FAILED");
}

async function build(page: Page) {
  const action = page.locator("button[data-editor-build-action]");
  await expect(action).toBeEnabled({ timeout: 30_000 });
  await action.click();
  await expect(action).toHaveAttribute("data-build-pending", "true", {
    timeout: 30_000,
  });
  await expect(action).toHaveAttribute("data-build-pending", "false", {
    timeout: 9 * 60_000,
  });
}

/** Builds and checks the isolated Build Preview against the sealed snapshot. */
async function expectBuildPreview(page: Page, marker: string, withProbe: boolean) {
  await openEditor(page);
  await build(page);
  const frameElement = page.locator('iframe[data-build-preview="isolated"]');
  await expect(frameElement).toBeVisible({ timeout: 60_000 });
  const address = new URL((await frameElement.getAttribute("src"))!);
  expect(address.hostname).toMatch(/^bp-[0-9a-f]{40}\./);
  let preview: Frame | null = null;
  await expect
    .poll(
      () =>
        (preview = page.frame({
          url: (url) => url.hostname === address.hostname,
        })),
      { timeout: 120_000 },
    )
    .toBeTruthy();
  await expect(preview!.locator("body")).not.toBeEmpty({ timeout: 120_000 });
  const content = await preview!.evaluate(async () => {
    const response = await fetch("/_morph/content?path=/");
    return { status: response.status, body: await response.text() };
  });
  expect(content.status).toBe(200);
  expect(content.body).toContain(marker);
  await expect(
    preview!.getByText(marker, { exact: false }).first(),
  ).toBeVisible({ timeout: 60_000 });
  const probed = withProbe
    ? await preview!.evaluate(async () => {
        const response = await fetch("/pages-probe");
        return { status: response.status, html: await response.text() };
      })
    : null;
  expect(probed === null || probed.status === 200).toBe(true);
  expect(probed === null || probed.html.includes(marker)).toBe(true);
  expect(probed === null || !probed.html.includes("PAGES_GET_FAILED")).toBe(true);
}

test.describe("Starter upgrade to version 28", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(CONTAINERS ? 25 * 60_000 : 6 * 60_000);

  let original: Record<string, string> = {};

  test.beforeAll(async ({ browser }) => {
    const page = await signedInPage(browser);
    await openEditor(page);
    original = await workspace(page);
    expect(original[CONTENT_MODULE]).toBe(STARTER_THEME_CONTENT_MODULE_SOURCE);
    // A binary file, as any Theme with an uploaded image has. An upgrade that
    // records its revision without a manifest is refused for such a workspace,
    // and then the editor cannot open; CI found it when an earlier spec on the
    // shard had uploaded one. Here it does not depend on what ran before.
    const uploaded = await uploadThemeBinary(
      page,
      scope!,
      UPLOADED_IMAGE,
      ONE_PIXEL_PNG,
    );
    expect(uploaded.ok(), await uploaded.text()).toBe(true);
    await page.context().close();
  });

  test.afterAll(async ({ browser }) => {
    const page = await signedInPage(browser);
    // On the current version first, so loading the editor upgrades nothing.
    setStarterVersion(28);
    await openEditor(page);
    const removed = await removeThemeFiles(page, scope!, [
      PROBE_ROUTE,
      UPLOADED_IMAGE,
    ]);
    expect(removed.success, JSON.stringify(removed)).toBe(true);
    await save(page, [
      { path: CONTENT_MODULE, content: original[CONTENT_MODULE]! },
      { path: PACKAGE, content: original[PACKAGE]! },
    ]);
    await page.context().close();
  });

  test("A. a new Starter: both previews, and morph.pages.get reads the marker", async ({
    page,
  }) => {
    await openEditor(page);
    await save(page, [PROBE_FILE]);
    const marker = `morph-a-${randomUUID()}`;
    await openEditor(page);
    await typeHeroMarker(page, marker);
    await expectLiveProbe(page, marker);
    // Build Preview needs containers. With the sidecar transport the Live
    // Preview half above is the whole test, and it reports as passed, not
    // as skipped after having run.
    if (CONTAINERS) await expectBuildPreview(page, marker, true);
  });

  test("D. the workspace marked 27: the upgrade runs and changes no file", async ({
    page,
  }) => {
    await openEditor(page);
    const before = await workspace(page);
    setStarterVersion(27);
    await openEditor(page);
    expect(await workspace(page)).toEqual(before);
    expect(starterVersion()).toBe(28);
  });

  test("B. the untouched pre-pages module on 27: only content.ts is replaced, once", async ({
    page,
  }) => {
    await openEditor(page);
    await save(page, [
      {
        path: CONTENT_MODULE,
        content: LEGACY_STARTER_THEME_CONTENT_MODULE_V14_SOURCE,
      },
    ]);
    setStarterVersion(27);
    const before = await workspace(page);

    await openEditor(page);
    const after = await workspace(page);
    expect(after[CONTENT_MODULE]).toBe(STARTER_THEME_CONTENT_MODULE_SOURCE);
    expect({ ...after, [CONTENT_MODULE]: "" }).toEqual({
      ...before,
      [CONTENT_MODULE]: "",
    });
    for (const path of OLD_PATH_COMPONENTS) {
      expect(Object.keys(after)).not.toContain(path);
    }
    expect(starterVersion()).toBe(28);

    // A second load: no second replacement, no added file, no version write.
    await openEditor(page);
    expect(await workspace(page)).toEqual(after);
    expect(starterVersion()).toBe(28);

    const marker = `morph-b-${randomUUID()}`;
    await typeHeroMarker(page, marker);
    await expectLiveProbe(page, marker);
    // Build Preview needs containers. With the sidecar transport the Live
    // Preview half above is the whole test, and it reports as passed, not
    // as skipped after having run.
    if (CONTAINERS) await expectBuildPreview(page, marker, true);
  });

  test("E. a toolchain pin an earlier Starter wrote: refused by the build, built once upgraded", async ({
    page,
  }) => {
    test.skip(!CONTAINERS, "Builds run in containers.");
    await openEditor(page);
    const pkg = JSON.parse((await workspace(page))[PACKAGE]!);
    // What the Starter wrote between 2026-09-23 and 2026-10-03.
    pkg.devDependencies["@cloudflare/vite-plugin"] = "1.50.0";
    await save(page, [{ path: PACKAGE, content: JSON.stringify(pkg, null, 2) }]);

    // On the current version nothing upgrades it, as for such a Theme today.
    setStarterVersion(28);
    await openEditor(page);
    await build(page);
    const refused = latestBuild();
    expect(refused?.status).toBe("failed");
    expect(refused?.error_message ?? "").toContain("INVALID_START_PACKAGE");
    expect(refused?.error_message ?? "").toContain("@cloudflare/vite-plugin");

    setStarterVersion(27);
    await openEditor(page);
    expect(
      JSON.parse((await workspace(page))[PACKAGE]!).devDependencies[
        "@cloudflare/vite-plugin"
      ],
    ).toBe("1.62.4");

    const marker = `morph-e-${randomUUID()}`;
    await typeHeroMarker(page, marker);
    await expectBuildPreview(page, marker, true);
    expect(latestBuild()?.status).toBe("succeeded");
  });

  test("C. the pre-pages module as the author edited it, on 27: nothing changes", async ({
    page,
  }) => {
    await openEditor(page);
    // The probe imports morph, which the pre-pages module does not export.
    const removed = await removeThemeFiles(page, scope!, [PROBE_ROUTE]);
    expect(removed.success, JSON.stringify(removed)).toBe(true);
    await save(page, [{ path: CONTENT_MODULE, content: EDITED_PRE_PAGES_MODULE }]);
    setStarterVersion(27);
    const before = await workspace(page);

    await openEditor(page);
    expect(await workspace(page)).toEqual(before);

    const marker = `morph-c-${randomUUID()}`;
    await typeHeroMarker(page, marker);
    // As in A and B: Live Preview only, unless containers run.
    if (CONTAINERS) await expectBuildPreview(page, marker, false);
  });
});
