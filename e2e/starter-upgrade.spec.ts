import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
import { STOREFRONT_STARTER_TEMPLATE_VERSION } from "../src/lib/storefront/default-storefront-document";

/**
 * The Starter upgrade on the workspace the editor provisions, the way an
 * author meets it: opening the editor changes nothing and says an upgrade is
 * available; the author reviews it and applies it, or does not.
 *
 *   A. a new Starter: Live Preview shows a value typed in Design, and a route
 *      calling morph.pages.get reads it;
 *   D. the same workspace marked as an older Starter: opening writes no file
 *      and no version; the review lists no change, and applying it only
 *      records the version;
 *   B. the pre-pages content module, untouched, on an older Starter: opening
 *      changes nothing; the review lists content.ts with its text before and
 *      after; applying replaces only it, and a second load changes nothing;
 *   E. a toolchain pin an earlier Starter wrote: the build refuses it, and
 *      builds once the reviewed upgrade brings it forward (containers only);
 *   C. the pre-pages module as the author edited it, on an older Starter: the
 *      review keeps it and says why; cancelling writes nothing;
 *   P. a Theme that records no Starter version: shown as pending, never as
 *      the latest, and opening writes nothing.
 *   R. a Theme created before the Starter had its account and order-transfer
 *      pages: the review offers them unselected and holds back the Header
 *      that links to /account; applying without them adds neither and keeps
 *      the Header; selecting them adds both and updates the Header.
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

/** The Starter version below the current one, which the cases start from. */
const OLDER = STOREFRONT_STARTER_TEMPLATE_VERSION - 1;

function clearStarterVersion() {
  d1(
    `UPDATE storefront_themes SET metadata = json_remove(COALESCE(metadata, '{}'), '$.starterTemplateVersion') WHERE id = '${scope!.themeId}'`,
  );
}

const upgradeNotice = (page: Page) =>
  page.locator("[data-editor-starter-upgrade]");

/** The author opens the review from the notice. */
async function openReview(page: Page) {
  await upgradeNotice(page)
    .getByRole("button", { name: "Review upgrade" })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Review the Starter upgrade",
  });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  return dialog;
}

/** Applies what the dialog shows, and waits for the apply to answer. */
async function applyReview(
  page: Page,
  dialog: Awaited<ReturnType<typeof openReview>>,
  label: RegExp,
) {
  const applied = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      isServerFunctionCall(response.url(), "applyStorefrontStarterUpgrade"),
    { timeout: 60_000 },
  );
  // Only the Starter part: the catalog, if it is waiting too, is the
  // catalog spec's to apply.
  const catalog = dialog.getByRole("checkbox", {
    name: "Apply the product catalog changes",
  });
  if ((await catalog.count()) > 0 && (await catalog.isChecked())) {
    await catalog.click();
  }
  await dialog.getByRole("button", { name: label }).click();
  const response = await applied;
  expect(response.ok()).toBe(true);
  // A refused apply still answers 200; the refusal is in the body.
  expect(await response.text()).not.toMatch(/"success":\s*false/);
  await expect(dialog).toBeHidden({ timeout: 30_000 });
}

/** Opening the editor. Since the reviewed upgrade, it upgrades nothing. */
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

