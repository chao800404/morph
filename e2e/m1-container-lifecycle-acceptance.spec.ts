import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { queryRunD1 } from "../scripts/verify-published-artifact.mjs";
import { STOREFRONT_STARTER_TEMPLATE_VERSION } from "../src/lib/storefront/default-storefront-document";
import {
  clickExposedElement,
  enableSelection,
  openContentTab,
  previewFrame,
  settleSelection,
} from "./helpers";
import {
  DOMAINS,
  RELEASES,
  editorContext,
  latestRelease,
  openEditor,
  publishShowingRelease,
  savedField,
  serverFn,
  signedInPage,
  storefrontFetcher,
  storefrontHarness,
} from "./native-acceptance";
import { themeScopeFromEditorPath } from "./native-compat";

/**
 * M1 Fixed-Version Container Lifecycle Acceptance
 *
 * Scope:
 * 1. Design B1 canvas field click & Inspector sync -> Draft A write -> Pre-publish public draft isolation
 * 2. Cloudflare Sandbox native Build & Publish -> Release 1
 * 3. 8799 Storefront verification & Draft B edit -> Public draft isolation
 * 4. Sandbox native Build & Publish -> Release 2
 * 5. OCC CAS re-activation of Release 1 (active pointer rollback, template published_revision_id remains B)
 * 6. Storefront reload & sealed content/mandatory asset verification
 *
 * Requirements:
 * - Runs only under cloudflare-sandbox transport and full Start preview runtime.
 * - Skipped runs NEVER count as passed evidence.
 * - Relative generation progression:
 *     draftGeneration: g0 -> g1 (g0+1, edit) -> g2 (g1+2, pub1) -> g3 (g2+1, edit2) -> g4 (g3+1 indep / g3+2 dep, pub2) -> g4 (rollback)
 *     releaseGeneration: rg0 -> rg0+1 (pub1) -> rg0+1 (edit2) -> rg0+2 (pub2) -> rg0+2 (rollback)
 * - Proves Starter version = 29 (STOREFRONT_STARTER_TEMPLATE_VERSION).
 * - Proves contentDependency from actual build output without premature assumptions.
 * - Connects public domain before draft isolation assertions.
 * - Inspected asset scope: strictly verifies the static asset (/assets/...) linked in the home page HTML returns HTTP 200 (does not claim uninspected global asset coverage).
 * - Teardown of ephemeral test environment: cleans up test domain and verifies zero residual rows in D1.
 * - Non-goals / Unverified boundaries:
 *     - Second build execution in container (Build 2) is UNVERIFIED (theme build was reused under content-independence).
 *     - Automated deployment pipeline is UNVERIFIED (8799 harness is an operator-managed local stand-in).
 */

const STATE_DIR = process.env.MORPH_E2E_STATE_DIR;
const TRANSPORT = process.env.E2E_EXPECT_PREVIEW_TRANSPORT;
const PREVIEW_RUNTIME = process.env.MORPH_E2E_PREVIEW_RUNTIME;
const EDITOR_PATH = process.env.E2E_EDITOR_PATH;

test.skip(
  !EDITOR_PATH || !STATE_DIR,
  "Run through scripts/run-editor-e2e.mjs: this reads the run's own D1 and R2.",
);
test.skip(
  TRANSPORT !== "cloudflare-sandbox",
  "M1 container lifecycle acceptance requires cloudflare-sandbox transport.",
);
test.skip(
  PREVIEW_RUNTIME !== "start",
  "M1 container lifecycle acceptance requires full Start preview runtime (MORPH_E2E_PREVIEW_RUNTIME=start).",
);

const scope = EDITOR_PATH ? themeScopeFromEditorPath(EDITOR_PATH) : null;
const HOST = "m1-accept.localhost";
const ROUTE = "/";

type AcceptanceIdentities = {
  themeId: string;
  templateId: string;
  initialSourceRevisionId: string | null;
  sourceRevisionId: string | null;
  draftRevisionA: string | null;
  build1: string | null;
  pub1: string | null;
  release1: string | null;
  contentDependency1: "dependent" | "independent" | null;
  draftRevisionB: string | null;
  build2: string | null;
  pub2: string | null;
  release2: string | null;
  contentDependency2: "dependent" | "independent" | null;
};

