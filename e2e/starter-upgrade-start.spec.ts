import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import {
  EDITOR_PATH,
  assertServerFnSuccess,
  isServerFunctionCall,
  previewFrame,
} from "./helpers";
import { execLocalD1 } from "./helpers/editor-writes-paused";
import {
  serverFn,
  signedInPage,
  THEMES,
} from "./native-acceptance";
import {
  removeThemeFiles,
  themeScopeFromEditorPath,
  uploadThemeBinary,
  writeThemeFiles,
} from "./native-compat";
import {
  LEGACY_STARTER_THEME_CONTENT_MODULE_V14_SOURCE,
  LEGACY_STARTER_THEME_CONTENT_MODULE_V31_SOURCE,
  STARTER_THEME_CONTENT_MODULE_SOURCE,
} from "../src/lib/storefront/starter-theme-v3-files";
import { STOREFRONT_STARTER_TEMPLATE_VERSION } from "../src/lib/storefront/default-storefront-document";
import { insertThrowawayTheme } from "./helpers/throwaway-theme";
import {
  LANE_CONTENT_MODULE,
  LANE_STARTER,
  CONTAINERS,
  STATE_DIR,
  scope,
  SERVER_FN_MODULE,
  CONTENT_MODULE,
  PACKAGE,
  PROBE_ROUTE,
  PROBE_FILE,
  OLD_PATH_COMPONENTS,
  UPLOADED_IMAGE,
  ONE_PIXEL_PNG,
  d1,
  setStarterVersion,
  starterVersion,
  workspace,
  save,
  OLDER,
  clearStarterVersion,
  upgradeNotice,
  openReview,
  applyReview,
  openEditor,
  typeHeroMarker,
  expectLiveProbe,
  expectBuildPreview,
} from "./helpers/starter-upgrade";

/**
 * The Starter upgrades that apply the current Starter, on the run's shared
 * editor Theme:
 *
 *   D. the workspace marked as an older Starter: opening writes no file and
 *      no version; the review lists no change, and applying it only records
 *      the version;
 *   B. the pre-pages content module, untouched, on an older Starter: opening
 *      changes nothing; the review lists content.ts with its text before and
 *      after; applying replaces only it, and a second load changes nothing;
 *   Q. a Theme of unknown origin, upgraded in part: still pending, and the
 *      next review offers only what is left;
 *   R. a Theme created before the Starter had its account and order-transfer
 *      pages: the review offers them unselected and holds back the Header
 *      that links to /account; applying without them adds neither and keeps
 *      the Header, and no notice asks again; the Command Palette reopens the
 *      review, which still offers them, and selecting them adds both and
 *      updates the Header;
 *
 * and, on a Theme of its own, an unrecorded Starter 31 Theme switched to Full
 * Start from the review and then upgraded to 32.
 *
 * From Starter 32 the current Starter's content module needs the full Start
 * preview, so an upgrade that applies it is refused on a client-lane Theme
 * (the pinned Starter 31 workspace, recording no runtime) by design. This
 * file is therefore assigned to the full Start job as a whole
 * (LANE_EXCLUSIVE_SPECS in scripts/editor-e2e-shards.mjs, START_PREVIEW_SHARDS
 * in scripts/editor-e2e-start.mjs) and is not on the client shards. The cases
 * both lanes run (A, C, P) and E are starter-upgrade.spec.ts.
 *
 * The workspace is shared with the specs that run after this one, so the
 * state it changes is put back afterwards.
 */

test.skip(
  !EDITOR_PATH || !STATE_DIR,
  "Set E2E_EDITOR_PATH, or run through scripts/run-editor-e2e.mjs.",
);

