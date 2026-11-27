import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { EDITOR_PATH } from "./helpers";
import {
  astroCaseTheme,
  astroContent,
  astroField,
  ensureSelection,
  frameShowing,
  liveFrame,
  openEditorAt,
  openPageFromList,
  recordEditor,
  selectCase,
  withProps,
  writeField,
  type D3Document,
  type EditorRecord,
} from "./helpers/astro-d3";
import { execLocalD1 } from "./helpers/editor-writes-paused";
import {
  DOMAINS,
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
  D3_SHELL_PATH,
  d3HeroFields,
  d3ReleaseAboutPage,
  d3Row,
  d3Shell,
  d3ShellPage,
} from "../src/lib/test-utils/astro-d3-cases";

/**
 * Astro M2 D3 batch 2 (the shared case table,
 * `~/handoff/2026-11-27/binding-case-table.md`): rows 14, 18 and row 24's
 * layout half, and the editor address of a route's own Document.
 *
 * An Astro Theme of its own (`e2e/helpers/astro-d3.ts`):
 *
 * - `src/layouts/Shell.astro`, the layout `/` and `/contact` render inside.
 *   It reads the request's page (`morph.pages.get(Astro.url.pathname)`),
 *   which Core answers with the layout Document's sections and the page's
 *   own, and spreads the layout Document's `banner`;
 * - `/` and `/contact`, each with a section of its own in the layout's slot;
 * - `/about`, outside the layout, `<Hero {...team} />`.
 *
 * What Design does on it today, each checked on the canvas, in the
 * Inspector and in the raw D1 rows:
 *
 * 1. an editor address naming `/about`'s own Document by id opens `/about`
 *    (it framed the home page, D3 batch 1), and its section edits;
 * 2. row 14, safely refused: a double click on an Astro field does not
 *    enter canvas editing and writes nothing; the Inspector still edits the
 *    field. Astro has no field-level canvas selection or inline edit path
 *    (the frame names a section, not a field);
 * 3. row 18, safely refused: the layout's section shows the layout
 *    Document's values on every page that uses the layout, a click on it is
 *    refused (located in Code, or said in Design) and writes nothing, with
 *    no Inspector input (Core claims fields only for call sites in
 *    the page's own template, and refuses an Astro `layout` write as
 *    `template-kind-unsupported`). A page's own section inside the layout's
 *    slot is refused as well (no proven field). The home page is reopened
 *    from the page list ("Home /");
 * 4. row 24's layout half: a pending layout draft (written by the harness:
 *    Design cannot make one on Astro, item 3) is sealed by a page publish,
 *    which says so before it is confirmed, and every page using the layout
 *    shows it on the public site; a later draft stays off until the next
 *    publish seals it.
 *
 * Container transport only, with Astro on (`MORPH_ASTRO_THEMES=1`, which
 * also lets the server build Astro) and the parser bound
 * (`MORPH_E2E_ASTRO_PARSER=1`). Every gate is a file gate. Target module:
 * scripts/container-acceptance-targets/astro-layout-inline.mjs.
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

const HOST = "astro-d3-layout.localhost";
const LAYOUT = "layout";

/** What the editor says for an Astro click it does not make a selection. */
const REFUSED_HINT =
  /This content is controlled by code, so it can't be edited in Design|This element isn't part of a section Design can edit/;

