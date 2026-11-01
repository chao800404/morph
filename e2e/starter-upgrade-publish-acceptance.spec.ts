import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { queryLifecycleD1 } from "../scripts/verify-published-artifact.mjs";
import { STOREFRONT_STARTER_TEMPLATE_VERSION } from "../src/lib/storefront/default-storefront-document";
import {
  EDITOR_PATH,
  assertServerFnSuccess,
  isServerFunctionCall,
  previewFrame,
} from "./helpers";
import {
  DOMAINS,
  RELEASES,
  editHero,
  latestRelease,
  openEditor,
  publishShowingRelease,
  savedField,
  serverFn,
  signedInPage,
  storefrontFetcher,
  storefrontHarness,
  type Fetcher,
} from "./native-acceptance";
import {
  removeThemeFiles,
  themeScopeFromEditorPath,
  writeThemeFiles,
} from "./native-compat";

/**
 * T1: a Theme created from an old Starter, upgraded the way its author does
 * it, then built, published and rolled back on the container transport.
 *
 * Each old workspace is the fixture under
 * `src/lib/storefront/__fixtures__/starter-history/`, byte for byte as that
 * Starter version created it; the unit tests (`starter-history-upgrade.test.ts`)
 * hold the upgrade's plan for each. Here the plan is not computed or written
 * by the test: the editor's review lists it and its apply writes it.
 *
 *   v28 (source-first, current toolchain pins): the old workspace builds, so
 *       the store publishes Release R0 from v28's own bytes. The review lists
 *       the one file v29 changed; after it is applied the workspace is the
 *       current Starter. A new build is published as R1; the home page and a
 *       non-home route render, a draft edit does not leak, and rolling back
 *       to R0 serves R0's build and content again.
 *   v20 (manifest era, flat components, stale toolchain pins): the old
 *       workspace's build is refused (INVALID_START_PACKAGE) and the live site
 *       stays on the release it had. The review brings the pins, Header,
 *       Footer, the section entries and the routes forward; the upgraded
 *       workspace builds and is published, with the same public checks.
 *       Rollback, narrowly: after the upgrade is published, the site can
 *       return to the release that was serving before the upgrade. That
 *       release is a baseline the v20 test publishes itself, from the current
 *       Starter, before it installs v20's files. Restoring v20's own original
 *       artifact stays UNVERIFIED: a v20 workspace cannot be built here before
 *       its upgrade, so no release of v20's own bytes can exist.
 *
 * The two tests do not depend on each other: each sets up its own
 * preconditions (v28: nothing published yet on this run's D1; v20: its own
 * baseline release and domain), they are not serial, and either runs alone
 * with `-g` on its title.
 *
 * v28 and v20 bracket the two shapes an upgrade meets: a Starter whose pins
 * still build, and one the build refuses until the upgrade fixes them. v11,
 * v15 and v26 share v20's shape (manifest, flat components, stale pins), and
 * their plans are held by the unit tests.
 *
 * Containers only: the build, the publish and the release are the container
 * transport's. The run's own D1 and R2, through the harness, as
 * m1-container-lifecycle-acceptance.spec.ts reads them.
 */

const STATE_DIR = process.env.MORPH_E2E_STATE_DIR;
const TRANSPORT = process.env.E2E_EXPECT_PREVIEW_TRANSPORT;

test.skip(
  !EDITOR_PATH || !STATE_DIR,
  "Run through scripts/run-editor-e2e.mjs: this reads the run's own D1 and R2.",
);
test.skip(
  TRANSPORT !== "cloudflare-sandbox",
  "Builds and publishes run in containers (MORPH_E2E_TRANSPORT=cloudflare-sandbox).",
);

const scope = EDITOR_PATH ? themeScopeFromEditorPath(EDITOR_PATH) : null;
/** One storefront hostname per test, so neither reuses the other's domain. */
const HOSTS = { v28: "t1-v28.localhost", v20: "t1-v20.localhost" } as const;
const SERVER_FN_MODULE =
  "/src/server/storefront/storefront-theme-files.serverFn.ts";
const PACKAGE = "package.json";
const LAYOUT = "src/layouts/StorefrontLayout.tsx";
const MANIFEST = "morph.theme.json";
/** A Starter route that is not the home page. */
const OTHER_ROUTE = "/order-transfer";
/** The route's own heading, rendered on the server. */
const OTHER_ROUTE_HEADING = "訂單轉移確認";

