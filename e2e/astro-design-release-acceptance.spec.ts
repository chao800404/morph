import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { EDITOR_PATH } from "./helpers";
import {
  astroCaseTheme,
  astroField,
  frameShowing,
  liveFrame,
  openEditorAt,
  openPageFromList,
  recordEditor,
  selectCase,
  withProps,
  writeField,
  type D3Document,
} from "./helpers/astro-d3";
import { execLocalD1 } from "./helpers/editor-writes-paused";
import {
  DOMAINS,
  RELEASES,
  latestRelease,
  publishShowingRelease,
  serverFn,
  signedInPage,
  storefrontFetcher,
} from "./native-acceptance";
import { themeScopeFromEditorPath, type ThemeScope } from "./native-compat";
import { astroConfig } from "../src/lib/storefront/theme-framework/astro-native-prerender.fixtures";
import {
  D3_DEFAULT_TITLE,
  D3_HERO,
  D3_HERO_FIELDS_PATH,
  D3_HERO_PATH,
  d3HeroFields,
  d3ReleaseAboutPage,
  d3ReleaseHomePage,
  d3Row,
} from "../src/lib/test-utils/astro-d3-cases";

/**
 * Astro M2 D3 rows 21-23 and row 24's page isolation: Design edits on a
 * native `.astro` site, published, rolled back and reloaded, as Start's M1
 * `b1-route-publish-rollback-acceptance.spec.ts` does for its routes.
 *
 * An Astro Theme of its own (`e2e/helpers/astro-d3.ts`) with two pages,
 * `/` (`<Hero {...hero} />`) and `/about` (`<Hero {...team} />`). Every
 * value the public site shows is written by the Inspector:
 *
 * 1. release 1: the home title edited through Design and published from
 *    the editor's toolbar; the public home shows it;
 * 2. release 2: `/about`'s title edited and left unpublished, the home title
 *    edited again; before the publish the public home is still release 1;
 *    after it the home shows release 2 and `/about` shows no draft of its
 *    own (a page publish seals that page only);
 * 3. rollback: a rollback naming a stale active release is refused and
 *    changes nothing; the real one puts release 1 back on the public site;
 * 4. the editor reloads after the rollback with every draft intact.
 *
 * Kept apart from `astro-inspector-write.spec.ts` so an Inspector failure
 * does not spend a build, and with its own target module
 * (scripts/container-acceptance-targets/astro-design-release.mjs).
 *
 * Container transport only, with Astro on (`MORPH_ASTRO_THEMES=1`, which
 * also lets the server build Astro) and the parser bound
 * (`MORPH_E2E_ASTRO_PARSER=1`). Every gate is a file gate.
 */
const STATE_DIR = process.env.MORPH_E2E_STATE_DIR;
const TRANSPORT = process.env.E2E_EXPECT_PREVIEW_TRANSPORT;
test.skip(
  !EDITOR_PATH || !STATE_DIR,
  "Run through scripts/run-editor-e2e.mjs: this reads the run's own D1 and R2.",
);
test.skip(
  TRANSPORT !== "cloudflare-sandbox",
  "The Astro dev server and build run in the Sandbox container; run with MORPH_E2E_TRANSPORT=cloudflare-sandbox.",
);
test.skip(
  process.env.MORPH_ASTRO_THEMES !== "1",
  "Astro is previewed and built only where the server sets MORPH_ASTRO_THEMES=1.",
);
test.skip(
  process.env.MORPH_E2E_ASTRO_PARSER !== "1",
  "Core's binding view needs the .astro parser behind ASTRO_PARSER; run with MORPH_E2E_ASTRO_PARSER=1.",
);

const HOST = "astro-d3-release.localhost";

