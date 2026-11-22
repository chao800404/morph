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
 *     the author's text unchanged; no pre-upgrade annotation gone (each on
 *     its own key or its listed move/rename target, ANNOTATION_PLANS); none
 *     bound to another field (same path, same Document place and D1 value
 *     before and after, same list row id); the added annotations exactly the
 *     listed ones. Then each pre-upgrade annotation is used once after the
 *     upgrade: clicked on the canvas, a value typed in the Inspector must
 *     land in exactly its Document, section and field (D1, read-only) and
 *     show on that element, then the original value goes back and is read
 *     back (v20: after its publish and rollback checks).
 *   - v11: a recorded limitation (V11_LIMITATION, proven outside the
 *     harness): only the before/after canvas comparison of the fields v11
 *     does not render from the Document (all of them) is exempt. The
 *     Documents are read back before the upgrade and every D1 author value
 *     is compared before/after; after the upgrade every canvas field is used
 *     once as above; then v11 is published and the release's public result
 *     read.
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
  /**
   * Where D1 holds it: the revision the template's draft points at, or, for
   * a template no edit has given a draft revision yet, the template row's
   * own `document` column.
   */
  source: "draft revision" | "template row";
  sections: Array<{ id: string; props?: Record<string, unknown> | null }>;
};

/**
 * Every template's Document as D1 holds it, read the way the editor's read
 * picks it (`storefrontThemeDal.findEditorContext`): the draft revision the
 * template points at when it has one, else the template row's own document.
 * dev-run2 (2026-11-22) showed why both are needed: after v11's upgrade the
 * layout template (starter-header, starter-footer) had no draft revision, so
 * a revision-only read saw no Document holding those sections. Through the
 * run's D1 file opened read-only.
 */