test.describe("Starter upgrade, reviewed by the author", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(CONTAINERS ? 25 * 60_000 : 6 * 60_000);

  let original: Record<string, string> = {};

  test.beforeAll(async ({ browser }) => {
    const page = await signedInPage(browser);
    await openEditor(page);
    original = await workspace(page);
    expect(original[CONTENT_MODULE]).toBe(LANE_CONTENT_MODULE);
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
    // Back on the lane's version, as the specs after this one (and, on the
    // client lane, its guard) expect.
    setStarterVersion(LANE_STARTER);
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
      // The probe the Live Preview check below reads. A saves it in
      // starter-upgrade.spec.ts; B saves its own, as this file runs apart.
      PROBE_FILE,
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
      setStarterVersion(LANE_STARTER);
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

      // Reopened: on the current Starter no Starter notice asks again (the
      // product catalog keeps its own notice when the store has products),
      // but the Command Palette opens the same review, which still offers
      // them and does not say they were removed.
      await openEditor(page);
      await expect(
        page.locator(
          '[data-editor-starter-upgrade="available"], [data-editor-starter-upgrade="pending"]',
        ),
      ).toHaveCount(0);
      await page.getByRole("button", { name: "Code", exact: true }).click();
      await page.getByTitle("Command Palette (Ctrl+Shift+P)").click();
      await page
        .getByRole("option", { name: /Theme: Review Starter Upgrade/ })
        .click();
      dialog = page.getByRole("dialog", { name: "Review the Starter upgrade" });
      await expect(dialog).toBeVisible({ timeout: 30_000 });
      starter = dialog.getByRole("region", { name: "Starter upgrade" });
      for (const path of PAGES) {
        await expect(
          starter.locator('[data-kept-reason="new-in-starter"]', {
            hasText: path,
          }),
        ).toHaveCount(1);
        await expect(
          starter.locator('[data-kept-reason="missing"]', { hasText: path }),
        ).toHaveCount(0);
      }
      // The Starter part has nothing to apply until the pages are selected.
      // The catalog, if it is waiting too, is the catalog spec's to apply.
      const catalog = dialog.getByRole("checkbox", {
        name: "Apply the product catalog changes",
      });
      if ((await catalog.count()) > 0 && (await catalog.isChecked())) {
        await catalog.click();
      }
      await expect(
        dialog.getByRole("button", { name: /^Apply selected$/ }),
      ).toBeDisabled();

      // Selected: both are added, and the Header updated with them.
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
      setStarterVersion(LANE_STARTER);
    }
  });
});

/**
 * An unrecorded Starter 31 Theme, upgraded to 32 through the review, on the
 * full Start lane. Starter 32's content module reads through a server
 * function, so the server applies it only to a Theme that records `start`
 * (STARTER_UPGRADE_START_PREVIEW_REQUIRED, nothing written otherwise). The
 * review says so before Apply and blocks Apply; its "Switch Live Preview to
 * Full Start" records the runtime through the editor's own compare-and-set
 * and changes nothing else; Apply is then the author's separate action.
 *
 * Its own Theme: provisioned with the current Starter (recording start, as
 * the editor requires for that), then made what a Theme created before 32
 * is: Starter 31's content module, Starter 31 recorded, no runtime recorded.
 * Only the content module differs between the two Starters' workspaces
 * (starter-workspace-v31.test.ts).
 */