test.describe("Astro Design edits published and rolled back (D3 rows 21-24)", () => {
  test.describe.configure({ mode: "serial" });
  // Each publish builds the Astro site in the container.
  test.setTimeout(30 * 60_000);
  test.use({ actionTimeout: 60_000 });

  const scope: ThemeScope | null = EDITOR_PATH
    ? { ...themeScopeFromEditorPath(EDITOR_PATH), themeId: randomUUID() }
    : null;
  const theme =
    EDITOR_PATH && STATE_DIR && scope
      ? astroCaseTheme({
          name: "astro-d3-release",
          editorPath: EDITOR_PATH,
          stateDir: STATE_DIR,
          scope,
        })
      : null;
  const SALE = `d3-release-sale-${randomUUID()}`;
  const home: D3Document = {
    version: 1,
    sections: [d3Row("hero", { title: SALE, desc: SALE })],
  };
  const about: D3Document = {
    version: 1,
    sections: [d3Row("team", { title: SALE, desc: SALE })],
  };
  const r1 = `d3-release-1-${randomUUID()}`;
  const r2 = `d3-release-2-${randomUUID()}`;
  const pending = `d3-about-pending-${randomUUID()}`;
  let origin = "";
  let domainId: string | null = null;
  let release1 = "";
  let release2 = "";
  let afterRelease2: { home: D3Document; about: D3Document } | null = null;

  const publicPage = async (path: string) => {
    const read = await storefrontFetcher(origin)(path);
    expect(read.status, read.body.slice(0, 500)).toBe(200);
    return read.body;
  };
  /** The heading the page's one case renders, or null with no case. */
  const heroOf = (body: string) => {
    const at = body.search(/data-d3-case="(?:hero|team)"/);
    if (at < 0) return null;
    return /<h1[^>]*>([^<]*)<\/h1>/.exec(body.slice(at))?.[1] ?? null;
  };
  test.beforeAll(async ({ browser }) => {
    await theme!.setUp(
      browser,
      [
        { path: "astro.config.mjs", content: astroConfig() },
        { path: D3_HERO_PATH, content: D3_HERO },
        { path: D3_HERO_FIELDS_PATH, content: d3HeroFields() },
        { path: "src/pages/index.astro", content: d3ReleaseHomePage() },
        { path: "src/pages/about.astro", content: d3ReleaseAboutPage() },
      ],
      { "/": home, "/about": about },
    );
    const page = await signedInPage(browser);
    try {
      await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
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
    if (domainId) {
      const page = await signedInPage(browser);
      try {
        await page.goto("/", { waitUntil: "domcontentloaded" });
        // As publish-hidden-page-section.spec.ts: the local stand-in domain
        // has no Cloudflare custom domain, and a primary one cannot be
        // deleted.
        execLocalD1(
          `UPDATE storefront_domains SET is_primary = 0, cloudflare_domain_id = NULL WHERE id = '${domainId}';`,
        );
        const removed = (await serverFn(
          page,
          DOMAINS,
          "deleteStorefrontDomains",
          { ids: [domainId] },
        )) as { success: boolean; message?: string };
        expect(removed.success, removed.message).toBe(true);
      } finally {
        await page.context().close();
      }
    }
    await theme?.tearDown(browser);
  });

  test("release 1: the home title edited in the Inspector through Design and published, and the public home shows it", async ({
    page,
  }) => {
    const record = recordEditor(page);
    await openEditorAt(page, theme!.editorPath("/"));
    await expect(
      (await liveFrame(page)).locator('[data-d3-case="hero"] h1'),
    ).toHaveText(SALE, { timeout: 180_000 });
    await expect(page.getByTestId("preview-document-navigation")).toHaveCount(
      0,
      { timeout: 120_000 },
    );
    const content = await selectCase(page, record, "hero", "hero");
    await writeField(page, record, astroField(content, "Title"), r1);
    await expect
      .poll(() => theme!.draft("/").document, { timeout: 60_000 })
      .toEqual(withProps(home, "hero", { title: r1 }));
    await frameShowing(page, '[data-d3-case="hero"] h1', r1);

    const shown = await publishShowingRelease(page);
    await shown.close();
    release1 = await latestRelease(page, scope!);
    const published = await theme!.harness.serveActiveRelease(
      r1,
      release1,
      origin,
    );
    expect(published.releaseId).toBe(release1);
    expect(heroOf(await publicPage("/"))).toBe(r1);
    // /about has no published Document: the component's own default shows.
    expect(heroOf(await publicPage("/about"))).toBe(D3_DEFAULT_TITLE);
  });

  test("release 2: a sibling page's draft stays unpublished, the home's draft stays off the public site until published, then the public home shows release 2", async ({
    page,
  }) => {
    expect(release1, "release 1 was published").not.toBe("");
    const record = recordEditor(page);
    await openEditorAt(page, theme!.editorPath("/"));
    await expect(page.getByTestId("preview-document-navigation")).toHaveCount(
      0,
      { timeout: 120_000 },
    );

    // /about's title, edited and left as a draft.
    await openPageFromList(page, "/about");
    const team = await selectCase(page, record, "team", "team");
    await writeField(page, record, astroField(team, "Title"), pending);
    const aboutDraft = withProps(about, "team", { title: pending });
    await expect
      .poll(() => theme!.draft("/about").document, { timeout: 60_000 })
      .toEqual(aboutDraft);
    await frameShowing(page, '[data-d3-case="team"] h1', pending);

    // The home title again: a draft, not yet on the public site.
    // Back from the page list, which names the home page "Home /" (the
    // page publish below is the home page's own).
    await openPageFromList(page, "/");
    await expect(
      (await liveFrame(page)).locator('[data-d3-case="hero"] h1'),
    ).toHaveText(r1, { timeout: 180_000 });
    const hero = await selectCase(page, record, "hero", "hero");
    await writeField(page, record, astroField(hero, "Title"), r2);
    const homeDraft = withProps(home, "hero", { title: r2 });
    await expect
      .poll(() => theme!.draft("/").document, { timeout: 60_000 })
      .toEqual(homeDraft);
    await frameShowing(page, '[data-d3-case="hero"] h1', r2);
    expect(heroOf(await publicPage("/"))).toBe(r1);
    expect(heroOf(await publicPage("/about"))).toBe(D3_DEFAULT_TITLE);

    // Published from the home page's editor: the home page only.
    const shown = await publishShowingRelease(page);
    await shown.close();
    release2 = await latestRelease(page, scope!);
    expect(release2).not.toBe(release1);
    const published = await theme!.harness.serveActiveRelease(
      r2,
      release2,
      origin,
    );
    expect(published.releaseId).toBe(release2);
    expect(heroOf(await publicPage("/"))).toBe(r2);
    // The sibling's draft was not sealed by the home page's publish.
    const aboutBody = await publicPage("/about");
    expect(heroOf(aboutBody)).toBe(D3_DEFAULT_TITLE);
    expect(aboutBody).not.toContain(pending);
    afterRelease2 = {
      home: theme!.draft("/").document,
      about: theme!.draft("/about").document,
    };
    expect(afterRelease2).toEqual({ home: homeDraft, about: aboutDraft });
  });

  test("rollback to release 1: a stale expectedActiveReleaseId is refused, then the public site is back to release 1", async ({
    page,
  }) => {
    expect(release2, "release 2 was published").not.toBe("");
    await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
    const beforeStale = await theme!.harness.publishedState();
    expect(beforeStale.active).toBe(release2);
    const stale = (await serverFn(page, RELEASES, "activateStorefrontRelease", {
      storefrontId: scope!.storefrontId,
      releaseId: release1,
      // Release 1 is no longer the active one.
      expectedActiveReleaseId: release1,
    })) as { success: boolean; error?: string; message?: string };
    expect(stale.success, JSON.stringify(stale)).toBe(false);
    // Refused before anything was written.
    expect(await theme!.harness.publishedState()).toEqual(beforeStale);
    expect(heroOf(await publicPage("/"))).toBe(r2);

    const rolledBack = (await serverFn(
      page,
      RELEASES,
      "activateStorefrontRelease",
      {
        storefrontId: scope!.storefrontId,
        releaseId: release1,
        expectedActiveReleaseId: release2,
      },
    )) as { success: boolean; message?: string };
    expect(rolledBack.success, rolledBack.message).toBe(true);
    expect((await theme!.harness.publishedState()).active).toBe(release1);
    const restored = await theme!.harness.serveActiveRelease(
      r1,
      release1,
      origin,
    );
    expect(restored.releaseId).toBe(release1);
    const body = await publicPage("/");
    expect(heroOf(body)).toBe(r1);
    expect(body).not.toContain(r2);
    expect(heroOf(await publicPage("/about"))).toBe(D3_DEFAULT_TITLE);
  });

  test("after the rollback the editor reloads with its drafts on both pages", async ({
    page,
  }) => {
    expect(afterRelease2, "release 2's drafts were read").not.toBeNull();
    const record = recordEditor(page);
    await openEditorAt(page, theme!.editorPath("/"));
    await expect(
      (await liveFrame(page)).locator('[data-d3-case="hero"] h1'),
    ).toHaveText(r2, { timeout: 180_000 });
    await expect(page.getByTestId("preview-document-navigation")).toHaveCount(
      0,
      { timeout: 120_000 },
    );
    const hero = await selectCase(page, record, "hero", "hero");
    await expect(astroField(hero, "Title")).toHaveValue(r2);
    await openPageFromList(page, "/about");
    await expect(
      (await liveFrame(page)).locator('[data-d3-case="team"] h1'),
    ).toHaveText(pending, { timeout: 120_000 });
    const team = await selectCase(page, record, "team", "team");
    await expect(astroField(team, "Title")).toHaveValue(pending);
    expect(record.writes, "the reload wrote nothing").toEqual([]);
    expect({
      home: theme!.draft("/").document,
      about: theme!.draft("/about").document,
    }).toEqual(afterRelease2);
  });
});
