import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  expect,
  test,
  type Browser,
  type Locator,
  type Page,
} from "@playwright/test";

import { queryLifecycleD1 } from "../scripts/verify-published-artifact.mjs";
import { STOREFRONT_STARTER_TEMPLATE_VERSION } from "../src/lib/storefront/default-storefront-document";
import {
  SAMPLE_OFFSETS,
  assertServerFnSuccess,
  decodeServerFnResult,
  enableSelection,
  isServerFunctionCall,
  openContentTab,
  previewFrame,
  settleSelection,
} from "./helpers";
import { execLocalD1 } from "./helpers/editor-writes-paused";
import {
  CaseRecord,
  Ledger,
  evidenceDir,
  sha256,
  startIdentity,
  writeJson,
} from "./helpers/m1-evidence";
import {
  DOMAINS,
  RELEASES,
  THEMES,
  editHero,
  editorContext,
  expectHydrated,
  latestRelease,
  openEditor,
  publishShowingRelease,
  savedField,
  serverFn,
  signedInPage,
  storefrontFetcher,
  storefrontHarness,
  storefrontRequest,
  type Fetcher,
} from "./native-acceptance";
import {
  removeThemeFiles,
  themeScopeFromEditorPath,
  writeThemeFiles,
  type ThemeScope,
} from "./native-compat";

/**
 * M1 item 1b, cases B1 and B2 (handoff 2026-11-21 m1-acceptance-plan.md §1b,
 * decisions Q4 and Q10): a Theme of each T1 Starter version (v11, v15, v20,
 * v26, v28), read back before and after the upgrade its author reviews and
 * applies in the editor; v20 and v28 then built, published and rolled back;
 * and an old Theme whose `content.ts` its author edited (B2).
 *
 * Isolation. Releases, domains and the active release are a storefront's.
 * The cases that only read back (v11, v15, v26) run on a storefront of their
 * own, created through the product path a merchant uses
 * (`createSalesChannel` with type "storefront", which creates the
 * storefront, its Theme and the current Starter's workspace;
 * `storefrontDal.ensureDefault`).
 *
 * The cases the public site serves (v28, v20, B2 v26) run on the run's own
 * storefront, the one the editor path names, each on a Theme of its own
 * there. The product serves a domain from one storefront only:
 * `createStorefrontDomain` takes a hostname and attaches it to the oldest
 * storefront (`storefrontDomainDal.activeStorefront`), so a domain cannot
 * reach a storefront made for a case (single-site product model; lead
 * decision 2026-11-21, option (a)). The run's storefront is that oldest one,
 * checked at set-up, and each case's domain is checked to land on it.
 * Because those cases share one storefront's active release, each public
 * step records the release the public host served before and after it (Core's
 * answer for the hostname, from the ETag of `/_morph/content`) and requires
 * the one after to be the release this case published or rolled back to, so
 * no case can pass on another's release.
 *
 * KNOWN ORDERING LIMIT (as in #360): v28's precondition is that nothing is
 * published yet on the run's storefront, so v28 must run before any other
 * publish on this run's D1. The file runs on one worker in file order, and
 * v28 is the first public case; v20 and B2 hold in any order. Run with `-g`
 * on a single title, each holds; run v28 after another publish and its
 * precondition fails (it does not pass on someone else's release). The same
 * note is written into each public case's ledger.
 *
 * Each storefront and Theme is left as its case ended it: the upgrade
 * rewrites template revisions as well as files, so it cannot be undone by
 * restoring files (see starter-upgrade-publish-acceptance.spec.ts), and
 * nothing else opens them. The domains are removed in afterAll.
 *
 * Each old workspace is the fixture under
 * `src/lib/storefront/__fixtures__/starter-history/`, byte for byte as that
 * Starter created it; the review lists the plan and its apply writes it.
 *
 * Read-back, before and after the upgrade, for every version:
 *   - the canvas (an element screenshot of the Live Preview frame, and the
 *     text of every `[data-storefront-field]` it renders);
 *   - the public page where a release is serving (a screenshot through a
 *     visitor's browser context, and the served HTML and `/_morph/content`);
 *   - `content.ts` (its bytes' sha256), every author route file
 *     (`src/routes/*`, sha256 and bytes), the whole workspace's hashes, and
 *     every template Document (JSON), all from the server's own reads.
 * What must hold: the author's Document content (each section's props) is
 * the same after the upgrade, the canvas shows the author's marker after it,
 * and every workspace path that changed is one the review listed.
 *
 * The canvas before and after (user decisions 2026-11-22):
 *   - v26, v28, B2: the canvas's field list is the same before and after.
 *   - v15, v20: four separate checks instead (expectUpgradeKeptAnnotations):
 *     the author's text unchanged; no pre-upgrade annotation gone; none bound
 *     to another field (same path, and its Document value in D1 before and
 *     after); the added annotations exactly the listed ones
 *     (EXPECTED_ADDED_ANNOTATIONS). Then each pre-upgrade annotation is used
 *     once after the upgrade: clicked on the canvas, a value typed in the
 *     Inspector must land in exactly its Document, section and field (D1,
 *     read-only) and show on that element, then the original value goes back
 *     and is read back (v20: after its publish and rollback checks).
 *   - v11: a recorded limitation, the pre-upgrade canvas marker only
 *     (V11_LIMITATION, proven outside the harness). The Documents are read
 *     back before the upgrade; the canvas and its fields after it must hold.
 *
 * Full Start (Q10): each case's Theme records `preview_runtime = 'start'`,
 * read back from D1, and every Live Preview start this case's editor asked
 * for answered `previewRuntime: "start"` (the start response is where the
 * Worker reports the runtime it resolved for the Theme; the product writes
 * no other runtime log line).
 *
 * Containers and full Start only: builds, publishes and the Live Preview
 * run in the Sandbox container (MORPH_E2E_TRANSPORT=cloudflare-sandbox,
 * MORPH_E2E_PREVIEW_RUNTIME=start). The public site is the local operator
 * stand-in (`storefrontHarness`), not a Cloudflare deployment.
 *
 * Evidence: MORPH_M1_EVIDENCE_DIR/<case>/ (else the test's output
 * directory): result.json (each step and the last one verified),
 * identity.json (plan 2.4), ledger.json (plan 2.3, from D1 reads),
 * before/ and after/ read-backs, screenshots.
 */

const STATE_DIR = process.env.MORPH_E2E_STATE_DIR;
const EDITOR_PATH = process.env.E2E_EDITOR_PATH;
const TRANSPORT = process.env.E2E_EXPECT_PREVIEW_TRANSPORT;
const PREVIEW_RUNTIME = process.env.MORPH_E2E_PREVIEW_RUNTIME;
/** The run's storefront: the one the product's domains serve. */
const RUN_STOREFRONT_ID = EDITOR_PATH
  ? themeScopeFromEditorPath(EDITOR_PATH).storefrontId
  : null;
const ORDERING_NOTE =
  "Known ordering limit: the public cases (v28, v20, B2 v26) share the run's storefront, the only one a domain can serve; v28 needs nothing published on it yet, so it must run before any other publish on this run's D1. Each public step records the release the host served before and after it and requires this case's own release after it.";

test.skip(
  !EDITOR_PATH || !STATE_DIR,
  "Run through scripts/run-editor-e2e.mjs: this reads the run's own D1 and R2.",
);
test.skip(
  TRANSPORT !== "cloudflare-sandbox",
  "Builds and publishes run in containers (MORPH_E2E_TRANSPORT=cloudflare-sandbox).",
);
test.skip(
  PREVIEW_RUNTIME !== "start",
  "M1 1b runs on the full Start preview (MORPH_E2E_PREVIEW_RUNTIME=start).",
);

const SALES_CHANNELS = "/src/server/sales-channel/sales-channels.serverFn.ts";
const FILES_MODULE =
  "/src/server/storefront/storefront-theme-files.serverFn.ts";
const PREVIEW_SERVER =
  "/src/server/storefront/storefront-theme-preview-server.serverFn.ts";
const PACKAGE = "package.json";
const LAYOUT = "src/layouts/StorefrontLayout.tsx";
const CONTENT = "src/morph/content.ts";
const MANIFEST = "morph.theme.json";
const OTHER_ROUTE = "/order-transfer";
const OTHER_ROUTE_HEADING = "訂單轉移確認";
/** The Starter this run upgrades to; the review lists below are against it. */
const UPGRADE_TARGET_STARTER = 30;
const AUTHOR_EDIT = "\n// author edit: keep this line\n";

type Fixture = {
  starterVersion: number;
  sourceCommit: string;
  sha256: string;
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
/** The Starter's own paths: v28 has exactly the current Starter's. */
const STARTER_PATHS = V28.files.map((file) => file.path);
const V28_REVIEW = [LAYOUT, CONTENT];
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
const PAGE_SECTION_ENTRIES = [
  "starter-categories",
  "starter-hero",
  "starter-introduction",
  "starter-newsletter",
  "starter-principles",
  "starter-story",
].map((slot) => `src/components/page-sections/index/${slot}/index.tsx`);
/** What the review lists for v20 against Starter 30 (as #360's spec holds). */
const V20_REVIEW = [
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
];

const sqlText = (value: string) => `'${value.replace(/'/g, "''")}'`;
const queryD1 = (sql: string, ...params: unknown[]) =>
  queryLifecycleD1(STATE_DIR!, sql, ...params) as Array<
    Record<string, unknown>
  >;

/** One case's own storefront and Theme, and where its evidence goes. */
type CaseRun = {
  label: string;
  scope: ThemeScope;
  editorPath: string;
  homeTemplateId: string;
  harness: ReturnType<typeof storefrontHarness>;
  original: Record<string, string>;
  record: CaseRecord;
  ledger: Ledger;
  dir: string;
  /** previewRuntime of every Live Preview start this case's editor asked for. */
  starts: Array<string | null>;
  host: string;
  domainId: string | null;
};

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
    { module: FILES_MODULE, scope },
  );
}

function starterVersion(scope: ThemeScope) {
  const [row] = queryD1(
    "SELECT json_extract(metadata, '$.starterTemplateVersion') AS version FROM storefront_themes WHERE id = ?1 AND storefront_id = ?2",
    scope.themeId,
    scope.storefrontId,
  );
  return row?.version;
}

function setStarterVersion(scope: ThemeScope, version: number) {
  expect(Number.isInteger(version), "a whole Starter version").toBe(true);
  execLocalD1(
    `UPDATE storefront_themes
       SET metadata = json_set(COALESCE(metadata, '{}'), '$.starterTemplateVersion', ${version})
     WHERE id = ${sqlText(scope.themeId)}
       AND storefront_id = ${sqlText(scope.storefrontId)};`,
  );
  expect(starterVersion(scope)).toBe(version);
}

function storedPreviewRuntime(scope: ThemeScope) {
  const rows = queryD1(
    "SELECT preview_runtime FROM storefront_themes WHERE id = ?1 AND storefront_id = ?2",
    scope.themeId,
    scope.storefrontId,
  );
  expect(rows.length).toBe(1);
  return (rows[0]!.preview_runtime as string | null) ?? null;
}