test.describe("Starter upgrade, reviewed by the author", () => {
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
    // Back on the current version, as the specs after this one expect.
    setStarterVersion(STOREFRONT_STARTER_TEMPLATE_VERSION);
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

  test("D. the workspace marked older: opening writes nothing; applying the empty review records the version", async ({
    page,
  }) => {
    await openEditor(page);
    const before = await workspace(page);
    setStarterVersion(OLDER);
    await openEditor(page);
    expect(await workspace(page)).toEqual(before);
    expect(starterVersion()).toBe(OLDER);
    await expect(upgradeNotice(page)).toHaveAttribute(
      "data-editor-starter-upgrade",
      "available",
    );

    const dialog = await openReview(page);
    await expect(
      dialog
        .getByRole("region", { name: "Starter upgrade" })
        .getByRole("heading", { name: "Changes (0)" }),
    ).toBeVisible();
    await applyReview(page, dialog, /^Apply selected$/);
    expect(await workspace(page)).toEqual(before);
    expect(starterVersion()).toBe(STOREFRONT_STARTER_TEMPLATE_VERSION);

    await openEditor(page);
    await expect(
      page.locator('[data-editor-starter-upgrade="available"]'),
    ).toHaveCount(0);
  });

  test("B. the untouched pre-pages module on an older Starter: reviewed, then only content.ts is replaced, once", async ({
    page,
  }) => {
    await openEditor(page);
    await save(page, [
      {
        path: CONTENT_MODULE,
        content: LEGACY_STARTER_THEME_CONTENT_MODULE_V14_SOURCE,
      },
    ]);
    setStarterVersion(OLDER);
    const before = await workspace(page);

    // Opening writes nothing.
    await openEditor(page);
    expect(await workspace(page)).toEqual(before);
    expect(starterVersion()).toBe(OLDER);

    // The review shows the one change, with its text before and after.
    const dialog = await openReview(page);
    await expect(
      dialog
        .getByRole("region", { name: "Starter upgrade" })
        .getByRole("heading", { name: "Changes (1)" }),
    ).toBeVisible();
    const diff = dialog.getByLabel(`Changes to ${CONTENT_MODULE}`);
    await expect(diff).toBeVisible();
    await expect(diff).toContainText("+ ");
    await expect(diff).toContainText("- ");
    // Still nothing written while the author reads it.
    expect(await workspace(page)).toEqual(before);

    await applyReview(page, dialog, /^Apply selected$/);
    const after = await workspace(page);
    expect(after[CONTENT_MODULE]).toBe(STARTER_THEME_CONTENT_MODULE_SOURCE);
    expect({ ...after, [CONTENT_MODULE]: "" }).toEqual({
      ...before,
      [CONTENT_MODULE]: "",
    });
    for (const path of OLD_PATH_COMPONENTS) {
      expect(Object.keys(after)).not.toContain(path);
    }
    expect(starterVersion()).toBe(STOREFRONT_STARTER_TEMPLATE_VERSION);

    // A second load: no second replacement, no added file, no version write.
    await openEditor(page);
    expect(await workspace(page)).toEqual(after);
    expect(starterVersion()).toBe(STOREFRONT_STARTER_TEMPLATE_VERSION);

    const marker = `morph-b-${randomUUID()}`;
    await typeHeroMarker(page, marker);
    await expectLiveProbe(page, marker);
    // Build Preview needs containers. With the sidecar transport the Live
    // Preview half above is the whole test, and it reports as passed, not
    // as skipped after having run.
    if (CONTAINERS) await expectBuildPreview(page, marker, true);
  });

  test("E. a toolchain pin an earlier Starter wrote: refused by the build, built once the reviewed upgrade is applied", async ({
    page,
  }) => {
    test.skip(!CONTAINERS, "Builds run in containers.");
    await openEditor(page);
    const pkg = JSON.parse((await workspace(page))[PACKAGE]!);
    // What the Starter wrote between 2026-09-23 and 2026-10-03.
    pkg.devDependencies["@cloudflare/vite-plugin"] = "1.50.0";
    await save(page, [{ path: PACKAGE, content: JSON.stringify(pkg, null, 2) }]);

    // On the current version nothing offers to upgrade it.
    setStarterVersion(STOREFRONT_STARTER_TEMPLATE_VERSION);
    await openEditor(page);
    await build(page);
    const refused = latestBuild();
    expect(refused?.status).toBe("failed");
    expect(refused?.error_message ?? "").toContain("INVALID_START_PACKAGE");
    expect(refused?.error_message ?? "").toContain("@cloudflare/vite-plugin");

    setStarterVersion(OLDER);
    await openEditor(page);
    await applyReview(page, await openReview(page), /^Apply selected$/);
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

  test("C. the pre-pages module as the author edited it, on an older Starter: kept, said why, nothing written", async ({
    page,
  }) => {
    await openEditor(page);
    // The probe imports morph, which the pre-pages module does not export.
    const removed = await removeThemeFiles(page, scope!, [PROBE_ROUTE]);
    expect(removed.success, JSON.stringify(removed)).toBe(true);
    await save(page, [{ path: CONTENT_MODULE, content: EDITED_PRE_PAGES_MODULE }]);
    setStarterVersion(OLDER);
    const before = await workspace(page);

    await openEditor(page);
    expect(await workspace(page)).toEqual(before);

    const dialog = await openReview(page);
    const kept = dialog.locator('[data-kept-reason="changed"]', {
      hasText: CONTENT_MODULE,
    });
    await expect(kept).toBeVisible();
    await expect(kept).toContainText("formatting-only changes");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    expect(await workspace(page)).toEqual(before);
    expect(starterVersion()).toBe(OLDER);

    const marker = `morph-c-${randomUUID()}`;
    await typeHeroMarker(page, marker);
    // As in A and B: Live Preview only, unless containers run.
    if (CONTAINERS) await expectBuildPreview(page, marker, false);
  });

  test("P. a Theme that records no Starter version: pending, never the latest, and nothing written", async ({
    page,
  }) => {
    await openEditor(page);
    const before = await workspace(page);
    clearStarterVersion();

    await openEditor(page);
    await expect(upgradeNotice(page)).toHaveAttribute(
      "data-editor-starter-upgrade",
      "pending",
    );
    await expect(upgradeNotice(page)).toContainText(
      "does not record which Starter it came from",
    );
    expect(await workspace(page)).toEqual(before);
    expect(
      d1(
        `SELECT json_type(metadata, '$.starterTemplateVersion') AS type FROM storefront_themes WHERE id = '${scope!.themeId}'`,
      )[0]?.type ?? null,
    ).toBeNull();
  });

  test("Q. a Theme of unknown origin, upgraded in part: still pending, and the next review offers only what is left", async ({
    page,
  }) => {
    // Its own setup and clean-up: the content-fields/link group removed, the
    // content module an older Starter's, and no version recorded.
    const GROUP = ["src/morph/content-fields.ts", "src/morph/link.tsx"];
    await openEditor(page);
    const original = await workspace(page);
    for (const path of [...GROUP, CONTENT_MODULE]) {
      expect(original[path], path).toBeDefined();
    }
    try {
      const removed = await removeThemeFiles(page, scope!, GROUP);
      expect(removed.success, JSON.stringify(removed)).toBe(true);
      await save(page, [
        {
          path: CONTENT_MODULE,
          content: LEGACY_STARTER_THEME_CONTENT_MODULE_V14_SOURCE,
        },
      ]);
      clearStarterVersion();

      await openEditor(page);
      await expect(upgradeNotice(page)).toHaveAttribute(
        "data-editor-starter-upgrade",
        "pending",
      );
      let dialog = await openReview(page);
      let starter = dialog.getByRole("region", { name: "Starter upgrade" });
      await expect(
        starter.getByRole("button", { name: CONTENT_MODULE }),
      ).toBeVisible();
      for (const path of GROUP) {
        await expect(starter.getByRole("button", { name: path })).toHaveCount(
          0,
        );
        await expect(
          starter.locator('[data-kept-reason="origin-unknown"]', {
            hasText: path,
          }),
        ).toHaveCount(1);
      }
      await expect(starter).toContainText(
        "cannot tell whether you removed it",
      );
      await applyReview(page, dialog, /^Apply selected$/);

      // Applied in part: the version is still unrecorded, the notice stays
      // and says so, and the group was not added.
      await expect(upgradeNotice(page)).toHaveAttribute(
        "data-editor-starter-upgrade",
        "pending",
        { timeout: 30_000 },
      );
      await expect(upgradeNotice(page)).toContainText(
        "still does not record which Starter it came from",
      );
      expect(
        d1(
          `SELECT json_type(metadata, '$.starterTemplateVersion') AS type FROM storefront_themes WHERE id = '${scope!.themeId}'`,
        )[0]?.type ?? null,
      ).toBeNull();
      const applied = await workspace(page);
      expect(applied[CONTENT_MODULE]).not.toBe(
        LEGACY_STARTER_THEME_CONTENT_MODULE_V14_SOURCE,
      );
      for (const path of GROUP) expect(applied[path], path).toBeUndefined();

      // Opened again: still pending, and the review no longer offers the
      // content module, but still says why the group is not added.
      await openEditor(page);
      await expect(upgradeNotice(page)).toHaveAttribute(
        "data-editor-starter-upgrade",
        "pending",
      );
      dialog = await openReview(page);
      starter = dialog.getByRole("region", { name: "Starter upgrade" });
      await expect(
        starter.getByRole("button", { name: CONTENT_MODULE }),
      ).toHaveCount(0);
      await expect(starter).toContainText(
        "cannot tell whether you removed it",
      );
      for (const path of GROUP) {
        await expect(
          starter.locator('[data-kept-reason="origin-unknown"]', {
            hasText: path,
          }),
        ).toHaveCount(1);
      }
      expect(await workspace(page)).toEqual(applied);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    } finally {
      await openEditor(page);
      await save(page, [
        ...GROUP.map((path) => ({ path, content: original[path]! })),
        { path: CONTENT_MODULE, content: original[CONTENT_MODULE]! },
      ]);
      setStarterVersion(STOREFRONT_STARTER_TEMPLATE_VERSION);
    }
  });

  test("R. a Theme created without the Starter's new pages: offered unselected; the Header waits for them", async ({
    page,
  }) => {
    // Its own setup and clean-up: the Header 97e9474 wrote (no /account
    // link), both pages removed, and the version that commit recorded.
    const PAGES = ["src/routes/account.tsx", "src/routes/order-transfer.tsx"];
    const HEADER = "src/components/Header.tsx";
    const legacyHeader = (
      JSON.parse(
        readFileSync(
          "src/lib/storefront/__fixtures__/starter-history/v26-97e9474.json",
          "utf8",
        ),
      ) as { files: { path: string; content: string }[] }
    ).files.find((file) => file.path === HEADER)!.content;
    await openEditor(page);
    const original = await workspace(page);
    for (const path of [...PAGES, HEADER]) {
      expect(original[path], path).toBeDefined();
    }
    expect(original[HEADER]).toContain('href: "/account"');
    expect(legacyHeader).not.toContain('"/account"');
    const setUp = async () => {
      const removed = await removeThemeFiles(page, scope!, PAGES);
      expect(removed.success, JSON.stringify(removed)).toBe(true);
      await save(page, [{ path: HEADER, content: legacyHeader }]);
      setStarterVersion(26);
      await openEditor(page);
    };
    try {
      await setUp();
      let dialog = await openReview(page);
      let starter = dialog.getByRole("region", { name: "Starter upgrade" });
      const pages = starter.getByRole("checkbox", {
        name: "Add the Starter's new pages",
      });
      await expect(pages).not.toBeChecked();
      for (const path of PAGES) {
        await expect(
          starter.locator('[data-kept-reason="new-in-starter"]', {
            hasText: path,
          }),
        ).toHaveCount(1);
      }
      await expect(
        starter.locator('[data-kept-reason="needs-route"]', { hasText: HEADER }),
      ).toHaveCount(1);
      await expect(starter.getByRole("button", { name: HEADER })).toHaveCount(0);

      // Applied without them: neither is added, the Header is kept.
      await applyReview(page, dialog, /^Apply selected$/);
      let after = await workspace(page);
      for (const path of PAGES) expect(after[path], path).toBeUndefined();
      expect(after[HEADER]).toBe(legacyHeader);
      expect(starterVersion()).toBe(STOREFRONT_STARTER_TEMPLATE_VERSION);

      // Selected: both are added, and the Header updated with them.
      setStarterVersion(26);
      await openEditor(page);
      dialog = await openReview(page);
      starter = dialog.getByRole("region", { name: "Starter upgrade" });
      await starter
        .getByRole("checkbox", { name: "Add the Starter's new pages" })
        .click();
      for (const path of [...PAGES, HEADER]) {
        await expect(starter.getByRole("button", { name: path })).toBeVisible();
      }
      await applyReview(page, dialog, /^Apply selected$/);
      after = await workspace(page);
      for (const path of PAGES) expect(after[path], path).toBe(original[path]);
      expect(after[HEADER]).toBe(original[HEADER]);
      expect(starterVersion()).toBe(STOREFRONT_STARTER_TEMPLATE_VERSION);
    } finally {
      await openEditor(page);
      const now = await workspace(page);
      const restore = [...PAGES, HEADER]
        .filter((path) => now[path] !== original[path])
        .map((path) => ({ path, content: original[path]! }));
      if (restore.length > 0) await save(page, restore);
      setStarterVersion(STOREFRONT_STARTER_TEMPLATE_VERSION);
    }
  });
});