function draftDocuments(scope: ThemeScope): DraftDocument[] {
  return queryD1(
    `SELECT t.id AS id, t.type AS type,
            r.id AS revision_id,
            CASE WHEN r.id IS NOT NULL THEN r.document ELSE t.document END AS document
       FROM storefront_theme_templates t
       LEFT JOIN storefront_theme_template_revisions r
         ON r.id = t.draft_revision_id AND r.template_id = t.id
      WHERE t.theme_id = ?1 AND t.deleted_at IS NULL
      ORDER BY t.id`,
    scope.themeId,
  ).map((row) => {
    expect(
      row.document,
      `template ${row.id} has a Document in D1`,
    ).toBeTruthy();
    const document = JSON.parse(String(row.document)) as {
      sections?: DraftDocument["sections"];
    };
    expect(
      Array.isArray(document.sections),
      `template ${row.id}'s Document has sections`,
    ).toBe(true);
    return {
      templateId: row.id as string,
      type: (row.type as string | null) ?? null,
      source: row.revision_id ? "draft revision" : "template row",
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
 * What the upgrade to Starter 30 does to the canvas annotations, by binding
 * key, per version (user decisions 2026-11-22), from dev-run4 (handoff
 * 2026-11-21 m1-harness/1b/dev-run4, read-back.json canvas fields of
 * 1b-b1-v15 and 1b-b1-v20). Every pre-upgrade annotation must be found after
 * the upgrade under its own key, or under the target this plan lists for it;
 * every annotation after the upgrade that is neither must be in `added`.
 * Anything else fails.
 *
 * - `moved`: the same field gaining its Document section. Before the upgrade
 *   v15's Header and Footer elements sat in no `data-storefront-section-id`
 *   (key `-|field#n`); after it they are in starter-header / starter-footer.
 *   One entry per annotation, in document order.
 * - `renamed`: the only field-name change allowed, v15's three category
 *   cards: annotated `href` before, `items` after, on the same `items.N` path.
 * - `added`: annotations new with the upgrade (v15 and v20: each Principles
 *   row's number, title and body; v15 also the Header/Footer store names,
 *   menu rows and copyright).
 */
type AnnotationPlan = {
  moved: Readonly<Record<string, string>>;
  renamed: Readonly<Record<string, string>>;
  added: readonly string[];
};

const PRINCIPLES_ROWS_ADDED = [0, 1, 2].flatMap((n) =>
  ["number", "title", "body"].map(
    (field) => `starter-principles|${field}#${n}`,
  ),
);

const ANNOTATION_PLANS: Record<15 | 20, AnnotationPlan> = {
  20: { moved: {}, renamed: {}, added: PRINCIPLES_ROWS_ADDED },
  15: {
    moved: {
      "-|label#0": "starter-header|label#0", // Shop
      "-|label#1": "starter-header|label#1", // About
      "-|label#2": "starter-header|label#2", // Journal
      "-|cartLabel#0": "starter-header|cartLabel#0", // Cart (0)
      "-|tagline#0": "starter-footer|tagline#0",
      "-|exploreHeading#0": "starter-footer|exploreHeading#0", // Explore
      "-|label#3": "starter-footer|label#0", // Shop all
      "-|label#4": "starter-footer|label#1", // Our story
      "-|label#5": "starter-footer|label#2", // Journal
      "-|helpHeading#0": "starter-footer|helpHeading#0", // Help
      "-|label#6": "starter-footer|label#3", // Contact
      "-|label#7": "starter-footer|label#4", // Shipping
      "-|label#8": "starter-footer|label#5", // Returns
    },
    renamed: {
      "starter-categories|href#0": "starter-categories|items#0",
      "starter-categories|href#1": "starter-categories|items#1",
      "starter-categories|href#2": "starter-categories|items#2",
    },
    added: [
      "starter-header|storeName#0",
      "starter-header|navItems#0",
      "starter-header|navItems#1",
      "starter-header|navItems#2",
      ...PRINCIPLES_ROWS_ADDED,
      "starter-footer|storeName#0",
      "starter-footer|exploreItems#0",
      "starter-footer|exploreItems#1",
      "starter-footer|exploreItems#2",
      "starter-footer|helpItems#0",
      "starter-footer|helpItems#1",
      "starter-footer|helpItems#2",
      "starter-footer|copyrightText#0",
    ],
  },
};

/** The section's props in the one draft Document holding it, or null. */
function sectionProps(drafts: DraftDocument[], section: string) {
  const holders = drafts.filter((draft) =>
    draft.sections.some((item) => item.id === section),
  );
  if (holders.length !== 1) return null;
  return holders[0]!.sections.find((item) => item.id === section)!.props ?? {};
}

/**
 * The list rows `location` passes through (`items.0.title` → `items.0`) must
 * be the same rows before and after: each row has an `id` in both Documents
 * and it is the same id, not only the same index.
 */
function rowIdentityProblems(
  name: string,
  section: string,
  location: string,
  beforeDrafts: DraftDocument[],
  afterDrafts: DraftDocument[],
  beforeRead?: AuthorContent,
  afterRead?: AuthorContent,
): string[] {
  const was = sectionProps(beforeDrafts, section);
  const is = sectionProps(afterDrafts, section);
  if (!was || !is) return [`${name}: section ${section} is not in one Document`];
  // An old store's rows have no stored id; the editor's read gives each one
  // (normalizeDocumentRowIds) and that is the row's identity until an edit
  // stores it. Used only where D1 holds none.
  const readProps = (read: AuthorContent | undefined) =>
    read
      ? Object.values(read)
          .map((sections) => sections[section])
          .find((props) => props !== undefined)
      : undefined;
  const wasRead = readProps(beforeRead);
  const isRead = readProps(afterRead);
  const problems: string[] = [];
  const parts = location.split(".");
  parts.forEach((part, index) => {
    if (!/^\d+$/.test(part)) return;
    const prefix = parts.slice(0, index + 1).join(".");
    const idOf = (row: unknown) =>
      row !== null && typeof row === "object"
        ? (row as { id?: unknown }).id
        : undefined;
    const idBefore =
      idOf(valueAt(was, prefix)) ?? idOf(valueAt(wasRead ?? {}, prefix));
    const idAfter =
      idOf(valueAt(is, prefix)) ?? idOf(valueAt(isRead ?? {}, prefix));
    if (typeof idBefore !== "string" || typeof idAfter !== "string") {
      problems.push(
        `${name}: row ${prefix} has no id (before ${String(idBefore)}, after ${String(idAfter)})`,
      );
    } else if (idBefore !== idAfter) {
      problems.push(
        `${name}: row ${prefix} is ${idBefore} before, ${idAfter} after`,
      );
    }
  });
  return problems;
}

type AnnotationPair = {
  from: CanvasBinding;
  to: CanvasBinding;
  how: "same" | "moved" | "renamed";
};

/**
 * v15 and v20 (user decisions 2026-11-22): instead of the whole canvas field
 * list being equal, four checks, each on its own:
 *   1. the author's text: every pre-upgrade annotation shows the same text
 *      after the upgrade (on its own key, or its listed move/rename target);
 *   2. no pre-upgrade annotation disappeared: each is present under its own
 *      key or under its listed target;
 *   3. none is bound to another field: same field path (a moved one without
 *      a path before is read at its target's path); before and after it
 *      resolves to the same Document, place and D1 value; every list row on
 *      its path is the same row (same id); a move only adds the section, a
 *      rename only changes `href` to `items`;
 *   4. the added annotations are exactly the plan's `added`.
 * Documents, listed paths and the marker after the upgrade are checked as for
 * every version. Each check is soft, so all four are recorded. Returns the
 * changed paths and the post-upgrade keys of every pre-upgrade annotation,
 * which are then each used once (exerciseAnnotations).
 */
function expectUpgradeKeptAnnotations(
  run: CaseRun,
  version: 15 | 20,
  before: ReadBack,
  after: ReadBack,
  listed: string[],
) {
  const changed = expectDocumentsKeptAndListed(before, after, listed, true);
  expect(
    before.canvas.rendered,
    "the canvas rendered the author's marker before the upgrade",
  ).toBe(true);
  const plan = ANNOTATION_PLANS[version];
  const afterByKey = new Map(after.canvas.bindings.map((b) => [b.key, b]));
  const beforeKeys = new Set(before.canvas.bindings.map((b) => b.key));
  const planProblems = [
    ...Object.keys(plan.moved),
    ...Object.keys(plan.renamed),
  ]
    .filter((source) => !beforeKeys.has(source))
    .map((source) => `listed source ${source} is not on the pre-upgrade canvas`);
  const pairs: AnnotationPair[] = [];
  const disappeared: string[] = [];
  for (const from of before.canvas.bindings) {
    const how: AnnotationPair["how"] =
      from.key in plan.moved
        ? "moved"
        : from.key in plan.renamed
          ? "renamed"
          : "same";
    const target =
      how === "moved"
        ? plan.moved[from.key]!
        : how === "renamed"
          ? plan.renamed[from.key]!
          : from.key;
    const to = afterByKey.get(target);
    if (!to) {
      disappeared.push(
        `${from.key}${how === "same" ? "" : ` (listed ${how} to ${target})`} (path ${from.path ?? "-"}, ${JSON.stringify(from.text.slice(0, 40))})`,
      );
      continue;
    }
    pairs.push({ from, to, how });
  }

  const textChanged = pairs
    .filter(({ from, to }) => to.text !== from.text)
    .map(
      ({ from, to }) =>
        `${from.key} -> ${to.key}: ${JSON.stringify(from.text.slice(0, 80))} -> ${JSON.stringify(to.text.slice(0, 80))}`,
    );
  const misbound: string[] = [];
  for (const { from, to, how } of pairs) {
    const name = from.key === to.key ? from.key : `${from.key} -> ${to.key}`;
    if (how === "moved") {
      if (from.section !== null) {
        misbound.push(`${name}: moved, but it had section ${from.section}`);
      }
      if (from.field !== to.field) {
        misbound.push(`${name}: moved, but field ${from.field} -> ${to.field}`);
      }
    }
    if (how === "renamed") {
      if (from.section !== to.section) {
        misbound.push(
          `${name}: renamed, but section ${from.section} -> ${to.section}`,
        );
      }
      if (from.field !== "href" || to.field !== "items") {
        misbound.push(
          `${name}: only href -> items may be renamed, got ${from.field} -> ${to.field}`,
        );
      }
      if (from.path === null) misbound.push(`${name}: renamed without a path`);
    }
    if (from.path !== null && from.path !== to.path) {
      misbound.push(`${name}: path ${from.path} -> ${to.path ?? "-"}`);
    }
    const is = resolveBinding(to, after.drafts);
    if (!is.ok) {
      misbound.push(`${name} after: ${is.reason}`);
      continue;
    }
    // Before the upgrade, read where it binds now: a moved one in its
    // target's section (and at its path, when it had none), a renamed one
    // under the field it is named now.
    const was = resolveBinding(
      {
        ...from,
        section: how === "moved" ? to.section : from.section,
        field: how === "renamed" ? to.field : from.field,
        path: from.path ?? (how === "moved" ? to.path : null),
      },
      before.drafts,
    );
    if (!was.ok) {
      misbound.push(`${name} before: ${was.reason}`);
      continue;
    }
    if (was.location !== is.location || was.templateId !== is.templateId) {
      misbound.push(
        `${name}: ${was.templateId}/${was.location} -> ${is.templateId}/${is.location}`,
      );
    }
    // The value kept, at the same place or where a documented migration
    // moves it (href -> link.href, actionHref -> action.href, ...).
    const lost =
      typeof was.value === "string"
        ? was.value === is.value
          ? []
          : [JSON.stringify(was.value)]
        : valueKeptProblems(was.value, is.value);
    if (lost.length) {
      misbound.push(`${name}: D1 value at ${is.location} lost ${lost.join(", ")}`);
    }
    misbound.push(
      ...rowIdentityProblems(
        name,
        to.section!,
        is.location,
        before.drafts,
        after.drafts,
        before.authorContent,
        after.authorContent,
      ),
    );
  }
  const targets = new Set(pairs.map(({ to }) => to.key));
  const added = after.canvas.bindings
    .filter((b) => !beforeKeys.has(b.key) && !targets.has(b.key))
    .map((b) => b.key);
  run.record.fact("annotationChecks", {
    before: before.canvas.bindings.length,
    after: after.canvas.bindings.length,
    pairs: pairs.map(({ from, to, how }) => ({
      from: from.key,
      to: to.key,
      how,
      pathBefore: from.path,
      pathAfter: to.path,
    })),
    planProblems,
    textChanged,
    disappeared,
    misbound,
    added,
    plan,
  });
  expect
    .soft(planProblems, "the move/rename plan matches the pre-upgrade canvas")
    .toEqual([]);
  expect.soft(textChanged, "1. the author's text is unchanged").toEqual([]);
  expect
    .soft(
      disappeared,
      "2. every pre-upgrade annotation is present, on its key or its listed move/rename target",
    )
    .toEqual([]);
  expect
    .soft(misbound, "3. no annotation is bound to another field")
    .toEqual([]);
  expect
    .soft(
      added,
      `4. the upgrade adds exactly v${version}'s expected annotations`,
    )
    .toEqual([...plan.added]);
  return { changed, exerciseKeys: new Set(pairs.map(({ to }) => to.key)) };
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

/** What the Inspector shows for one text control, for the record. */
type InspectorCandidate = {
  index: number;
  label: string;
  rowNumber: number | null;
  focused: boolean;
};

/**
 * The Inspector's text control for the clicked field. Among the inputs and
 * textareas showing `value`:
 *   1. the one the editor marks focused (`InspectorField`'s ring, set for a
 *      section's own field when the click names it);
 *   2. else, for a field inside a list row (dev-run2: the list rows' own
 *      controls carry no focus mark, and two controls showed a category
 *      title), the one whose label names the field and whose row card is the
 *      clicked row (its number is the path's index + 1);
 *   3. else the one whose label names the field.
 * Exactly one must remain, or this throws with every candidate described.
 * It never falls back to the first match.
 */
async function inspectorControlFor(
  page: Page,
  value: string,
  binding: Pick<CanvasBinding, "field" | "path">,
) {
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
  const candidates: InspectorCandidate[] = await controls.evaluateAll(
    (items, wanted) =>
      items
        .map((item, index) => {
          const field = item.closest('[data-slot="inspector-content-field"]');
          // The row card around it: the nearest ancestor whose first child
          // holds the row number (`<p class="… font-mono">N</p>`).
          let rowNumber: number | null = null;
          for (
            let node = field?.parentElement ?? null;
            node && rowNumber === null;
            node = node.parentElement
          ) {
            const number = node.querySelector(":scope > div > p.font-mono");
            if (number && /^\d+$/.test((number.textContent ?? "").trim())) {
              rowNumber = Number((number.textContent ?? "").trim());
            }
          }
          return {
            index,
            shows: (item as HTMLInputElement).value === wanted,
            label: (
              field?.querySelector("label")?.textContent ?? ""
            ).trim(),
            rowNumber,
            focused: /\bring-1\b/.test(field?.className ?? ""),
          };
        })
        .filter((item) => item.shows)
        .map(({ shows: _shows, ...item }) => item),
    value,
  );
  const normal = (text: string) => text.toLowerCase().replace(/[\s_-]/g, "");
  const named = (item: InspectorCandidate) =>
    normal(item.label) === normal(binding.field ?? "");
  const rowIndex = binding.path
    ?.split(".")
    .filter((part) => /^\d+$/.test(part))
    .map(Number)
    .pop();
  const rules: Array<[string, (item: InspectorCandidate) => boolean]> = [
    ["the only control showing the value", () => candidates.length === 1],
    ["the control the editor marks focused", (item) => item.focused],
    [
      "the clicked row's control for this field",
      (item) =>
        rowIndex !== undefined && named(item) && item.rowNumber === rowIndex + 1,
    ],
    ["the control labelled with this field", named],
  ];
  for (const [rule, keep] of rules) {
    const left = candidates.filter(keep);
    if (left.length === 1) {
      return { control: controls.nth(left[0]!.index), rule, candidates };
    }
  }
  throw new Error(
    `no single Inspector control for ${binding.path ?? binding.field} shows ${JSON.stringify(value.slice(0, 60))}: ${JSON.stringify(candidates)}`,
  );
}

/** Types `value` into the Inspector control and leaves it, as an author does. */
async function typeInto(control: Locator, value: string) {
  await expect(control).toBeEnabled({ timeout: 60_000 });
  await control.fill(value);
  await control.press("Tab");
}

/**
 * Clicks `element` at a point where it is the nearest field element under
 * the pointer (itself, or a part of it that is no field of its own) and the
 * editor's panels do not cover the frame. The points are sampled inside the
 * part of the element that is on screen: dev-run2's story image is taller
 * than the window, so points spread over its whole box fell off-screen.
 * False when it has no such point; `misses` then says what each point hit.
 */
async function clickOwnPoint(
  page: Page,
  element: Locator,
  misses: string[] = [],
): Promise<boolean> {
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
  const box = await element.boundingBox({ timeout: 10_000 }).catch(() => null);
  const viewport = page.viewportSize();
  if (!frameBox || !box || !viewport || box.width === 0 || box.height === 0) {
    misses.push(`no box (frame ${JSON.stringify(frameBox)}, element ${JSON.stringify(box)})`);
    return false;
  }
  const left = Math.max(box.x, frameBox.x, 0);
  const top = Math.max(box.y, frameBox.y, 0);
  const right = Math.min(box.x + box.width, frameBox.x + frameBox.width, viewport.width);
  const bottom = Math.min(box.y + box.height, frameBox.y + frameBox.height, viewport.height);
  if (right - left < 2 || bottom - top < 2) {
    misses.push(`off screen (element ${JSON.stringify(box)}, frame ${JSON.stringify(frameBox)})`);
    return false;
  }
  for (const [dx, dy] of SAMPLE_OFFSETS) {
    const point = {
      x: left + (right - left) * dx,
      y: top + (bottom - top) * dy,
    };
    const onPage = await page.evaluate((at) => {
      const hit = document.elementFromPoint(at.x, at.y);
      return hit?.tagName === "IFRAME"
        ? null
        : `${hit?.tagName ?? "nothing"}${hit?.getAttribute("data-slot") ? `[${hit.getAttribute("data-slot")}]` : ""}`;
    }, point);
    if (onPage) {
      misses.push(`${Math.round(point.x)},${Math.round(point.y)}: page ${onPage}`);
      continue;
    }
    const inFrame = await element.evaluate(
      (node, at) => {
        const hit = document.elementFromPoint(at.x, at.y);
        const field = hit?.closest("[data-storefront-field]");
        return field === node
          ? null
          : `${hit?.tagName ?? "nothing"} in ${field?.getAttribute("data-storefront-field") ?? "no field"}`;
      },
      { x: point.x - frameBox.x, y: point.y - frameBox.y },
    );
    if (inFrame) {
      misses.push(`${Math.round(point.x)},${Math.round(point.y)}: frame ${inFrame}`);
      continue;
    }
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
  /** Which rule picked the Inspector control, and every control that showed the value. */
  controlRule?: string;
  controlCandidates?: InspectorCandidate[];
  /** The control's `maxlength`, when it has one. */
  maxLength?: number | null;
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
 *
 * `keys` are post-upgrade keys (for v15, a moved or renamed annotation's
 * listed target); every one of them must be on the canvas.
 */
async function exerciseAnnotations(
  page: Page,
  run: CaseRun,
  keys: ReadonlySet<string>,
): Promise<Exercise[]> {
  const dir = evidenceDir(`1b-${run.label}/exercise`);
  await openEditor(page, run.editorPath);
  await expect(
    previewFrame(page).locator('[data-storefront-section-id="starter-hero"]'),
  ).toBeVisible({ timeout: 180_000 });
  await tabletCanvas(page);
  const current = (await canvasBindings(page)).filter((b) => keys.has(b.key));
  const missing = [...keys].filter(
    (key) => !current.some((binding) => binding.key === key),
  );
  expect(missing, "every annotation to use is on the canvas").toEqual([]);
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
      const misses: string[] = [];
      if (!(await clickOwnPoint(page, element, misses))) {
        // Only a row or card its own fields cover entirely is reached through
        // one of them, as an author reaches it. Anything else that cannot be
        // clicked fails, saying what each point hit.
        if (!binding.container) {
          throw new Error(
            `no point on the canvas where this field takes the click: ${misses.slice(0, 6).join("; ")}`,
          );
        }
        const inner = element.locator("[data-storefront-field]").first();
        const innerMisses: string[] = [];
        if (!(await clickOwnPoint(page, inner, innerMisses))) {
          throw new Error(
            `neither this row nor its first field takes the click: ${[...misses, ...innerMisses].slice(0, 6).join("; ")}`,
          );
        }
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
      const target = await inspectorControlFor(page, original, binding);
      result.controlRule = target.rule;
      result.controlCandidates = target.candidates;
      // Short enough for the field's declared length (dev-run3: Principles'
      // `number` declares maxLength 20, and a 23-character value was cut to
      // 20 by the control, as it should be). A value that does not fit is
      // the harness's mistake, so it fails here instead of being typed.
      const maxLength = Number(
        (await target.control.getAttribute("maxlength")) ?? Infinity,
      );
      const written = `1b${n}-${randomUUID().slice(0, 6)}`;
      result.written = written;
      result.maxLength = Number.isFinite(maxLength) ? maxLength : null;
      expect(
        written.length,
        `the value fits the field's maxlength ${maxLength}`,
      ).toBeLessThanOrEqual(maxLength);
      expect(written, "the value differs from the stored one").not.toBe(
        original,
      );
      await typeInto(target.control, written);
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
      await typeInto(
        (await inspectorControlFor(page, written, binding)).control,
        original,
      );
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
 * v11 pre-upgrade limitation (user decisions 2026-11-22), proven against the
 * original v11 fixture outside this harness (handoff 2026-11-22
 * m1-harness/1b/v11-proof):
 *   - result.json: the fixture's own root and home routes rendered with
 *     Core's content for "/" show the hero's default eyebrow, not the
 *     author's value; v15, the control, shows it;
 *   - rendered-fields.json: with a sentinel value for every content field of
 *     every slot, v11 renders none of them; each of its 14
 *     `data-storefront-field` elements shows its component's own default.
 * Cause, in the fixture bytes: v11's `content()` reads a React context that
 * no v11 file provides, so every slot reads `{}`.
 *
 * Exempt: the before/after canvas comparison for the fields v11 does not
 * render from the Document, which is every one of them (the marker
 * included). Still checked: the author's values in D1 before against after
 * (so the two sides cannot drop a value together); the canvas comparison for
 * any field v11 renders from the Document (V11_FIELDS_RENDERED_FROM_DOCUMENT,
 * none); after the upgrade, each canvas field selects and writes its own
 * Document, section and field; after publish, the public result reads the
 * author's content.
 */
const V11_LIMITATION =
  "v11 pre-upgrade limitation: canvas marker not rendered (existing behaviour, proven by handoff/2026-11-22/m1-harness/1b/v11-proof/result.json and rendered-fields.json: the original v11 fixture rendered with Core's content shows the default eyebrow, not the marker, and renders no Document field at all; no v11 file but content.ts names MorphContentProvider). Exempt: the before/after canvas comparison of the fields v11 does not render from the Document (all of them).";
const V11_DEFAULT_EYEBROW = "New collection";
/** The v11 fixture the proof (handoff 2026-11-22 v11-proof) rendered. */
const V11_FIXTURE_SHA256 =
  "e4568e974890a865733f807c3cbbae3a91e025395c2e45489058f0787f18c3b8";

/**
 * Before v11's upgrade: the author's value is read back from the Documents
 * (the server's read and D1), the canvas shows v11's own default instead of
 * it (the proven behaviour; should it ever render the marker, this fails and
 * the limitation must go), and the cause is still in the fixture's bytes.
 * Recorded as the named limitation, never skipped. Returns the fields the
 * pre-upgrade canvas shows, with the split into exempt and compared.
 */
async function expectV11PreUpgradeLimitation(
  page: Page,
  run: CaseRun,
  old: Fixture,
  before: ReadBack,
  marker: string,
): Promise<CanvasBinding[]> {
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
  expect(old.sha256, "the v11 fixture is the one the proof rendered").toBe(
    V11_FIXTURE_SHA256,
  );
  const shown = await canvasBindings(page);
  writeJson(evidenceDir(`1b-${run.label}/before`), "v11-canvas-bindings.json", shown);
  // Every v11 field holds a sentinel (seedOldShapeDocuments). The fields
  // still compared are those whose sentinel the pre-upgrade canvas shows:
  // by the proof none, and any one is a failure here.
  const values = seeded(run).sentinels.map((item) => item.value);
  const text = await renderedText(page);
  const compared = [
    ...shown
      .filter((binding) => values.some((value) => binding.text.includes(value)))
      .map((binding) => binding.key),
    ...values
      .filter((value) => text.includes(value))
      .map((value) => `text ${value}`),
  ];
  expect(
    compared,
    "v11's pre-upgrade canvas shows no Document value (the proven exemption covers every field)",
  ).toEqual([]);
  run.record.fact("v11FieldSplit", {
    exempt: shown
      .filter((binding) => !compared.includes(binding.key))
      .map((binding) => ({ key: binding.key, path: binding.path, text: binding.text.slice(0, 80) })),
    compared,
    comparedNote:
      compared.length === 0
        ? "none: no seeded sentinel shows on the pre-upgrade v11 canvas (as rendered-fields.json proves)"
        : null,
  });
  run.record.fact("limitation", V11_LIMITATION);
  test.info().annotations.push({
    type: "limitation",
    description: V11_LIMITATION,
  });
  return shown;
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
 * paths, the marker on the canvas); (a) every author value D1 held before
 * the upgrade is the same value at the same place after it; (b) every field
 * v11 rendered from the Document shows the same text after (none, by the
 * proof); and every field the upgraded canvas shows resolves to its Document
 * section's value in D1.
 */
function expectV11AfterUpgrade(
  run: CaseRun,
  before: ReadBack,
  after: ReadBack,
  listed: string[],
  v11Canvas: CanvasBinding[],
) {
  const changed = expectDocumentsKeptAndListed(before, after, listed, true);
  expect(
    after.drafts.map((draft) => draft.templateId).sort(),
    "the upgrade keeps the same templates",
  ).toEqual(before.drafts.map((draft) => draft.templateId).sort());
  const was = documentLeaves(before.drafts);
  const is = documentLeaves(after.drafts);
  const valuesChanged = [...was.keys()]
    .filter((key) => !/(^|[./])id$/.test(key))
    .filter((key) => {
      const [template, section, ...path] = key.split("/");
      const moved = `${template}/${section}/${migratedPath(path.join("/"))}`;
      return is.get(key) !== was.get(key) && is.get(moved) !== was.get(key);
    })
    .map(
      (key) =>
        `${key}: ${JSON.stringify(was.get(key))} -> ${is.has(key) ? JSON.stringify(is.get(key)) : "(gone)"}`,
    );
  run.record.fact("v11AuthorValues", {
    before: was.size,
    after: is.size,
    changed: valuesChanged,
  });
  expect
    .soft(valuesChanged, "(a) every author value in D1 is kept by the upgrade")
    .toEqual([]);
  // (b) The fields v11 renders from the Document are compared before/after;
  // expectV11PreUpgradeLimitation proved there are none (a sentinel shown
  // before the upgrade fails there), so this records the empty set.
  run.record.fact("v11ComparedFields", {
    compared: [],
    exempt: v11Canvas.map((binding) => binding.key),
  });
  expect(after.canvas.bindings.length).toBeGreaterThan(0);
  expect
    .soft(
      after.canvas.bindings
        .map((binding) => ({
          binding,
          where: resolveBinding(binding, after.drafts),
        }))
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

/**
 * Pre-upgrade Documents in each version's OWN shape, with sentinels (review of
 * d371b94, 2026-11-22). Provisioning writes the current Starter's Documents,
 * and installing an old Starter's files leaves them as they are, so without
 * this every version would upgrade a Document already in the new shape
 * (`link.href`, `action.href`) and a reset to defaults would pass. Each case
 * replaces them, before the upgrade, with the default home (and, from v16,
 * layout) Document its Starter shipped (e2e/fixtures/starter-history-documents,
 * generated from src/lib/storefront/default-storefront-document.ts at the
 * fixture's source commit), with every text and URL field set to a unique
 * sentinel, and checks after the upgrade, and after the first edits, that
 * D1, the editor's read, the canvas and the served page hold each sentinel
 * where the upgrade must keep it.
 */
type ShapedDocument = {
  version?: number;
  sections: Array<{ id: string; props?: Record<string, unknown> }>;
};

type OldDocuments = {
  starterVersion: number;
  sourceCommit: string;
  sourceFile: string;
  sourceBlob: string;
  sourceSha256: string;
  home: ShapedDocument;
  layout: ShapedDocument | null;
};

function oldDocuments(old: Fixture): OldDocuments {
  const loaded = JSON.parse(
    readFileSync(
      join(
        process.cwd(),
        "e2e/fixtures/starter-history-documents",
        `v${old.starterVersion}.json`,
      ),
      "utf8",
    ),
  ) as OldDocuments;
  expect(loaded.starterVersion).toBe(old.starterVersion);
  expect(
    loaded.sourceCommit,
    "the Documents come from the commit that recorded this Starter",
  ).toBe(old.sourceCommit);
  return loaded;
}

/** One seeded value: where it is before the upgrade and where it must be after. */
type Sentinel = {
  template: "index" | "layout";
  section: string;
  before: string;
  after: string;
  value: string;
  kind: "text" | "url" | "position";
};

type Seeded = {
  documents: Omit<OldDocuments, "home" | "layout">;
  layout: string;
  sentinels: Sentinel[];
  cards: CardUrl[];
  actions: ActionUrl[];
};

const seeds = new Map<string, Seeded>();

function seeded(run: CaseRun): Seeded {
  const seed = seeds.get(run.label);
  expect(seed, "the case seeded its pre-upgrade Documents").toBeDefined();
  return seed!;
}

const SENTINEL_TEXT_KEYS = new Set([
  "eyebrow",
  "heading",
  "description",
  "actionLabel",
  "label",
  "body",
  "title",
  "caption",
  "placeholder",
  "number",
  "storeName",
  "tagline",
  "exploreHeading",
  "helpHeading",
  "cartLabel",
  "copyrightText",
]);

/**
 * Where an old-shape path's value belongs after the documented migrations
 * (#430, f600fae): a row's or a section's own `href` → `link.href`,
 * `actionHref` → `action.href`, `actionTarget` → `action.target`; and the
 * grouped image (`imageSrc`/`imageAlt` → `image.src`/`image.alt`).
 */
function migratedPath(path: string): string {
  const parts = path.split(".");
  const last = parts[parts.length - 1];
  const parent = parts[parts.length - 2];
  const head = parts.slice(0, -1);
  if (last === "href" && !["link", "action", "cartLink"].includes(parent ?? "")) {
    return [...head, "link", "href"].join(".");
  }
  const moved: Record<string, string[]> = {
    actionHref: ["action", "href"],
    actionTarget: ["action", "target"],
    imageSrc: ["image", "src"],
    imageAlt: ["image", "alt"],
  };
  return last && moved[last] ? [...head, ...moved[last]!].join(".") : path;
}

/** Every primitive leaf of a value, by dotted path. */
function leavesOf(value: unknown, prefix = ""): Array<[string, unknown]> {
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, inner]) =>
      leavesOf(inner, prefix ? `${prefix}.${key}` : key),
    );
  }
  return [[prefix, value]];
}

/**
 * The before value's leaves that the after value does not keep, at the same
 * path or the documented migrated one. Row ids are compared separately.
 */
function valueKeptProblems(before: unknown, after: unknown): string[] {
  return leavesOf(before)
    .filter(([path]) => path !== "id" && !path.endsWith(".id"))
    .filter(
      ([path, value]) =>
        valueAt(after, path) !== value && valueAt(after, migratedPath(path)) !== value,
    )
    .map(([path, value]) => `${path}=${JSON.stringify(value)}`);
}

/** Replaces every text and URL field with a unique sentinel, recording each. */
function sentinelize(
  document: ShapedDocument,
  template: Sentinel["template"],
  tag: string,
  marker: string,
  sentinels: Sentinel[],
) {
  for (const section of document.sections) {
    const walk = (value: unknown, path: string): unknown => {
      if (Array.isArray(value)) {
        return value.map((item, index) => walk(item, `${path}.${index}`));
      }
      if (value !== null && typeof value === "object") {
        return Object.fromEntries(
          Object.entries(value).map(([key, inner]) => [
            key,
            walk(inner, path ? `${path}.${key}` : key),
          ]),
        );
      }
      if (typeof value !== "string") return value;
      const key = path.split(".").pop()!;
      // The case's own marker, checked by the existing read-backs.
      if (section.id === "starter-hero" && path === "eyebrow") return marker;
      if (section.id === "starter-story" && path === "imagePosition") {
        sentinels.push({
          template,
          section: section.id,
          before: path,
          after: path,
          value: STORY_POSITION,
          kind: "position",
        });
        return STORY_POSITION;
      }
      const n = sentinels.length;
      if (SENTINEL_TEXT_KEYS.has(key)) {
        const sentinel = `S${n}-${tag}`;
        sentinels.push({
          template,
          section: section.id,
          before: path,
          after: path,
          value: sentinel,
          kind: "text",
        });
        return sentinel;
      }
      if (key === "href" || key === "actionHref") {
        const sentinel = `/m1-1b/u${n}-${tag}`;
        sentinels.push({
          template,
          section: section.id,
          before: path,
          after: migratedPath(path),
          value: sentinel,
          kind: "url",
        });
        return sentinel;
      }
      return value;
    };
    section.props = walk(section.props ?? {}, "") as Record<string, unknown>;
  }
}

/**
 * Before the upgrade: the version's own default Documents with sentinels,
 * written into the Document the editor reads (the draft revision, else the
 * template row) of the case's home and layout templates, then verified from
 * D1 (read-only) and the editor's read. Before v16 a store had no layout
 * Document (its shell rendered its own defaults); the layout template the
 * current provisioning created is emptied instead, which is as close as a
 * store of today can get (recorded).
 *
 * Seeded directly rather than through the editor's write: today's write
 * path normalizes a Document to the current shape on save, so it cannot
 * produce what an old store held. No old Starter declares the story's
 * `imagePosition` either (v11's manifest, v15's and v20's `contentFields`).
 */
async function seedOldShapeDocuments(
  page: Page,
  run: CaseRun,
  old: Fixture,
  marker: string,
) {
  const documents = oldDocuments(old);
  const tag = randomUUID().slice(0, 4);
  const sentinels: Sentinel[] = [];
  const home = structuredClone(documents.home);
  sentinelize(home, "index", tag, marker, sentinels);
  const layout: ShapedDocument = documents.layout
    ? structuredClone(documents.layout)
    : { version: documents.home.version ?? 1, sections: [] };
  if (documents.layout) sentinelize(layout, "layout", tag, marker, sentinels);
  const rows = queryD1(
    `SELECT t.id AS id, t.type AS type, t.route_path AS route_path, r.id AS revision_id
       FROM storefront_theme_templates t
       LEFT JOIN storefront_theme_template_revisions r
         ON r.id = t.draft_revision_id AND r.template_id = t.id
      WHERE t.theme_id = ?1 AND t.deleted_at IS NULL`,
    run.scope.themeId,
  );
  const target = (type: string) => {
    const found = rows.filter(
      (row) => row.type === type && (type !== "index" || row.route_path == null),
    );
    expect(found.length, `one ${type} template`).toBe(1);
    return found[0]!;
  };
  const written: Record<string, unknown> = {};
  for (const [type, document] of [
    ["index", home],
    ["layout", layout],
  ] as const) {
    const row = target(type);
    const text = sqlText(JSON.stringify(document));
    execLocalD1(
      row.revision_id
        ? `UPDATE storefront_theme_template_revisions SET document = ${text} WHERE id = ${sqlText(String(row.revision_id))};`
        : `UPDATE storefront_theme_templates SET document = ${text} WHERE id = ${sqlText(String(row.id))};`,
    );
    written[type] = {
      templateId: row.id,
      into: row.revision_id ? "draft revision" : "template row",
    };
  }
  // Read-only verification: D1 holds exactly what was written.
  const drafts = draftDocuments(run.scope);
  expect(
    drafts.find((draft) => draft.templateId === target("index").id)?.sections,
    "D1 holds the seeded home Document",
  ).toEqual(home.sections);
  expect(
    drafts.find((draft) => draft.templateId === target("layout").id)?.sections,
    "D1 holds the seeded layout Document",
  ).toEqual(layout.sections);
  // The old keys, not the new ones.
  const categories = (sectionProps(drafts, "starter-categories")?.items ??
    []) as Array<Record<string, unknown>>;
  const oldKeyProblems = [
    ...categories.flatMap((row, index) => [
      ...(typeof row.href === "string" ? [] : [`categories row ${index} has no href`]),
      ...("link" in row ? [`categories row ${index} already has link`] : []),
    ]),
    ...ACTION_SECTIONS.flatMap((section) => {
      const props = sectionProps(drafts, section) ?? {};
      return [
        ...(typeof props.actionHref === "string" ? [] : [`${section} has no actionHref`]),
        ...("action" in props ? [`${section} already has action`] : []),
      ];
    }),
  ];
  expect(oldKeyProblems, "D1 holds the old keys (href, actionHref), not the new ones").toEqual([]);
  // The editor's read, and the row ids it gives the old rows (no stored ids).
  const context = await editorContext(page, run.scope);
  const served = (section: string) =>
    context.templates
      .flatMap((template) => template.document.sections)
      .find((item) => item.id === section)?.props ?? {};
  const serverItems = (served("starter-categories").items ?? []) as Array<
    Record<string, unknown>
  >;
  const find = (section: string, path: string) =>
    sentinels.find((item) => item.section === section && item.before === path)
      ?.value ?? null;
  const cards: CardUrl[] = categories.map((_, row) => ({
    row,
    id: serverItems[row]?.id,
    title: find("starter-categories", `items.${row}.title`),
    url: find("starter-categories", `items.${row}.href`),
    shape: "href",
  }));
  const actions: ActionUrl[] = ACTION_SECTIONS.map((section) => ({
    section,
    url: find(section, "actionHref"),
    shape: "actionHref",
    label: find(section, "actionLabel"),
  }));
  const serverProblems = sentinels
    .filter((item) => item.template === "index")
    .filter((item) => valueAt(served(item.section), item.before) !== item.value)
    .map((item) => `${item.section}/${item.before}`);
  expect(serverProblems, "the editor reads every seeded value").toEqual([]);
  expect(
    cards.filter((card) => typeof card.id !== "string").map((card) => card.row),
    "the editor's read gives each old row an id",
  ).toEqual([]);
  const seed: Seeded = {
    documents: {
      starterVersion: documents.starterVersion,
      sourceCommit: documents.sourceCommit,
      sourceFile: documents.sourceFile,
      sourceBlob: documents.sourceBlob,
      sourceSha256: documents.sourceSha256,
    },
    layout: documents.layout
      ? "the version's own layout Document"
      : "emptied: no layout Document existed before v16 (the template row exists because today's provisioning made it)",
    sentinels,
    cards,
    actions,
  };
  seeds.set(run.label, seed);
  writeJson(run.dir, "seeded.json", { ...seed, written, home, layout });
  recordPositions(run, "stored before the upgrade", {
    method:
      "seeded with the version's own default Document (top-level string props.imagePosition of starter-story, the shape its Starter provisioned); no old Starter declares imagePosition, so no author could store it through the editor",
    declaredIn: declaresStoryPosition(old),
    value: STORY_POSITION,
    d1: storedStoryPosition(run.scope),
  });
  expect(storedStoryPosition(run.scope), "D1 holds the non-default story position").toBe(
    STORY_POSITION,
  );
}

const sentinelRecords = new Map<string, Record<string, unknown>>();

function recordSentinels(run: CaseRun, point: string, value: unknown) {
  const record = sentinelRecords.get(run.label) ?? {};
  record[point] = value;
  sentinelRecords.set(run.label, record);
  writeJson(run.dir, "sentinels.json", record);
}

/**
 * Every sentinel where the upgrade must keep it: in D1 and in the editor's
 * read at its post-upgrade path, each category row with the row id the
 * editor gave it before the upgrade, and, when `canvas`, on the canvas
 * (text shown, URL as a link, the position rendered).
 */
async function expectSeededContent(
  page: Page,
  run: CaseRun,
  point: string,
  canvas: boolean,
) {
  const seed = seeded(run);
  const drafts = draftDocuments(run.scope);
  const context = await editorContext(page, run.scope);
  const reads: Array<[string, Array<{ type: string | null; sections: DraftDocument["sections"] }>]> = [
    ["D1", drafts],
    [
      "editor read",
      context.templates.map((template) => ({
        type: (template as { type?: string }).type ?? null,
        sections: template.document.sections,
      })),
    ],
  ];
  const problems: string[] = [];
  for (const item of seed.sentinels) {
    for (const [name, documents] of reads) {
      const props = documents
        .filter((document) => document.type === item.template)
        .map((document) => document.sections.find((section) => section.id === item.section)?.props)
        .find((found) => found !== undefined);
      const value = valueAt(props ?? {}, item.after);
      if (value !== item.value) {
        problems.push(
          `${name} ${item.section}/${item.after}: ${JSON.stringify(value)}, not ${item.value}`,
        );
      }
    }
  }
  const items = (sectionProps(drafts, "starter-categories")?.items ?? []) as Array<
    Record<string, unknown>
  >;
  for (const card of seed.cards) {
    const id = items[card.row]?.id;
    if (id !== card.id) {
      problems.push(`D1 categories row ${card.row} is ${String(id)}, not ${String(card.id)}`);
    }
  }
  let shown: unknown = null;
  if (canvas) {
    await openEditorWithHero(page, run);
    const text = await renderedText(page);
    const frame = await previewFrame(page)
      .locator("body")
      .evaluate((body) => ({
        placeholders: [...body.querySelectorAll("[placeholder]")].map(
          (node) => node.getAttribute("placeholder") ?? "",
        ),
        links: [...body.querySelectorAll("a[href]")].map((anchor) => {
          const url = new URL(anchor.getAttribute("href")!, location.href);
          return `${url.pathname}${url.search}${url.hash}`;
        }),
      }));
    const position = await canvasStoryPosition(page);
    for (const item of seed.sentinels) {
      if (item.kind === "text" && !text.includes(item.value) && !frame.placeholders.includes(item.value)) {
        problems.push(`canvas does not show ${item.section}/${item.after} ${item.value}`);
      }
      if (item.kind === "url" && !frame.links.includes(urlPath(item.value))) {
        problems.push(`canvas has no link to ${item.section}/${item.after} ${item.value}`);
      }
      if (item.kind === "position" && position.computed !== position.expected) {
        problems.push(`canvas story image renders ${position.computed}, not ${position.expected}`);
      }
    }
    shown = { placeholders: frame.placeholders, links: frame.links, position };
  }
  recordSentinels(run, point, {
    reached: true,
    canvas,
    sentinels: seed.sentinels.length,
    shown,
    problems,
    ok: problems.length === 0,
  });
  expect
    .soft(problems, `every seeded value is kept (${point})`)
    .toEqual([]);
}

/** Every sentinel on a published or served page: text shown, URL as a link, the position. */
function expectSeededContentServed(run: CaseRun, html: string, where: string) {
  const seed = seeded(run);
  const links = [...html.matchAll(/<a\b[^>]*\bhref="([^"]*)"/gi)].map((match) =>
    urlPath(match[1]!.replace(/&amp;/g, "&")),
  );
  const problems = seed.sentinels.flatMap((item) => {
    if (item.kind === "text" && !html.includes(item.value)) {
      return [`no ${item.section}/${item.after} ${item.value}`];
    }
    if (item.kind === "url" && !links.includes(urlPath(item.value))) {
      return [`no link to ${item.section}/${item.after} ${item.value}`];
    }
    if (item.kind === "position" && !new RegExp(`object-position\\s*:\\s*${item.value}`, "i").test(html)) {
      return [`no image with object-position ${item.value}`];
    }
    return [];
  });
  recordSentinels(run, `served: ${where}`, {
    reached: true,
    problems,
    ok: problems.length === 0,
  });
  expect
    .soft(problems, `every seeded value is on the ${where}`)
    .toEqual([]);
}

/**
 * The category cards' links (user decision 2026-11-22). Two points, both
 * strict, each recorded in `<case>/links.json` whether or not it passes:
 *   (a) after the upgrade and before any edit, each category card on the
 *       canvas, and on the published or served page where the case has one,
 *       is an anchor whose href is the author's URL from the pre-upgrade D1
 *       Document (e.g. /collections/morning-table);
 *   (b) after the first copy-only edit to the cards (one card's title), each
 *       card's URL is still in D1 in a documented shape (`href`, or
 *       `link.href`) and each card on the canvas is still that anchor.
 * They fail until the category link fix lands (dev-run2: the first list
 * write drops every row's `href`).
 */
type CardUrl = {
  row: number;
  id: unknown;
  title: string | null;
  url: string | null;
  shape: "href" | "link.href" | null;
};

/** Each category row's URL, read only from the documented shapes. */
function categoryCardUrls(drafts: DraftDocument[]): CardUrl[] {
  const props = sectionProps(drafts, "starter-categories");
  const items = Array.isArray(props?.items) ? (props!.items as unknown[]) : [];
  return items.map((item, row) => {
    const value = (item ?? {}) as Record<string, unknown>;
    const link = value.link;
    const shape: CardUrl["shape"] =
      typeof value.href === "string"
        ? "href"
        : link !== null &&
            typeof link === "object" &&
            typeof (link as { href?: unknown }).href === "string"
          ? "link.href"
          : null;
    return {
      row,
      id: value.id,
      title: typeof value.title === "string" ? value.title : null,
      url:
        shape === "href"
          ? (value.href as string)
          : shape === "link.href"
            ? ((link as { href: string }).href)
            : null,
      shape,
    };
  });
}

/** A URL as a page resolves it: path, query and fragment. */
function urlPath(url: string) {
  const resolved = new URL(url, "http://storefront.invalid");
  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}

const linkRecords = new Map<string, Record<string, unknown>>();

/** Records one link point in `<case>/links.json`. */
function recordLinks(run: CaseRun, point: string, value: unknown) {
  const record = linkRecords.get(run.label) ?? {};
  record[point] = value;
  linkRecords.set(run.label, record);
  writeJson(run.dir, "links.json", record);
}

/** Every category card on the canvas: the anchor it is, or sits in, and where it goes. */
async function canvasCardLinks(page: Page) {
  const cards = previewFrame(page).locator(
    '[data-storefront-section-id="starter-categories"] [data-storefront-field="items"]',
  );
  await expect
    .poll(() => cards.count(), {
      timeout: 120_000,
      message: "the canvas renders the category cards",
    })
    .toBeGreaterThan(0);
  return cards.evaluateAll((items) =>
    items.map((item, row) => {
      const anchor =
        item.closest("a") ?? (item.querySelector("a") as HTMLAnchorElement | null);
      const href = anchor?.getAttribute("href") ?? null;
      let resolved: string | null = null;
      if (href) {
        const url = new URL(href, location.href);
        resolved = `${url.pathname}${url.search}${url.hash}`;
      }
      return {
        row,
        path: item.getAttribute("data-storefront-field-path"),
        anchor: anchor !== null,
        href,
        resolved,
      };
    }),
  );
}

/** The problems with the canvas cards against the expected URLs (none when they hold). */
function canvasLinkProblems(
  expected: CardUrl[],
  shown: Awaited<ReturnType<typeof canvasCardLinks>>,
) {
  const problems: string[] = [];
  if (shown.length !== expected.length) {
    problems.push(`${shown.length} cards on the canvas, ${expected.length} rows in the Document`);
  }
  for (const row of expected) {
    const card = shown[row.row];
    if (!row.url) problems.push(`row ${row.row}: no URL in the pre-upgrade Document`);
    else if (!card) problems.push(`row ${row.row}: no card on the canvas`);
    else if (!card.anchor) problems.push(`row ${row.row}: the card is no link`);
    else if (card.resolved !== urlPath(row.url)) {
      problems.push(`row ${row.row}: the card goes to ${card.href ?? "nothing"}, not ${row.url}`);
    }
  }
  return problems;
}

/** (a) on the canvas: after the upgrade, before any edit. */
async function expectCardLinksOnCanvas(
  page: Page,
  run: CaseRun,
) {
  const expected = seeded(run).cards;
  await openEditorWithHero(page, run);
  const shown = await canvasCardLinks(page);
  const problems = canvasLinkProblems(expected, shown);
  recordLinks(run, "a: canvas after the upgrade, before any edit", {
    reached: true,
    expected,
    shown,
    problems,
    ok: problems.length === 0,
  });
  expect
    .soft(problems, "(a) each category card on the canvas links to the author's URL")
    .toEqual([]);
}

/** (a) on a published or served page: each card is an anchor to its URL holding its title. */
function expectCardLinksServed(
  run: CaseRun,
  html: string,
  where: string,
) {
  const expected = seeded(run).cards;
  const anchors = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map(
    (match) => ({
      href: /\bhref="([^"]*)"/i.exec(match[1]!)?.[1] ?? null,
      text: match[2]!.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
    }),
  );
  const problems: string[] = [];
  const found = expected.map((row) => {
    const anchor = anchors.find(
      (item) =>
        item.href !== null &&
        row.url !== null &&
        urlPath(item.href.replace(/&amp;/g, "&")) === urlPath(row.url) &&
        row.title !== null &&
        item.text.includes(row.title),
    );
    if (!row.url) problems.push(`row ${row.row}: no URL in the pre-upgrade Document`);
    else if (!anchor) {
      problems.push(`row ${row.row}: no link to ${row.url} holding "${row.title}"`);
    }
    return { ...row, anchor: anchor ?? null };
  });
  recordLinks(run, `a: ${where}`, {
    reached: true,
    found,
    problems,
    ok: problems.length === 0,
  });
  expect
    .soft(problems, `(a) each category card on the ${where} links to the author's URL`)
    .toEqual([]);
}

/**
 * (b) The first copy-only edit to the cards: row 0's title, typed in the
 * Inspector after clicking it on the canvas. It must land; then each row's
 * URL must still be in D1 in a documented shape and each card on the canvas
 * still link to it. Row 0's title is put back and read back afterwards.
 */
async function expectCardLinksAfterCopyEdit(
  page: Page,
  run: CaseRun,
) {
  const expected = seeded(run).cards;
  const point = "b: after the first copy-only edit";
  recordLinks(run, point, { reached: false });
  await openEditorWithHero(page, run);
  await tabletCanvas(page);
  if (
    await page
      .getByRole("button", { name: "Enable section selection" })
      .isVisible()
      .catch(() => false)
  ) {
    await enableSelection(page);
  }
  const binding = (await canvasBindings(page)).find(
    (item) => item.key === "starter-categories|title#0",
  );
  expect(binding, "row 0's title is on the canvas").toBeDefined();
  const element = previewFrame(page)
    .locator("[data-storefront-field]")
    .nth(binding!.index);
  const drafts = draftDocuments(run.scope);
  const where = resolveBinding(binding!, drafts);
  expect(where.ok, "row 0's title resolves to its Document").toBe(true);
  const original = (where as { value: string }).value;
  const leaf = `${(where as { templateId: string }).templateId}/starter-categories/${(where as { location: string }).location}`;
  await element.scrollIntoViewIfNeeded();
  const misses: string[] = [];
  expect(
    await clickOwnPoint(page, element, misses),
    `row 0's title takes the click (${misses.slice(0, 4).join("; ")})`,
  ).toBe(true);
  await openContentTab(page);
  const copy = `1bcopy-${randomUUID().slice(0, 6)}`;
  await typeInto(
    (await inspectorControlFor(page, original, binding!)).control,
    copy,
  );
  await expect
    .poll(() => documentLeaves(draftDocuments(run.scope)).get(leaf), {
      timeout: 30_000,
      message: "the copy edit is stored",
    })
    .toBe(copy);
  const now = categoryCardUrls(draftDocuments(run.scope));
  const storedProblems = expected
    .map((row) => {
      const kept = now.find((item) => item.id === row.id);
      if (!row.url) return `row ${row.row}: no URL before the edit`;
      if (!kept) return `row ${row.row} (${String(row.id)}): gone from D1`;
      if (!kept.url) return `row ${row.row} (${String(row.id)}): no URL in D1 (href or link.href)`;
      if (urlPath(kept.url) !== urlPath(row.url)) {
        return `row ${row.row} (${String(row.id)}): D1 holds ${kept.url}, not ${row.url}`;
      }
      return null;
    })
    .filter((problem): problem is string => problem !== null);
  await expect(element).toHaveText(copy, { timeout: 30_000 });
  const shown = await canvasCardLinks(page);
  const canvasProblems = canvasLinkProblems(expected, shown);
  recordLinks(run, point, {
    reached: true,
    edit: { leaf, copy },
    stored: now,
    storedProblems,
    shown,
    canvasProblems,
    ok: storedProblems.length === 0 && canvasProblems.length === 0,
  });
  // Row 0's title back, read back.
  await typeInto((await inspectorControlFor(page, copy, binding!)).control, original);
  await expect
    .poll(() => documentLeaves(draftDocuments(run.scope)).get(leaf), {
      timeout: 30_000,
      message: "row 0's title is put back",
    })
    .toBe(original);
  expect
    .soft(storedProblems, "(b) after a copy edit each card's URL is still in D1")
    .toEqual([]);
  expect
    .soft(canvasProblems, "(b) after a copy edit each card on the canvas still links to it")
    .toEqual([]);
}

/**
 * The hero's and the story's (ImageWithText) action button links (user
 * decision 2026-11-22; product fix f600fae on #430: old Documents store
 * `actionHref`, the current source declares and renders `action.href`).
 * The same two strict points as the category cards, recorded in links.json:
 *   (a) after the upgrade, before any edit, each section's action button on
 *       the canvas, and on the published or served page where the case has
 *       one, links to the author's URL from the pre-upgrade D1 Document
 *       (`actionHref` or `action.href`);
 *   (b) after a first copy-only edit to the section (its heading), D1 holds
 *       the URL as `action.href` and the button still links to it.
 * The author's URLs are set before the upgrade, through the old Starter's
 * own declared field (`actionHref` up to v15, `action` from v20), so a
 * component default (the hero's /collections/new, the story's "#") can
 * never pass for the author's value.
 */
const ACTION_SECTIONS = ["starter-hero", "starter-story"] as const;
type ActionSection = (typeof ACTION_SECTIONS)[number];

type ActionUrl = {
  section: ActionSection;
  url: string | null;
  shape: "action.href" | "actionHref" | null;
  label: string | null;
};

/**
 * Each action's URL in D1. `shapes` are the shapes accepted, in order: the
 * pre-upgrade read takes `action.href` and else `actionHref`; after a copy
 * edit only `action.href` is documented.
 */
function actionUrls(
  drafts: DraftDocument[],
  shapes: ReadonlyArray<ActionUrl["shape"] & string>,
): ActionUrl[] {
  return ACTION_SECTIONS.map((section) => {
    const props = (sectionProps(drafts, section) ?? {}) as Record<
      string,
      unknown
    >;
    const action = props.action;
    const actionHref =
      action !== null &&
      typeof action === "object" &&
      typeof (action as { href?: unknown }).href === "string"
        ? (action as { href: string }).href
        : null;
    const found = shapes
      .map((shape) => ({
        shape,
        url:
          shape === "action.href"
            ? actionHref
            : typeof props.actionHref === "string"
              ? props.actionHref
              : null,
      }))
      .find((item) => item.url !== null);
    return {
      section,
      url: found?.url ?? null,
      shape: found?.shape ?? null,
      label: typeof props.actionLabel === "string" ? props.actionLabel : null,
    };
  });
}

/** Each section's action button on the canvas: the anchor it is, or sits in. */
async function canvasActionLinks(page: Page) {
  return previewFrame(page)
    .locator("body")
    .evaluate((body, sections) =>
      sections.map((section) => {
        const label = body.querySelector(
          `[data-storefront-section-id="${section}"] [data-storefront-field="actionLabel"]`,
        );
        const anchor =
          label?.closest("a") ??
          (label?.querySelector("a") as HTMLAnchorElement | null) ??
          null;
        const href = anchor?.getAttribute("href") ?? null;
        let resolved: string | null = null;
        if (href) {
          const url = new URL(href, location.href);
          resolved = `${url.pathname}${url.search}${url.hash}`;
        }
        return {
          section,
          button: label !== null,
          text: (label?.textContent ?? "").trim(),
          anchor: anchor !== null,
          href,
          resolved,
        };
      }),
    [...ACTION_SECTIONS]);
}

function actionLinkProblems(
  expected: ActionUrl[],
  shown: Awaited<ReturnType<typeof canvasActionLinks>>,
) {
  return expected.flatMap((item) => {
    const button = shown.find((entry) => entry.section === item.section);
    if (!item.url) return [`${item.section}: no URL in the pre-upgrade Document`];
    if (!button?.button) return [`${item.section}: no action button on the canvas`];
    if (!button.anchor) return [`${item.section}: the action button is no link`];
    if (button.resolved !== urlPath(item.url)) {
      return [`${item.section}: the button goes to ${button.href ?? "nothing"}, not ${item.url}`];
    }
    return [];
  });
}

/** (a) on the canvas: after the upgrade, before any edit. */
async function expectActionLinksOnCanvas(
  page: Page,
  run: CaseRun,
) {
  const expected = seeded(run).actions;
  await openEditorWithHero(page, run);
  await expect
    .poll(async () => (await canvasActionLinks(page)).filter((b) => b.button).length, {
      timeout: 120_000,
      message: "the canvas renders both action buttons",
    })
    .toBe(ACTION_SECTIONS.length);
  const shown = await canvasActionLinks(page);
  const problems = actionLinkProblems(expected, shown);
  recordLinks(run, "a: actions on the canvas after the upgrade, before any edit", {
    reached: true,
    expected,
    shown,
    problems,
    ok: problems.length === 0,
  });
  expect
    .soft(problems, "(a) the hero and story action buttons on the canvas link to the author's URL")
    .toEqual([]);
}

/** (a) on a published or served page: an anchor to each URL holding its label. */
function expectActionLinksServed(
  run: CaseRun,
  html: string,
  where: string,
) {
  const expected = seeded(run).actions;
  const anchors = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map(
    (match) => ({
      href: /\bhref="([^"]*)"/i.exec(match[1]!)?.[1] ?? null,
      text: match[2]!.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
    }),
  );
  const problems: string[] = [];
  const found = expected.map((item) => {
    const anchor = anchors.find(
      (entry) =>
        entry.href !== null &&
        item.url !== null &&
        urlPath(entry.href.replace(/&amp;/g, "&")) === urlPath(item.url) &&
        item.label !== null &&
        entry.text.includes(item.label),
    );
    if (!item.url) problems.push(`${item.section}: no URL in the pre-upgrade Document`);
    else if (!anchor) {
      problems.push(`${item.section}: no link to ${item.url} holding "${item.label}"`);
    }
    return { ...item, anchor: anchor ?? null };
  });
  recordLinks(run, `a: actions on the ${where}`, {
    reached: true,
    found,
    problems,
    ok: problems.length === 0,
  });
  expect
    .soft(problems, `(a) the hero and story action buttons on the ${where} link to the author's URL`)
    .toEqual([]);
}

/**
 * (b) A first copy-only edit to each section, its heading, typed in the
 * Inspector after clicking it on the canvas; then D1 must hold the action's
 * URL as `action.href` and the button must still link to it. Each heading is
 * put back and read back.
 */
async function expectActionLinksAfterCopyEdit(
  page: Page,
  run: CaseRun,
) {
  const expected = seeded(run).actions;
  const point = "b: actions after a first copy-only edit";
  recordLinks(run, point, { reached: false });
  await openEditorWithHero(page, run);
  await tabletCanvas(page);
  const edits: unknown[] = [];
  const problems: string[] = [];
  for (const section of ACTION_SECTIONS) {
    if (
      await page
        .getByRole("button", { name: "Enable section selection" })
        .isVisible()
        .catch(() => false)
    ) {
      await enableSelection(page);
    }
    const binding = (await canvasBindings(page)).find(
      (item) => item.key === `${section}|heading#0`,
    );
    expect(binding, `${section}'s heading is on the canvas`).toBeDefined();
    const element = previewFrame(page)
      .locator("[data-storefront-field]")
      .nth(binding!.index);
    const where = resolveBinding(binding!, draftDocuments(run.scope));
    expect(where.ok, `${section}'s heading resolves to its Document`).toBe(true);
    const original = (where as { value: string }).value;
    const leaf = `${(where as { templateId: string }).templateId}/${section}/${(where as { location: string }).location}`;
    await element.scrollIntoViewIfNeeded();
    const misses: string[] = [];
    expect(
      await clickOwnPoint(page, element, misses),
      `${section}'s heading takes the click (${misses.slice(0, 4).join("; ")})`,
    ).toBe(true);
    await openContentTab(page);
    const copy = `1bcopy-${randomUUID().slice(0, 6)}`;
    await typeInto(
      (await inspectorControlFor(page, original, binding!)).control,
      copy,
    );
    await expect
      .poll(() => documentLeaves(draftDocuments(run.scope)).get(leaf), {
        timeout: 30_000,
        message: `${section}'s copy edit is stored`,
      })
      .toBe(copy);
    await expect(element).toHaveText(copy, { timeout: 30_000 });
    const want = expected.find((item) => item.section === section)!;
    const stored = actionUrls(draftDocuments(run.scope), ["action.href"]).find(
      (item) => item.section === section,
    )!;
    if (!want.url) problems.push(`${section}: no URL before the edit`);
    else if (!stored.url) problems.push(`${section}: no action.href in D1 after the edit`);
    else if (urlPath(stored.url) !== urlPath(want.url)) {
      problems.push(`${section}: D1 action.href is ${stored.url}, not ${want.url}`);
    }
    const shown = (await canvasActionLinks(page)).find(
      (item) => item.section === section,
    );
    problems.push(
      ...actionLinkProblems([want], shown ? [shown] : []).map(
        (problem) => `after the edit, ${problem}`,
      ),
    );
    edits.push({ section, leaf, copy, stored, shown });
    if (section === "starter-story") {
      // The first edit of another story field: the image position must hold.
      await expectStoryPositionAfterEdit(page, run, `starter-story heading -> ${copy}`);
    }
    // The heading back, read back.
    await typeInto((await inspectorControlFor(page, copy, binding!)).control, original);
    await expect
      .poll(() => documentLeaves(draftDocuments(run.scope)).get(leaf), {
        timeout: 30_000,
        message: `${section}'s heading is put back`,
      })
      .toBe(original);
  }
  recordLinks(run, point, {
    reached: true,
    edits,
    problems,
    ok: problems.length === 0,
  });
  expect
    .soft(problems, "(b) after a copy edit, D1 holds action.href and each button still links to it")
    .toEqual([]);
}

/**
 * The story image's position as upgrade compatibility (user decision
 * 2026-11-22: `starter-story.imagePosition` is not made editable this
 * round). Every Starter's ImageWithText renders `imagePosition` as the
 * image's `style.objectPosition` (default "center"; the Starter's provisioned
 * Document stores "center center", default-storefront-document.ts). Points,
 * strict, recorded in positions.json with reached/ok/problems:
 *   - before the upgrade, a non-default position is stored and read back;
 *   - (a) after the upgrade, before any edit: D1 still holds it, the canvas
 *     image's computed object-position is that value's, and the published
 *     or served page renders it where the case has one;
 *   - (b) after the first edit of another story field (its heading, in the
 *     action-link (b) step): still stored and still rendered.
 */
const STORY_POSITION = "top left";

const positionRecords = new Map<string, Record<string, unknown>>();

function recordPositions(run: CaseRun, point: string, value: unknown) {
  const record = positionRecords.get(run.label) ?? {};
  record[point] = value;
  positionRecords.set(run.label, record);
  writeJson(run.dir, "positions.json", record);
}

/** Whether the installed old Starter declares the story's imagePosition. */
function declaresStoryPosition(old: Fixture) {
  const sources = old.files.filter(
    (file) =>
      file.path.endsWith("ImageWithText.tsx") ||
      file.path.includes("starter-story") ||
      file.path === MANIFEST,
  );
  return sources
    .filter((file) =>
      file.path === MANIFEST
        ? Object.entries(
            (JSON.parse(file.content) as {
              components?: Record<string, { contentFields?: Record<string, unknown> }>;
            }).components ?? {},
          ).some(
            ([name, component]) =>
              name.startsWith("image-with-text") &&
              "imagePosition" in (component.contentFields ?? {}),
          )
        : /export const contentFields[\s\S]*?\bimagePosition\s*:/.test(
            /export const contentFields[\s\S]*?\n\}/.exec(file.content)?.[0] ?? "",
          ),
    )
    .map((file) => file.path);
}

/** The story's stored imagePosition in D1 (null when absent). */
function storedStoryPosition(scope: ThemeScope) {
  const value = sectionProps(draftDocuments(scope), "starter-story")?.imagePosition;
  return typeof value === "string" ? value : null;
}

/** The story image's computed object-position, and STORY_POSITION's computed form. */
async function canvasStoryPosition(page: Page) {
  return previewFrame(page)
    .locator("body")
    .evaluate((body, wanted) => {
      const section = body.querySelector('[data-storefront-section-id="starter-story"]');
      const image =
        (section?.querySelector('img[style*="object-position"]') as HTMLImageElement | null) ??
        (section?.querySelector("img") as HTMLImageElement | null);
      const probe = document.createElement("img");
      probe.style.objectPosition = wanted;
      probe.style.display = "none";
      body.appendChild(probe);
      const expected = getComputedStyle(probe).objectPosition;
      probe.remove();
      return {
        image: image !== null,
        inline: image?.style.objectPosition ?? null,
        computed: image ? getComputedStyle(image).objectPosition : null,
        expected,
      };
    }, STORY_POSITION);
}

function positionProblems(
  stored: string | null,
  shown: Awaited<ReturnType<typeof canvasStoryPosition>>,
) {
  const problems: string[] = [];
  if (stored !== STORY_POSITION) {
    problems.push(`D1 holds ${JSON.stringify(stored)}, not ${JSON.stringify(STORY_POSITION)}`);
  }
  if (!shown.image) problems.push("no story image on the canvas");
  else if (shown.computed !== shown.expected) {
    problems.push(`the story image renders object-position ${shown.computed}, not ${shown.expected} (${STORY_POSITION})`);
  }
  return problems;
}

/** (a) After the upgrade, before any edit: stored and rendered on the canvas. */
async function expectStoryPositionAfterUpgrade(page: Page, run: CaseRun) {
  await openEditorWithHero(page, run);
  await expect(
    previewFrame(page).locator('[data-storefront-section-id="starter-story"] img').first(),
  ).toBeAttached({ timeout: 120_000 });
  const stored = storedStoryPosition(run.scope);
  const shown = await canvasStoryPosition(page);
  const problems = positionProblems(stored, shown);
  recordPositions(run, "a: canvas after the upgrade, before any edit", {
    reached: true,
    stored,
    shown,
    problems,
    ok: problems.length === 0,
  });
  expect
    .soft(problems, "(a) the story image position is kept and rendered after the upgrade")
    .toEqual([]);
}

/** (a) On a published or served page: the story image carries the position. */
function expectStoryPositionServed(run: CaseRun, html: string, where: string) {
  const images = [...html.matchAll(/<img\b[^>]*>/gi)].map((match) => match[0]);
  const positioned = images.filter((tag) =>
    /object-position\s*:\s*([^;"]+)/i.exec(tag)?.[1]?.trim().toLowerCase() ===
    STORY_POSITION,
  );
  const problems =
    positioned.length === 1
      ? []
      : [`${positioned.length} images on the ${where} carry object-position ${STORY_POSITION}`];
  recordPositions(run, `a: ${where}`, {
    reached: true,
    positioned,
    problems,
    ok: problems.length === 0,
  });
  expect
    .soft(problems, `(a) the story image on the ${where} renders the author's position`)
    .toEqual([]);
}

/** (b) After the first edit of another story field: stored and rendered. */
async function expectStoryPositionAfterEdit(page: Page, run: CaseRun, edit: string) {
  const stored = storedStoryPosition(run.scope);
  const shown = await canvasStoryPosition(page);
  const problems = positionProblems(stored, shown);
  recordPositions(run, "b: after the first edit of another story field", {
    reached: true,
    edit,
    stored,
    shown,
    problems,
    ok: problems.length === 0,
  });
  expect
    .soft(problems, "(b) the story image position survives an edit of another story field")
    .toEqual([]);
}

/**
 * (d) v11 published after its upgrade, on its own storefront, and the
 * published result read through the release the publish shows (the
 * storefront has no domain: domains reach only the run's storefront). The
 * release is this Theme's and active; its home page and its content for "/"
 * carry the author's marker, and the content's hero slot holds the author's
 * value as D1's draft did.
 */
async function publishV11(
  page: Page,
  run: CaseRun,
  marker: string,
) {
  await openEditor(page, run.editorPath);
  const draftHero = sectionProps(draftDocuments(run.scope), "starter-hero");
  expect(draftHero?.eyebrow, "the draft holds the author's value").toBe(marker);
  const shown = await publishShowingRelease(page);
  try {
    const home = await shown.fetch("/");
    const content = await shown.fetch("/_morph/content?path=%2F");
    const dir = evidenceDir(`1b-${run.label}/published`);
    writeFileSync(join(dir, "release-home.html"), home.body);
    writeFileSync(join(dir, "release-content.json"), content.body);
    expect(home.status).toBe(200);
    expect(home.body, "the published home page shows the marker").toContain(
      marker,
    );
    expect(content.status).toBe(200);
    const slots = (JSON.parse(content.body) as {
      slots?: Record<string, Record<string, unknown>>;
    }).slots;
    expect(
      slots?.["starter-hero"]?.eyebrow,
      "the published content's hero holds the author's value",
    ).toBe(marker);
    // (a) on the published page: before any edit to the cards.
    expectCardLinksServed(run, home.body, "published release page");
    expectActionLinksServed(run, home.body, "published release page");
    expectStoryPositionServed(run, home.body, "published release page");
    expectSeededContentServed(run, home.body, "published release page");
    run.record.fact("publishedRead", {
      homeStatus: home.status,
      homeSha256: sha256(home.body),
      contentStatus: content.status,
      contentSha256: sha256(content.body),
    });
  } finally {
    await shown.close();
  }
  const releaseId = await latestRelease(page, run.scope);
  const row = releaseRow(releaseId);
  expect(row.theme_id, "the release is this case's Theme's").toBe(
    run.scope.themeId,
  );
  expect(row.storefront_id).toBe(run.scope.storefrontId);
  expect(activeRelease(run.scope), "the release is active").toBe(releaseId);
  run.record.identity.releaseId = releaseId;
  run.record.identity.buildId = row.theme_build_id;
  run.record.identity.sourceRevisionId = row.source_revision_id;
  run.ledger.add({
    step: `1b/${run.label}/publish`,
    action: "publish",
    themeId: row.theme_id,
    sourceRevisionId: row.source_revision_id,
    templateDraftGeneration: homeDraftGeneration(run),
    buildId: row.theme_build_id,
    buildReused: null,
    contentPublicationId: row.content_publication_id,
    releaseId,
    activeRelease: { before: null, after: activeRelease(run.scope) },
    expectedActiveReleaseId: null,
    evidence: ["published/release-home.html", "published/release-content.json"],
  });
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
  migrated = false,
) {
  for (const [template, sections] of Object.entries(before.authorContent)) {
    for (const [section, props] of Object.entries(sections)) {
      if (migrated) {
        // An old-shape Document (seedOldShapeDocuments): every value is kept,
        // at its path or where a documented migration moves it.
        expect
          .soft(
            valueKeptProblems(props, after.authorContent[template]?.[section]),
            `${template} ${section} props kept`,
          )
          .toEqual([]);
        continue;
      }
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
   * this case (Q4: v20 and v28 carry the publish and rollback), except v11's
   * (user decision 2026-11-22: its public result is read after a publish);
   * each result record says the last step it verified.
   */
  async function readBackOnly(
    page: Page,
    browser: Browser,
    version: 11 | 15 | 26,
  ) {
    // v11 and v15 also write and read back their annotations; v11 publishes.
    if (version !== 26) test.setTimeout(75 * 60_000);
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
      if (version !== 26) {
        await run.record.step(
          "the version's own Documents, with sentinels, seeded before the upgrade",
          () => seedOldShapeDocuments(page, run, old, marker),
        );
      }
      const before = await run.record.step("before-upgrade read-back", () =>
        readBack(page, browser, run, "before", marker, {
          canvasRequired: false,
        }),
      );
      run.record.fact("beforeCanvasRendered", before.canvas.rendered);
      run.record.identity.contentTsSha256 = before.contentTs.sha256;
      run.record.identity.contentTsEdited = false;
      const v11Canvas =
        version === 11
          ? await run.record.step(
              "v11 pre-upgrade limitation: canvas marker not rendered",
              () =>
                expectV11PreUpgradeLimitation(page, run, old, before, marker),
            )
          : [];
      const listed = await run.record.step("review", async () => {
        const shown = await review(page, run);
        await apply(page, run, shown.dialog);
        return shown.paths;
      });
      const after = await run.record.step("after-upgrade read-back", () =>
        readBack(page, browser, run, "after", marker, { canvasRequired: true }),
      );
      const toUse = await run.record.step(
        "upgrade kept the author's content",
        async () => {
          let keys: ReadonlySet<string> | null = null;
          if (version === 15) {
            const kept = expectUpgradeKeptAnnotations(
              run,
              15,
              before,
              after,
              listed,
            );
            run.record.fact("changedPaths", kept.changed);
            keys = kept.exerciseKeys;
          } else if (version === 11) {
            run.record.fact(
              "changedPaths",
              expectV11AfterUpgrade(run, before, after, listed, v11Canvas),
            );
            // (c) every field of the upgraded canvas, used once.
            keys = new Set(after.canvas.bindings.map((b) => b.key));
          } else {
            run.record.fact(
              "changedPaths",
              expectUpgradeKeptAuthorContent(before, after, listed),
            );
          }
          expect(after.contentTs.sha256).not.toBeNull();
          return keys;
        },
      );
      if (version !== 26) {
        // The category cards' links (a), before any edit to them.
        await run.record.step(
          "(a) category cards link to the author's URL on the canvas after the upgrade",
          () => expectCardLinksOnCanvas(page, run),
        );
        await run.record.step(
          "(a) hero and story action buttons link to the author's URL on the canvas after the upgrade",
          () => expectActionLinksOnCanvas(page, run),
        );
        await run.record.step(
          "(a) story image position kept and rendered on the canvas after the upgrade",
          () => expectStoryPositionAfterUpgrade(page, run),
        );
        await run.record.step(
          "(a) every seeded value kept after the upgrade: D1, editor read, canvas",
          () => expectSeededContent(page, run, "after the upgrade, before any edit", true),
        );
        if (version === 11) {
          // Published before any edit, so the release shows (a) too.
          await run.record.step("published, public result read", () =>
            publishV11(page, run, marker),
          );
        } else {
          recordLinks(run, "a: published or served page", {
            reached: false,
            reason: "not verified (by design, Q4): v15 is read back only; it is not published",
          });
          recordLinks(run, "a: actions on the published or served page", {
            reached: false,
            reason: "not verified (by design, Q4): v15 is read back only; it is not published",
          });
          recordSentinels(run, "served: published or served page", {
            reached: false,
            reason: "not verified (by design, Q4): v15 is read back only; it is not published",
          });
          recordPositions(run, "a: published or served page", {
            reached: false,
            reason: "not verified (by design, Q4): v15 is read back only; it is not published",
          });
        }
        await run.record.step(
          "(b) after the first copy-only edit, category cards still link to the author's URL",
          () => expectCardLinksAfterCopyEdit(page, run),
        );
        await run.record.step(
          "(b) after a first copy-only edit, hero and story action buttons still link to the author's URL",
          () => expectActionLinksAfterCopyEdit(page, run),
        );
        await run.record.step(
          "(b) every seeded value kept after the first edits: D1, editor read, canvas",
          () => expectSeededContent(page, run, "after the first edits", true),
        );
      }
      if (toUse) {
        await run.record.step(
          version === 11
            ? "each canvas field selects, writes and reads back its own Document field after the upgrade"
            : "each pre-upgrade annotation written and read back after the upgrade",
          async () =>
            expectAnnotationsExercised(
              run,
              await exerciseAnnotations(page, run, toUse),
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
      await run.record.step(
        "the version's own Documents, with sentinels, seeded before the upgrade",
        () => seedOldShapeDocuments(page, run, V20, baselineMarker),
      );
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
      let v20Kept: ReturnType<typeof expectUpgradeKeptAnnotations> | null =
        null;
      const after = await run.record.step("after-upgrade read-back", () =>
        readBack(page, browser, run, "after", baselineMarker, {
          canvasRequired: true,
        }),
      );
      await run.record.step("upgrade kept the author's content", async () => {
        v20Kept = expectUpgradeKeptAnnotations(
          run,
          20,
          before,
          after,
          V20_REVIEW,
        );
        run.record.fact("changedPaths", v20Kept.changed);
        // The live site did not move with the upgrade.
        expect(after.public.activeRelease).toBe(baseline.releaseId);
        expect(after.public.home?.hasMarker).toBe(true);
        const files = await workspace(page, run.scope);
        for (const path of [...FLAT_COMPONENTS, MANIFEST]) {
          expect(files[path], path).toBeDefined();
        }
      });
      await run.record.step(
        "(a) category cards link to the author's URL on the canvas after the upgrade",
        () => expectCardLinksOnCanvas(page, run),
      );
      await run.record.step(
        "(a) hero and story action buttons link to the author's URL on the canvas after the upgrade",
        () => expectActionLinksOnCanvas(page, run),
      );
      await run.record.step(
        "(a) story image position kept and rendered on the canvas after the upgrade",
        () => expectStoryPositionAfterUpgrade(page, run),
      );
      await run.record.step(
        "(a) every seeded value kept after the upgrade: D1, editor read, canvas",
        () => expectSeededContent(page, run, "after the upgrade, before any edit", true),
      );
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
      await run.record.step(
        "(a) on the served page after the upgraded publish (its only edit is the hero eyebrow): cards, actions, position, seeded values",
        async () => {
          const home = await storefront("/");
          expect(home.status).toBe(200);
          expectCardLinksServed(
            run,
            home.body,
            "served page after the upgraded publish",
          );
          expectActionLinksServed(
            run,
            home.body,
            "served page after the upgraded publish",
          );
          expectStoryPositionServed(
            run,
            home.body,
            "served page after the upgraded publish",
          );
          expectSeededContentServed(
            run,
            home.body,
            "served page after the upgraded publish",
          );
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
      await run.record.step(
        "(b) after the first copy-only edit, category cards still link to the author's URL",
        () => expectCardLinksAfterCopyEdit(page, run),
      );
      await run.record.step(
        "(b) after a first copy-only edit, hero and story action buttons still link to the author's URL",
        () => expectActionLinksAfterCopyEdit(page, run),
      );
      await run.record.step(
        "(b) every seeded value kept after the first edits: D1, editor read, canvas",
        () => expectSeededContent(page, run, "after the first edits", true),
      );
      // After every publish-result check, so its draft writes (each put back
      // and read back) cannot move what those checks saw.
      await run.record.step(
        "each pre-upgrade annotation written and read back after the upgrade",
        async () => {
          expectAnnotationsExercised(
            run,
            await exerciseAnnotations(page, run, v20Kept!.exerciseKeys),
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