/**
 * The storefront's published state: the same query as
 * `storefrontHarness().publishedState()`, read through the run's D1 file
 * read-only (`queryLifecycleD1`, with a busy timeout) instead of a second
 * workerd. That second reader hit SQLITE_BUSY during v20's refused build in
 * dev-run3 and failed the step on a D1 "internal error" before any assertion.
 */
function publishedState(scope: ThemeScope) {
  const [row] = queryD1(
    `SELECT
       (SELECT active_release_id FROM storefronts WHERE id = ?1) AS active,
       (SELECT COUNT(*) FROM storefront_releases WHERE storefront_id = ?1) AS releases,
       (SELECT COUNT(*) FROM storefront_content_publications p
         WHERE p.storefront_id = ?1
           AND NOT EXISTS (
             SELECT 1 FROM storefront_theme_builds b
             WHERE b.content_publication_id = p.id
           )) AS publications`,
    scope.storefrontId,
  );
  return row as {
    active: string | null;
    releases: number;
    publications: number;
  };
}

function activeRelease(scope: ThemeScope) {
  const [row] = queryD1(
    "SELECT active_release_id FROM storefronts WHERE id = ?1",
    scope.storefrontId,
  );
  return (row?.active_release_id as string | null) ?? null;
}

function latestSourceRevision(scope: ThemeScope) {
  const [row] = queryD1(
    "SELECT id FROM storefront_theme_revisions WHERE theme_id = ?1 AND deleted_at IS NULL ORDER BY revision_number DESC LIMIT 1",
    scope.themeId,
  );
  return (row?.id as string | undefined) ?? null;
}

function homeDraftGeneration(run: CaseRun) {
  const [row] = queryD1(
    "SELECT draft_generation FROM storefront_theme_templates WHERE id = ?1",
    run.homeTemplateId,
  );
  return (row?.draft_generation as number | undefined) ?? null;
}

function latestBuild(scope: ThemeScope) {
  const [row] = queryD1(
    "SELECT id, status, error_message, source_revision_id FROM storefront_theme_builds WHERE theme_id = ?1 ORDER BY created_at DESC LIMIT 1",
    scope.themeId,
  );
  return row as
    | {
        id: string;
        status: string;
        error_message: string | null;
        source_revision_id: string | null;
      }
    | undefined;
}

function releaseRow(releaseId: string) {
  const [row] = queryD1(
    `SELECT r.id, r.theme_id, r.storefront_id, r.source_revision_id,
            r.theme_build_id, r.content_publication_id,
            b.content_dependency, b.content_publication_id AS build_content
       FROM storefront_releases r
       JOIN storefront_theme_builds b ON b.id = r.theme_build_id
      WHERE r.id = ?1`,
    releaseId,
  );
  return row as {
    id: string;
    theme_id: string;
    storefront_id: string;
    source_revision_id: string;
    theme_build_id: string;
    content_publication_id: string | null;
    content_dependency: string | null;
    build_content: string | null;
  };
}

/**
 * A Theme of the case's own on the run's storefront, the one the product's
 * domains serve (see the header: the public cases share it).
 *
 * Inserted with no files, recorded as Starter 1, as
 * starter-upgrade-publish-acceptance.spec.ts and the other throwaway Themes
 * do; the editor's read (`getStorefrontThemeEditor` →
 * `ensureStoredStarterPreview`) then writes the current Starter's files and
 * templates. Read here through the server function, before the editor
 * opens, so the Theme records full Start before any Live Preview starts.
 */
async function themeOnRunStorefront(
  page: Page,
  label: string,
): Promise<ThemeScope> {
  expect(RUN_STOREFRONT_ID, "the run's storefront").toBeTruthy();
  const [oldest] = queryD1(
    "SELECT id FROM storefronts WHERE deleted_at IS NULL ORDER BY created_at ASC LIMIT 1",
  );
  expect(
    oldest?.id,
    "the run's storefront is the one createStorefrontDomain attaches domains to",
  ).toBe(RUN_STOREFRONT_ID);
  const scope: ThemeScope = {
    storefrontId: RUN_STOREFRONT_ID!,
    themeId: randomUUID(),
  };
  const now = new Date().toISOString();
  execLocalD1(`INSERT INTO storefront_themes
    (id, storefront_id, name, metadata, created_at, updated_at)
    VALUES (${sqlText(scope.themeId)}, ${sqlText(scope.storefrontId)},
      ${sqlText(`m1-1b-${label}-${scope.themeId}`)}, '{"starterTemplateVersion":1}',
      ${sqlText(now)}, ${sqlText(now)});`);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const provisioned = (await serverFn(
    page,
    THEMES,
    "getStorefrontThemeEditor",
    scope,
  )) as { success: boolean; message?: string };
  expect(provisioned.success, provisioned.message).toBe(true);
  return scope;
}

/**
 * A storefront of the case's own, made the way a merchant makes one (or, for
 * a case the public site serves, a Theme of its own on the run's
 * storefront), with its Theme recorded and verified as full Start (Q10).
 */
async function setUpCase(
  page: Page,
  label: string,
  starter: number | null,
  on: "own storefront" | "run storefront" = "own storefront",
): Promise<CaseRun> {
  const dir = evidenceDir(`1b-${label}`);
  const identity = startIdentity(`1b/${label}`);
  const record = new CaseRecord(dir, `1b/${label}`, identity);
  const ledger = new Ledger(dir);
  const starts: Array<string | null> = [];
  page.on("response", async (response) => {
    if (!isServerFunctionCall(response.url(), "startThemePreviewServer"))
      return;
    try {
      const decoded = decodeServerFnResult(await response.text()) as {
        success?: boolean;
        data?: { previewRuntime?: string };
      };
      starts.push(
        decoded?.success ? (decoded.data?.previewRuntime ?? "client") : null,
      );
    } catch {
      starts.push(null);
    }
  });

  if (on === "run storefront") {
    const scope = await record.step(
      "own Theme on the run's storefront",
      async () => {
        const made = await themeOnRunStorefront(page, label);
        const active = activeRelease(made);
        record.fact("activeReleaseAtStart", active);
        record.fact("orderingLimit", ORDERING_NOTE);
        ledger.add({
          step: `1b/${label}/set-up`,
          action: "case set up on the run's storefront",
          themeId: made.themeId,
          sourceRevisionId: null,
          templateDraftGeneration: null,
          buildId: null,
          buildReused: null,
          contentPublicationId: null,
          releaseId: null,
          activeRelease: { before: active, after: active },
          expectedActiveReleaseId: null,
          evidence: [],
          note: ORDERING_NOTE,
        });
        return made;
      },
    );
    return finishSetUp(page, label, starter, scope, {
      dir,
      identity,
      record,
      ledger,
      starts,
    });
  }

  const scope = await record.step("isolated storefront", async () => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const name = `m1-1b-${label}-${randomUUID().slice(0, 8)}`;
    const created = (await serverFn(
      page,
      SALES_CHANNELS,
      "createSalesChannel",
      {
        name,
        type: "storefront",
      },
    )) as { success: boolean; message?: string; data?: { id: string } };
    expect(created.success, created.message).toBe(true);
    const rows = queryD1(
      "SELECT id, active_theme_id FROM storefronts WHERE sales_channel_id = ?1 AND deleted_at IS NULL",
      created.data!.id,
    );
    expect(rows.length, "one storefront for the new channel").toBe(1);
    const made: ThemeScope = {
      storefrontId: rows[0]!.id as string,
      themeId: rows[0]!.active_theme_id as string,
    };
    expect(made.themeId, "the storefront has its Theme").toBeTruthy();
    expect(activeRelease(made), "nothing is published on it yet").toBeNull();
    return made;
  });
  return finishSetUp(page, label, starter, scope, {
    dir,
    identity,
    record,
    ledger,
    starts,
  });
}

/** The set-up both kinds of case share once their Theme exists. */
async function finishSetUp(
  page: Page,
  label: string,
  starter: number | null,
  scope: ThemeScope,
  parts: {
    dir: string;
    identity: CaseRecord["identity"];
    record: CaseRecord;
    ledger: Ledger;
    starts: Array<string | null>;
  },
): Promise<CaseRun> {
  const { dir, identity, record, ledger, starts } = parts;
  identity.themeId = scope.themeId;
  record.fact("scope", scope);

  await record.step("theme records full Start", async () => {
    const stored = storedPreviewRuntime(scope);
    if (stored !== "start") {
      const set = (await serverFn(
        page,
        PREVIEW_SERVER,
        "setThemePreviewRuntime",
        {
          ...scope,
          previewRuntime: "start",
          expectedPreviewRuntime: stored,
        },
      )) as { success: boolean; message?: string };
      expect(set.success, set.message).toBe(true);
    }
    expect(storedPreviewRuntime(scope)).toBe("start");
    identity.previewMode = "start";
  });

  const provisioned = await record.step(
    "provisioned current Starter",
    async () => {
      const result = (await serverFn(
        page,
        THEMES,
        "getStorefrontThemeEditor",
        scope,
      )) as {
        success: boolean;
        message?: string;
        data?: { templates: Array<{ id: string; type: string }> };
      };
      expect(result.success, result.message).toBe(true);
      const home = result.data!.templates.find((t) => t.type === "index");
      expect(home, "the Theme has its home template").toBeDefined();
      const editorPath = `/store/${scope.storefrontId}/themes/${scope.themeId}/editor?templateId=${home!.id}`;
      await openEditor(page, editorPath);
      const original = await workspace(page, scope);
      expect(STOREFRONT_STARTER_TEMPLATE_VERSION).toBe(UPGRADE_TARGET_STARTER);
      expect(starterVersion(scope)).toBe(STOREFRONT_STARTER_TEMPLATE_VERSION);
      for (const file of V28.files) {
        if (V28_REVIEW.includes(file.path)) {
          expect(original[file.path], file.path).not.toBe(file.content);
        } else {
          expect(original[file.path], file.path).toBe(file.content);
        }
      }
      return { editorPath, homeTemplateId: home!.id, original };
    },
  );

  identity.starterVersion = starter;
  return {
    label,
    scope,
    ...provisioned,
    harness: storefrontHarness({ scope, stateDir: STATE_DIR! }),
    record,
    ledger,
    dir,
    starts,
    host: `m1-1b-${label}-${randomUUID().slice(0, 6)}.localhost`.toLowerCase(),
    domainId: null,
  };
}

const upgradeNotice = (page: Page) =>
  page.locator("[data-editor-starter-upgrade]");

