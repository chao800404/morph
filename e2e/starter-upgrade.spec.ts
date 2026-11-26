import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { EDITOR_PATH } from "./helpers";
import { signedInPage } from "./native-acceptance";
import {
  removeThemeFiles,
  uploadThemeBinary,
} from "./native-compat";
import { STOREFRONT_STARTER_TEMPLATE_VERSION } from "../src/lib/storefront/default-storefront-document";
import {
  LANE_CONTENT_MODULE,
  LANE_STARTER,
  CONTAINERS,
  STATE_DIR,
  scope,
  CONTENT_MODULE,
  PACKAGE,
  PROBE_ROUTE,
  PROBE_FILE,
  UPLOADED_IMAGE,
  ONE_PIXEL_PNG,
  EDITED_PRE_PAGES_MODULE,
  d1,
  setStarterVersion,
  starterVersion,
  latestBuild,
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
  build,
  expectBuildPreview,
} from "./helpers/starter-upgrade";

/**
 * The Starter upgrade on the workspace the editor provisions, the way an
 * author meets it: opening the editor changes nothing and says an upgrade is
 * available; the author reviews it and applies it, or does not.
 *
 *   A. a new Starter: Live Preview shows a value typed in Design, and a route
 *      calling morph.pages.get reads it;
 *   E. a toolchain pin an earlier Starter wrote: the build refuses it, and
 *      builds once the reviewed upgrade brings it forward (containers only);
 *   C. the pre-pages module as the author edited it, on an older Starter: the
 *      review keeps it and says why; cancelling writes nothing;
 *   P. a Theme that records no Starter version: shown as pending, never as
 *      the latest, and opening writes nothing.
 *
 * Markers are random, so no component default can produce them. With the
 * container transport each case also builds and checks the isolated Build
 * Preview reads the build's sealed snapshot.
 *
 * The workspace is shared with the specs that run after this one, so the
 * state it changes is put back afterwards.
 *
 * Where each case runs. A, C and P apply nothing of the current Starter
 * and run on both lanes, the client lane against Starter 31's module and
 * version. E needs containers. The cases that apply the current Starter (D,
 * B, Q and R), whose content module needs the full Start preview from
 * Starter 32, are starter-upgrade-start.spec.ts, which only the full Start
 * job runs.
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

  test("E. a toolchain pin an earlier Starter wrote: refused by the build, built once the reviewed upgrade is applied", async ({
    page,
  }) => {
    test.skip(!CONTAINERS, "Builds run in containers.");
    await openEditor(page);
    const files = await workspace(page);
    const pkg = JSON.parse(files[PACKAGE]!);
    // What the Starter wrote between 2026-09-23 and 2026-10-03.
    pkg.devDependencies["@cloudflare/vite-plugin"] = "1.50.0";
    await save(page, [
      // The probe the Build Preview check reads. A saves it too; E saves its
      // own so it also runs alone, as the container job runs it.
      ...(files[PROBE_ROUTE] === PROBE_FILE.content ? [] : [PROBE_FILE]),
      { path: PACKAGE, content: JSON.stringify(pkg, null, 2) },
    ]);

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
});