// DIAG(302): diagnostic branch only, never merged. Observes; asserts nothing.
const diagEvents: Array<Record<string, unknown>> = [];
function diagRecord(kind: string, data: Record<string, unknown>) {
  const event = { at: new Date().toISOString(), kind, ...data };
  diagEvents.push(event);
  console.log(`[diag-302] ${JSON.stringify(event)}`);
}
function diagUrl(url: string) {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname.includes(".preview.") ? "preview" : parsed.hostname,
      path: parsed.pathname,
    };
  } catch {
    return { host: "?", path: "?" };
  }
}

test.describe("M1 container lifecycle acceptance", () => {
  test.afterEach(() => {
    mkdirSync("test-results", { recursive: true });
    writeFileSync(
      "test-results/diag-302-events.json",
      JSON.stringify(diagEvents, null, 2),
    );
  });
  test.describe.configure({ mode: "serial" });
  test.setTimeout(45 * 60_000);
  test.use({ actionTimeout: 60_000 });

  const harness = STATE_DIR
    ? storefrontHarness({ scope: scope!, stateDir: STATE_DIR })
    : null;
  let domainId: string | null = null;

  async function queryD1(sql: string, ...params: unknown[]) {
    const dir = mkdtempSync(join(tmpdir(), "m1-query-"));
    try {
      return await queryRunD1(
        { persistTo: STATE_DIR!, workDir: dir },
        sql,
        ...params,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  async function queryLifecycleSnapshot(
    templateId: string,
    themeId: string,
    storefrontId: string,
  ) {
    const [templateRow] = (await queryD1(
      `SELECT t.id,
              t.document AS published_document,
              t.draft_revision_id,
              t.published_revision_id,
              t.draft_generation,
              r.document AS draft_document
         FROM storefront_theme_templates t
    LEFT JOIN storefront_theme_template_revisions r ON r.id = t.draft_revision_id
        WHERE t.id = ?1`,
      templateId,
    )) as Array<{
      id: string;
      published_document: string | null;
      draft_revision_id: string | null;
      published_revision_id: string | null;
      draft_generation: number;
      draft_document: string | null;
    }>;

    const [themeRow] = (await queryD1(
      "SELECT release_generation, source_generation, published_source_revision_id, metadata FROM storefront_themes WHERE id = ?1",
      themeId,
    )) as Array<{
      release_generation: number;
      source_generation: number;
      published_source_revision_id: string | null;
      metadata: string;
    }>;

    const [sfRow] = (await queryD1(
      "SELECT active_release_id FROM storefronts WHERE id = ?1",
      storefrontId,
    )) as Array<{
      active_release_id: string | null;
    }>;

    const parseHeroHeading = (docJson: string | null | undefined) => {
      if (!docJson) return null;
      try {
        const doc = JSON.parse(docJson);
        const hero = doc.sections?.find((s: any) => s.id === "starter-hero");
        return (hero?.props?.heading ?? hero?.props?.title ?? null) as string | null;
      } catch {
        return null;
      }
    };

    const draftHeroHeading =
      parseHeroHeading(templateRow?.draft_document) ??
      parseHeroHeading(templateRow?.published_document);
    const publishedHeroHeading = parseHeroHeading(templateRow?.published_document);

    return {
      template: {
        id: templateRow?.id,
        draftRevisionId: templateRow?.draft_revision_id,
        publishedRevisionId: templateRow?.published_revision_id,
        draftGeneration: Number(templateRow?.draft_generation),
        draftHeroHeading,
        publishedHeroHeading,
      },
      theme: {
        releaseGeneration: Number(themeRow?.release_generation),
        sourceGeneration: Number(themeRow?.source_generation),
        publishedSourceRevisionId: themeRow?.published_source_revision_id,
        metadata: JSON.parse(themeRow?.metadata ?? "{}"),
      },
      storefront: {
        activeReleaseId: sfRow?.active_release_id ?? null,
      },
    };
  }

  async function ensureSelection(page: import("@playwright/test").Page) {
    const enable = page.getByRole("button", { name: "Enable section selection" });
    if (await enable.isVisible().catch(() => false)) {
      await enableSelection(page);
    }
  }

  test.afterAll(async ({ browser }) => {
    try {
      if (domainId) {
        const cleanupPage = await signedInPage(browser);
        try {
          await cleanupPage.goto("/", { waitUntil: "domcontentloaded" });
          // Local test stand-in domain has no remote Cloudflare Custom Domain to detach,
          // and serverFn deleteStorefrontDomains guards against deleting primary domains.
          // Prepare the domain row so deleteStorefrontDomains executes cleanly through the serverFn.
          await harness?.writeD1(
            "UPDATE storefront_domains SET is_primary = 0, cloudflare_domain_id = NULL WHERE id = ?1",
            domainId,
          );
          const cleanupRes = (await serverFn(
            cleanupPage,
            DOMAINS,
            "deleteStorefrontDomains",
            {
              ids: [domainId],
            },
          )) as { success: boolean; message?: string };
          expect(cleanupRes.success, cleanupRes.message).toBe(true);

          const domainRows = (await queryD1(
            "SELECT id FROM storefront_domains WHERE id = ?1 AND deleted_at IS NULL",
            domainId,
          )) as Array<{ id: string }>;
          expect(
            domainRows.length,
            "Cleaned-up domain must not remain in D1",
          ).toBe(0);
        } finally {
          await cleanupPage.context().close();
        }
      }
    } finally {
      await harness?.dispose();
    }
  });

  test("Design B1 -> Build/Publish Release 1 -> Storefront draft isolation -> Release 2 -> Rollback Release 1 -> Reload", async ({
    page,
  }) => {
    // DIAG(302): observers only.
    await page.addInitScript(() => {
      const seen = new WeakMap<Element, string>();
      const report = () => {
        for (const el of document.querySelectorAll(
          '[role="alert"],[role="status"],[aria-live],[data-sonner-toast]',
        )) {
          const text = (el.textContent ?? "").trim().slice(0, 300);
          if (text && seen.get(el) !== text) {
            seen.set(el, text);
            console.log(`[diag-notice] ${text}`);
          }
        }
      };
      new MutationObserver(report).observe(document, {
        subtree: true,
        childList: true,
        characterData: true,
      });
    });
    page.on("console", (message) => {
      const text = message.text();
      if (
        /\[preview-probe\]|\[diag-notice\]|preview/i.test(text) ||
        message.type() === "error" ||
        message.type() === "warning"
      )
        diagRecord("console", { type: message.type(), text: text.slice(0, 400) });
    });
    page.on("framenavigated", (frame) =>
      diagRecord(
        frame === page.mainFrame() ? "page-navigated" : "frame-navigated",
        diagUrl(frame.url()),
      ),
    );
    page.on("response", (response) => {
      if (response.status() >= 400)
        diagRecord("response", {
          status: response.status(),
          method: response.request().method(),
          ...diagUrl(response.url()),
        });
    });
    page.on("requestfailed", (request) =>
      diagRecord("request-failed", {
        method: request.method(),
        failure: request.failure()?.errorText ?? null,
        ...diagUrl(request.url()),
      }),
    );

    // Assert full Start runtime explicitly
    expect(
      PREVIEW_RUNTIME,
      "Test must execute in full Start preview runtime",
    ).toBe("start");

    const identities: AcceptanceIdentities = {
      themeId: scope!.themeId,
      templateId: "",
      initialSourceRevisionId: null,
      sourceRevisionId: null,
      draftRevisionA: null,
      build1: null,
      pub1: null,
      release1: null,
      contentDependency1: null,
      draftRevisionB: null,
      build2: null,
      pub2: null,
      release2: null,
      contentDependency2: null,
    };

    const contentA = `m1-hero-A-${randomUUID().slice(0, 8)}`;
    const draftB = `m1-hero-B-${randomUUID().slice(0, 8)}`;
    const contentB = draftB;

    const origin = `http://${HOST}:${new URL(test.info().project.use.baseURL!).port}`;
    const storefront = storefrontFetcher(origin);
    const { serveActiveRelease, publishedState, releaseBuild } = harness!;

    // =========================================================================
    // 0. Preconditions & Initial Isolated Storefront State
    // =========================================================================
    const initialPublished = await publishedState();
    const relCount0 = initialPublished.releases;
    const r0 = initialPublished.active;

    const [indexTemplateRow] = (await queryD1(
      "SELECT id FROM storefront_theme_templates WHERE theme_id = ?1 AND type = 'index' AND deleted_at IS NULL",
      scope!.themeId,
    )) as Array<{ id: string }>;
    expect(
      indexTemplateRow?.id,
      "Home template of type index must exist in D1",
    ).toBeDefined();

    await openEditor(page);
    const ctx0 = await editorContext(page, scope!);
    const home0 = ctx0.templates.find(
      (t) => t.id === indexTemplateRow.id && t.document,
    );
    expect(
      home0,
      "Home template of type index must exist in editor context",
    ).toBeDefined();
    if (!home0) throw new Error("Home template missing");

    identities.templateId = home0.id;

    // Snapshot 0: Verify Starter Template Version is 29 on the tested head
    const snap0 = await queryLifecycleSnapshot(home0.id, scope!.themeId, scope!.storefrontId);
    expect(
      snap0.theme.metadata.starterTemplateVersion,
      "Tested head must record Starter Template Version 29",
    ).toBe(STOREFRONT_STARTER_TEMPLATE_VERSION);

    identities.initialSourceRevisionId = snap0.theme.publishedSourceRevisionId;
    expect(
      identities.initialSourceRevisionId,
      "Before first publish, theme published_source_revision_id must be null in D1",
    ).toBeNull();

    const g0 = snap0.template.draftGeneration;
    const rg0 = snap0.theme.releaseGeneration;
    const initialPublishedRevId = snap0.template.publishedRevisionId;
    const initialDraftRevId = snap0.template.draftRevisionId;
    const initialHeroHeading = snap0.template.publishedHeroHeading;

    // =========================================================================
    // 1. Design B1 Canvas Field Click & Inspector Sync -> Draft A Write
    // =========================================================================
    await ensureSelection(page);

    const heroSectionA = previewFrame(page).locator(
      '[data-storefront-section-id="starter-hero"]',
    );
    await expect(
      heroSectionA,
      "Starter hero section must exist on canvas",
    ).toBeVisible({ timeout: 45_000 });

    const heroTitleA = heroSectionA
      .locator(
        '[data-storefront-field="heading"], [data-storefront-field="title"], h1',
      )
      .first();
    await expect(
      heroTitleA,
      "Hero title/heading element must exist on canvas",
    ).toBeVisible({ timeout: 30_000 });

    await heroTitleA.scrollIntoViewIfNeeded();
    const clickedA = await clickExposedElement(page, heroTitleA);
    expect(
      clickedA,
      "Canvas exposed hero title element was clicked",
    ).not.toBeNull();

    await settleSelection(page);
    await openContentTab(page);

    const inspectorFieldA = page
      .locator('[data-slot="inspector-content-field"]')
      .filter({ hasText: /heading|title/i })
      .first();
    if (!(await inspectorFieldA.isVisible().catch(() => false))) {
      const heroButton = page.getByRole("button", { name: "hero", exact: true });
      if (await heroButton.isVisible().catch(() => false)) {
        await heroButton.click();
        await settleSelection(page);
        await openContentTab(page);
      }
    }
    await expect(
      inspectorFieldA,
      "Inspector heading/title field must be visible",
    ).toBeVisible({ timeout: 30_000 });

    const inputA = inspectorFieldA.locator("input, textarea").first();
    await expect(
      inputA,
      "Inspector input for heading/title must be visible",
    ).toBeVisible({ timeout: 30_000 });

    const canvasTextBeforeA = (await heroTitleA.textContent())?.trim();
    const inspectorValBeforeA = await inputA.inputValue();
    if (canvasTextBeforeA) {
      expect(inspectorValBeforeA).toBe(canvasTextBeforeA);
    }

    await inputA.fill(contentA);
    await inputA.press("Tab");

    await savedField(page, scope!, contentA);

    await expect(
      heroSectionA.getByText(contentA, { exact: false }).first(),
    ).toBeVisible({ timeout: 30_000 });

    // Raw D1 Diff Assertions for Step 1:
    // draftGeneration: g0 -> g0 + 1
    // draftHeroHeading: contentA
    // publishedHeroHeading: initial (isolated)
    // draft_revision_id: newly generated id
    // published_revision_id: unchanged
    // releaseGeneration: unchanged (rg0)
    // active_release_id: unchanged (r0)
    const snap1 = await queryLifecycleSnapshot(home0.id, scope!.themeId, scope!.storefrontId);
    const g1 = snap1.template.draftGeneration;
    expect(g1).toBe(g0 + 1);
    expect(snap1.template.draftHeroHeading).toBe(contentA);
    expect(snap1.template.publishedHeroHeading).toBe(initialHeroHeading);
    expect(snap1.template.draftRevisionId).not.toBeNull();
    expect(snap1.template.draftRevisionId).not.toBe(initialDraftRevId);
    expect(snap1.template.publishedRevisionId).toBe(initialPublishedRevId);
    expect(snap1.theme.releaseGeneration).toBe(rg0);
    expect(snap1.storefront.activeReleaseId).toBe(r0);

    identities.draftRevisionA = snap1.template.draftRevisionId;

    // Connect storefront domain before Release 1 publish to verify pre-publish draft isolation
    const domain = (await serverFn(page, DOMAINS, "createStorefrontDomain", {
      storefrontId: scope!.storefrontId,
      hostname: HOST,
    })) as { success: boolean; message?: string; data?: { id: string } };
    expect(domain.success, domain.message).toBe(true);
    domainId = domain.data!.id;

    // Public Draft Isolation Assertion BEFORE Release 1:
    // The public domain is connected, but Release 1 has NOT yet been published.
    // The storefront router must refuse unreleased traffic (HTTP 404) and strictly MUST NOT leak Draft A.
    const resPre = await storefront(ROUTE);
    expect(resPre.status).toBe(404);
    expect(resPre.body).not.toContain(contentA);

    const contentResPre = await storefront("/_morph/content?path=%2F");
    expect(contentResPre.status).toBe(404);
    expect(contentResPre.body).not.toContain(contentA);

    // =========================================================================
    // 2. Container Native Build & Publish -> Release 1
    // =========================================================================
    const shown1 = await publishShowingRelease(page);
    await shown1.close();

    const release1 = await latestRelease(page, scope!);
    identities.release1 = release1;
    expect(release1).not.toBe(r0);

    const relBuild1 = await releaseBuild(release1);
    identities.build1 = relBuild1.buildId;
    identities.pub1 = relBuild1.releaseContent;
    identities.contentDependency1 = relBuild1.dependency;

    expect(identities.build1).toBeTruthy();
    expect(identities.pub1).toBeTruthy();

    // Prove contentDependency from actual build output without premature assumption
    expect(["dependent", "independent"]).toContain(
      identities.contentDependency1,
    );
    if (identities.contentDependency1 === "dependent") {
      expect(relBuild1.releaseContent).toBe(relBuild1.buildContent);
    }

    // Raw D1 Diff Assertions for Step 2:
    // draftGeneration: g1 -> g1 + 2 (alwaysPrepare + publish increments)
    // published_revision_id: advances to draftRevisionA
    // draftHeroHeading: contentA
    // publishedHeroHeading: contentA
    // releaseGeneration: rg0 -> rg0 + 1
    // active_release_id: advances to release1
    const snap2 = await queryLifecycleSnapshot(home0.id, scope!.themeId, scope!.storefrontId);
    const g2 = snap2.template.draftGeneration;
    expect(g2).toBe(g1 + 2);
    expect(snap2.template.draftHeroHeading).toBe(contentA);
    expect(snap2.template.publishedHeroHeading).toBe(contentA);
    expect(snap2.template.publishedRevisionId).toBe(identities.draftRevisionA);
    expect(snap2.theme.releaseGeneration).toBe(rg0 + 1);
    expect(snap2.storefront.activeReleaseId).toBe(release1);

    // Record and assert publishedSourceRevisionId after Release 1 publish
    expect(snap2.theme.publishedSourceRevisionId).toBeTruthy();
    identities.sourceRevisionId = snap2.theme.publishedSourceRevisionId;
    const [rel1Row] = (await queryD1(
      "SELECT source_revision_id FROM storefront_releases WHERE id = ?1",
      release1,
    )) as Array<{ source_revision_id: string }>;
    expect(rel1Row?.source_revision_id).toBe(identities.sourceRevisionId);

    const stateAfterPub1 = await publishedState();
    expect(stateAfterPub1.active).toBe(release1);
    expect(stateAfterPub1.releases).toBe(relCount0 + 1);

    // =========================================================================
    // 3. Storefront Verification & Draft B Edit
    // =========================================================================
    // Start 8799 Theme Worker for Release 1
    const pub1Info = await serveActiveRelease(contentA, release1, origin);
    expect(pub1Info.releaseId).toBe(release1);
    expect(pub1Info.buildId).toBe(identities.build1);

    // Public site serves Release 1 content
    const res1 = await storefront(ROUTE);
    expect(res1.status).toBe(200);
    expect(res1.body).toContain(contentA);

    const contentRes1 = await storefront("/_morph/content?path=%2F");
    expect(contentRes1.status).toBe(200);
    expect(contentRes1.body).toContain(contentA);

    // Inspected asset scope: strictly asserts the built static asset (/assets/...) linked in the rendered home page HTML returns HTTP 200
    const assetMatches1 = /(?:href|src)="(\/assets\/[^"]+)"/.exec(res1.body);
    expect(
      assetMatches1,
      "Public storefront HTML must link built static asset",
    ).not.toBeNull();
    const asset1 = assetMatches1![1];
    const assetRes1 = await storefront(asset1);
    expect(
      assetRes1.status,
      `Inspected home page static asset ${asset1} must return HTTP 200`,
    ).toBe(200);

    // Perform second B1 canvas click and Inspector edit -> Draft B
    await openEditor(page);
    // DIAG(302): draft state right after the editor reopened.
    {
      const diagSnap = await queryLifecycleSnapshot(
        home0.id,
        scope!.themeId,
        scope!.storefrontId,
      );
      const diagHero = await previewFrame(page)
        .locator('[data-storefront-section-id="starter-hero"]')
        .first()
        .textContent({ timeout: 5_000 })
        .catch((error: unknown) => `unavailable: ${String(error).slice(0, 120)}`);
      diagRecord("draft-after-reopen", {
        draftHeroHeading: diagSnap.template.draftHeroHeading,
        publishedHeroHeading: diagSnap.template.publishedHeroHeading,
        draftRevisionId: diagSnap.template.draftRevisionId,
        heroTextHasContentA: diagHero?.includes(contentA) ?? null,
      });
    }
    await ensureSelection(page);

    const heroSectionB = previewFrame(page).locator(
      '[data-storefront-section-id="starter-hero"]',
    );
    await expect(heroSectionB).toBeVisible({ timeout: 45_000 });

    const heroTitleB = heroSectionB
      .locator(
        '[data-storefront-field="heading"], [data-storefront-field="title"], h1',
      )
      .first();
    await expect(heroTitleB).toBeVisible({ timeout: 30_000 });

    await heroTitleB.scrollIntoViewIfNeeded();
    const clickedB = await clickExposedElement(page, heroTitleB);
    expect(
      clickedB,
      "Canvas hero title element was clicked for Draft B",
    ).not.toBeNull();

    await settleSelection(page);
    await openContentTab(page);

    const inspectorFieldB = page
      .locator('[data-slot="inspector-content-field"]')
      .filter({ hasText: /heading|title/i })
      .first();
    if (!(await inspectorFieldB.isVisible().catch(() => false))) {
      const heroButton = page.getByRole("button", { name: "hero", exact: true });
      if (await heroButton.isVisible().catch(() => false)) {
        await heroButton.click();
        await settleSelection(page);
        await openContentTab(page);
      }
    }
    await expect(inspectorFieldB).toBeVisible({ timeout: 30_000 });

    const inputB = inspectorFieldB.locator("input, textarea").first();
    await expect(inputB).toBeVisible({ timeout: 30_000 });

    await inputB.fill(draftB);
    await inputB.press("Tab");

    await savedField(page, scope!, draftB);

    await expect(
      heroSectionB.getByText(draftB, { exact: false }).first(),
    ).toBeVisible({ timeout: 30_000 });

    // Raw D1 Diff Assertions for Step 3:
    // draftGeneration: g2 -> g2 + 1
    // draftHeroHeading: draftB
    // publishedHeroHeading: contentA (still Release 1 published document!)
    // draft_revision_id: new id, not draftRevisionA
    // published_revision_id: unchanged (still draftRevisionA)
    // releaseGeneration: unchanged (rg0 + 1)
    // active_release_id: unchanged (release1)
    const snap3 = await queryLifecycleSnapshot(home0.id, scope!.themeId, scope!.storefrontId);
    const g3 = snap3.template.draftGeneration;
    expect(g3).toBe(g2 + 1);
    expect(snap3.template.draftHeroHeading).toBe(draftB);
    expect(snap3.template.publishedHeroHeading).toBe(contentA);
    expect(snap3.template.draftRevisionId).not.toBeNull();
    expect(snap3.template.draftRevisionId).not.toBe(identities.draftRevisionA);
    expect(snap3.template.publishedRevisionId).toBe(identities.draftRevisionA);
    expect(snap3.theme.releaseGeneration).toBe(rg0 + 1);
    expect(snap3.storefront.activeReleaseId).toBe(release1);

    identities.draftRevisionB = snap3.template.draftRevisionId;

    // Public Draft Isolation Assertion: storefront still serves Content-A, NEVER Draft-B
    const res2 = await storefront(ROUTE);
    expect(res2.status).toBe(200);
    expect(res2.body).toContain(contentA);
    expect(res2.body).not.toContain(draftB);

    const contentRes2 = await storefront("/_morph/content?path=%2F");
    expect(contentRes2.status).toBe(200);
    expect(contentRes2.body).toContain(contentA);
    expect(contentRes2.body).not.toContain(draftB);

    // =========================================================================
    // 4. Container Native Build & Publish -> Release 2
    // =========================================================================
    const shown2 = await publishShowingRelease(page);
    await shown2.close();

    const release2 = await latestRelease(page, scope!);
    identities.release2 = release2;
    expect(release2).not.toBe(release1);

    const relBuild2 = await releaseBuild(release2);
    identities.build2 = relBuild2.buildId;
    identities.pub2 = relBuild2.releaseContent;
    identities.contentDependency2 = relBuild2.dependency;

    expect(identities.pub2).toBeTruthy();
    expect(identities.pub2).not.toBe(identities.pub1);
    expect(["dependent", "independent"]).toContain(
      identities.contentDependency2,
    );
    if (identities.contentDependency2 === "dependent") {
      expect(identities.build2).not.toBe(identities.build1);
      expect(relBuild2.releaseContent).toBe(relBuild2.buildContent);
    } else {
      expect(identities.build2).toBe(identities.build1);
    }

    // Raw D1 Diff Assertions for Step 4:
    // draftGeneration: if build was triggered (dependent), g3 + 2; if build was reused (independent), g3 + 1
    // draftHeroHeading: contentB
    // publishedHeroHeading: contentB
    // published_revision_id: advances to draftRevisionB
    // releaseGeneration: rg0 + 1 -> rg0 + 2
    // active_release_id: advances to release2
    const snap4 = await queryLifecycleSnapshot(home0.id, scope!.themeId, scope!.storefrontId);
    const g4 = snap4.template.draftGeneration;
    expect(g4).toBe(
      identities.contentDependency2 === "dependent" ? g3 + 2 : g3 + 1,
    );
    expect(snap4.template.draftHeroHeading).toBe(contentB);
    expect(snap4.template.publishedHeroHeading).toBe(contentB);
    expect(snap4.template.publishedRevisionId).toBe(identities.draftRevisionB);
    expect(snap4.theme.releaseGeneration).toBe(rg0 + 2);
    expect(snap4.storefront.activeReleaseId).toBe(release2);

    const stateAfterPub2 = await publishedState();
    expect(stateAfterPub2.active).toBe(release2);
    expect(stateAfterPub2.releases).toBe(relCount0 + 2);

    // Switch 8799 harness to Release 2
    await serveActiveRelease(contentB, release2, origin);

    // Public site now serves Content-B, no longer Content-A
    const res3 = await storefront(ROUTE);
    expect(res3.status).toBe(200);
    expect(res3.body).toContain(contentB);
    expect(res3.body).not.toContain(contentA);

    const contentRes3 = await storefront("/_morph/content?path=%2F");
    expect(contentRes3.status).toBe(200);
    expect(contentRes3.body).toContain(contentB);
    expect(contentRes3.body).not.toContain(contentA);

    // =========================================================================
    // 5. OCC CAS Re-activation of Release 1 (Active Pointer Rollback)
    // =========================================================================
    // Test OCC conflict rejection:
    // When the active release is Release 2, attempt activation with a valid but obsolete expectedActiveReleaseId (Release 1).
    // The server function must reject with error code RELEASE_ACTIVATION_CONFLICT.
    const conflictRes = (await serverFn(
      page,
      RELEASES,
      "activateStorefrontRelease",
      {
        storefrontId: scope!.storefrontId,
        releaseId: release1,
        expectedActiveReleaseId: release1,
      },
    )) as { success: boolean; message?: string; error?: string };
    expect(conflictRes.success).toBe(false);
    expect(conflictRes.error).toBe("RELEASE_ACTIVATION_CONFLICT");

    // Immediately verify raw D1 state after conflict rejection and BEFORE legitimate rollback:
    // Assert active release, template revisions, generations, and release count are completely untouched.
    const snapConflict = await queryLifecycleSnapshot(home0.id, scope!.themeId, scope!.storefrontId);
    expect(snapConflict.storefront.activeReleaseId).toBe(release2);
    expect(snapConflict.theme.releaseGeneration).toBe(rg0 + 2);
    expect(snapConflict.template.draftGeneration).toBe(g4);
    expect(snapConflict.template.draftRevisionId).toBe(identities.draftRevisionB);
    expect(snapConflict.template.draftHeroHeading).toBe(contentB);
    expect(snapConflict.template.publishedRevisionId).toBe(identities.draftRevisionB);
    expect(snapConflict.template.publishedHeroHeading).toBe(contentB);

    const stateConflict = await publishedState();
    expect(stateConflict.active).toBe(release2);
    expect(stateConflict.releases).toBe(relCount0 + 2);

    // Legitimate OCC CAS activation of Release 1
    const activateRes = (await serverFn(
      page,
      RELEASES,
      "activateStorefrontRelease",
      {
        storefrontId: scope!.storefrontId,
        releaseId: release1,
        expectedActiveReleaseId: release2,
      },
    )) as { success: boolean; message?: string };
    expect(activateRes.success, activateRes.message).toBe(true);

    // Raw D1 Diff Assertions for Step 5:
    // active_release_id: moves back to release1 (active release pointer rollback)
    // releaseGeneration: remains rg0 + 2 (NOT incremented!)
    // Note: When Release 2 was published, Revision B became the template's published_revision_id in D1.
    // The rollback only moves the active release pointer back to Release 1 without touching template rows.
    // Therefore, published_revision_id remains draftRevisionB (B is already published at template revision level),
    // while the storefront sales channel runtime is pinned back to Release 1.
    // draftGeneration: remains g4 (NOT rolled back!)
    // draft_revision_id: remains draftRevisionB (NOT rolled back!)
    // draftHeroHeading: remains contentB (NOT rolled back!)
    // published_revision_id: remains draftRevisionB (template-level published revision is unchanged)
    const snap5 = await queryLifecycleSnapshot(home0.id, scope!.themeId, scope!.storefrontId);
    expect(snap5.storefront.activeReleaseId).toBe(release1);
    expect(snap5.theme.releaseGeneration).toBe(rg0 + 2);
    expect(snap5.template.draftGeneration).toBe(g4);
    expect(snap5.template.draftRevisionId).toBe(identities.draftRevisionB);
    expect(snap5.template.draftHeroHeading).toBe(contentB);
    expect(snap5.template.publishedRevisionId).toBe(identities.draftRevisionB);

    const stateAfterRollback = await publishedState();
    expect(stateAfterRollback.active).toBe(release1);
    expect(stateAfterRollback.releases).toBe(relCount0 + 2);

    // =========================================================================
    // 6. Public Storefront Reload & Rollback Verification
    // =========================================================================
    // Switch 8799 harness back to Release 1
    const restored = await serveActiveRelease(contentA, release1, origin);
    expect(restored.buildId).toBe(identities.build1);
    expect(restored.contentPublicationId).toBe(identities.pub1);

    // Public storefront reload returns Content-A, strictly excluding Content-B
    const res4 = await storefront(ROUTE);
    expect(res4.status).toBe(200);
    expect(res4.body).toContain(contentA);
    expect(res4.body).not.toContain(contentB);

    const contentRes4 = await storefront("/_morph/content?path=%2F");
    expect(contentRes4.status).toBe(200);
    expect(contentRes4.body).toContain(contentA);
    expect(contentRes4.body).not.toContain(contentB);

    // Inspected asset scope: strictly asserts the restored built static asset (/assets/...) linked in the restored home page HTML returns HTTP 200
    const assetMatches4 = /(?:href|src)="(\/assets\/[^"]+)"/.exec(res4.body);
    expect(
      assetMatches4,
      "Restored storefront HTML must link built static asset",
    ).not.toBeNull();
    const asset4 = assetMatches4![1];
    const assetRes4 = await storefront(asset4);
    expect(
      assetRes4.status,
      `Restored home page static asset ${asset4} must return HTTP 200`,
    ).toBe(200);

    console.log("[M1_ACCEPTANCE_IDENTITIES]", JSON.stringify(identities, null, 2));
  });
});