type Fixture = {
  starterVersion: number;
  files: { path: string; content: string }[];
};

function fixture(version: number): Fixture {
  const loaded = JSON.parse(
    readFileSync(
      join(
        process.cwd(),
        "src/lib/storefront/__fixtures__/starter-history",
        `v${version}.json`,
      ),
      "utf8",
    ),
  ) as Fixture;
  expect(loaded.starterVersion).toBe(version);
  return loaded;
}

const V28 = fixture(28);
const V20 = fixture(20);
/**
 * The Starter's own paths. v28 has exactly the current Starter's (the unit
 * test "v28 is the current Starter apart from the one file version 29
 * changed").
 */
const STARTER_PATHS = V28.files.map((file) => file.path);
const FLAT_COMPONENTS = [
  "CategoryShowcase",
  "EditorialIntro",
  "Hero",
  "ImageWithText",
  "Newsletter",
  "Principles",
].map((name) => `src/components/${name}.tsx`);
const SECTION_REEXPORTS = FLAT_COMPONENTS.map((path) =>
  path.replace("src/components/", "src/components/sections/"),
);

/** Every text file, path → content. */
async function workspace(page: Page): Promise<Record<string, string>> {
  return page.evaluate(
    async ({ module, scope }) => {
      const fns = await import(/* @vite-ignore */ module);
      const listed = await fns.listStorefrontThemeFiles({ data: scope });
      if (!listed?.success) throw new Error("Theme files could not be listed.");
      return Object.fromEntries(
        (listed.data.files as { path: string; content: string }[]).map(
          (file) => [file.path, file.content],
        ),
      );
    },
    { module: SERVER_FN_MODULE, scope: scope! },
  );
}

const upgradeNotice = (page: Page) =>
  page.locator("[data-editor-starter-upgrade]");

/** The author opens the review from the notice. */
async function openReview(page: Page) {
  await expect(upgradeNotice(page)).toHaveAttribute(
    "data-editor-starter-upgrade",
    "available",
    { timeout: 30_000 },
  );
  await upgradeNotice(page)
    .getByRole("button", { name: "Review upgrade" })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Review the Starter upgrade",
  });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  return dialog;
}

/**
 * Applies the Starter part the dialog shows and waits for the apply to
 * answer. The product catalog, offered beside it on a store with products,
 * is left out: it is not part of the Starter upgrade.
 */
async function applyReview(
  page: Page,
  dialog: Awaited<ReturnType<typeof openReview>>,
) {
  const applied = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      isServerFunctionCall(response.url(), "applyStorefrontStarterUpgrade"),
    { timeout: 60_000 },
  );
  const catalog = dialog.getByRole("checkbox", {
    name: "Apply the product catalog changes",
  });
  if ((await catalog.count()) > 0 && (await catalog.isChecked())) {
    await catalog.click();
  }
  await expect(
    dialog.getByRole("checkbox", { name: "Apply the Starter upgrade" }),
  ).toBeChecked();
  await dialog.getByRole("button", { name: /^Apply selected$/ }).click();
  const response = await applied;
  expect(response.ok()).toBe(true);
  // A refused apply still answers 200; the refusal is in the body.
  assertServerFnSuccess(await response.text());
  await expect(dialog).toBeHidden({ timeout: 30_000 });
}

/** Opens the editor and waits for the canvas to show the home hero. */
async function openEditorWithHero(page: Page) {
  await openEditor(page);
  await expect(
    previewFrame(page).locator('[data-storefront-section-id="starter-hero"]'),
    "the Live Preview renders the home hero",
  ).toBeVisible({ timeout: 180_000 });
}