test.describe("an unrecorded Starter 31 Theme upgraded through the review", () => {
  const PREVIEW_SERVER =
    "/src/server/storefront/storefront-theme-preview-server.serverFn.ts";

  test("explains Full Start before Apply; the switch changes no file, version or content; Apply then records 32 and renders it", async ({
    page,
  }) => {
    test.setTimeout(6 * 60_000);
    const own = {
      ...themeScopeFromEditorPath(EDITOR_PATH!),
      themeId: randomUUID(),
    };
    const row = () =>
      d1(
        `SELECT preview_runtime, json_extract(metadata, '$.starterTemplateVersion') AS version FROM storefront_themes WHERE id = '${own.themeId}'`,
      )[0] as { preview_runtime: string | null; version: number } | undefined;
    const callServer = async (module: string, name: string, data: unknown) =>
      (await serverFn(page, module, name, data)) as {
        success: boolean;
        message?: string;
        data?: any;
      };
    const filesOf = async () => {
      const listed = await callServer(SERVER_FN_MODULE, "listStorefrontThemeFiles", own);
      expect(listed.success, listed.message).toBe(true);
      return Object.fromEntries(
        (listed.data.files as { path: string; content: string }[]).map(
          (file) => [file.path, file.content],
        ),
      );
    };
    const documentsOf = async () => {
      const editor = await callServer(THEMES, "getStorefrontThemeEditor", own);
      expect(editor.success, editor.message).toBe(true);
      return Object.fromEntries(
        (editor.data.templates as { id: string; document: unknown }[]).map(
          (template) => [template.id, template.document],
        ),
      );
    };

    insertThrowawayTheme({
      themeId: own.themeId,
      storefrontId: own.storefrontId,
      name: `upgrade-start-${own.themeId}`,
      previewRuntime: "start",
      // An empty row, for the editor to provision the current Starter into.
      rowOnly: true,
    });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const provisioned = await callServer(THEMES, "getStorefrontThemeEditor", own);
    expect(provisioned.success, provisioned.message).toBe(true);
    const home = (provisioned.data.templates as { id: string; type: string }[]).find(
      (template) => template.type === "index",
    )!;
    expect((await filesOf())[CONTENT_MODULE]).toBe(STARTER_THEME_CONTENT_MODULE_SOURCE);

    // What a Theme created from Starter 31 holds: its module, its version,
    // and no recorded runtime.
    const saved = await writeThemeFiles(page, own, [
      { path: CONTENT_MODULE, content: LEGACY_STARTER_THEME_CONTENT_MODULE_V31_SOURCE },
    ]);
    expect(saved.success, JSON.stringify(saved)).toBe(true);
    execLocalD1(
      `UPDATE storefront_themes SET metadata = json_set(COALESCE(metadata, '{}'), '$.starterTemplateVersion', 31) WHERE id = '${own.themeId}'`,
    );
    const cleared = await callServer(PREVIEW_SERVER, "setThemePreviewRuntime", {
      ...own,
      previewRuntime: null,
      expectedPreviewRuntime: "start",
    });
    expect(cleared.success, cleared.message).toBe(true);
    expect(row()).toEqual({ preview_runtime: null, version: 31 });
    const filesBefore = await filesOf();
    const documentsBefore = await documentsOf();

    const applies: string[] = [];
    page.on("request", (request) => {
      if (isServerFunctionCall(request.url(), "applyStorefrontStarterUpgrade")) {
        applies.push(request.url());
      }
    });
    await page.goto(
      `/store/${own.storefrontId}/themes/${own.themeId}/editor?templateId=${home.id}`,
      { waitUntil: "domcontentloaded" },
    );
    await expect(page.getByRole("button", { name: /^Publish$/ })).toBeVisible({
      timeout: 45_000,
    });
    await page.waitForTimeout(4_000);

    // 1. The review says so before Apply, and Apply is blocked.
    const dialog = await openReview(page);
    const requirement = dialog.getByRole("alert");
    await expect(requirement).toContainText(
      "This upgrade needs the full Start Live Preview.",
    );
    await expect(requirement).toContainText(CONTENT_MODULE);
    const apply = dialog.getByRole("button", { name: /^Apply selected$/ });
    await expect(apply).toBeDisabled();

    // 2. The switch records Full Start and changes nothing else.
    const switched = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        isServerFunctionCall(response.url(), "setThemePreviewRuntime"),
      { timeout: 60_000 },
    );
    await dialog
      .getByRole("button", { name: "Switch Live Preview to Full Start" })
      .click();
    assertServerFnSuccess(await (await switched).text());
    await expect(dialog.getByRole("alert")).toHaveCount(0, { timeout: 30_000 });
    await expect(apply).toBeEnabled();
    expect(row()).toEqual({ preview_runtime: "start", version: 31 });
    expect(await filesOf()).toEqual(filesBefore);
    expect(await documentsOf()).toEqual(documentsBefore);
    expect(applies, "switching applies nothing").toEqual([]);

    // 3. Applying is the author's own action: Starter 32 is recorded and runs.
    await applyReview(page, dialog, /^Apply selected$/);
    expect(applies).toHaveLength(1);
    expect(row()).toEqual({ preview_runtime: "start", version: 32 });
    expect((await filesOf())[CONTENT_MODULE]).toBe(STARTER_THEME_CONTENT_MODULE_SOURCE);
    await page.goto(
      `/store/${own.storefrontId}/themes/${own.themeId}/editor?templateId=${home.id}`,
      { waitUntil: "domcontentloaded" },
    );
    await expect(
      previewFrame(page).locator('[data-storefront-section-id="starter-hero"]'),
    ).toBeVisible({ timeout: 120_000 });
  });
});
