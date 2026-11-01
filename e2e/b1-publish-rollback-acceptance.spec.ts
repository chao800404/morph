import { expect, test, type Browser, type Page } from "@playwright/test";

import { queryLifecycleD1 } from "../scripts/verify-published-artifact.mjs";
import { B1_HOME_LAYOUT_CASES } from "../src/lib/test-utils/binding-acceptance-b1-cases";
import {
  storedSectionsOf,
  type BasCase,
  type StoredDocument,
  type StoredSections,
} from "../src/lib/test-utils/binding-acceptance-cases";
import {
  seedSingletonCases,
  storedCaseSections,
  walkCase,
  type Fixture,
} from "./binding-acceptance-helpers";
import {
  DOMAINS,
  RELEASES,
  latestRelease,
  openEditor,
  publishShowingRelease,
  serverFn,
  signedInPage,
  storefrontFetcher,
  storefrontHarness,
} from "./native-acceptance";
import { themeScopeFromEditorPath } from "./native-compat";

/**
 * B1 publish and rollback on the home route and the layout-shared sections
 * (M1 gaps (b) and (g): no B1 route had ever been published, and the home and
 * layout cases had no publish case).
 *
 * The cases are `B1_HOME_LAYOUT_CASES`, h1 and l1, written onto the run's own
 * Theme: h1 becomes its home route, l1 its root layout, so both are what the
 * public site serves. Each edit is a full Design walk (`walkCase`, S1-S5:
 * canvas, location, the editor's real write, the raw D1 Document, reload),
 * on the second instance of each case, which shares its title text with the
 * first.
 *
 *   release 1  h1 in the Inspector, l1 on the canvas, then published
 *   release 2  h1 on the canvas, l1 in the Inspector; the draft stays off the
 *              public site until it is published
 *   rollback   release 1 re-activated (OCC on the active release); after a
 *              reload every case is back to release 1's values
 *
 * Each release is checked three ways: the release's own content publication
 * in D1 holds the values, the public HTML carries them, and the public DOM
 * shows each element's value in place, on the home page and on a non-home
 * page, so the first instance keeping "SALE" while the second changes is seen
 * where it renders. The served artifact is the local operator stand-in
 * (`storefrontHarness`), as in m1-container-lifecycle-acceptance.spec.ts.
 *
 * Serial: a failed step skips the rest, and CI requires every listed test to
 * have passed (scripts/container-acceptance-targets/b1-publish-rollback.mjs),
 * so a skip is never evidence.
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
  "B1 publish and rollback acceptance requires cloudflare-sandbox transport.",
);
test.skip(
  PREVIEW_RUNTIME !== "start",
  "B1 publish and rollback acceptance requires full Start preview runtime (MORPH_E2E_PREVIEW_RUNTIME=start).",
);

const scope = EDITOR_PATH ? themeScopeFromEditorPath(EDITOR_PATH) : null;
const HOST = "b1-publish.localhost";

const caseById = (id: string) => {
  const found = B1_HOME_LAYOUT_CASES.find((testCase) => testCase.id === id);
  if (!found) throw new Error(`no B1 case ${id}`);
  return found;
};
const H1 = caseById("h1");
const L1 = caseById("l1");
const HOME = "/";
const NON_HOME = L1.layout!.pages.find((page) => page.routePath !== HOME)!.routePath;

/** Both cases' own sections, as one release holds them. */
type CaseValues = Readonly<{ h1: StoredSections; l1: StoredSections }>;

/** The field each case's edit lands on: the second instance's title. */
const editedField = (testCase: BasCase) => {
  const target = testCase.elements[testCase.edit.element]!.target;
  if (target.kind !== "field") throw new Error(`${testCase.id} edits no field`);
  return target;
};

const valueOf = (stored: StoredSections, testCase: BasCase) => {
  const { section, field } = editedField(testCase);
  return stored[section]?.[field] ?? "";
};

/** The edited values of a release: what must and must not be on a page. */
const editedValues = (values: CaseValues) => [
  valueOf(values.h1, H1),
  valueOf(values.l1, L1),
];