/** Types `marker` into the hero and waits for the draft to hold it. */
async function editHeroDraft(page: Page, marker: string) {
  await openEditorWithHero(page);
  await editHero(page, marker);
  await savedField(page, scope!, marker);
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

test.describe("Starter upgrade from history, built, published and rolled back", () => {
  // Not serial: a failed v28 test must not skip the v20 test, which sets up
  // its own baseline. After a failure Playwright runs afterAll, starts a new
  // worker and runs beforeAll again, which is why both restore and re-read.
  test.setTimeout(30 * 60_000);
  test.use({ actionTimeout: 60_000 });

  const harness = STATE_DIR
    ? storefrontHarness({ scope: scope!, stateDir: STATE_DIR })
    : null;
  /** Domains this worker created, removed by afterAll. */
  const domainIds: string[] = [];
  /** The workspace the editor provisioned: the current Starter. */
  let original: Record<string, string> = {};

  const queryD1 = (sql: string, ...params: unknown[]) =>
    queryLifecycleD1(STATE_DIR!, sql, ...params);

  function starterVersion() {
    const [row] = queryD1(
      "SELECT json_extract(metadata, '$.starterTemplateVersion') AS version FROM storefront_themes WHERE id = ?1",
      scope!.themeId,
    );
    return row?.version;
  }

  async function setStarterVersion(version: number) {
    expect(
      await harness!.writeD1(
        "UPDATE storefront_themes SET metadata = json_set(COALESCE(metadata, '{}'), '$.starterTemplateVersion', ?1) WHERE id = ?2",
        Number(version),
        scope!.themeId,
      ),
    ).toBe(1);
  }

  function latestBuild() {
    const [row] = queryD1(
      "SELECT id, status, error_message FROM storefront_theme_builds WHERE theme_id = ?1 ORDER BY created_at DESC LIMIT 1",
      scope!.themeId,
    );
    return row as
      | { id: string; status: string; error_message: string | null }
      | undefined;
  }

  function releaseSource(releaseId: string) {
    const [row] = queryD1(
      "SELECT source_revision_id FROM storefront_releases WHERE id = ?1",
      releaseId,
    );
    return row?.source_revision_id as string | undefined;
  }

  /**
   * Puts an old Starter's files in place of the Starter's own paths, through
   * the server function Code mode saves with, and records its version. Files
   * outside the Starter's paths (the catalog's, if any) are left alone.
   */
  async function installStarter(page: Page, old: Fixture) {
    const current = await workspace(page);
    const changed = old.files.filter(
      (file) => current[file.path] !== file.content,
    );
    const saved = await writeThemeFiles(page, scope!, changed);
    expect(saved.success, JSON.stringify(saved)).toBe(true);
    const oldPaths = new Set(old.files.map((file) => file.path));
    const removed = await removeThemeFiles(
      page,
      scope!,
      STARTER_PATHS.filter((path) => !oldPaths.has(path)),
    );
    expect(removed.success, JSON.stringify(removed)).toBe(true);
    await setStarterVersion(old.starterVersion);
    const installed = await workspace(page);
    for (const file of old.files) {
      expect(installed[file.path], file.path).toBe(file.content);
    }
    for (const path of STARTER_PATHS.filter((path) => !oldPaths.has(path))) {
      expect(installed[path], path).toBeUndefined();
    }
    expect(starterVersion()).toBe(old.starterVersion);
  }

  /** Opening the editor on the old workspace writes nothing. */
  async function expectOpeningWritesNothing(page: Page, version: number) {
    const before = await workspace(page);
    await openEditor(page);
    await expect(upgradeNotice(page)).toHaveAttribute(
      "data-editor-starter-upgrade",
      "available",
      { timeout: 30_000 },
    );
    expect(await workspace(page)).toEqual(before);
    expect(starterVersion()).toBe(version);
  }

  /** Reviews and applies the upgrade, checking the review wrote nothing. */
  async function reviewAndApply(page: Page, listed: string[]) {
    await openEditor(page);
    const before = await workspace(page);
    const dialog = await openReview(page);
    const starter = dialog.getByRole("region", { name: "Starter upgrade" });
    const heading = starter.getByRole("heading", { name: /^Changes \(\d+\)$/ });
    await expect(heading).toBeVisible();
    expect(
      Number(/\((\d+)\)/.exec((await heading.textContent()) ?? "")?.[1]),
    ).toBeGreaterThan(0);
    for (const path of listed) {
      await expect(
        starter.getByRole("button", { name: path }),
        `the review lists ${path}`,
      ).toBeVisible();
    }
    // Nothing is written while the author reads it.
    expect(await workspace(page)).toEqual(before);
    await applyReview(page, dialog);
    expect(starterVersion()).toBe(STOREFRONT_STARTER_TEMPLATE_VERSION);
    return { before, after: await workspace(page) };
  }

  /** The Starter's paths that are missing, or differ from the current Starter. */
  function againstCurrent(files: Record<string, string>) {
    return {
      differs: STARTER_PATHS.filter(
        (path) => path in files && files[path] !== original[path],
      ).sort(),
      missing: STARTER_PATHS.filter((path) => !(path in files)).sort(),
    };
  }

  /** Publishes from the toolbar; the release, its build and content. */
  async function publishRelease(page: Page) {
    const shown = await publishShowingRelease(page);
    await shown.close();
    const releaseId = await latestRelease(page, scope!);
    const built = await harness!.releaseBuild(releaseId);
    expect(built.buildId, "the release names its build").toBeTruthy();
    expect(built.releaseContent, "the release names its content").toBeTruthy();
    return { releaseId, ...built };
  }

  /**
   * The public site as the active release serves it: the home page with the
   * content it published, a non-home route, and none of `absent`.
   */
  async function expectPublicSite(
    storefront: Fetcher,
    marker: string,
    absent: string[],
  ) {
    const home = await storefront("/");
    expect(home.status).toBe(200);
    expect(home.body).toContain(marker);
    const content = await storefront("/_morph/content?path=%2F");
    expect(content.status).toBe(200);
    expect(content.body).toContain(marker);
    const other = await storefront(OTHER_ROUTE);
    expect(other.status, `${OTHER_ROUTE} renders`).toBe(200);
    expect(other.body).toContain(OTHER_ROUTE_HEADING);
    for (const text of absent) {
      expect(home.body).not.toContain(text);
      expect(content.body).not.toContain(text);
      expect(other.body).not.toContain(text);
    }
    const asset = /(?:href|src)="(\/assets\/[^"]+)"/.exec(home.body);
    expect(asset, "the home page links a built asset").not.toBeNull();
    expect((await storefront(asset![1]!)).status).toBe(200);
  }

  /** Rolls the active release back to `release` under its OCC. */
  async function rollBack(page: Page, releaseId: string, from: string) {
    const activated = (await serverFn(
      page,
      RELEASES,
      "activateStorefrontRelease",
      {
        storefrontId: scope!.storefrontId,
        releaseId,
        expectedActiveReleaseId: from,
      },
    )) as { success: boolean; message?: string };
    expect(activated.success, activated.message).toBe(true);
    expect((await harness!.publishedState()).active).toBe(releaseId);
  }

  const origin = (host: string) =>
    `http://${host}:${new URL(test.info().project.use.baseURL!).port}`;

  /** Puts the Starter's paths back as the editor provisioned them. */
  async function restoreCurrentStarter(page: Page) {
    const now = await workspace(page);
    const back = STARTER_PATHS.filter((path) => now[path] !== original[path]);
    // Nothing to write when nothing moved; an empty batch is not sent.
    const restored = back.length
      ? await writeThemeFiles(
          page,
          scope!,
          back.map((path) => ({ path, content: original[path]! })),
        )
      : { success: true };
    expect(restored.success, JSON.stringify(restored)).toBe(true);
    const removed = await removeThemeFiles(
      page,
      scope!,
      Object.keys(now).filter((path) => !(path in original)),
    );
    expect(removed.success, JSON.stringify(removed)).toBe(true);
    await setStarterVersion(STOREFRONT_STARTER_TEMPLATE_VERSION);
    expect(await workspace(page)).toEqual(original);
  }

  /** Connects `host` to the store, for the public checks. */
  async function connectDomain(page: Page, host: string) {
    const domain = (await serverFn(page, DOMAINS, "createStorefrontDomain", {
      storefrontId: scope!.storefrontId,
      hostname: host,
    })) as { success: boolean; message?: string; data?: { id: string } };
    expect(domain.success, domain.message).toBe(true);
    domainIds.push(domain.data!.id);
  }

  test.beforeAll(async ({ browser }) => {
    const page = await signedInPage(browser);
    try {
      await openEditor(page);
      original = await workspace(page);
      expect(starterVersion()).toBe(STOREFRONT_STARTER_TEMPLATE_VERSION);
      // Equal to the current Starter, apart from the layout v29 changed.
      for (const file of V28.files) {
        if (file.path === LAYOUT) {
          expect(original[file.path], file.path).not.toBe(file.content);
        } else {
          expect(original[file.path], file.path).toBe(file.content);
        }
      }
    } finally {
      await page.context().close();
    }
  });

  test.afterAll(async ({ browser }) => {
    const page = await signedInPage(browser);
    try {
      // Back to the current Starter, as the editor provisioned it.
      await openEditor(page);
      await restoreCurrentStarter(page);
      for (const domainId of domainIds.splice(0)) {
        // As m1-container-lifecycle-acceptance.spec.ts: the local stand-in
        // domain has no Cloudflare custom domain, and a primary domain cannot
        // be deleted, so the row is made deletable first.
        await harness!.writeD1(
          "UPDATE storefront_domains SET is_primary = 0, cloudflare_domain_id = NULL WHERE id = ?1",
          domainId,
        );
        const deleted = (await serverFn(
          page,
          DOMAINS,
          "deleteStorefrontDomains",
          { ids: [domainId] },
        )) as { success: boolean; message?: string };
        expect(deleted.success, deleted.message).toBe(true);
      }
    } finally {
      await page.context().close();
      await harness?.dispose();
    }
  });

  test("v28: published from its own bytes, upgraded by review, published again, rolled back", async ({
    page,
  }) => {
    const host = HOSTS.v28;
    const storefront = storefrontFetcher(origin(host));
    // Precondition: this run's D1, with nothing published yet, and the
    // workspace as the editor provisioned it.
    const before = await harness!.publishedState();
    expect(
      before.active,
      "v28 precondition: nothing is published on this run's D1",
    ).toBeNull();
    await openEditor(page);
    await restoreCurrentStarter(page);

    await installStarter(page, V28);
    await expectOpeningWritesNothing(page, 28);

    // R0: published from v28's own bytes.
    const contentA = `t1-v28-a-${randomUUID().slice(0, 8)}`;
    await editHeroDraft(page, contentA);
    await connectDomain(page, host);
    // Before any publish, the domain serves nothing, and not the draft.
    const unpublished = await storefront("/");
    expect(unpublished.status).toBe(404);
    expect(unpublished.body).not.toContain(contentA);

    const r0 = await publishRelease(page);
    const r0Source = releaseSource(r0.releaseId);
    expect(r0Source).toBeTruthy();
    const served0 = await harness!.serveActiveRelease(
      contentA,
      r0.releaseId,
      origin(host),
    );
    expect(served0.buildId).toBe(r0.buildId);
    await expectPublicSite(storefront, contentA, []);

    // The reviewed upgrade: the one file v29 changed.
    const { after } = await reviewAndApply(page, [LAYOUT]);
    expect(againstCurrent(after)).toEqual({ differs: [], missing: [] });
    // The home Document was not reset: the draft still holds R0's content.
    await savedField(page, scope!, contentA);
    await openEditor(page);
    await expect(
      page.locator('[data-editor-starter-upgrade="available"]'),
    ).toHaveCount(0);

    // R1: a new build of the upgraded source.
    const contentB = `t1-v28-b-${randomUUID().slice(0, 8)}`;
    await editHeroDraft(page, contentB);
    const r1 = await publishRelease(page);
    expect(r1.releaseId).not.toBe(r0.releaseId);
    expect(r1.buildId, "the upgraded source is built again").not.toBe(
      r0.buildId,
    );
    // serveActiveRelease below refuses a release whose build did not succeed.
    const r1Source = releaseSource(r1.releaseId);
    expect(r1Source).toBeTruthy();
    expect(r1Source).not.toBe(r0Source);
    await harness!.serveActiveRelease(contentB, r1.releaseId, origin(host));
    await expectPublicSite(storefront, contentB, [contentA]);

    // A draft edit after the publish stays out of the public site.
    const draftD = `t1-v28-d-${randomUUID().slice(0, 8)}`;
    await editHeroDraft(page, draftD);
    await expectPublicSite(storefront, contentB, [contentA, draftD]);

    // Rolled back to R0, built from v28's own bytes: its own build, content
    // and source again.
    await rollBack(page, r0.releaseId, r1.releaseId);
    const restored = await harness!.serveActiveRelease(
      contentA,
      r0.releaseId,
      origin(host),
    );
    expect(restored.buildId).toBe(r0.buildId);
    expect(restored.contentPublicationId).toBe(r0.releaseContent);
    expect(restored.sourceRevisionId).toBe(r0Source);
    await expectPublicSite(storefront, contentA, [contentB, draftD]);
  });

  test("v20: refused until upgraded by review, then published; the site can return to the release serving before the upgrade", async ({
    page,
  }) => {
    const host = HOSTS.v20;
    const storefront = storefrontFetcher(origin(host));

    // Precondition, established here and by no other test: a release that
    // is serving before the upgrade. Built and published from the current
    // Starter, which builds, because v20's own bytes cannot be built before
    // the upgrade. So the rollback below returns to this baseline; restoring
    // an artifact of v20's own bytes stays unverified.
    await openEditor(page);
    await restoreCurrentStarter(page);
    await connectDomain(page, host);
    const baselineMarker = `t1-v20-base-${randomUUID().slice(0, 8)}`;
    await editHeroDraft(page, baselineMarker);
    const baseline = await publishRelease(page);
    const baselineSource = releaseSource(baseline.releaseId);
    expect(
      baselineSource,
      "v20 precondition: the baseline release names its source",
    ).toBeTruthy();
    const servedBaseline = await harness!.serveActiveRelease(
      baselineMarker,
      baseline.releaseId,
      origin(host),
    );
    expect(servedBaseline.buildId).toBe(baseline.buildId);
    expect(
      (await harness!.publishedState()).active,
      "v20 precondition: the baseline release is the one serving",
    ).toBe(baseline.releaseId);
    await expectPublicSite(storefront, baselineMarker, []);

    await installStarter(page, V20);
    await expectOpeningWritesNothing(page, 20);

    // The old workspace's pins are refused by the build; the live site stays
    // on the baseline.
    const releasesBefore = (await harness!.publishedState()).releases;
    await build(page);
    const refused = latestBuild();
    expect(refused?.status).toBe("failed");
    expect(refused?.error_message ?? "").toContain("INVALID_START_PACKAGE");
    const unchanged = await harness!.publishedState();
    expect(unchanged.active).toBe(baseline.releaseId);
    expect(unchanged.releases).toBe(releasesBefore);
    await expectPublicSite(storefront, baselineMarker, []);

    // The reviewed upgrade.
    const { after } = await reviewAndApply(page, [
      PACKAGE,
      "src/components/Header.tsx",
      "src/components/Footer.tsx",
      SECTION_REEXPORTS[0]!,
      "src/routes/order-transfer.tsx",
    ]);
    // What the unit test holds for v20 after one pass: every Starter path
    // present; the pins corrected in package.json (serialised with a trailing
    // newline); the sections/ entries re-export the flat components, which
    // stay where the author's Theme had them, as does its manifest.
    const { differs, missing } = againstCurrent(after);
    expect(missing).toEqual([]);
    expect(differs).toEqual([PACKAGE, ...SECTION_REEXPORTS].sort());
    expect(JSON.parse(after[PACKAGE]!)).toEqual(JSON.parse(original[PACKAGE]!));
    for (const path of [...FLAT_COMPONENTS, MANIFEST]) {
      expect(after[path], path).toBeDefined();
    }
    // The home Document was not reset: the draft still holds the baseline's.
    await savedField(page, scope!, baselineMarker);
    await openEditor(page);
    await expect(
      page.locator('[data-editor-starter-upgrade="available"]'),
    ).toHaveCount(0);

    // A new build of the upgraded source, published.
    const contentB = `t1-v20-b-${randomUUID().slice(0, 8)}`;
    await editHeroDraft(page, contentB);
    const r2 = await publishRelease(page);
    expect(r2.releaseId).not.toBe(baseline.releaseId);
    expect(r2.buildId).not.toBe(baseline.buildId);
    expect(releaseSource(r2.releaseId)).not.toBe(baselineSource);
    await harness!.serveActiveRelease(contentB, r2.releaseId, origin(host));
    await expectPublicSite(storefront, contentB, [baselineMarker]);

    const draftD = `t1-v20-d-${randomUUID().slice(0, 8)}`;
    await editHeroDraft(page, draftD);
    await expectPublicSite(storefront, contentB, [baselineMarker, draftD]);

    // After the upgrade is published, the site returns to the release that
    // was serving before it: the baseline, not an artifact of v20's bytes.
    await rollBack(page, baseline.releaseId, r2.releaseId);
    const restored = await harness!.serveActiveRelease(
      baselineMarker,
      baseline.releaseId,
      origin(host),
    );
    expect(restored.buildId).toBe(baseline.buildId);
    expect(restored.contentPublicationId).toBe(baseline.releaseContent);
    expect(restored.sourceRevisionId).toBe(baselineSource);
    await expectPublicSite(storefront, baselineMarker, [contentB, draftD]);
  });
});
