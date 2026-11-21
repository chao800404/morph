import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Browser, type Page } from "@playwright/test";

import { queryLifecycleD1 } from "../scripts/verify-published-artifact.mjs";
import { STOREFRONT_STARTER_TEMPLATE_VERSION } from "../src/lib/storefront/default-storefront-document";
import {
  assertServerFnSuccess,
  decodeServerFnResult,
  isServerFunctionCall,
  previewFrame,
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
  type Fetcher,
} from "./native-acceptance";
import {
  removeThemeFiles,
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
 * Isolation. Releases, domains and the active release are a storefront's,
 * so each case runs on a storefront of its own, created through the product
 * path a merchant uses (`createSalesChannel` with type "storefront", which
 * creates the storefront, its Theme and the current Starter's workspace;
 * `storefrontDal.ensureDefault`). No case reads or writes another's
 * storefront or the run's shared editor Theme, so each one's preconditions
 * (v28: nothing published yet on its storefront) hold in any order and with
 * `-g` on one title. This removes #360's known limit, where v28 and v20
 * shared the run's storefront and v28's precondition only held if it ran
 * first. Each storefront and Theme is left as its case ended it: the upgrade
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
 * A storefront of the case's own, made the way a merchant makes one, with
 * its Theme recorded and verified as full Start (Q10).
 */
async function setUpCase(
  page: Page,
  label: string,
  starter: number | null,
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

/** Each template's sections' props, by template type/name and section id. */
type AuthorContent = Record<string, Record<string, unknown>>;

type ReadBack = {
  at: string;
  starterVersion: unknown;
  contentTs: { sha256: string | null; bytes: number | null };
  routes: Record<string, string>;
  workspaceSha256: Record<string, string>;
  authorContent: AuthorContent;
  canvas: { rendered: boolean; marker: string; fields: FieldText[] };
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
    canvas: { rendered, marker, fields },
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
  const shown = (
    await starter
      .getByRole("button")
      .evaluateAll((buttons) =>
        buttons.map(
          (button) =>
            button.getAttribute("aria-label") ?? button.textContent ?? "",
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

async function connectDomain(page: Page, run: CaseRun) {
  const domain = (await serverFn(page, DOMAINS, "createStorefrontDomain", {
    storefrontId: run.scope.storefrontId,
    hostname: run.host,
  })) as { success: boolean; message?: string; data?: { id: string } };
  expect(domain.success, domain.message).toBe(true);
  run.domainId = domain.data!.id;
  connectedDomains.push(domain.data!.id);
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
  expect((await run.harness.publishedState()).active).toBe(releaseId);
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
          expectUpgradeKeptAuthorContent(before, after, listed),
        );
        expect(after.contentTs.sha256).not.toBeNull();
      });
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

  test("B1 v20: read back, refused build, reviewed upgrade, published, rolled back to the release serving before the upgrade", async ({
    page,
    browser,
  }) => {
    const V20 = fixture(20);
    const run = await setUpCase(page, "b1-v20", 20);
    try {
      const storefront = storefrontFetcher(origin(run.host));
      // The release serving before the upgrade: built and published from the
      // current Starter on this Theme, since v20's own bytes cannot be built
      // before the upgrade. Restoring an artifact of v20's own bytes stays
      // UNVERIFIED for that reason.
      const baselineMarker = `m1-1b-v20-base-${randomUUID().slice(0, 8)}`;
      const baseline = await run.record.step(
        "baseline release serving",
        async () => {
          await connectDomain(page, run);
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
      await run.record.step(
        "old workspace build refused, site unchanged",
        async () => {
          const releasesBefore = (await run.harness.publishedState()).releases;
          await openEditor(page, run.editorPath);
          const refused = await build(page, run, "1b/b1-v20/refused-build");
          expect(refused?.status).toBe("failed");
          expect(refused?.error_message ?? "").toContain(
            "INVALID_START_PACKAGE",
          );
          const unchanged = await run.harness.publishedState();
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
          expectUpgradeKeptAuthorContent(before, after, V20_REVIEW),
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
      const upgraded = await run.record.step(
        "upgraded source built and published",
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
      await run.record.step(
        "a later draft stays off the public site",
        async () => {
          await editHeroDraft(page, run, draftD);
          await expectPublicSite(storefront, contentB, [
            baselineMarker,
            draftD,
          ]);
        },
      );
      await run.record.step(
        "rolled back to the release serving before the upgrade",
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
      await run.record.step("full Start", async () => expectFullStart(run));
    } finally {
      await finish(run);
    }
  });

  test("B1 v28: read back, published from its own bytes, reviewed upgrade, published, rolled back", async ({
    page,
    browser,
  }) => {
    const run = await setUpCase(page, "b1-v28", 28);
    try {
      const storefront = storefrontFetcher(origin(run.host));
      await run.record.step("installed v28", async () => {
        await installStarter(page, run, V28);
        await expectOpeningWritesNothing(page, run, 28);
      });
      const contentA = `m1-1b-v28-a-${randomUUID().slice(0, 8)}`;
      const r0 = await run.record.step(
        "R0 published from v28's own bytes",
        async () => {
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
      const r1 = await run.record.step(
        "R1 published from the upgraded source",
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
      await run.record.step(
        "a later draft stays off the public site",
        async () => {
          await editHeroDraft(page, run, draftD);
          await expectPublicSite(storefront, contentB, [contentA, draftD]);
        },
      );
      await run.record.step(
        "rolled back to R0, the release serving before the upgrade",
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

  test("B2 v26: content.ts the author edited is kept byte for byte, the review says why, its read result is unchanged, then published", async ({
    page,
    browser,
  }) => {
    const V26 = fixture(26);
    const original = V26.files.find((file) => file.path === CONTENT);
    expect(original, "v26 has a content module").toBeDefined();
    const edited = original!.content + AUTHOR_EDIT;
    const run = await setUpCase(page, "b2-v26", 26);
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
      await run.record.step("published, public read result", async () => {
        await connectDomain(page, run);
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
      });
      await run.record.step("full Start", async () => expectFullStart(run));
    } finally {
      await finish(run);
    }
  });
});