async function openReview(page: Page) {
  await expect(upgradeNotice(page)).toHaveAttribute(
    "data-editor-starter-upgrade",
    "available",
    { timeout: 30_000 },
  );
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

/** Opens `run`'s editor and waits for the canvas to render the home hero. */
async function openEditorWithHero(page: Page, run: CaseRun) {
  await openEditor(page, run.editorPath);
  await expect(
    previewFrame(page).locator('[data-storefront-section-id="starter-hero"]'),
    "the Live Preview renders the home hero",
  ).toBeVisible({ timeout: 180_000 });
}

/** Types `marker` into the hero and waits for the draft to hold it. */
async function editHeroDraft(page: Page, run: CaseRun, marker: string) {
  await openEditorWithHero(page, run);
  await editHero(page, marker);
  await savedField(page, run.scope, marker);
  run.ledger.add({
    step: `1b/${run.label}/edit`,
    action: `Inspector write (${marker})`,
    themeId: run.scope.themeId,
    sourceRevisionId: latestSourceRevision(run.scope),
    templateDraftGeneration: homeDraftGeneration(run),
    buildId: null,
    buildReused: null,
    contentPublicationId: null,
    releaseId: null,
    activeRelease: {
      before: activeRelease(run.scope),
      after: activeRelease(run.scope),
    },
    expectedActiveReleaseId: null,
    evidence: [],
  });
}

/** Puts an old Starter's files in place of the Starter's own and records its version. */
async function installStarter(
  page: Page,
  run: CaseRun,
  old: Fixture,
  edits: Record<string, string> = {},
) {
  const files = old.files.map((file) =>
    file.path in edits ? { ...file, content: edits[file.path]! } : file,
  );
  const current = await workspace(page, run.scope);
  const changed = files.filter((file) => current[file.path] !== file.content);
  const saved = await writeThemeFiles(page, run.scope, changed);
  expect(saved.success, JSON.stringify(saved)).toBe(true);
  const oldPaths = new Set(files.map((file) => file.path));
  const stale = STARTER_PATHS.filter((path) => !oldPaths.has(path));
  const removed = await removeThemeFiles(page, run.scope, stale);
  expect(removed.success, JSON.stringify(removed)).toBe(true);
  setStarterVersion(run.scope, old.starterVersion);
  const installed = await workspace(page, run.scope);
  for (const file of files) {
    expect(installed[file.path], file.path).toBe(file.content);
  }
  for (const path of stale) expect(installed[path], path).toBeUndefined();
  run.record.fact("fixture", {
    version: old.starterVersion,
    sourceCommit: old.sourceCommit,
    sha256: old.sha256,
    authorEdits: Object.keys(edits),
  });
}

/** Opening the editor on the old workspace writes nothing. */
async function expectOpeningWritesNothing(
  page: Page,
  run: CaseRun,
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
  expect(starterVersion(run.scope)).toBe(version);
}

type FieldText = { section: string | null; field: string | null; text: string };

/** What the canvas renders in every content field, in document order. */
async function canvasFields(page: Page): Promise<FieldText[]> {
  return previewFrame(page)
    .locator("body")
    .evaluate((body) =>
      [...body.querySelectorAll("[data-storefront-field]")].map((element) => ({
        section:
          element
            .closest("[data-storefront-section-id]")
            ?.getAttribute("data-storefront-section-id") ?? null,
        field: element.getAttribute("data-storefront-field"),
        text: (element.textContent ?? "").trim(),
      })),
    );
}

/**
 * One `[data-storefront-field]` element on the canvas and the binding it
 * carries: the Document section around it, its field and field path. `key`
 * is `<section or ->|<field>#<n>`, n counting that section and field's
 * elements in document order; `index` is its place among all field elements.
 */
type CanvasBinding = {
  key: string;
  index: number;
  section: string | null;
  field: string | null;
  path: string | null;
  text: string;
  /** It holds other field elements (a list row, a card), so its text is theirs. */
  container: boolean;
};

async function canvasBindings(page: Page): Promise<CanvasBinding[]> {
  const raw = await previewFrame(page)
    .locator("body")
    .evaluate((body) =>
      [...body.querySelectorAll("[data-storefront-field]")].map((element) => ({
        section:
          element
            .closest("[data-storefront-section-id]")
            ?.getAttribute("data-storefront-section-id") ?? null,
        field: element.getAttribute("data-storefront-field"),
        path: element.getAttribute("data-storefront-field-path"),
        text: (element.textContent ?? "").trim(),
        container: element.querySelector("[data-storefront-field]") !== null,
      })),
    );
  const seen = new Map<string, number>();
  return raw.map((binding, index) => {
    const base = `${binding.section ?? "-"}|${binding.field}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return { key: `${base}#${n}`, index, ...binding };
  });
}

type DraftDocument = {
  templateId: string;
  type: string | null;
  sections: Array<{ id: string; props?: Record<string, unknown> | null }>;
};

/**
 * Every template's draft Document as D1 holds it (the revision the template's
 * draft points at, where an edit is stored), through the run's D1 file opened
 * read-only.
 */
function draftDocuments(scope: ThemeScope): DraftDocument[] {
  return queryD1(
    `SELECT t.id AS id, t.type AS type, r.document AS document
       FROM storefront_theme_templates t
       JOIN storefront_theme_template_revisions r
         ON r.id = t.draft_revision_id AND r.template_id = t.id
      WHERE t.theme_id = ?1 AND t.deleted_at IS NULL
      ORDER BY t.id`,
    scope.themeId,
  ).map((row) => {
    const document = JSON.parse(String(row.document)) as {
      sections?: DraftDocument["sections"];
    };
    expect(
      Array.isArray(document.sections),
      `template ${row.id}'s draft Document has sections`,
    ).toBe(true);
    return {
      templateId: row.id as string,
      type: (row.type as string | null) ?? null,
      sections: document.sections!,
    };
  });
}

function valueAt(props: unknown, location: string): unknown {
  let value = props;
  for (const part of location.split(".")) {
    if (value === null || typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

type Resolution =
  | {
      ok: true;
      templateId: string;
      location: string;
      kind: "text" | "value";
      value: unknown;
    }
  | { ok: false; reason: string };

/**
 * Where a canvas binding lands in the Documents: the one template holding its
 * section, and the value at its field path (or field). A text element must
 * show exactly that string; a container or image binds an object or list. A
 * path must end in the field the element names (`title` for
 * `items.0.title`, `items` for `items.0`), or the element names one field and
 * writes another.
 */
function resolveBinding(
  binding: CanvasBinding,
  drafts: DraftDocument[],
): Resolution {
  if (!binding.section) return { ok: false, reason: "no Document section" };
  if (!binding.field) return { ok: false, reason: "no field" };
  const holders = drafts.filter((draft) =>
    draft.sections.some((section) => section.id === binding.section),
  );
  if (holders.length !== 1) {
    return {
      ok: false,
      reason: `${holders.length} Documents hold section ${binding.section}`,
    };
  }
  const location = binding.path ?? binding.field;
  if (binding.path) {
    const named = binding.path
      .split(".")
      .filter((part) => !/^\d+$/.test(part))
      .pop();
    if (named !== binding.field) {
      return {
        ok: false,
        reason: `names field ${binding.field} at path ${binding.path}`,
      };
    }
  }
  const props = holders[0]!.sections.find(
    (section) => section.id === binding.section,
  )!.props;
  const value = valueAt(props ?? {}, location);
  if (value === undefined) {
    return { ok: false, reason: `no stored value at ${location}` };
  }
  if (!binding.container && typeof value === "string") {
    if (value.trim() !== binding.text) {
      return {
        ok: false,
        reason: `shows ${JSON.stringify(binding.text.slice(0, 80))}, Document holds ${JSON.stringify(value.slice(0, 80))}`,
      };
    }
    return {
      ok: true,
      templateId: holders[0]!.templateId,
      location,
      kind: "text",
      value,
    };
  }
  if (value === null || typeof value !== "object") {
    return {
      ok: false,
      reason: `${binding.container ? "a container" : "an element"} bound to a ${typeof value} at ${location}`,
    };
  }
  return {
    ok: true,
    templateId: holders[0]!.templateId,
    location,
    kind: "value",
    value,
  };
}

/** Every primitive leaf of every draft Document, `template/section/path` → value. */
function documentLeaves(drafts: DraftDocument[]): Map<string, unknown> {
  const leaves = new Map<string, unknown>();
  const walk = (prefix: string, value: unknown) => {
    if (value !== null && typeof value === "object") {
      for (const [key, inner] of Object.entries(value)) {
        walk(`${prefix}.${key}`, inner);
      }
      return;
    }
    leaves.set(prefix, value);
  };
  for (const draft of drafts) {
    for (const section of draft.sections) {
      for (const [key, value] of Object.entries(section.props ?? {})) {
        walk(`${draft.templateId}/${section.id}/${key}`, value);
      }
    }
  }
  return leaves;
}

/** The leaves that differ between two reads, sorted. */
function changedLeaves(
  before: Map<string, unknown>,
  after: Map<string, unknown>,
): string[] {
  const keys = new Set([...before.keys(), ...after.keys()]);
  return [...keys]
    .filter(
      (key) =>
        !before.has(key) ||
        !after.has(key) ||
        before.get(key) !== after.get(key),
    )
    .sort();
}

/**
 * The annotations the upgrade to Starter 30 adds on the canvas (after minus
 * before, by binding key), per version, from dev-run4 (handoff 2026-11-21
 * m1-harness/1b/dev-run4, read-back.json canvas fields of 1b-b1-v15 and
 * 1b-b1-v20). Any other added annotation fails.
 *
 * v20: the three Principles rows now carry their own number, title and body.
 * v15: the same, plus Header and Footer inside their Document sections
 * (starter-header, starter-footer: before the upgrade their elements sat in no
 * `data-storefront-section-id`), their list rows, store names and copyright,
 * and the three category cards bound as `items` rows.
 */
const EXPECTED_ADDED_ANNOTATIONS: Record<15 | 20, readonly string[]> = {
  20: [
    "starter-principles|number#0",
    "starter-principles|title#0",
    "starter-principles|body#0",
    "starter-principles|number#1",
    "starter-principles|title#1",
    "starter-principles|body#1",
    "starter-principles|number#2",
    "starter-principles|title#2",
    "starter-principles|body#2",
  ],
  15: [
    "starter-header|storeName#0",
    "starter-header|navItems#0",
    "starter-header|label#0",
    "starter-header|navItems#1",
    "starter-header|label#1",
    "starter-header|navItems#2",
    "starter-header|label#2",
    "starter-header|cartLabel#0",
    "starter-categories|items#0",
    "starter-categories|items#1",
    "starter-categories|items#2",
    "starter-principles|number#0",
    "starter-principles|title#0",
    "starter-principles|body#0",
    "starter-principles|number#1",
    "starter-principles|title#1",
    "starter-principles|body#1",
    "starter-principles|number#2",
    "starter-principles|title#2",
    "starter-principles|body#2",
    "starter-footer|storeName#0",
    "starter-footer|tagline#0",
    "starter-footer|exploreHeading#0",
    "starter-footer|exploreItems#0",
    "starter-footer|label#0",
    "starter-footer|exploreItems#1",
    "starter-footer|label#1",
    "starter-footer|exploreItems#2",
    "starter-footer|label#2",
    "starter-footer|helpHeading#0",
    "starter-footer|helpItems#0",
    "starter-footer|label#3",
    "starter-footer|helpItems#1",
    "starter-footer|label#4",
    "starter-footer|helpItems#2",
    "starter-footer|label#5",
    "starter-footer|copyrightText#0",
  ],
};

/**
 * v15 and v20 (user decision 2026-11-22): instead of the whole canvas field
 * list being equal, four checks, each on its own:
 *   1. the author's text: every pre-upgrade annotation shows the same text
 *      after the upgrade;
 *   2. no pre-upgrade annotation disappeared (by binding key);
 *   3. none is bound to another field: the same field path as before, and
 *      before and after it resolves to its Document section's value (D1);
 *   4. the added annotations are exactly EXPECTED_ADDED_ANNOTATIONS[version].
 * Documents, listed paths and the marker after the upgrade are checked as for
 * every version. Each check is soft, so all four are recorded.
 */
function expectUpgradeKeptAnnotations(
  run: CaseRun,
  version: 15 | 20,
  before: ReadBack,
  after: ReadBack,
  listed: string[],
) {
  const changed = expectDocumentsKeptAndListed(before, after, listed);
  expect(
    before.canvas.rendered,
    "the canvas rendered the author's marker before the upgrade",
  ).toBe(true);
  const afterByKey = new Map(after.canvas.bindings.map((b) => [b.key, b]));
  const beforeKeys = new Set(before.canvas.bindings.map((b) => b.key));
  const kept = before.canvas.bindings.filter((b) => afterByKey.has(b.key));

  const textChanged = kept
    .filter((b) => afterByKey.get(b.key)!.text !== b.text)
    .map(
      (b) =>
        `${b.key}: ${JSON.stringify(b.text.slice(0, 80))} -> ${JSON.stringify(afterByKey.get(b.key)!.text.slice(0, 80))}`,
    );
  const disappeared = before.canvas.bindings
    .filter((b) => !afterByKey.has(b.key))
    .map((b) => `${b.key} (path ${b.path ?? "-"}, ${JSON.stringify(b.text.slice(0, 40))})`);
  const misbound: string[] = [];
  for (const b of kept) {
    const now = afterByKey.get(b.key)!;
    if (now.path !== b.path) {
      misbound.push(`${b.key}: path ${b.path ?? "-"} -> ${now.path ?? "-"}`);
    }
    const was = resolveBinding(b, before.drafts);
    if (!was.ok) misbound.push(`${b.key} before: ${was.reason}`);
    const is = resolveBinding(now, after.drafts);
    if (!is.ok) misbound.push(`${b.key} after: ${is.reason}`);
    if (was.ok && is.ok && was.location !== is.location) {
      misbound.push(`${b.key}: ${was.location} -> ${is.location}`);
    }
  }
  const added = after.canvas.bindings
    .filter((b) => !beforeKeys.has(b.key))
    .map((b) => b.key);
  run.record.fact("annotationChecks", {
    before: before.canvas.bindings.length,
    after: after.canvas.bindings.length,
    textChanged,
    disappeared,
    misbound,
    added,
    expectedAdded: EXPECTED_ADDED_ANNOTATIONS[version],
  });
  expect.soft(textChanged, "1. the author's text is unchanged").toEqual([]);
  expect
    .soft(disappeared, "2. no pre-upgrade annotation disappeared")
    .toEqual([]);
  expect
    .soft(misbound, "3. no annotation is bound to another field")
    .toEqual([]);
  expect
    .soft(added, `4. the upgrade adds exactly v${version}'s expected annotations`)
    .toEqual([...EXPECTED_ADDED_ANNOTATIONS[version]]);
  return changed;
}

/** Fits the Live Preview frame to the canvas, so no field sits under a panel. */
async function tabletCanvas(page: Page) {
  const unlock = page.getByRole("button", {
    name: "Width locked (click to unlock)",
  });
  if (await unlock.isVisible().catch(() => false)) await unlock.click();
  const tablet = page.getByRole("button", {
    name: "Tablet preview, 768 pixels",
  });
  if (await tablet.isVisible().catch(() => false)) await tablet.click();
  await page.waitForTimeout(500);
}

/**
 * The Inspector's text control for the clicked field: the one input or
 * textarea showing `value`, or among several, the one the editor marks as
 * the focused field.
 */
async function inspectorControlShowing(page: Page, value: string) {
  const controls = page
    .locator('[data-slot="inspector-content-field"]')
    .locator("input:visible, textarea:visible");
  await expect
    .poll(
      async () =>
        (await controls.evaluateAll((items) =>
          items.map((item) => (item as HTMLInputElement).value),
        )).filter((shown) => shown === value).length,
      {
        timeout: 30_000,
        message: `the Inspector shows ${JSON.stringify(value.slice(0, 60))}`,
      },
    )
    .toBeGreaterThan(0);
  const candidates = await controls.evaluateAll(
    (items, wanted) =>
      items
        .map((item, index) => ({
          index,
          shows: (item as HTMLInputElement).value === wanted,
          focused: /\bring-1\b/.test(
            item.closest('[data-slot="inspector-content-field"]')?.className ??
              "",
          ),
        }))
        .filter((item) => item.shows),
    value,
  );
  const chosen =
    candidates.length === 1
      ? candidates[0]!
      : candidates.filter((item) => item.focused).length === 1
        ? candidates.find((item) => item.focused)!
        : null;
  if (!chosen) {
    throw new Error(
      `${candidates.length} Inspector controls show ${JSON.stringify(value.slice(0, 60))}, none singled out as focused`,
    );
  }
  return controls.nth(chosen.index);
}

/** Types `value` into the Inspector control and leaves it, as an author does. */
async function typeInto(
  control: Awaited<ReturnType<typeof inspectorControlShowing>>,
  value: string,
) {
  await expect(control).toBeEnabled({ timeout: 60_000 });
  await control.fill(value);
  await control.press("Tab");
}

/**
 * Clicks `element` at a point where it is the nearest field element under
 * the pointer (itself, or a part of it that is no field of its own) and the
 * editor's panels do not cover the frame. False when it has no such point.
 */
async function clickOwnPoint(page: Page, element: Locator): Promise<boolean> {
  const frame = page.locator("iframe").first();
  await expect
    .poll(
      () =>
        frame
          .evaluate((node) => getComputedStyle(node).pointerEvents)
          .catch(() => "none"),
      { message: "the canvas never accepted input", timeout: 60_000 },
    )
    .not.toBe("none");
  const frameBox = await frame.boundingBox();
  const box = await element.boundingBox();
  if (!frameBox || !box || box.width === 0 || box.height === 0) return false;
  for (const [dx, dy] of SAMPLE_OFFSETS) {
    const point = { x: box.x + box.width * dx, y: box.y + box.height * dy };
    const uncovered = await page.evaluate(
      (at) => document.elementFromPoint(at.x, at.y)?.tagName === "IFRAME",
      point,
    );
    if (!uncovered) continue;
    const own = await element.evaluate(
      (node, at) =>
        document
          .elementFromPoint(at.x, at.y)
          ?.closest("[data-storefront-field]") === node,
      { x: point.x - frameBox.x, y: point.y - frameBox.y },
    );
    if (!own) continue;
    await page.mouse.click(point.x, point.y);
    await settleSelection(page);
    return true;
  }
  return false;
}

type Exercise = {
  key: string;
  section: string | null;
  field: string | null;
  path: string | null;
  kind?: "text" | "value";
  location?: string;
  templateId?: string;
  written?: string;
  wroteLeaves?: string[];
  restoredLeaves?: string[];
  canvasShowedWrite?: boolean;
  canvasShowedRestore?: boolean;
  selectedSection?: string | null;
  outcome?: string;
  error?: string;
};

/**
 * Each pre-upgrade annotation, used once for real after the upgrade (user
 * decision 2026-11-22): clicked on the canvas; for a text field, a new value
 * typed in the Inspector, which must land in exactly that Document, section
 * and field path (the only D1 leaf that changes) and show on that canvas
 * element; then the original value typed back and read back the same way.
 * A container (a list row, a card) or an image binds no text of its own: it
 * is clicked and must select an element of its own section, and its text
 * fields are written through their own annotations.
 */
async function exerciseAnnotations(
  page: Page,
  run: CaseRun,
  before: ReadBack,
): Promise<Exercise[]> {
  const dir = evidenceDir(`1b-${run.label}/exercise`);
  await openEditor(page, run.editorPath);
  await expect(
    previewFrame(page).locator('[data-storefront-section-id="starter-hero"]'),
  ).toBeVisible({ timeout: 180_000 });
  await tabletCanvas(page);
  const preUpgrade = new Set(before.canvas.bindings.map((b) => b.key));
  const current = (await canvasBindings(page)).filter((b) =>
    preUpgrade.has(b.key),
  );
  const results: Exercise[] = [];
  for (const [n, binding] of current.entries()) {
    const result: Exercise = {
      key: binding.key,
      section: binding.section,
      field: binding.field,
      path: binding.path,
    };
    results.push(result);
    try {
      const where = resolveBinding(binding, draftDocuments(run.scope));
      if (!where.ok) throw new Error(`does not resolve: ${where.reason}`);
      result.kind = where.kind;
      result.location = where.location;
      result.templateId = where.templateId;
      const element = previewFrame(page)
        .locator("[data-storefront-field]")
        .nth(binding.index);
      const now = await element.evaluate((node) => ({
        field: node.getAttribute("data-storefront-field"),
        path: node.getAttribute("data-storefront-field-path"),
      }));
      expect(now, "the same element is still at this place").toEqual({
        field: binding.field,
        path: binding.path,
      });
      if (
        await page
          .getByRole("button", { name: "Enable section selection" })
          .isVisible()
          .catch(() => false)
      ) {
        await enableSelection(page);
      }
      await element.scrollIntoViewIfNeeded();
      if (!(await clickOwnPoint(page, element))) {
        // A row or card its own fields cover entirely: an author reaches it
        // only through one of them.
        if (where.kind !== "value") {
          throw new Error("no point on the canvas where this field takes the click");
        }
        const inner = element.locator("[data-storefront-field]").first();
        expect(
          await clickOwnPoint(page, inner),
          "a field inside the row takes the click",
        ).toBe(true);
        result.outcome = "covered by its own fields; selected through the first of them";
      }
      await openContentTab(page);
      result.selectedSection = await previewFrame(page)
        .locator('[data-storefront-editor-selected="true"]')
        .first()
        .evaluate(
          (node) =>
            node
              .closest("[data-storefront-section-id]")
              ?.getAttribute("data-storefront-section-id") ?? null,
        )
        .catch(() => null);
      expect(
        result.selectedSection,
        "the click selects an element of this section",
      ).toBe(binding.section);
      if (where.kind === "value") {
        result.outcome ??=
          "selected; binds a list row, card or image, whose text fields are written through their own annotations";
        continue;
      }
      const original = where.value as string;
      const expectedLeaf = `${where.templateId}/${binding.section}/${where.location}`;
      const start = documentLeaves(draftDocuments(run.scope));
      const written = `m1-1b-${run.label}-a${n}-${randomUUID().slice(0, 6)}`;
      result.written = written;
      await typeInto(await inspectorControlShowing(page, original), written);
      await expect
        .poll(
          () =>
            changedLeaves(start, documentLeaves(draftDocuments(run.scope))),
          {
            timeout: 30_000,
            message: `the write lands only at ${expectedLeaf}`,
          },
        )
        .toEqual([expectedLeaf]);
      const stored = documentLeaves(draftDocuments(run.scope));
      result.wroteLeaves = changedLeaves(start, stored);
      expect(stored.get(expectedLeaf)).toBe(written);
      await expect(element).toHaveText(written, { timeout: 30_000 });
      result.canvasShowedWrite = true;
      // The original value back, through the same control, read back too.
      await typeInto(await inspectorControlShowing(page, written), original);
      await expect
        .poll(
          () =>
            changedLeaves(start, documentLeaves(draftDocuments(run.scope))),
          {
            timeout: 30_000,
            message: `the original value is back at ${expectedLeaf}`,
          },
        )
        .toEqual([]);
      result.restoredLeaves = [];
      await expect(element).toHaveText(original.trim(), { timeout: 30_000 });
      result.canvasShowedRestore = true;
      result.outcome = "written, read back, restored, read back";
    } catch (error) {
      result.error = String((error as Error)?.message ?? error)
        .split("\n")[0]!
        .slice(0, 400);
    } finally {
      writeJson(dir, "annotation-exercise.json", results);
    }
  }
  return results;
}

/** The exercise's verdict: every pre-upgrade annotation present was used. */
function expectAnnotationsExercised(run: CaseRun, results: Exercise[]) {
  run.record.fact("annotationExercise", {
    total: results.length,
    written: results.filter((r) => r.outcome?.startsWith("written")).length,
    selectedOnly: results.filter((r) => r.kind === "value" && !r.error)
      .length,
    failed: results.filter((r) => r.error).length,
  });
  expect(
    results.filter((r) => r.kind === "text" && !r.error).length,
    "text annotations were written and read back",
  ).toBeGreaterThan(0);
  expect
    .soft(
      results.filter((r) => r.error).map((r) => `${r.key}: ${r.error}`),
      "every pre-upgrade annotation still on the canvas was used once and landed in its own Document, section and field",
    )
    .toEqual([]);
}

/**
 * v11 pre-upgrade limitation (user decision 2026-11-22), proven against the
 * original v11 fixture outside this harness (handoff 2026-11-22
 * m1-harness/1b/v11-proof: the fixture's own root and home routes rendered
 * with Core's content for "/" show the hero's default eyebrow, not the
 * author's value; v15, the control, shows it). Cause, in the fixture bytes:
 * v11's `content()` reads a React context that no v11 file provides, so every
 * slot reads `{}` and each component shows its defaults. The exception covers
 * only the pre-upgrade canvas: the author's Document values are still read
 * back before the upgrade, and the canvas and publish checks after it stay.
 */
const V11_LIMITATION =
  "v11 pre-upgrade limitation: canvas marker not rendered (existing behaviour, proven by handoff/2026-11-22/m1-harness/1b/v11-proof/result.json: the original v11 fixture rendered with Core's content shows the default eyebrow, not the marker; no v11 file but content.ts names MorphContentProvider)";
const V11_DEFAULT_EYEBROW = "New collection";

/**
 * Before v11's upgrade: the author's value is read back from the Documents
 * (the server's read and D1), the canvas shows v11's own default instead of
 * it (the proven behaviour; should it ever render the marker, this fails and
 * the limitation must go), and the cause is still in the fixture's bytes.
 * Recorded as the named limitation, never skipped.
 */
async function expectV11PreUpgradeLimitation(
  page: Page,
  run: CaseRun,
  old: Fixture,
  before: ReadBack,
  marker: string,
) {
  const inServerRead = Object.values(before.authorContent).some(
    (sections) =>
      (sections["starter-hero"] as Record<string, unknown> | undefined)
        ?.eyebrow === marker,
  );
  expect(inServerRead, "the server reads the author's value back").toBe(true);
  const inD1 = before.drafts.filter(
    (draft) =>
      draft.sections.find((section) => section.id === "starter-hero")?.props
        ?.eyebrow === marker,
  );
  expect(inD1.length, "D1 holds the author's value in one draft").toBe(1);
  expect(
    old.files
      .filter(
        (file) =>
          file.path !== CONTENT && file.content.includes("MorphContentProvider"),
      )
      .map((file) => file.path),
    "no v11 file provides the content context",
  ).toEqual([]);
  expect(
    before.canvas.rendered,
    "v11's canvas does not render the marker (proven existing behaviour)",
  ).toBe(false);
  await openEditor(page, run.editorPath);
  await expect
    .poll(() => renderedText(page).catch(() => ""), {
      timeout: 120_000,
      message: "v11's canvas shows its default eyebrow",
    })
    .toContain(V11_DEFAULT_EYEBROW);
  expect(
    await renderedText(page),
    "v11's canvas does not show the marker",
  ).not.toContain(marker);
  run.record.fact("limitation", V11_LIMITATION);
  test.info().annotations.push({
    type: "limitation",
    description: V11_LIMITATION,
  });
}

/**
 * The text the canvas renders: its text nodes outside script, style and
 * template elements (a page may carry its content snapshot in a script).
 */
function renderedText(page: Page) {
  return previewFrame(page)
    .locator("body")
    .evaluate((body) => {
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      const parts: string[] = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.parentElement?.closest("script,style,template,noscript")) {
          continue;
        }
        parts.push(node.textContent ?? "");
      }
      return parts.join(" ");
    });
}

/**
 * After v11's upgrade: what every version must hold (Documents, listed
 * paths, the marker on the canvas), and, in place of a before/after canvas
 * comparison the limitation leaves nothing to compare with, every field the
 * upgraded canvas shows resolves to its Document section's value in D1.
 */
function expectV11AfterUpgrade(
  before: ReadBack,
  after: ReadBack,
  listed: string[],
) {
  const changed = expectDocumentsKeptAndListed(before, after, listed);
  expect(after.canvas.bindings.length).toBeGreaterThan(0);
  expect
    .soft(
      after.canvas.bindings
        .map((binding) => ({ binding, where: resolveBinding(binding, after.drafts) }))
        .filter(({ where }) => !where.ok)
        .map(
          ({ binding, where }) =>
            `${binding.key}: ${(where as { reason: string }).reason}`,
        ),
      "every field the upgraded canvas shows resolves to its Document",
    )
    .toEqual([]);
  return changed;
}

/** Each template's sections' props, by template type/name and section id. */
type AuthorContent = Record<string, Record<string, unknown>>;

type ReadBack = {
  at: string;
  starterVersion: unknown;
  contentTs: { sha256: string | null; bytes: number | null };
  routes: Record<string, string>;
  workspaceSha256: Record<string, string>;
  authorContent: AuthorContent;
  canvas: {
    rendered: boolean;
    marker: string;
    fields: FieldText[];
    /** Each field element's binding as the editor reads it (v15/v20 checks). */
    bindings: CanvasBinding[];
  };
  /** Every template's draft Document, read from D1 (read-only). */
  drafts: DraftDocument[];
  public: {
    served: boolean;
    activeRelease: string | null;
    home?: { status: number; sha256: string; hasMarker: boolean };
    content?: { status: number; sha256: string; hasMarker: boolean };
    screenshotError?: string;
  };
};

const origin = (host: string) =>
  `http://${host}:${new URL(test.info().project.use.baseURL!).port}`;

/**
 * The read-back the plan asks for, kept under `<dir>/<phase>/`: canvas and
 * public screenshots, content.ts, the author routes, every Document, and the
 * whole workspace's hashes.
 */
async function readBack(
  page: Page,
  browser: Browser,
  run: CaseRun,
  phase: string,
  marker: string,
  options: { canvasRequired: boolean; publicMarker?: string },
): Promise<ReadBack> {
  const dir = evidenceDir(`1b-${run.label}/${phase}`);
  const files = await workspace(page, run.scope);
  const content = files[CONTENT];
  const routes = Object.fromEntries(
    Object.entries(files)
      .filter(([path]) => path.startsWith("src/routes/"))
      .map(([path, text]) => [path, sha256(text)]),
  );
  for (const [path, text] of Object.entries(files)) {
    if (path === CONTENT || path.startsWith("src/routes/")) {
      writeFileSync(join(dir, path.replace(/\//g, "__")), text);
    }
  }
  const context = await editorContext(page, run.scope);
  writeJson(dir, "documents.json", context.templates);
  const authorContent: AuthorContent = {};
  for (const template of context.templates as Array<
    (typeof context.templates)[number] & { type?: string; name?: string }
  >) {
    const key = `${template.type ?? "?"}:${template.name ?? template.id}`;
    authorContent[key] = Object.fromEntries(
      template.document.sections.map((section) => [
        section.id,
        section.props ?? {},
      ]),
    );
  }

  // The canvas, as the author sees it in the editor.
  await openEditor(page, run.editorPath);
  let rendered = false;
  try {
    await expect(
      previewFrame(page).getByText(marker, { exact: false }).first(),
    ).toBeVisible({ timeout: options.canvasRequired ? 180_000 : 120_000 });
    rendered = true;
  } catch (error) {
    if (options.canvasRequired) throw error;
  }
  await page
    .locator("iframe")
    .first()
    .screenshot({ path: join(dir, "canvas.png") })
    .catch(() => page.screenshot({ path: join(dir, "canvas-page.png") }));
  const fields = rendered ? await canvasFields(page) : [];
  const bindings = rendered ? await canvasBindings(page) : [];
  const drafts = draftDocuments(run.scope);
  writeJson(dir, "draft-documents.json", drafts);

  // The public page, where a release is serving.
  const active = activeRelease(run.scope);
  const publicRead: ReadBack["public"] = {
    served: false,
    activeRelease: active,
  };
  if (active && run.domainId) {
    const storefront = storefrontFetcher(origin(run.host));
    const wanted = options.publicMarker ?? marker;
    const home = await storefront("/");
    const served = await storefront("/_morph/content?path=%2F");
    publicRead.served = home.status === 200;
    publicRead.home = {
      status: home.status,
      sha256: sha256(home.body),
      hasMarker: home.body.includes(wanted),
    };
    publicRead.content = {
      status: served.status,
      sha256: sha256(served.body),
      hasMarker: served.body.includes(wanted),
    };
    writeFileSync(join(dir, "public-home.html"), home.body);
    writeFileSync(join(dir, "public-content.json"), served.body);
    // A visitor's browser, signed out. The served bytes above are the
    // evidence; a screenshot that cannot be taken is recorded, not fatal.
    const visitor = await browser.newContext();
    try {
      const view = await visitor.newPage();
      await view.goto(`${origin(run.host)}/`, { waitUntil: "load" });
      await view.screenshot({ path: join(dir, "public.png"), fullPage: true });
    } catch (error) {
      publicRead.screenshotError = String((error as Error)?.message ?? error)
        .split("\n")[0]!
        .slice(0, 300);
    } finally {
      await visitor.close();
    }
  }

  const result: ReadBack = {
    at: new Date().toISOString(),
    starterVersion: starterVersion(run.scope),
    contentTs: {
      sha256: content === undefined ? null : sha256(content),
      bytes: content === undefined ? null : Buffer.byteLength(content),
    },
    routes,
    workspaceSha256: Object.fromEntries(
      Object.entries(files)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([path, text]) => [path, sha256(text)]),
    ),
    authorContent,
    canvas: { rendered, marker, fields, bindings },
    drafts,
    public: publicRead,
  };
  writeJson(dir, "read-back.json", result);
  return result;
}

/**
 * Reviews the upgrade: the listed paths (exactly `listed` when given), a
 * screenshot of the dialog, and nothing written while it is open. Returns
 * the dialog and what it listed.
 */
async function review(page: Page, run: CaseRun, listed?: string[]) {
  await openEditor(page, run.editorPath);
  const before = await workspace(page, run.scope);
  const dialog = await openReview(page);
  const starter = dialog.getByRole("region", { name: "Starter upgrade" });
  const heading = starter.getByRole("heading", { name: /^Changes \(\d+\)$/ });
  await expect(heading).toBeVisible();
  const count = Number(
    /\((\d+)\)/.exec((await heading.textContent()) ?? "")?.[1],
  );
  // A change row is a button holding two spans, the operation ("create",
  // "update") and then the path, so its whole text reads "updatepackage.json".
  // The path is the row's last span; any other button keeps its own name and
  // is dropped by the path pattern below.
  const shown = (
    await starter
      .getByRole("button")
      .evaluateAll((buttons) =>
        buttons.map(
          (button) =>
            button.querySelector(":scope > span:last-child")?.textContent ??
            button.getAttribute("aria-label") ??
            button.textContent ??
            "",
        ),
      )
  )
    .map((name) => name.trim())
    .filter((name) =>
      /^[\w@.-]+(\/[\w@.[\]$-]+)*\.(tsx?|jsx?|mjs|json|css)$/.test(name),
    );
  const paths = [...new Set(shown)].sort();
  if (listed) {
    expect(count, "the review lists exactly the expected files").toBe(
      listed.length,
    );
    for (const path of listed) {
      await expect(
        starter.getByRole("button", { name: path }),
        `the review lists ${path}`,
      ).toBeVisible();
    }
  }
  expect
    .soft(paths.length, "every listed change was read from the dialog")
    .toBe(count);
  const kept = await dialog.locator("[data-kept-reason]").evaluateAll((items) =>
    items.map((item) => ({
      reason: item.getAttribute("data-kept-reason"),
      text: (item.textContent ?? "").trim().slice(0, 300),
    })),
  );
  await dialog.screenshot({ path: join(run.dir, "review.png") });
  writeJson(run.dir, "review.json", { count, paths, kept });
  // Nothing is written while the author reads it.
  expect(await workspace(page, run.scope)).toEqual(before);
  return { dialog, count, paths: listed ?? paths, kept };
}

/** Applies the Starter part the dialog shows; the product catalog is left out. */
async function apply(
  page: Page,
  run: CaseRun,
  dialog: Awaited<ReturnType<typeof review>>["dialog"],
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
  assertServerFnSuccess(await response.text());
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  expect(starterVersion(run.scope)).toBe(STOREFRONT_STARTER_TEMPLATE_VERSION);
  run.ledger.add({
    step: `1b/${run.label}/upgrade`,
    action: "upgrade applied",
    themeId: run.scope.themeId,
    sourceRevisionId: latestSourceRevision(run.scope),
    templateDraftGeneration: homeDraftGeneration(run),
    buildId: null,
    buildReused: null,
    contentPublicationId: null,
    releaseId: null,
    activeRelease: {
      before: activeRelease(run.scope),
      after: activeRelease(run.scope),
    },
    expectedActiveReleaseId: null,
    evidence: ["review.json", "review.png"],
  });
}

/**
 * What the upgrade may change: the author's Document content stays (every
 * section present before keeps its props), the canvas shows the author's
 * marker, and every workspace path that changed is one the review listed.
 */
function expectUpgradeKeptAuthorContent(
  before: ReadBack,
  after: ReadBack,
  listed: string[],
) {
  const changed = expectDocumentsKeptAndListed(before, after, listed);
  // The canvas shows the same author content before and after. An old
  // workspace whose canvas does not render before the upgrade fails this
  // softly: nothing to compare is not a pass, and the steps after it still
  // run and are recorded.
  expect
    .soft(
      before.canvas.rendered,
      "the canvas rendered the author's marker before the upgrade",
    )
    .toBe(true);
  expect
    .soft(after.canvas.fields, "the canvas shows the same content fields")
    .toEqual(before.canvas.fields);
  return changed;
}

/**
 * The part of the read-back comparison every version shares: each section
 * present before keeps its props, every changed workspace path is one the
 * review listed, and the canvas renders the author's marker after the
 * upgrade.
 */
function expectDocumentsKeptAndListed(
  before: ReadBack,
  after: ReadBack,
  listed: string[],
) {
  for (const [template, sections] of Object.entries(before.authorContent)) {
    for (const [section, props] of Object.entries(sections)) {
      expect
        .soft(
          after.authorContent[template]?.[section],
          `${template} ${section} props`,
        )
        .toEqual(props);
    }
  }
  const paths = new Set([
    ...Object.keys(before.workspaceSha256),
    ...Object.keys(after.workspaceSha256),
  ]);
  const changed = [...paths]
    .filter(
      (path) => before.workspaceSha256[path] !== after.workspaceSha256[path],
    )
    .sort();
  expect
    .soft(
      changed.filter((path) => !listed.includes(path)),
      "only the files the review listed changed",
    )
    .toEqual([]);
  expect(
    after.canvas.rendered,
    "the canvas renders the author's marker after the upgrade",
  ).toBe(true);
  return changed;
}

async function connectDomain(page: Page, run: CaseRun) {
  const domain = (await serverFn(page, DOMAINS, "createStorefrontDomain", {
    storefrontId: run.scope.storefrontId,
    hostname: run.host,
  })) as { success: boolean; message?: string; data?: { id: string } };
  expect(domain.success, domain.message).toBe(true);
  run.domainId = domain.data!.id;
  connectedDomains.push(domain.data!.id);
  // `createStorefrontDomain` takes only a hostname and attaches it to the
  // oldest storefront (`storefrontDomainDal.activeStorefront`); the
  // `storefrontId` above is not part of its input. A domain on another
  // storefront serves that storefront's release, so say so here rather than
  // as a 404 on the public site later.
  const [row] = queryD1(
    "SELECT storefront_id FROM storefront_domains WHERE id = ?1",
    domain.data!.id,
  );
  expect(
    row?.storefront_id,
    "the domain is attached to this case's storefront",
  ).toBe(run.scope.storefrontId);
}

/** Publishes from the toolbar and records the release in the ledger. */
async function publishRelease(page: Page, run: CaseRun, step: string) {
  const before = activeRelease(run.scope);
  const earlierBuilds = queryD1(
    "SELECT theme_build_id FROM storefront_releases WHERE storefront_id = ?1",
    run.scope.storefrontId,
  ).map((row) => row.theme_build_id as string);
  const shown = await publishShowingRelease(page);
  await shown.close();
  const releaseId = await latestRelease(page, run.scope);
  const row = releaseRow(releaseId);
  expect(row.theme_id, "the release is this case's Theme's").toBe(
    run.scope.themeId,
  );
  expect(row.storefront_id).toBe(run.scope.storefrontId);
  expect(row.theme_build_id, "the release names its build").toBeTruthy();
  expect(
    row.content_publication_id,
    "the release names its content",
  ).toBeTruthy();
  run.ledger.add({
    step,
    action: "publish",
    themeId: row.theme_id,
    sourceRevisionId: row.source_revision_id,
    templateDraftGeneration: homeDraftGeneration(run),
    buildId: row.theme_build_id,
    buildReused: earlierBuilds.includes(row.theme_build_id),
    contentPublicationId: row.content_publication_id,
    releaseId,
    activeRelease: { before, after: activeRelease(run.scope) },
    expectedActiveReleaseId: null,
    evidence: [],
  });
  run.record.identity.releaseId = releaseId;
  run.record.identity.buildId = row.theme_build_id;
  run.record.identity.sourceRevisionId = row.source_revision_id;
  return {
    releaseId,
    buildId: row.theme_build_id,
    releaseContent: row.content_publication_id,
    sourceRevisionId: row.source_revision_id,
  };
}

/** Builds from the toolbar and records the build. */
async function build(page: Page, run: CaseRun, step: string) {
  const action = page.locator("button[data-editor-build-action]");
  await expect(action).toBeEnabled({ timeout: 30_000 });
  await expectHydrated(action);
  await action.click();
  await expect(action).toHaveAttribute("data-build-pending", "true", {
    timeout: 30_000,
  });
  await expect(action).toHaveAttribute("data-build-pending", "false", {
    timeout: 9 * 60_000,
  });
  const made = latestBuild(run.scope);
  run.ledger.add({
    step,
    action: `build (${made?.status ?? "none"})`,
    themeId: run.scope.themeId,
    sourceRevisionId: made?.source_revision_id ?? null,
    templateDraftGeneration: homeDraftGeneration(run),
    buildId: made?.id ?? null,
    buildReused: null,
    contentPublicationId: null,
    releaseId: null,
    activeRelease: {
      before: activeRelease(run.scope),
      after: activeRelease(run.scope),
    },
    expectedActiveReleaseId: null,
    evidence: [],
  });
  return made;
}

/** The public site serves `marker` on the home page, its content and a non-home route. */
async function expectPublicSite(
  storefront: Fetcher,
  marker: string,
  absent: string[],
  otherRoute = true,
) {
  const home = await storefront("/");
  expect(home.status).toBe(200);
  expect(home.body).toContain(marker);
  const content = await storefront("/_morph/content?path=%2F");
  expect(content.status).toBe(200);
  expect(content.body).toContain(marker);
  const other = otherRoute ? await storefront(OTHER_ROUTE) : null;
  if (other) {
    expect(other.status, `${OTHER_ROUTE} renders`).toBe(200);
    expect(other.body).toContain(OTHER_ROUTE_HEADING);
  }
  for (const text of absent) {
    expect(home.body).not.toContain(text);
    expect(content.body).not.toContain(text);
    if (other) expect(other.body).not.toContain(text);
  }
}

/**
 * The release Core serves for this case's host, or null when it serves
 * none: Core names the release it resolved for the hostname in the ETag of
 * its content endpoint (`"<releaseId>:<path>"`).
 */
async function servedRelease(run: CaseRun): Promise<string | null> {
  if (!run.domainId) return null;
  const response = await storefrontRequest(
    origin(run.host),
    "/_morph/content?path=%2F",
  );
  await response.arrayBuffer();
  if (response.status !== 200) return null;
  const etag = response.headers.get("etag") ?? "";
  const named = /^(?:W\/)?"([^":]+):\/"$/.exec(etag);
  expect(
    named,
    `the content read names its release (ETag ${etag})`,
  ).not.toBeNull();
  return named![1]!;
}

/**
 * A step the public site is part of. The public cases share the run's
 * storefront (header), so the release the host serves is read before and
 * after the step, written to the ledger, and the one after must be
 * `expected(result)`: a release this case published or rolled back to.
 */
async function publicStep<T>(
  run: CaseRun,
  name: string,
  expected: (result: T) => string,
  body: () => Promise<T>,
): Promise<T> {
  return run.record.step(name, async () => {
    const activeBefore = activeRelease(run.scope);
    const before = await servedRelease(run);
    const result = await body();
    const after = await servedRelease(run);
    const wanted = expected(result);
    const served = (run.record.facts.servedReleases ?? []) as unknown[];
    served.push({ step: name, before, after, expected: wanted });
    run.record.fact("servedReleases", served);
    run.ledger.add({
      step: `1b/${run.label}/${name}`,
      action: "public site served",
      themeId: run.scope.themeId,
      sourceRevisionId: null,
      templateDraftGeneration: homeDraftGeneration(run),
      buildId: null,
      buildReused: null,
      contentPublicationId: null,
      releaseId: wanted,
      activeRelease: { before: activeBefore, after: activeRelease(run.scope) },
      expectedActiveReleaseId: null,
      evidence: [],
      servedRelease: { before, after },
      note: ORDERING_NOTE,
    });
    expect(after, `${name}: the host serves this case's own release`).toBe(
      wanted,
    );
    return result;
  });
}

/** Serves the active release and checks it is the publication `release` names. */
async function serveRelease(
  run: CaseRun,
  marker: string,
  release: {
    releaseId: string;
    buildId: string;
    releaseContent: string | null;
    sourceRevisionId: string;
  },
) {
  const served = await run.harness.serveActiveRelease(
    marker,
    release.releaseId,
    origin(run.host),
  );
  expect(served.buildId).toBe(release.buildId);
  expect(served.contentPublicationId).toBe(release.releaseContent);
  expect(served.sourceRevisionId).toBe(release.sourceRevisionId);
  return served;
}

/** Rolls the active release back to `releaseId` under its CAS and records it. */
async function rollBack(
  page: Page,
  run: CaseRun,
  releaseId: string,
  from: string,
) {
  const before = activeRelease(run.scope);
  expect(before).toBe(from);
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
  expect(publishedState(run.scope).active).toBe(releaseId);
  const row = releaseRow(releaseId);
  run.ledger.add({
    step: `1b/${run.label}/rollback`,
    action: "rollback",
    themeId: row.theme_id,
    sourceRevisionId: row.source_revision_id,
    templateDraftGeneration: homeDraftGeneration(run),
    buildId: row.theme_build_id,
    buildReused: true,
    contentPublicationId: row.content_publication_id,
    releaseId,
    activeRelease: { before, after: activeRelease(run.scope) },
    expectedActiveReleaseId: from,
    evidence: [],
  });
}

/** Every Live Preview start of the case answered the full Start runtime (Q10). */
function expectFullStart(run: CaseRun) {
  run.record.fact("previewStarts", run.starts);
  expect(
    run.starts.length,
    "the editor started a Live Preview",
  ).toBeGreaterThan(0);
  expect(
    run.starts.filter((runtime) => runtime !== "start"),
    "every Live Preview start answered previewRuntime start",
  ).toEqual([]);
  expect(storedPreviewRuntime(run.scope)).toBe("start");
}

async function finish(run: CaseRun) {
  run.record.identity.starterVersion =
    (starterVersion(run.scope) as number | undefined) ?? null;
  run.record.write(true);
  run.ledger.write();
  await run.harness.dispose();
}

/** Domains the cases connected, removed in afterAll. */
const connectedDomains: string[] = [];

test.describe("M1 1b Starter upgrade and compatibility on full Start", () => {
  test.setTimeout(40 * 60_000);
  test.use({ actionTimeout: 60_000 });

  test.afterAll(async ({ browser }) => {
    if (!connectedDomains.length) return;
    const page = await signedInPage(browser);
    const failures: string[] = [];
    try {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      for (const domainId of connectedDomains.splice(0)) {
        try {
          execLocalD1(
            `UPDATE storefront_domains SET is_primary = 0, cloudflare_domain_id = NULL WHERE id = ${sqlText(domainId)};`,
          );
          const deleted = (await serverFn(
            page,
            DOMAINS,
            "deleteStorefrontDomains",
            {
              ids: [domainId],
            },
          )) as { success: boolean; message?: string };
          if (!deleted.success)
            failures.push(`domain ${domainId}: ${deleted.message}`);
        } catch (error) {
          failures.push(`domain ${domainId}: ${String(error)}`);
        }
      }
      expect(failures, failures.join("\n")).toEqual([]);
    } finally {
      await page.context().close();
    }
  });

  /**
   * v11, v15 and v26 (manifest era, flat components, stale pins): read back
   * before and after the upgrade. Their build and publish are not part of
   * this case (Q4: v20 and v28 carry the publish and rollback); each result
   * record says the last step it verified.
   */
  async function readBackOnly(
    page: Page,
    browser: Browser,
    version: 11 | 15 | 26,
  ) {
    // v15 also writes and reads back each of its pre-upgrade annotations.
    if (version === 15) test.setTimeout(75 * 60_000);
    const old = fixture(version);
    const run = await setUpCase(page, `b1-v${version}`, version);
    try {
      const marker = `m1-1b-v${version}-${randomUUID().slice(0, 8)}`;
      await run.record.step("author content on the Theme", () =>
        editHeroDraft(page, run, marker),
      );
      await run.record.step(`installed v${version}`, async () => {
        await installStarter(page, run, old);
        await expectOpeningWritesNothing(page, run, version);
      });
      const before = await run.record.step("before-upgrade read-back", () =>
        readBack(page, browser, run, "before", marker, {
          canvasRequired: false,
        }),
      );
      run.record.fact("beforeCanvasRendered", before.canvas.rendered);
      run.record.identity.contentTsSha256 = before.contentTs.sha256;
      run.record.identity.contentTsEdited = false;
      if (version === 11) {
        await run.record.step(
          "v11 pre-upgrade limitation: canvas marker not rendered",
          () => expectV11PreUpgradeLimitation(page, run, old, before, marker),
        );
      }
      const listed = await run.record.step("review", async () => {
        const shown = await review(page, run);
        await apply(page, run, shown.dialog);
        return shown.paths;
      });
      const after = await run.record.step("after-upgrade read-back", () =>
        readBack(page, browser, run, "after", marker, { canvasRequired: true }),
      );
      await run.record.step("upgrade kept the author's content", async () => {
        run.record.fact(
          "changedPaths",
          version === 15
            ? expectUpgradeKeptAnnotations(run, 15, before, after, listed)
            : version === 11
              ? expectV11AfterUpgrade(before, after, listed)
              : expectUpgradeKeptAuthorContent(before, after, listed),
        );
        expect(after.contentTs.sha256).not.toBeNull();
      });
      if (version === 15) {
        await run.record.step(
          "each pre-upgrade annotation written and read back after the upgrade",
          async () =>
            expectAnnotationsExercised(
              run,
              await exerciseAnnotations(page, run, before),
            ),
        );
      }
      await run.record.step("full Start", async () => expectFullStart(run));
    } finally {
      await finish(run);
    }
  }

  test("B1 v11: read back before and after the reviewed upgrade", async ({
    page,
    browser,
  }) => readBackOnly(page, browser, 11));

  test("B1 v15: read back before and after the reviewed upgrade", async ({
    page,
    browser,
  }) => readBackOnly(page, browser, 15));

  test("B1 v26: read back before and after the reviewed upgrade", async ({
    page,
    browser,
  }) => readBackOnly(page, browser, 26));

  // v28 runs first of the public cases: its precondition is that nothing is
  // published on the run's storefront yet (header: known ordering limit).
  test("B1 v28: read back, published from its own bytes, reviewed upgrade, published, rolled back", async ({
    page,
    browser,
  }) => {
    const run = await setUpCase(page, "b1-v28", 28, "run storefront");
    try {
      const storefront = storefrontFetcher(origin(run.host));
      await run.record.step("installed v28", async () => {
        await installStarter(page, run, V28);
        await expectOpeningWritesNothing(page, run, 28);
      });
      const contentA = `m1-1b-v28-a-${randomUUID().slice(0, 8)}`;
      const r0 = await publicStep(
        run,
        "R0 published from v28's own bytes",
        (made) => made.releaseId,
        async () => {
          // The known ordering limit (header): nothing published yet on the
          // run's storefront, so v28 runs before any other publish.
          expect(
            activeRelease(run.scope),
            "v28 precondition: nothing is published on the run's storefront yet",
          ).toBeNull();
          await editHeroDraft(page, run, contentA);
          await connectDomain(page, run);
          // Before any publish this storefront's domain serves nothing.
          const unpublished = await storefront("/");
          expect(unpublished.status).toBe(404);
          expect(unpublished.body).not.toContain(contentA);
          const made = await publishRelease(page, run, "1b/b1-v28/R0");
          await serveRelease(run, contentA, made);
          await expectPublicSite(storefront, contentA, []);
          return made;
        },
      );
      const before = await run.record.step("before-upgrade read-back", () =>
        readBack(page, browser, run, "before", contentA, {
          canvasRequired: true,
        }),
      );
      run.record.identity.contentTsSha256 = before.contentTs.sha256;
      run.record.identity.contentTsEdited = false;
      await run.record.step("review", async () => {
        const shown = await review(page, run, V28_REVIEW);
        await apply(page, run, shown.dialog);
      });
      const after = await run.record.step("after-upgrade read-back", () =>
        readBack(page, browser, run, "after", contentA, {
          canvasRequired: true,
        }),
      );
      await run.record.step("upgrade kept the author's content", async () => {
        run.record.fact(
          "changedPaths",
          expectUpgradeKeptAuthorContent(before, after, V28_REVIEW),
        );
        expect(after.public.activeRelease).toBe(r0.releaseId);
        expect(after.public.home?.hasMarker).toBe(true);
        const files = await workspace(page, run.scope);
        expect(
          STARTER_PATHS.filter((path) => files[path] !== run.original[path]),
          "the upgraded workspace is the current Starter",
        ).toEqual([]);
      });
      const contentB = `m1-1b-v28-b-${randomUUID().slice(0, 8)}`;
      const r1 = await publicStep(
        run,
        "R1 published from the upgraded source",
        (made) => made.releaseId,
        async () => {
          await editHeroDraft(page, run, contentB);
          const made = await publishRelease(page, run, "1b/b1-v28/R1");
          expect(made.releaseId).not.toBe(r0.releaseId);
          expect(made.buildId, "the upgraded source is built again").not.toBe(
            r0.buildId,
          );
          expect(made.sourceRevisionId).not.toBe(r0.sourceRevisionId);
          await serveRelease(run, contentB, made);
          await expectPublicSite(storefront, contentB, [contentA]);
          return made;
        },
      );
      await run.record.step("published read-back", async () => {
        await readBack(page, browser, run, "published", contentB, {
          canvasRequired: true,
        });
      });
      const draftD = `m1-1b-v28-d-${randomUUID().slice(0, 8)}`;
      await publicStep(
        run,
        "a later draft stays off the public site",
        () => r1.releaseId,
        async () => {
          await editHeroDraft(page, run, draftD);
          await expectPublicSite(storefront, contentB, [contentA, draftD]);
        },
      );
      await publicStep(
        run,
        "rolled back to R0, the release serving before the upgrade",
        () => r0.releaseId,
        async () => {
          await rollBack(page, run, r0.releaseId, r1.releaseId);
          await serveRelease(run, contentA, r0);
          await expectPublicSite(storefront, contentA, [contentB, draftD]);
          // Q6: public site on R0, the editor keeps the pre-rollback draft.
          const rolled = await readBack(
            page,
            browser,
            run,
            "rolled-back",
            draftD,
            {
              canvasRequired: true,
              publicMarker: contentA,
            },
          );
          expect(rolled.public.home?.hasMarker).toBe(true);
          await savedField(page, run.scope, draftD);
        },
      );
      await run.record.step("full Start", async () => expectFullStart(run));
    } finally {
      await finish(run);
    }
  });

  test("B1 v20: read back, refused build, reviewed upgrade, published, rolled back to the release serving before the upgrade", async ({
    page,
    browser,
  }) => {
    // v20 also writes and reads back each of its pre-upgrade annotations.
    test.setTimeout(75 * 60_000);
    const V20 = fixture(20);
    const run = await setUpCase(page, "b1-v20", 20, "run storefront");
    try {
      const storefront = storefrontFetcher(origin(run.host));
      // The release serving before the upgrade: built and published from the
      // current Starter on this Theme, since v20's own bytes cannot be built
      // before the upgrade. Restoring an artifact of v20's own bytes stays
      // UNVERIFIED for that reason.
      const baselineMarker = `m1-1b-v20-base-${randomUUID().slice(0, 8)}`;
      // Connected first, so the step below records what the host served
      // before this case published (another case's release, or none).
      await run.record.step("domain connected", () => connectDomain(page, run));
      const baseline = await publicStep(
        run,
        "baseline release serving",
        (made) => made.releaseId,
        async () => {
          await editHeroDraft(page, run, baselineMarker);
          const made = await publishRelease(page, run, "1b/b1-v20/baseline");
          await serveRelease(run, baselineMarker, made);
          await expectPublicSite(storefront, baselineMarker, []);
          return made;
        },
      );
      await run.record.step("installed v20", async () => {
        await installStarter(page, run, V20);
        await expectOpeningWritesNothing(page, run, 20);
      });
      const before = await run.record.step("before-upgrade read-back", () =>
        readBack(page, browser, run, "before", baselineMarker, {
          canvasRequired: false,
        }),
      );
      run.record.fact("beforeCanvasRendered", before.canvas.rendered);
      run.record.identity.contentTsSha256 = before.contentTs.sha256;
      run.record.identity.contentTsEdited = false;
      await publicStep(
        run,
        "old workspace build refused, site unchanged",
        () => baseline.releaseId,
        async () => {
          const releasesBefore = publishedState(run.scope).releases;
          await openEditor(page, run.editorPath);
          const refused = await build(page, run, "1b/b1-v20/refused-build");
          expect(refused?.status).toBe("failed");
          expect(refused?.error_message ?? "").toContain(
            "INVALID_START_PACKAGE",
          );
          const unchanged = publishedState(run.scope);
          expect(unchanged.active).toBe(baseline.releaseId);
          expect(unchanged.releases).toBe(releasesBefore);
          await expectPublicSite(storefront, baselineMarker, []);
        },
      );
      await run.record.step("review", async () => {
        const shown = await review(page, run, V20_REVIEW);
        await apply(page, run, shown.dialog);
      });
      const after = await run.record.step("after-upgrade read-back", () =>
        readBack(page, browser, run, "after", baselineMarker, {
          canvasRequired: true,
        }),
      );
      await run.record.step("upgrade kept the author's content", async () => {
        run.record.fact(
          "changedPaths",
          expectUpgradeKeptAnnotations(run, 20, before, after, V20_REVIEW),
        );
        // The live site did not move with the upgrade.
        expect(after.public.activeRelease).toBe(baseline.releaseId);
        expect(after.public.home?.hasMarker).toBe(true);
        const files = await workspace(page, run.scope);
        for (const path of [...FLAT_COMPONENTS, MANIFEST]) {
          expect(files[path], path).toBeDefined();
        }
      });
      const contentB = `m1-1b-v20-b-${randomUUID().slice(0, 8)}`;
      const upgraded = await publicStep(
        run,
        "upgraded source built and published",
        (made) => made.releaseId,
        async () => {
          await editHeroDraft(page, run, contentB);
          const made = await publishRelease(page, run, "1b/b1-v20/publish");
          expect(made.releaseId).not.toBe(baseline.releaseId);
          expect(made.buildId).not.toBe(baseline.buildId);
          expect(made.sourceRevisionId).not.toBe(baseline.sourceRevisionId);
          await serveRelease(run, contentB, made);
          await expectPublicSite(storefront, contentB, [baselineMarker]);
          return made;
        },
      );
      await run.record.step("published read-back", async () => {
        await readBack(page, browser, run, "published", contentB, {
          canvasRequired: true,
        });
      });
      const draftD = `m1-1b-v20-d-${randomUUID().slice(0, 8)}`;
      await publicStep(
        run,
        "a later draft stays off the public site",
        () => upgraded.releaseId,
        async () => {
          await editHeroDraft(page, run, draftD);
          await expectPublicSite(storefront, contentB, [
            baselineMarker,
            draftD,
          ]);
        },
      );
      await publicStep(
        run,
        "rolled back to the release serving before the upgrade",
        () => baseline.releaseId,
        async () => {
          await rollBack(page, run, baseline.releaseId, upgraded.releaseId);
          await serveRelease(run, baselineMarker, baseline);
          await expectPublicSite(storefront, baselineMarker, [
            contentB,
            draftD,
          ]);
          // Q6: the public site is back on the old release; the editor keeps
          // the draft it had before the rollback. Both read back.
          const rolled = await readBack(
            page,
            browser,
            run,
            "rolled-back",
            draftD,
            {
              canvasRequired: true,
              publicMarker: baselineMarker,
            },
          );
          expect(rolled.public.home?.hasMarker).toBe(true);
          await savedField(page, run.scope, draftD);
        },
      );
      // After every publish-result check, so its draft writes (each put back
      // and read back) cannot move what those checks saw.
      await run.record.step(
        "each pre-upgrade annotation written and read back after the upgrade",
        async () => {
          expectAnnotationsExercised(
            run,
            await exerciseAnnotations(page, run, before),
          );
          expect(
            activeRelease(run.scope),
            "draft writes leave the live release where it was",
          ).toBe(baseline.releaseId);
        },
      );
      await run.record.step("full Start", async () => expectFullStart(run));
    } finally {
      await finish(run);
    }
  });

  test("B2 v26: content.ts the author edited is kept byte for byte, the review says why, its read result is unchanged, then published", async ({
    page,
    browser,
  }) => {
    const V26 = fixture(26);
    const original = V26.files.find((file) => file.path === CONTENT);
    expect(original, "v26 has a content module").toBeDefined();
    const edited = original!.content + AUTHOR_EDIT;
    const run = await setUpCase(page, "b2-v26", 26, "run storefront");
    try {
      const storefront = storefrontFetcher(origin(run.host));
      const marker = `m1-1b-b2-${randomUUID().slice(0, 8)}`;
      await run.record.step("author content on the Theme", () =>
        editHeroDraft(page, run, marker),
      );
      await run.record.step(
        "installed v26 with the author's content.ts",
        async () => {
          await installStarter(page, run, V26, { [CONTENT]: edited });
          await expectOpeningWritesNothing(page, run, 26);
        },
      );
      const before = await run.record.step("before-upgrade read-back", () =>
        readBack(page, browser, run, "before", marker, {
          canvasRequired: false,
        }),
      );
      expect(before.contentTs.sha256).toBe(sha256(edited));
      run.record.identity.contentTsSha256 = before.contentTs.sha256;
      run.record.identity.contentTsEdited = true;
      run.record.fact("beforeCanvasRendered", before.canvas.rendered);
      const listed = await run.record.step(
        "review keeps content.ts and says why",
        async () => {
          const shown = await review(page, run);
          expect(
            shown.paths,
            "content.ts is not among the changes",
          ).not.toContain(CONTENT);
          const kept = shown.dialog.locator('[data-kept-reason="changed"]', {
            hasText: CONTENT,
          });
          await expect(kept).toBeVisible();
          await expect(kept).toContainText("formatting-only changes");
          run.record.fact("keptReason", (await kept.textContent())?.trim());
          await apply(page, run, shown.dialog);
          return shown.paths;
        },
      );
      const after = await run.record.step("after-upgrade read-back", () =>
        readBack(page, browser, run, "after", marker, { canvasRequired: true }),
      );
      await run.record.step(
        "content.ts bytes and its read result unchanged",
        async () => {
          expect(after.contentTs.sha256, "content.ts byte for byte").toBe(
            sha256(edited),
          );
          expect((await workspace(page, run.scope))[CONTENT]).toBe(edited);
          // What the Theme reads through the module: the canvas's content
          // fields, compared before and after (expectUpgradeKeptAuthorContent).
          run.record.fact(
            "changedPaths",
            expectUpgradeKeptAuthorContent(before, after, listed),
          );
        },
      );
      // Connected first, so the step below records what the host served
      // before this case published (another case's release, or none).
      await run.record.step("domain connected", () => connectDomain(page, run));
      await publicStep(
        run,
        "published, public read result",
        (made) => made.releaseId,
        async () => {
          await openEditor(page, run.editorPath);
          const made = await publishRelease(page, run, "1b/b2-v26/publish");
          await serveRelease(run, marker, made);
          await expectPublicSite(storefront, marker, [], false);
          const published = await readBack(
            page,
            browser,
            run,
            "published",
            marker,
            {
              canvasRequired: true,
            },
          );
          expect(published.contentTs.sha256).toBe(sha256(edited));
          expect(published.public.home?.hasMarker).toBe(true);
          expect(published.public.content?.hasMarker).toBe(true);
          return made;
        },
      );
      await run.record.step("full Start", async () => expectFullStart(run));
    } finally {
      await finish(run);
    }
  });
});