test.describe("Astro layout-shared sections and canvas editing (D3 rows 14, 18, 24)", () => {
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
          name: "astro-d3-layout",
          editorPath: EDITOR_PATH,
          stateDir: STATE_DIR,
          scope,
        })
      : null;
  const SALE = `d3-layout-sale-${randomUUID()}`;
  const home: D3Document = {
    version: 1,
    sections: [d3Row("hero", { title: SALE, desc: SALE })],
  };
  const contact: D3Document = {
    version: 1,
    sections: [d3Row("contact", { title: SALE, desc: SALE })],
  };
  const about: D3Document = {
    version: 1,
    sections: [d3Row("team", { title: SALE, desc: SALE })],
  };
  const banner = (title: string): D3Document => ({
    version: 1,
    sections: [d3Row("banner", { title, desc: SALE })],
  });
  const L1 = `d3-layout-1-${randomUUID()}`;
  const L2 = `d3-layout-2-${randomUUID()}`;
  const a1 = `d3-about-1-${randomUUID()}`;
  const a2 = `d3-about-2-${randomUUID()}`;
  let aboutDraft = about;
  let origin = "";
  let domainId: string | null = null;
  let release1 = "";

  const publicPage = async (path: string) => {
    const read = await storefrontFetcher(origin)(path);
    expect(read.status, read.body.slice(0, 500)).toBe(200);
    return read.body;
  };
  /** The heading case `caseId` renders on a public page, or null. */
  const headingOf = (body: string, caseId: string) => {
    const at = body.indexOf(`data-d3-case="${caseId}"`);
    if (at < 0) return null;
    return /<h1[^>]*>([^<]*)<\/h1>/.exec(body.slice(at))?.[1] ?? null;
  };
  /** Every draft of the Theme, for an exact before/after. */
  const drafts = () => ({
    home: theme!.draft("/"),
    contact: theme!.draft("/contact"),
    about: theme!.draft("/about"),
    layout: theme!.draft(LAYOUT),
  });

  test.beforeAll(async ({ browser }) => {
    await theme!.setUp(
      browser,
      [
        { path: "astro.config.mjs", content: astroConfig() },
        { path: D3_HERO_PATH, content: D3_HERO },
        { path: D3_HERO_FIELDS_PATH, content: d3HeroFields() },
        { path: D3_SHELL_PATH, content: d3Shell() },
        { path: "src/pages/index.astro", content: d3ShellPage("/", "hero") },
        {
          path: "src/pages/contact.astro",
          content: d3ShellPage("/contact", "contact"),
        },
        { path: "src/pages/about.astro", content: d3ReleaseAboutPage() },
      ],
      { "/": home, "/contact": contact, "/about": about },
    );
    await theme!.seedTemplate(LAYOUT, "layout", "Layout");
    await theme!.seedDraft(LAYOUT, banner(L1));
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
        // As astro-design-release-acceptance.spec.ts.
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

  /** Opens `/about`'s editor by the address naming its own Document. */
  async function openAbout(page: Page) {
    await openEditorAt(page, theme!.editorPath("/about"));
    await expect
      .poll(async () => new URL((await liveFrame(page)).url()).pathname, {
        timeout: 180_000,
        message: "the editor frames the page the address names",
      })
      .toBe("/about");
    await expect(
      (await liveFrame(page)).locator('[data-d3-case="team"] h1'),
    ).toBeVisible({ timeout: 180_000 });
    await expect(page.getByTestId("preview-document-navigation")).toHaveCount(
      0,
      { timeout: 120_000 },
    );
  }

  /** A click on `selector` that Design refuses: said, no input, no write. */
  async function expectRefusedClick(
    page: Page,
    record: EditorRecord,
    selector: string,
    sectionId: string,
  ) {
    const sent = record.writes.length;
    const frame = await liveFrame(page);
    await ensureSelection(page, frame);
    await frame.locator(selector).click();
    // Not a Design selection: the click is located in Code (L1.5a), and a
    // click inside a section boundary Core does not confirm also says why
    // (run on ca9cd25: both for the slot's section; Code alone for the
    // layout's markup, outside every boundary of the page's own template,
    // as OUTSIDE_SECTION_HINT in astro-design-selection.ts says). What was
    // shown is recorded with the run.
    const hint = page.getByText(REFUSED_HINT).first();
    const code = page.getByRole("textbox", { name: "Editor content" });
    await expect(
      hint.or(code).first(),
      `a click on ${sectionId} is refused as a Design selection`,
    ).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(1_000);
    const locatedInCode = await code.isVisible();
    const said = await hint.isVisible();
    test.info().annotations.push({
      type: "refusal",
      description: `${sectionId}: located in Code ${locatedInCode}, said ${said}`,
    });
    await expect(astroContent(page, sectionId)).toHaveCount(0);
    await page.waitForTimeout(3_000);
    expect(record.writes.length, `a click on ${sectionId} writes nothing`).toBe(
      sent,
    );
    if (locatedInCode) {
      await page.getByRole("button", { name: "Design", exact: true }).click();
      await expect(code).toBeHidden({ timeout: 60_000 });
      await expect((await liveFrame(page)).locator(selector)).toBeVisible({
        timeout: 120_000,
      });
    }
    return locatedInCode ? "code" : "design";
  }

  test("an editor address naming /about's own Document opens /about, and its section edits", async ({
    page,
  }) => {
    const record = recordEditor(page);
    const before = drafts();
    await openAbout(page);
    await expect
      .poll(() => new URL(page.url()).searchParams.get("routePath"), {
        message: "the editor's address names the page it frames",
      })
      .toBe("/about");
    await expect(
      (await liveFrame(page)).locator('[data-d3-case="team"] h1'),
    ).toHaveText(SALE);
    const team = await selectCase(page, record, "team", "team");
    await expect(astroField(team, "Title")).toHaveValue(SALE);
    await writeField(page, record, astroField(team, "Title"), a1);
    aboutDraft = withProps(about, "team", { title: a1 });
    await expect
      .poll(() => theme!.draft("/about").document, { timeout: 60_000 })
      .toEqual(aboutDraft);
    expect(theme!.draft("/about").generation).toBe(
      before.about.generation + 1,
    );
    await frameShowing(page, '[data-d3-case="team"] h1', a1);
    // The other pages and the layout are untouched.
    const after = drafts();
    expect([after.home, after.contact, after.layout]).toEqual([
      before.home,
      before.contact,
      before.layout,
    ]);
  });

  test("row 14: a double click on an Astro field does not edit on the canvas and writes nothing; the Inspector still edits it", async ({
    page,
  }) => {
    const record = recordEditor(page);
    await openAbout(page);
    await selectCase(page, record, "team", "team");
    const before = drafts();
    const sent = record.writes.length;
    const frame = await liveFrame(page);
    const heading = frame.locator('[data-d3-case="team"] h1');
    await expect(heading).toHaveText(a1);
    await heading.dblclick();
    await page.waitForTimeout(1_500);
    // Start's inline edit marks the text it opens (`contenteditable`
    // plaintext-only, `data-storefront-editor-inline-editing`); here nothing
    // is opened.
    await expect(heading).not.toHaveAttribute("contenteditable", /.*/);
    await expect(
      frame.locator('[data-storefront-editor-inline-editing="true"]'),
    ).toHaveCount(0);
    await page.keyboard.type(`typed-${randomUUID()}`);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(3_000);
    expect(record.writes.length, "the double click and typing write nothing").toBe(
      sent,
    );
    expect(drafts()).toEqual(before);
    await expect(heading).toHaveText(a1);

    // The same field, from the Inspector.
    const team = await selectCase(page, record, "team", "team");
    await writeField(page, record, astroField(team, "Title"), a2);
    aboutDraft = withProps(about, "team", { title: a2 });
    await expect
      .poll(() => theme!.draft("/about").document, { timeout: 60_000 })
      .toEqual(aboutDraft);
    await frameShowing(page, '[data-d3-case="team"] h1', a2);
  });

  test("row 18: the layout's section shows the layout Document on every page that uses it, and Design refuses it and the slot's section, writing nothing", async ({
    page,
  }) => {
    const record = recordEditor(page);
    const before = drafts();
    await openEditorAt(page, theme!.editorPath("/"));
    let frame = await liveFrame(page);
    await expect(frame.locator('[data-d3-case="banner"] h1')).toHaveText(L1, {
      timeout: 180_000,
    });
    await expect(frame.locator('[data-d3-case="hero"] h1')).toHaveText(SALE);
    await expect(page.getByTestId("preview-document-navigation")).toHaveCount(
      0,
      { timeout: 120_000 },
    );
    await expectRefusedClick(page, record, '[data-d3-case="banner"] h1', "banner");
    await expectRefusedClick(page, record, '[data-d3-case="hero"] h1', "hero");

    await openPageFromList(page, "/contact");
    frame = await liveFrame(page);
    await expect(frame.locator('[data-d3-case="banner"] h1')).toHaveText(L1, {
      timeout: 120_000,
    });
    await expect(frame.locator('[data-d3-case="contact"] h1')).toHaveText(SALE);
    await expectRefusedClick(page, record, '[data-d3-case="banner"] h1', "banner");

    // The home page again, from the page list.
    await openPageFromList(page, "/");
    await expect(
      (await liveFrame(page)).locator('[data-d3-case="hero"] h1'),
    ).toHaveText(SALE, { timeout: 120_000 });
    expect(record.writes, "nothing was written").toEqual([]);
    expect(drafts()).toEqual(before);
  });

  test("row 24, layout: a page publish seals the pending layout draft, and every page using the layout shows it; a later draft stays off until the next publish", async ({
    page,
  }) => {
    const record = recordEditor(page);
    const layoutPending = theme!.templateRow(LAYOUT);
    expect(layoutPending.published).toBeNull();
    const scopeSaysLayout = async (open: Page) => {
      await expect(
        open.locator('[data-publish-scope="page-and-layout"]'),
        "the confirmation says the shared layout goes live too",
      ).toBeVisible({ timeout: 60_000 });
    };

    // Release 1, from /about's editor: /about and the pending layout.
    await openAbout(page);
    await expect(
      (await liveFrame(page)).locator('[data-d3-case="team"] h1'),
    ).toHaveText(a2);
    const shown = await publishShowingRelease(page, scopeSaysLayout);
    await shown.close();
    release1 = await latestRelease(page, scope!);
    const published = await theme!.harness.serveActiveRelease(
      a2,
      release1,
      origin,
    );
    expect(published.releaseId).toBe(release1);
    expect(theme!.templateRow(LAYOUT).published).toBe(layoutPending.draft);
    const home1 = await publicPage("/");
    const contact1 = await publicPage("/contact");
    expect(headingOf(home1, "banner")).toBe(L1);
    expect(headingOf(contact1, "banner")).toBe(L1);
    // The pages' own drafts were not published: their defaults show.
    expect(headingOf(home1, "hero")).toBe(D3_DEFAULT_TITLE);
    expect(headingOf(contact1, "contact")).toBe(D3_DEFAULT_TITLE);
    expect(headingOf(await publicPage("/about"), "team")).toBe(a2);

    // A later layout draft (another writer; Design cannot make one here):
    // off the public site until a publish seals it.
    await theme!.seedDraft(LAYOUT, banner(L2));
    const layoutNext = theme!.templateRow(LAYOUT);
    expect(layoutNext.draft).not.toBe(layoutPending.draft);
    expect(headingOf(await publicPage("/"), "banner")).toBe(L1);

    // Release 2, from /about's editor again, with an edit of its own.
    await openAbout(page);
    const a3 = `d3-about-3-${randomUUID()}`;
    const team = await selectCase(page, record, "team", "team");
    await writeField(page, record, astroField(team, "Title"), a3);
    aboutDraft = withProps(about, "team", { title: a3 });
    await expect
      .poll(() => theme!.draft("/about").document, { timeout: 60_000 })
      .toEqual(aboutDraft);
    await frameShowing(page, '[data-d3-case="team"] h1', a3);
    // The preview frames the draft layout already.
    const shown2 = await publishShowingRelease(page, scopeSaysLayout);
    await shown2.close();
    const release2 = await latestRelease(page, scope!);
    expect(release2).not.toBe(release1);
    const published2 = await theme!.harness.serveActiveRelease(
      a3,
      release2,
      origin,
    );
    expect(published2.releaseId).toBe(release2);
    expect(theme!.templateRow(LAYOUT).published).toBe(layoutNext.draft);
    const home2 = await publicPage("/");
    const contact2 = await publicPage("/contact");
    expect(headingOf(home2, "banner")).toBe(L2);
    expect(headingOf(contact2, "banner")).toBe(L2);
    expect(home2).not.toContain(L1);
    expect(headingOf(home2, "hero")).toBe(D3_DEFAULT_TITLE);
    expect(headingOf(await publicPage("/about"), "team")).toBe(a3);
    // Every draft is as the publish found it.
    expect(theme!.draft(LAYOUT).document).toEqual(banner(L2));
    expect(theme!.draft("/").document).toEqual(home);
    expect(theme!.draft("/contact").document).toEqual(contact);
  });
});