test.describe("B1 publish and rollback on the home and layout-shared cases", () => {
  test.describe.configure({ mode: "serial" });
  test.use({ actionTimeout: 60_000 });

  const harness = STATE_DIR
    ? storefrontHarness({ scope: scope!, stateDir: STATE_DIR })
    : null;
  const fx: Fixture | null = EDITOR_PATH
    ? { scope: scope!, editorPath: EDITOR_PATH }
    : null;
  let domainId: string | null = null;
  let origin = "";
  let release1 = "";
  let release2 = "";
  let publication1: string | null = null;
  let values1: CaseValues | null = null;
  let values2: CaseValues | null = null;

  const queryD1 = (sql: string, ...params: unknown[]) =>
    queryLifecycleD1(STATE_DIR!, sql, ...params) as Array<Record<string, unknown>>;

  /** Both cases' sections in their draft Documents, read raw from D1. */
  const draftValues = async (): Promise<CaseValues> => ({
    h1: await storedCaseSections(fx!, H1),
    l1: await storedCaseSections(fx!, L1),
  });

  /**
   * Both cases' sections in a release's own content publication: the index
   * and layout revisions it pins, not the templates' current rows.
   */
  const releaseValues = (releaseId: string): CaseValues => {
    const rows = queryD1(
      `SELECT t.type AS type, t.route_path AS route_path, r.document AS document
         FROM storefront_releases rel
         JOIN storefront_content_publication_items i ON i.publication_id = rel.content_publication_id
         JOIN storefront_theme_template_revisions r ON r.id = i.revision_id
         JOIN storefront_theme_templates t ON t.id = r.template_id
        WHERE rel.id = ?1 AND t.theme_id = ?2`,
      releaseId,
      scope!.themeId,
    );
    const documentOf = (type: "index" | "layout") => {
      const found = rows.filter(
        (row) => row.type === type && (type === "layout" || row.route_path === null),
      );
      expect(found, `release ${releaseId} pins one ${type} revision`).toHaveLength(1);
      return storedSectionsOf(JSON.parse(String(found[0]!.document)) as StoredDocument);
    };
    const own = (testCase: BasCase, stored: StoredSections) =>
      Object.fromEntries(testCase.slots.map((slot) => [slot, stored[slot]]));
    return {
      h1: own(H1, documentOf("index")),
      l1: own(L1, documentOf("layout")),
    };
  };

  /**
   * Two-instance isolation in storage: each case's second instance holds an
   * edit in the one field Design wrote, and everything else, the first
   * instance (which shares its title text) included, is still the seed.
   */
  const expectIsolated = (values: CaseValues) => {
    for (const testCase of [H1, L1]) {
      const stored = values[testCase.id as "h1" | "l1"];
      const { section, field } = editedField(testCase);
      const edit = valueOf(stored, testCase);
      expect(edit, `${testCase.id} ${section}.${field} holds an edit`).not.toBe(
        valueOf(testCase.seed, testCase),
      );
      expect(stored, `${testCase.id} changed in ${section}.${field} only`).toEqual({
        ...testCase.seed,
        [section]: { ...testCase.seed[section], [field]: edit },
      });
    }
  };

  /** A Design walk that must pass in full before anything is published. */
  const designWalk = async (page: Page, testCase: BasCase, mode: "inspector" | "inline") => {
    const before = valueOf((await draftValues())[testCase.id as "h1" | "l1"], testCase);
    await walkCase(page, testCase, mode, fx!);
    expect(test.info().errors, `${testCase.id} ${mode} Design walk`).toEqual([]);
    const after = valueOf((await draftValues())[testCase.id as "h1" | "l1"], testCase);
    expect(after, `${testCase.id} ${mode} wrote a new value`).not.toBe(before);
    return after;
  };

  /**
   * The public site shows `values` on the home page and the non-home page:
   * the raw HTML carries them and none of `absent`, and the DOM shows every
   * element's value in place. Checked again after a reload.
   */
  const expectPublic = async (browser: Browser, values: CaseValues, absent: readonly string[]) => {
    const storefront = storefrontFetcher(origin);
    const pages = [
      { path: HOME, cases: [H1, L1], missing: [] as BasCase[] },
      { path: NON_HOME, cases: [L1], missing: [H1] },
    ];
    for (const { path, cases } of pages) {
      const html = await storefront(path);
      expect(html.status, `${path} is served`).toBe(200);
      for (const testCase of cases) {
        expect(html.body, `${path} HTML carries ${testCase.id}'s edit`).toContain(
          valueOf(values[testCase.id as "h1" | "l1"], testCase),
        );
      }
      for (const value of absent) {
        expect(html.body, `${path} HTML carries no other release's value`).not.toContain(value);
      }
    }
    const shopper = await browser.newPage();
    try {
      for (const { path, cases, missing } of pages) {
        const shown = async (when: string) => {
          for (const testCase of cases) {
            const root = shopper.locator(`[data-bas-case="${testCase.id}"]`);
            await expect(root, `${path} renders ${testCase.id} ${when}`).toBeVisible({
              timeout: 30_000,
            });
            for (const element of testCase.elements) {
              await expect(
                root.locator(element.tag).nth(element.nth),
                `${path} ${testCase.id} ${element.tag}[${element.nth}] ${when}`,
              ).toHaveText(element.text(values[testCase.id as "h1" | "l1"]), { timeout: 30_000 });
            }
          }
          for (const testCase of missing) {
            await expect(shopper.locator(`[data-bas-case="${testCase.id}"]`)).toHaveCount(0);
          }
          for (const value of absent) {
            await expect(shopper.getByText(value, { exact: false })).toHaveCount(0);
          }
        };
        const response = await shopper.goto(`${origin}${path}`, { waitUntil: "domcontentloaded" });
        expect(response?.status(), `${path} is served`).toBe(200);
        await shown("on load");
        const reloaded = await shopper.reload({ waitUntil: "domcontentloaded" });
        expect(reloaded?.status(), `${path} is served after a reload`).toBe(200);
        await shown("after a reload");
      }
    } finally {
      await shopper.close();
    }
  };

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(600_000);
    const page = await signedInPage(browser);
    try {
      await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
      // h1 becomes the home route and l1 the root layout of the run's Theme,
      // seeded through the editor's own writes.
      await seedSingletonCases(page, fx!);
      expect(await draftValues()).toEqual({ h1: H1.seed, l1: L1.seed });

      const domain = (await serverFn(page, DOMAINS, "createStorefrontDomain", {
        storefrontId: scope!.storefrontId,
        hostname: HOST,
      })) as { success: boolean; message?: string; data?: { id: string } };
      expect(domain.success, domain.message).toBe(true);
      domainId = domain.data!.id;
      origin = `http://${HOST}:${new URL(test.info().project.use.baseURL!).port}`;
    } finally {
      await page.context().close();
    }
  });

  test.afterAll(async ({ browser }) => {
    try {
      if (domainId) {
        const page = await signedInPage(browser);
        try {
          await page.goto("/", { waitUntil: "domcontentloaded" });
          // As in the lifecycle spec: the local stand-in domain has no
          // Cloudflare custom domain, and a primary domain cannot be deleted.
          await harness?.writeD1(
            "UPDATE storefront_domains SET is_primary = 0, cloudflare_domain_id = NULL WHERE id = ?1",
            domainId,
          );
          const removed = (await serverFn(page, DOMAINS, "deleteStorefrontDomains", {
            ids: [domainId],
          })) as { success: boolean; message?: string };
          expect(removed.success, removed.message).toBe(true);
        } finally {
          await page.context().close();
        }
      }
    } finally {
      await harness?.dispose();
    }
  });

  test("release 1: h1 home route second instance edited in the Inspector through Design", async ({ page }) => {
    await designWalk(page, H1, "inspector");
  });

  test("release 1: l1 layout-shared second instance edited on the canvas through Design", async ({ page }) => {
    await designWalk(page, L1, "inline");
  });

  test("release 1: published, the public home and non-home pages show its values with each instance its own", async ({ page, browser }) => {
    test.setTimeout(15 * 60_000);
    const values = await draftValues();
    expectIsolated(values);

    // Connected but never published: nothing is served, the draft least of all.
    const storefront = storefrontFetcher(origin);
    const before = await storefront(HOME);
    expect(before.status).toBe(404);
    for (const value of editedValues(values)) expect(before.body).not.toContain(value);

    const { publishedState, serveActiveRelease, releaseBuild } = harness!;
    const state0 = await publishedState();
    await openEditor(page);
    await (await publishShowingRelease(page)).close();
    release1 = await latestRelease(page, scope!);
    expect(release1).not.toBe(state0.active);
    const state1 = await publishedState();
    expect(state1.active).toBe(release1);
    expect(state1.releases).toBe(state0.releases + 1);

    // The release pins exactly the values Design wrote, for both Documents.
    expect(releaseValues(release1)).toEqual(values);
    publication1 = (await releaseBuild(release1)).releaseContent;
    expect(publication1).toBeTruthy();

    const served = await serveActiveRelease(valueOf(values.h1, H1), release1, origin);
    expect(served.releaseId).toBe(release1);
    values1 = values;
    await expectPublic(browser, values1, []);
  });

  test("release 2: h1 home route second instance edited on the canvas through Design", async ({ page }) => {
    await designWalk(page, H1, "inline");
  });

  test("release 2: l1 layout-shared second instance edited in the Inspector through Design", async ({ page }) => {
    await designWalk(page, L1, "inspector");
  });

  test("release 2: the draft stays off the public site until published, then the public site shows release 2", async ({ page, browser }) => {
    test.setTimeout(15 * 60_000);
    const values = await draftValues();
    expectIsolated(values);
    const r1 = editedValues(values1!);
    const r2 = editedValues(values);
    for (const [index, value] of r2.entries()) expect(value).not.toBe(r1[index]);

    // The draft is not public while release 1 is active.
    await expectPublic(browser, values1!, r2);

    const { publishedState, serveActiveRelease, releaseBuild } = harness!;
    await openEditor(page);
    await (await publishShowingRelease(page)).close();
    release2 = await latestRelease(page, scope!);
    expect(release2).not.toBe(release1);
    const state2 = await publishedState();
    expect(state2.active).toBe(release2);

    expect(releaseValues(release2)).toEqual(values);
    // Release 1 still pins its own values: publishing again changed nothing in it.
    expect(releaseValues(release1)).toEqual(values1);
    const publication2 = (await releaseBuild(release2)).releaseContent;
    expect(publication2).toBeTruthy();
    expect(publication2).not.toBe(publication1);

    const served = await serveActiveRelease(valueOf(values.h1, H1), release2, origin);
    expect(served.releaseId).toBe(release2);
    values2 = values;
    await expectPublic(browser, values2, r1);
  });

  test("rollback to release 1: after a reload every case on the public site is back to release 1", async ({ page, browser }) => {
    test.setTimeout(15 * 60_000);
    const { publishedState, serveActiveRelease } = harness!;
    const before = await publishedState();
    expect(before.active).toBe(release2);

    await openEditor(page);
    const activated = (await serverFn(page, RELEASES, "activateStorefrontRelease", {
      storefrontId: scope!.storefrontId,
      releaseId: release1,
      expectedActiveReleaseId: release2,
    })) as { success: boolean; message?: string };
    expect(activated.success, activated.message).toBe(true);

    const after = await publishedState();
    expect(after.active).toBe(release1);
    expect(after.releases).toBe(before.releases);
    // A rollback moves the active release only: the drafts keep release 2's
    // values, and each release still pins its own.
    expect(await draftValues()).toEqual(values2);
    expect(releaseValues(release1)).toEqual(values1);
    expect(releaseValues(release2)).toEqual(values2);

    const restored = await serveActiveRelease(valueOf(values1!.h1, H1), release1, origin);
    expect(restored.releaseId).toBe(release1);
    expect(restored.contentPublicationId).toBe(publication1);
    await expectPublic(browser, values1!, editedValues(values2!));
  });
});
