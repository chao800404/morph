import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { queryRunD1 } from "../scripts/verify-published-artifact.mjs";
import { STOREFRONT_STARTER_TEMPLATE_VERSION } from "../src/lib/storefront/default-storefront-document";
import { clickExposedElement, openContentTab, previewFrame } from "./helpers";
import {
  DOMAINS,
  RELEASES,
  editorContext,
  latestRelease,
  openEditor,
  publishShowingRelease,
  serverFn,
  storefrontFetcher,
  storefrontHarness,
} from "./native-acceptance";
import { themeScopeFromEditorPath } from "./native-compat";

/**
 * M1 Fixed-Version Container Lifecycle Acceptance
 *
 * Scope:
 * 1. Design B1 canvas field click & Inspector sync -> Draft A write
 * 2. Cloudflare Sandbox native Build & Publish -> Release 1
 * 3. Domain provisioning, 8799 Storefront verification & Draft B edit -> Public draft isolation
 * 4. Sandbox native Build & Publish -> Release 2
 * 5. OCC CAS re-activation of Release 1 (active pointer rollback, no theme generation bump)
 * 6. Storefront reload & sealed content/asset verification
 *
 * Requirements:
 * - Runs only under cloudflare-sandbox transport and full Start preview runtime.
 * - Skipped runs NEVER count as passed evidence.
 * - Relative generation progression:
 *     draftGeneration: g0 -> g0+1 (edit) -> g0+2 (pub1) -> g0+3 (edit2) -> g0+4 (pub2) -> g0+4 (rollback)
 *     releaseGeneration: rg0 -> rg0+1 (pub1) -> rg0+1 (edit2) -> rg0+2 (pub2) -> rg0+2 (rollback)
 * - Proves Starter version = 29 (STOREFRONT_STARTER_TEMPLATE_VERSION).
 * - Proves contentDependency from actual build output without premature assumptions.
 * - Connects public domain before draft isolation assertions.
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
  sourceRevisionId: string;
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

test.describe("M1 container lifecycle acceptance", () => {
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

  test.afterAll(async ({ browser }) => {
    await harness?.dispose();
    if (domainId) {
      const page = await browser.newPage();
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await serverFn(page, DOMAINS, "deleteStorefrontDomains", {
        ids: [domainId],
      });
      await page.close();
    }
  });

  test("Design B1 -> Build/Publish Release 1 -> Storefront draft isolation -> Release 2 -> Rollback Release 1 -> Reload", async ({
    page,
  }) => {
    // Assert full Start runtime explicitly
    expect(
      PREVIEW_RUNTIME,
      "Test must execute in full Start preview runtime",
    ).toBe("start");

    const identities: AcceptanceIdentities = {
      themeId: scope!.themeId,
      templateId: "",
      sourceRevisionId: "",
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

    await openEditor(page);
    const ctx0 = await editorContext(page, scope!);
    const home0 = ctx0.templates.find((t) => t.id && t.document);
    expect(home0, "Home template must exist in editor context").toBeDefined();
    if (!home0) throw new Error("Home template missing");

    identities.templateId = home0.id;

    // Verify Starter Template Version is 29 on the tested head
    const [themeRow] = await queryD1(
      "SELECT metadata, release_generation, source_generation, published_source_revision_id FROM storefront_themes WHERE id = ?1",
      scope!.themeId,
    );
    const themeMetadata = JSON.parse(
      (themeRow as { metadata?: string })?.metadata ?? "{}",
    );
    expect(
      themeMetadata.starterTemplateVersion,
      "Tested head must record Starter Template Version 29",
    ).toBe(STOREFRONT_STARTER_TEMPLATE_VERSION);

    identities.sourceRevisionId =
      (themeRow as { published_source_revision_id?: string })
        ?.published_source_revision_id ?? "";

    const [homeRow0] = await queryD1(
      "SELECT draft_generation, published_revision_id, draft_revision_id FROM storefront_theme_templates WHERE id = ?1",
      home0.id,
    );
    const g0 = Number((homeRow0 as any).draft_generation);
    const rg0 = ctx0.theme.releaseGeneration;
    const initialPublishedRevId = (homeRow0 as any).published_revision_id;

    // =========================================================================
    // 1. Design B1 Canvas Field Click & Inspector Sync -> Draft A Write
    // =========================================================================
    const exposedA = previewFrame(page)
      .locator('[data-storefront-field="title"], h1[data-storefront-field]')
      .first();
    await expect(exposedA).toBeVisible({ timeout: 45_000 });

    const clickedA = await clickExposedElement(page, exposedA);
    expect(
      clickedA,
      "Canvas exposed element with data-storefront-field was clicked",
    ).not.toBeNull();

    await openContentTab(page);
    const inputA = page
      .locator('[data-slot="inspector-content-field"] input')
      .first();
    await expect(inputA).toBeVisible({ timeout: 30_000 });

    const canvasTextBefore = (await exposedA.textContent())?.trim();
    const inspectorValBefore = await inputA.inputValue();
    if (canvasTextBefore) {
      expect(inspectorValBefore).toBe(canvasTextBefore);
    }

    await inputA.fill(contentA);
    await inputA.press("Tab");

    await expect(
      previewFrame(page).getByText(contentA, { exact: false }).first(),
    ).toBeVisible({ timeout: 30_000 });

    // Assert relative generation advancement after draft edit: g0 -> g0 + 1
    const [homeRow1] = await queryD1(
      "SELECT draft_generation, draft_revision_id, published_revision_id FROM storefront_theme_templates WHERE id = ?1",
      home0.id,
    );
    expect(Number((homeRow1 as any).draft_generation)).toBe(g0 + 1);

    const ctx1 = await editorContext(page, scope!);
    expect(ctx1.theme.releaseGeneration).toBe(rg0);

    identities.draftRevisionA = (homeRow1 as any).draft_revision_id;
    expect(identities.draftRevisionA).not.toBeNull();
    expect((homeRow1 as any).published_revision_id).toBe(
      initialPublishedRevId,
    );

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

    // Publish advances both draftGeneration (g0+1 -> g0+2) and releaseGeneration (rg0 -> rg0+1)
    const [homeRow2] = await queryD1(
      "SELECT draft_generation, published_revision_id FROM storefront_theme_templates WHERE id = ?1",
      home0.id,
    );
    expect(Number((homeRow2 as any).draft_generation)).toBe(g0 + 2);
    expect((homeRow2 as any).published_revision_id).toBe(
      identities.draftRevisionA,
    );

    const ctx2 = await editorContext(page, scope!);
    expect(ctx2.theme.releaseGeneration).toBe(rg0 + 1);

    const stateAfterPub1 = await publishedState();
    expect(stateAfterPub1.active).toBe(release1);
    expect(stateAfterPub1.releases).toBe(relCount0 + 1);

    // =========================================================================
    // 3. Domain Provisioning, Storefront Verification & Draft B Edit
    // =========================================================================
    // Connect storefront domain before draft isolation assertion
    const domain = (await serverFn(page, DOMAINS, "createStorefrontDomain", {
      storefrontId: scope!.storefrontId,
      hostname: HOST,
    })) as { success: boolean; message?: string; data?: { id: string } };
    expect(domain.success, domain.message).toBe(true);
    domainId = domain.data!.id;

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

    const assetMatches1 = /(?:href|src)="(\/assets\/[^"]+)"/.exec(res1.body);
    const asset1 = assetMatches1 ? assetMatches1[1] : null;
    if (asset1) {
      const assetRes1 = await storefront(asset1);
      expect(assetRes1.status).toBe(200);
    }

    // Perform second B1 canvas click and Inspector edit -> Draft B
    await openEditor(page);
    const exposedB = previewFrame(page)
      .locator('[data-storefront-field="title"], h1[data-storefront-field]')
      .first();
    await expect(exposedB).toBeVisible({ timeout: 45_000 });
    const clickedB = await clickExposedElement(page, exposedB);
    expect(clickedB).not.toBeNull();

    await openContentTab(page);
    const inputB = page
      .locator('[data-slot="inspector-content-field"] input')
      .first();
    await expect(inputB).toBeVisible({ timeout: 30_000 });
    await inputB.fill(draftB);
    await inputB.press("Tab");

    await expect(
      previewFrame(page).getByText(draftB, { exact: false }).first(),
    ).toBeVisible({ timeout: 30_000 });

    // Draft edit advances draftGeneration: g0+2 -> g0+3
    const [homeRow3] = await queryD1(
      "SELECT draft_generation, draft_revision_id, published_revision_id FROM storefront_theme_templates WHERE id = ?1",
      home0.id,
    );
    expect(Number((homeRow3 as any).draft_generation)).toBe(g0 + 3);

    identities.draftRevisionB = (homeRow3 as any).draft_revision_id;
    expect(identities.draftRevisionB).not.toBe(identities.draftRevisionA);
    expect((homeRow3 as any).published_revision_id).toBe(
      identities.draftRevisionA,
    );

    const ctx3 = await editorContext(page, scope!);
    expect(ctx3.theme.releaseGeneration).toBe(rg0 + 1);

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

    expect(identities.build2).not.toBe(identities.build1);
    expect(["dependent", "independent"]).toContain(
      identities.contentDependency2,
    );
    if (identities.contentDependency2 === "dependent") {
      expect(relBuild2.releaseContent).toBe(relBuild2.buildContent);
    }

    // Publish advances draftGeneration (g0+3 -> g0+4) and releaseGeneration (rg0+1 -> rg0+2)
    const [homeRow4] = await queryD1(
      "SELECT draft_generation, published_revision_id FROM storefront_theme_templates WHERE id = ?1",
      home0.id,
    );
    expect(Number((homeRow4 as any).draft_generation)).toBe(g0 + 4);
    expect((homeRow4 as any).published_revision_id).toBe(
      identities.draftRevisionB,
    );

    const ctx4 = await editorContext(page, scope!);
    expect(ctx4.theme.releaseGeneration).toBe(rg0 + 2);

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
    // Test OCC conflict rejection
    const conflictRes = (await serverFn(
      page,
      RELEASES,
      "activateStorefrontRelease",
      {
        storefrontId: scope!.storefrontId,
        releaseId: release1,
        expectedActiveReleaseId: "wrong-active-release-id",
      },
    )) as { success: boolean; message?: string };
    expect(conflictRes.success).toBe(false);

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

    // Active pointer moves back to release1
    const stateAfterRollback = await publishedState();
    expect(stateAfterRollback.active).toBe(release1);
    expect(stateAfterRollback.releases).toBe(relCount0 + 2);

    // Confirm Theme releaseGeneration does NOT increase on activation (remains rg0 + 2)
    const ctx5 = await editorContext(page, scope!);
    expect(ctx5.theme.releaseGeneration).toBe(rg0 + 2);

    // Template draft remains draftRevisionB and draftGeneration remains g0 + 4 (not rolled back)
    const [homeRow5] = await queryD1(
      "SELECT draft_generation, draft_revision_id FROM storefront_theme_templates WHERE id = ?1",
      home0.id,
    );
    expect(Number((homeRow5 as any).draft_generation)).toBe(g0 + 4);
    expect((homeRow5 as any).draft_revision_id).toBe(identities.draftRevisionB);

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

    const assetMatches4 = /(?:href|src)="(\/assets\/[^"]+)"/.exec(res4.body);
    const asset4 = assetMatches4 ? assetMatches4[1] : null;
    if (asset4) {
      const assetRes4 = await storefront(asset4);
      expect(assetRes4.status).toBe(200);
    }
  });
});
