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
import { execLocalD1 } from "./helpers/editor-writes-paused";
import {
  DOMAINS,
  RELEASES,
  THEMES,
  editHero,
  expectHydrated,
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
  type ThemeScope,
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
 *       exactly the files versions 29 and 30 changed (the layout, and the
 *       content module's render-context reads); after it is applied the
 *       workspace is the current Starter. A new build is published as R1; the home page and a
 *       non-home route render, a draft edit does not leak, and rolling back
 *       to R0 serves R0's build and content again.
 *   v20 (manifest era, flat components, stale toolchain pins): the old
 *       workspace's build is refused (INVALID_START_PACKAGE) and the live site
 *       stays on the release it had. The review brings the pins, Header,
 *       Footer, the flat components, the section entries, the layout, the
 *       content module and the routes forward (the full list is below); the upgraded
 *       workspace builds and is published, with the same public checks.
 *       Rollback, narrowly: after the upgrade is published, the site can
 *       return to the release that was serving before the upgrade. That
 *       release is a baseline the v20 test publishes itself, from the current
 *       Starter, before it installs v20's files. Restoring v20's own original
 *       artifact stays UNVERIFIED: a v20 workspace cannot be built here before
 *       its upgrade, so no release of v20's own bytes can exist.
 *
 * Each test runs on a Theme of its own, created for it in the run's
 * storefront and never used again: the run's shared editor Theme
 * (EDITOR_PATH) is not opened, read or written; only its storefront id is
 * taken from that path. A fresh Theme is recorded as Starter 1 with no files,
 * and the editor's first read of it provisions the current Starter and
 * records that version (`ensureStoredStarterPreview`); that provisioned
 * workspace is the test's "original". The upgrade cannot be undone by
 * restoring files: it also points the Theme's draft and published template
 * revisions at the components it wrote (on 2026-11-06 a v20 upgrade left the
 * shared index template's starter-introduction on the flat
 * src/components/EditorialIntro.tsx, and the manifest migration then
 * reported `blocked`). So nothing is restored: each Theme is left as its
 * test ended it, upgraded (or wherever a failure stopped it). That is
 * deliberate and recorded here; it reaches nothing else because nothing
 * else uses that Theme. The domains each test connects are still removed.
 *
 * Releases are the storefront's, not a Theme's: `storefronts.active_release_id`
 * is the one release every domain of the store serves, and each release
 * names the Theme it was built from. Every release a test publishes or
 * rolls back to is one it published from its own Theme, and
 * `serveActiveRelease` refuses an active release of any other Theme
 * (THEME_MISMATCH in verify-published-artifact.mjs), so each public check is
 * of this test's Theme.
 *
 * The two tests do not depend on each other: each sets up its own
 * preconditions (v28: its own Theme, and nothing published yet on this
 * run's D1; v20: its own Theme, baseline release and domain), they are not
 * serial, and either runs alone with `-g` on its title.
 *
 * v28 and v20 bracket the two shapes an upgrade meets: a Starter whose pins
 * still build, and one the build refuses until the upgrade fixes them. v11,
 * v15 and v26 share v20's shape (manifest, flat components, stale pins), and
 * their plans are held by the unit tests.
 *
 * Containers only: the build, the publish and the release are the container
 * transport's. The run's own D1 and R2, through the harness, as
 * m1-container-lifecycle-acceptance.spec.ts reads them. The harness's own D1
 * writes from here go through `execLocalD1` (the run's SQLite file, with a
 * busy timeout), not a second workerd: one through `writeRunD1` collided
 * with the dev server (SQLITE_BUSY) on 2026-11-06.
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

/** The run's storefront. Its shared editor Theme is not used here. */
const STOREFRONT_ID = EDITOR_PATH
  ? themeScopeFromEditorPath(EDITOR_PATH).storefrontId
  : null;
/** One storefront hostname per test, so neither reuses the other's domain. */
const HOSTS = { v28: "t1-v28.localhost", v20: "t1-v20.localhost" } as const;
const SERVER_FN_MODULE =
  "/src/server/storefront/storefront-theme-files.serverFn.ts";
const PACKAGE = "package.json";
const LAYOUT = "src/layouts/StorefrontLayout.tsx";
const CONTENT = "src/morph/content.ts";
/**
 * The Starter this run upgrades to. The review lists below are what the
 * review shows for each fixture against this version, file by file (they
 * match `starter-history-upgrade.test.ts`); a new Starter version changes
 * them, and this check makes that a decision rather than a drift.
 */
const UPGRADE_TARGET_STARTER = 30;
/** The files versions 29 (the layout) and 30 (the content module) changed. */
const V28_REVIEW = [LAYOUT, CONTENT];
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
 * test "v28 is the current Starter apart from the files versions 29 and 30
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
/** The page-owned home sections an upgrade from the manifest era creates. */
const PAGE_SECTION_ENTRIES = [
  "starter-categories",
  "starter-hero",
  "starter-introduction",
  "starter-newsletter",
  "starter-principles",
  "starter-story",
].map((slot) => `src/components/page-sections/index/${slot}/index.tsx`);

/**
 * One test's own Theme: where its editor opens, its harness (serving and
 * reading this run's D1 for that Theme), and the workspace the editor
 * provisioned on it, which is the current Starter.
 */
type ThemeRun = {
  scope: ThemeScope;
  editorPath: string;
  harness: ReturnType<typeof storefrontHarness>;
  original: Record<string, string>;
};

const sqlText = (value: string) => `'${value.replace(/'/g, "''")}'`;

/** Every text file of `scope`'s workspace, path → content. */
async function workspace(
  page: Page,
  scope: ThemeScope,
): Promise<Record<string, string>> {
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
    { module: SERVER_FN_MODULE, scope },
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
  // The notice is server-rendered: a click before React has hydrated it is
  // received by nothing and no review is ever asked for (seen on 0d9fc38,
  // case E: the click landed about 1.6 s before the editor mounted). The
  // button itself must be hydrated before it is clicked.
  const review = upgradeNotice(page).getByRole("button", {
    name: "Review upgrade",
  });
  await expectHydrated(review);
  await review.click();
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

/** Opens `run`'s editor and waits for the canvas to show the home hero. */
async function openEditorWithHero(page: Page, run: ThemeRun) {
  await openEditor(page, run.editorPath);
  await expect(
    previewFrame(page).locator('[data-storefront-section-id="starter-hero"]'),
    "the Live Preview renders the home hero",
  ).toBeVisible({ timeout: 180_000 });
}

/** Types `marker` into the hero and waits for `run`'s draft to hold it. */
async function editHeroDraft(page: Page, run: ThemeRun, marker: string) {
  await openEditorWithHero(page, run);
  await editHero(page, marker);
  await savedField(page, run.scope, marker);
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
  // its own Theme and baseline. After a failure Playwright runs afterAll and
  // starts a new worker; nothing is shared between the tests but the
  // storefront and the domain list afterAll empties.
  test.setTimeout(30 * 60_000);
  test.use({ actionTimeout: 60_000 });

  /** Domains this worker created, removed by afterAll. */
  const domainIds: string[] = [];

  const queryD1 = (sql: string, ...params: unknown[]) =>
    queryLifecycleD1(STATE_DIR!, sql, ...params);

  function starterVersion(run: Pick<ThemeRun, "scope">) {
    const [row] = queryD1(
      "SELECT json_extract(metadata, '$.starterTemplateVersion') AS version FROM storefront_themes WHERE id = ?1 AND storefront_id = ?2",
      run.scope.themeId,
      run.scope.storefrontId,
    );
    return row?.version;
  }

  /**
   * Records `version` as `run`'s Starter, as an old Theme had it. Through
   * the run's SQLite file (`execLocalD1`), read back to prove the row took it.
   */
  function setStarterVersion(run: ThemeRun, version: number) {
    expect(Number.isInteger(version), "a whole Starter version").toBe(true);
    execLocalD1(
      `UPDATE storefront_themes
         SET metadata = json_set(COALESCE(metadata, '{}'), '$.starterTemplateVersion', ${version})
       WHERE id = ${sqlText(run.scope.themeId)}
         AND storefront_id = ${sqlText(run.scope.storefrontId)};`,
    );
    expect(starterVersion(run)).toBe(version);
  }

  function latestBuild(run: ThemeRun) {
    const [row] = queryD1(
      "SELECT id, status, error_message FROM storefront_theme_builds WHERE theme_id = ?1 ORDER BY created_at DESC LIMIT 1",
      run.scope.themeId,
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
   * A Theme of this test's own in the run's storefront, provisioned by the
   * editor and open in it, with the same checks the shared Theme's
   * workspace used to get: the current Starter is the version this spec's
   * review lists were written against, the editor recorded it, and the
   * provisioned workspace is v28 apart from exactly V28_REVIEW.
   *
   * Inserted with no files, recorded as Starter 1, as the other throwaway
   * Themes are (code-tree-context-menu.spec.ts). The editor's read
   * (`getStorefrontThemeEditor` → `ensureStoredStarterPreview`) then writes
   * the current Starter's files, creates the index, product and layout
   * templates and records the current version, because the stored version is
   * below it and the workspace is empty.
   */
  async function setUpThemeRun(page: Page, label: string): Promise<ThemeRun> {
    const scope: ThemeScope = {
      storefrontId: STOREFRONT_ID!,
      themeId: randomUUID(),
    };
    const now = new Date().toISOString();
    execLocalD1(`INSERT INTO storefront_themes
      (id, storefront_id, name, metadata, created_at, updated_at)
      VALUES (${sqlText(scope.themeId)}, ${sqlText(scope.storefrontId)},
        ${sqlText(`t1-${label}-${scope.themeId}`)}, '{"starterTemplateVersion":1}',
        ${sqlText(now)}, ${sqlText(now)});`);
    // Any page of the app reaches the server functions; not the shared
    // Theme's editor.
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const provisioned = (await serverFn(
      page,
      THEMES,
      "getStorefrontThemeEditor",
      scope,
    )) as {
      success: boolean;
      message?: string;
      data?: { templates: Array<{ id: string; type: string }> };
    };
    expect(provisioned.success, provisioned.message).toBe(true);
    const home = provisioned.data!.templates.find(
      (template) => template.type === "index",
    );
    expect(home, "the editor created the Theme's home template").toBeDefined();
    const editorPath = `/store/${scope.storefrontId}/themes/${scope.themeId}/editor?templateId=${home!.id}`;
    await openEditor(page, editorPath);

    const original = await workspace(page, scope);
    expect(STOREFRONT_STARTER_TEMPLATE_VERSION).toBe(UPGRADE_TARGET_STARTER);
    expect(starterVersion({ scope })).toBe(STOREFRONT_STARTER_TEMPLATE_VERSION);
    // Equal to the current Starter, apart from exactly the files versions
    // 29 and 30 changed.
    for (const file of V28.files) {
      if (V28_REVIEW.includes(file.path)) {
        expect(original[file.path], file.path).not.toBe(file.content);
      } else {
        expect(original[file.path], file.path).toBe(file.content);
      }
    }
    return {
      scope,
      editorPath,
      harness: storefrontHarness({ scope, stateDir: STATE_DIR! }),
      original,
    };
  }

  /**
   * Puts an old Starter's files in place of the Starter's own paths, through
   * the server function Code mode saves with, and records its version. Files
   * outside the Starter's paths (the catalog's, if any) are left alone.
   */
  async function installStarter(page: Page, run: ThemeRun, old: Fixture) {
    const current = await workspace(page, run.scope);
    const changed = old.files.filter(
      (file) => current[file.path] !== file.content,
    );
    const saved = await writeThemeFiles(page, run.scope, changed);
    expect(saved.success, JSON.stringify(saved)).toBe(true);
    const oldPaths = new Set(old.files.map((file) => file.path));
    const removed = await removeThemeFiles(
      page,
      run.scope,
      STARTER_PATHS.filter((path) => !oldPaths.has(path)),
    );
    expect(removed.success, JSON.stringify(removed)).toBe(true);
    setStarterVersion(run, old.starterVersion);
    const installed = await workspace(page, run.scope);
    for (const file of old.files) {
      expect(installed[file.path], file.path).toBe(file.content);
    }
    for (const path of STARTER_PATHS.filter((path) => !oldPaths.has(path))) {
      expect(installed[path], path).toBeUndefined();
    }
    expect(starterVersion(run)).toBe(old.starterVersion);
  }

  /** Opening the editor on the old workspace writes nothing. */
  async function expectOpeningWritesNothing(
    page: Page,
    run: ThemeRun,
    version: number,
  ) {
    const before = await workspace(page, run.scope);
    await openEditor(page, run.editorPath);
    await expect(upgradeNotice(page)).toHaveAttribute(
      "data-editor-starter-upgrade",
      "available",
      { timeout: 30_000 },
    );
    expect(await workspace(page, run.scope)).toEqual(before);
    expect(starterVersion(run)).toBe(version);
  }

  /**
   * Reviews and applies the upgrade, checking the review lists exactly
   * `listed` (no more, no fewer) and wrote nothing.
   */
  async function reviewAndApply(page: Page, run: ThemeRun, listed: string[]) {
    await openEditor(page, run.editorPath);
    const before = await workspace(page, run.scope);
    const dialog = await openReview(page);
    const starter = dialog.getByRole("region", { name: "Starter upgrade" });
    const heading = starter.getByRole("heading", { name: /^Changes \(\d+\)$/ });
    await expect(heading).toBeVisible();
    expect(
      Number(/\((\d+)\)/.exec((await heading.textContent()) ?? "")?.[1]),
      "the review lists exactly the expected files",
    ).toBe(listed.length);
    for (const path of listed) {
      await expect(
        starter.getByRole("button", { name: path }),
        `the review lists ${path}`,
      ).toBeVisible();
    }
    // Nothing is written while the author reads it.
    expect(await workspace(page, run.scope)).toEqual(before);
    await applyReview(page, dialog);
    expect(starterVersion(run)).toBe(STOREFRONT_STARTER_TEMPLATE_VERSION);
    return { before, after: await workspace(page, run.scope) };
  }

  /**
   * The Starter's paths that are missing, or differ from the current Starter
   * as the editor provisioned it on `run`'s Theme.
   */
  function againstCurrent(run: ThemeRun, files: Record<string, string>) {
    return {
      differs: STARTER_PATHS.filter(
        (path) => path in files && files[path] !== run.original[path],
      ).sort(),
      missing: STARTER_PATHS.filter((path) => !(path in files)).sort(),
    };
  }

  /** Publishes from the toolbar; the release, its build and content. */
  async function publishRelease(page: Page, run: ThemeRun) {
    const shown = await publishShowingRelease(page);
    await shown.close();
    const releaseId = await latestRelease(page, run.scope);
    // The store's newest release is the one this Theme just published.
    const [made] = queryD1(
      "SELECT theme_id FROM storefront_releases WHERE id = ?1",
      releaseId,
    );
    expect(made?.theme_id, "the release is this test's Theme's").toBe(
      run.scope.themeId,
    );
    const built = await run.harness.releaseBuild(releaseId);
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

  /** Rolls the storefront's active release back to `release` under its OCC. */
  async function rollBack(
    page: Page,
    run: ThemeRun,
    releaseId: string,
    from: string,
  ) {
    const activated = (await serverFn(
      page,
      RELEASES,
      "activateStorefrontRelease",
      {
        storefrontId: run.scope.storefrontId,
        releaseId,
        expectedActiveReleaseId: from,
      },
    )) as { success: boolean; message?: string };
    expect(activated.success, activated.message).toBe(true);
    expect((await run.harness.publishedState()).active).toBe(releaseId);
  }

  const origin = (host: string) =>
    `http://${host}:${new URL(test.info().project.use.baseURL!).port}`;

  /** Connects `host` to the store, for the public checks. */
  async function connectDomain(page: Page, run: ThemeRun, host: string) {
    const domain = (await serverFn(page, DOMAINS, "createStorefrontDomain", {
      storefrontId: run.scope.storefrontId,
      hostname: host,
    })) as { success: boolean; message?: string; data?: { id: string } };
    expect(domain.success, domain.message).toBe(true);
    domainIds.push(domain.data!.id);
  }

  test.afterAll(async ({ browser }) => {
    // The Themes the tests made are left as they ended (see the header):
    // only the domains are removed. Each removal runs whatever failed before
    // it; the failures are reported together, so one that cannot be undone
    // does not leave the others behind.
    if (!domainIds.length) return;
    const page = await signedInPage(browser);
    const failures: string[] = [];
    try {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      for (const domainId of domainIds.splice(0)) {
        try {
          // As m1-container-lifecycle-acceptance.spec.ts: the local stand-in
          // domain has no Cloudflare custom domain, and a primary domain
          // cannot be deleted, so the row is made deletable first.
          execLocalD1(
            `UPDATE storefront_domains SET is_primary = 0, cloudflare_domain_id = NULL WHERE id = ${sqlText(domainId)};`,
          );
          const deleted = (await serverFn(
            page,
            DOMAINS,
            "deleteStorefrontDomains",
            { ids: [domainId] },
          )) as { success: boolean; message?: string };
          if (!deleted.success) {
            failures.push(`domain ${domainId}: ${deleted.message}`);
          }
        } catch (error) {
          failures.push(`domain ${domainId}: ${String(error)}`);
        }
      }
      expect(failures, failures.join("\n")).toEqual([]);
    } finally {
      await page.context().close();
    }
  });

  test("v28: published from its own bytes, upgraded by review, published again, rolled back", async ({
    page,
  }) => {
    const host = HOSTS.v28;
    const storefront = storefrontFetcher(origin(host));
    // This test's own Theme, provisioned as the current Starter. It is left
    // upgraded when the test ends: single use, nothing else opens it.
    const run = await setUpThemeRun(page, "v28");
    try {
      // Precondition: this run's D1, with nothing published yet on the
      // storefront.
      const before = await run.harness.publishedState();
      expect(
        before.active,
        "v28 precondition: nothing is published on this run's D1",
      ).toBeNull();

      await installStarter(page, run, V28);
      await expectOpeningWritesNothing(page, run, 28);

      // R0: published from v28's own bytes.
      const contentA = `t1-v28-a-${randomUUID().slice(0, 8)}`;
      await editHeroDraft(page, run, contentA);
      await connectDomain(page, run, host);
      // Before any publish, the domain serves nothing, and not the draft.
      const unpublished = await storefront("/");
      expect(unpublished.status).toBe(404);
      expect(unpublished.body).not.toContain(contentA);

      const r0 = await publishRelease(page, run);
      const r0Source = releaseSource(r0.releaseId);
      expect(r0Source).toBeTruthy();
      const served0 = await run.harness.serveActiveRelease(
        contentA,
        r0.releaseId,
        origin(host),
      );
      expect(served0.buildId).toBe(r0.buildId);
      await expectPublicSite(storefront, contentA, []);

      // The reviewed upgrade: the files versions 29 and 30 changed.
      const { after } = await reviewAndApply(page, run, V28_REVIEW);
      expect(againstCurrent(run, after)).toEqual({ differs: [], missing: [] });
      // The home Document was not reset: the draft still holds R0's content.
      await savedField(page, run.scope, contentA);
      await openEditor(page, run.editorPath);
      await expect(
        page.locator('[data-editor-starter-upgrade="available"]'),
      ).toHaveCount(0);

      // R1: a new build of the upgraded source.
      const contentB = `t1-v28-b-${randomUUID().slice(0, 8)}`;
      await editHeroDraft(page, run, contentB);
      const r1 = await publishRelease(page, run);
      expect(r1.releaseId).not.toBe(r0.releaseId);
      expect(r1.buildId, "the upgraded source is built again").not.toBe(
        r0.buildId,
      );
      // serveActiveRelease below refuses a release whose build did not
      // succeed, or one of another Theme.
      const r1Source = releaseSource(r1.releaseId);
      expect(r1Source).toBeTruthy();
      expect(r1Source).not.toBe(r0Source);
      await run.harness.serveActiveRelease(contentB, r1.releaseId, origin(host));
      await expectPublicSite(storefront, contentB, [contentA]);

      // A draft edit after the publish stays out of the public site.
      const draftD = `t1-v28-d-${randomUUID().slice(0, 8)}`;
      await editHeroDraft(page, run, draftD);
      await expectPublicSite(storefront, contentB, [contentA, draftD]);

      // Rolled back to R0, built from v28's own bytes: its own build, content
      // and source again.
      await rollBack(page, run, r0.releaseId, r1.releaseId);
      const restored = await run.harness.serveActiveRelease(
        contentA,
        r0.releaseId,
        origin(host),
      );
      expect(restored.buildId).toBe(r0.buildId);
      expect(restored.contentPublicationId).toBe(r0.releaseContent);
      expect(restored.sourceRevisionId).toBe(r0Source);
      await expectPublicSite(storefront, contentA, [contentB, draftD]);
    } finally {
      await run.harness.dispose();
    }
  });

  test("v20: refused until upgraded by review, then published; the site can return to the release serving before the upgrade", async ({
    page,
  }) => {
    const host = HOSTS.v20;
    const storefront = storefrontFetcher(origin(host));
    // This test's own Theme, provisioned as the current Starter. It is left
    // upgraded, legacy manifest and all, when the test ends: single use,
    // nothing else opens it.
    const run = await setUpThemeRun(page, "v20");
    try {
      // Precondition, established here and by no other test: a release that
      // is serving before the upgrade. Built and published from the current
      // Starter on this Theme, which builds, because v20's own bytes cannot
      // be built before the upgrade. So the rollback below returns to this
      // baseline; restoring an artifact of v20's own bytes stays unverified.
      await connectDomain(page, run, host);
      const baselineMarker = `t1-v20-base-${randomUUID().slice(0, 8)}`;
      await editHeroDraft(page, run, baselineMarker);
      const baseline = await publishRelease(page, run);
      const baselineSource = releaseSource(baseline.releaseId);
      expect(
        baselineSource,
        "v20 precondition: the baseline release names its source",
      ).toBeTruthy();
      const servedBaseline = await run.harness.serveActiveRelease(
        baselineMarker,
        baseline.releaseId,
        origin(host),
      );
      expect(servedBaseline.buildId).toBe(baseline.buildId);
      expect(
        (await run.harness.publishedState()).active,
        "v20 precondition: the baseline release is the one serving",
      ).toBe(baseline.releaseId);
      await expectPublicSite(storefront, baselineMarker, []);

      await installStarter(page, run, V20);
      await expectOpeningWritesNothing(page, run, 20);

      // The old workspace's pins are refused by the build; the live site
      // stays on the baseline.
      const releasesBefore = (await run.harness.publishedState()).releases;
      await build(page);
      const refused = latestBuild(run);
      expect(refused?.status).toBe("failed");
      expect(refused?.error_message ?? "").toContain("INVALID_START_PACKAGE");
      const unchanged = await run.harness.publishedState();
      expect(unchanged.active).toBe(baseline.releaseId);
      expect(unchanged.releases).toBe(releasesBefore);
      await expectPublicSite(storefront, baselineMarker, []);

      // The reviewed upgrade, in full: the pins, Header and Footer, the flat
      // components, the page-owned section entries and the sections/
      // re-exports it creates, the layout, the content module, and the
      // routes (the home route updated; the account and order-transfer pages
      // created).
      const { after } = await reviewAndApply(page, run, [
        PACKAGE,
        "src/components/Header.tsx",
        "src/components/Footer.tsx",
        ...FLAT_COMPONENTS,
        ...PAGE_SECTION_ENTRIES,
        ...SECTION_REEXPORTS,
        LAYOUT,
        CONTENT,
        "src/routes/account.tsx",
        "src/routes/index.tsx",
        "src/routes/order-transfer.tsx",
      ]);
      // What the unit test holds for v20 after one pass: every Starter path
      // present; the pins corrected in package.json (serialised with a
      // trailing newline); the sections/ entries re-export the flat
      // components, which stay where the author's Theme had them, as does its
      // manifest.
      const { differs, missing } = againstCurrent(run, after);
      expect(missing).toEqual([]);
      expect(differs).toEqual([PACKAGE, ...SECTION_REEXPORTS].sort());
      expect(JSON.parse(after[PACKAGE]!)).toEqual(
        JSON.parse(run.original[PACKAGE]!),
      );
      for (const path of [...FLAT_COMPONENTS, MANIFEST]) {
        expect(after[path], path).toBeDefined();
      }
      // The home Document was not reset: the draft still holds the
      // baseline's.
      await savedField(page, run.scope, baselineMarker);
      await openEditor(page, run.editorPath);
      await expect(
        page.locator('[data-editor-starter-upgrade="available"]'),
      ).toHaveCount(0);

      // A new build of the upgraded source, published.
      const contentB = `t1-v20-b-${randomUUID().slice(0, 8)}`;
      await editHeroDraft(page, run, contentB);
      const r2 = await publishRelease(page, run);
      expect(r2.releaseId).not.toBe(baseline.releaseId);
      expect(r2.buildId).not.toBe(baseline.buildId);
      expect(releaseSource(r2.releaseId)).not.toBe(baselineSource);
      await run.harness.serveActiveRelease(contentB, r2.releaseId, origin(host));
      await expectPublicSite(storefront, contentB, [baselineMarker]);

      const draftD = `t1-v20-d-${randomUUID().slice(0, 8)}`;
      await editHeroDraft(page, run, draftD);
      await expectPublicSite(storefront, contentB, [baselineMarker, draftD]);

      // After the upgrade is published, the site returns to the release that
      // was serving before it: the baseline, not an artifact of v20's bytes.
      await rollBack(page, run, baseline.releaseId, r2.releaseId);
      const restored = await run.harness.serveActiveRelease(
        baselineMarker,
        baseline.releaseId,
        origin(host),
      );
      expect(restored.buildId).toBe(baseline.buildId);
      expect(restored.contentPublicationId).toBe(baseline.releaseContent);
      expect(restored.sourceRevisionId).toBe(baselineSource);
      await expectPublicSite(storefront, baselineMarker, [contentB, draftD]);
    } finally {
      await run.harness.dispose();
    }
  });
});
