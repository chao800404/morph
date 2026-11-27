import { randomUUID } from "node:crypto";

import { expect, test, type Browser, type Page } from "@playwright/test";

import { EDITOR_PATH } from "./helpers";
import {
  SECTION_WRITE,
  acceptedBasisOps,
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
import { isServerFn } from "./helpers/editor-writes-paused";
import { signedInPage } from "./native-acceptance";
import {
  removeThemeFiles,
  themeScopeFromEditorPath,
  writeThemeFiles,
  type ThemeScope,
} from "./native-compat";
import { astroConfig } from "../src/lib/storefront/theme-framework/astro-native-prerender.fixtures";
import {
  D3_DEFAULT_DESC,
  D3_HERO,
  D3_HERO_FIELDS_PATH,
  D3_HERO_PATH,
  D3_P4A_LITERAL,
  D3_REFUSED_PATH,
  d3AboutPage,
  d3HeroFields,
  d3HomePage,
  d3RefusedPage,
  d3Row,
  d3SidecarPage,
} from "../src/lib/test-utils/astro-d3-cases";

/**
 * Astro Inspector writes on a real Astro Live Preview (`astro dev` in the
 * container, behind the preview Worker): M2 PR 3's first write, and the
 * Astro M2 D3 coverage, equal to Start's B1 and binding acceptance (the
 * shared case table, `~/handoff/2026-11-27/binding-case-table.md`), written
 * as native `.astro` pages (`src/lib/test-utils/astro-d3-cases.ts`, whose
 * binding Core's view is held to in `storefront-theme.dal.astro.test.ts`).
 *
 * A click in Design on a section Core's binding view confirms selects it
 * and opens its declared fields in the Inspector (owner decision D2).
 * Typing into a field writes the Document through the editor's one content
 * write path, gated on the section's acknowledged basis (option B, the #399
 * proof), and carries the identity and Core's component digest. In every
 * case:
 *
 * - every field of every section starts with the same text (Start's
 *   equal-text trap), so an edit is told from its neighbours only by where
 *   it lands;
 * - after each write the whole raw D1 draft Document equals the one before
 *   with exactly that field changed, one draft generation on;
 * - the next input waits for the reloaded page's own basis ack;
 * - a field Core does not prove writable for the call site is shown as
 *   controlled by code, has no input, and nothing is written for it, while
 *   its sibling still edits.
 *
 * Groups, each on an Astro Theme of its own (`e2e/helpers/astro-d3.ts`):
 * the M2 PR 3 hero (D3 rows 1, 10, 11, 15, 16, 19, and a stale edit, row
 * 20); the editable shapes (rows 2-4, 12, 17); the shapes Design must not
 * write (rows 5-9); the `.fields.ts` declaration (row 30).
 *
 * Container transport only, with Astro on (`MORPH_ASTRO_THEMES=1`) and the
 * `.astro` parser behind Core's `ASTRO_PARSER` (`MORPH_E2E_ASTRO_PARSER=1`):
 * without it Core's binding view refuses every click. Every gate is a file
 * gate: where one does not hold the whole file skips, and its container
 * acceptance (scripts/container-acceptance-targets/astro-inspector-write.mjs)
 * then fails for the missing cases rather than passing.
 */
const STATE_DIR = process.env.MORPH_E2E_STATE_DIR;
const TRANSPORT = process.env.E2E_EXPECT_PREVIEW_TRANSPORT;
test.skip(
  !EDITOR_PATH || !STATE_DIR,
  "Run through scripts/run-editor-e2e.mjs: this writes the run's own D1.",
);
test.skip(
  TRANSPORT !== "cloudflare-sandbox",
  "The Astro dev server runs in the Sandbox container; run with MORPH_E2E_TRANSPORT=cloudflare-sandbox.",
);
test.skip(
  process.env.MORPH_ASTRO_THEMES !== "1",
  "Astro is previewed only where the server sets MORPH_ASTRO_THEMES=1.",
);
test.skip(
  process.env.MORPH_E2E_ASTRO_PARSER !== "1",
  "Core's binding view needs the .astro parser behind ASTRO_PARSER; run with MORPH_E2E_ASTRO_PARSER=1.",
);

/** A case's own Theme, on the seeded store's storefront. */
function caseTheme(name: string) {
  if (!EDITOR_PATH || !STATE_DIR) return null;
  const scope: ThemeScope = {
    ...themeScopeFromEditorPath(EDITOR_PATH),
    themeId: randomUUID(),
  };
  return astroCaseTheme({
    name,
    editorPath: EDITOR_PATH,
    stateDir: STATE_DIR,
    scope,
  });
}

/** The text every field of a case starts with. */
const sale = (tag: string) => `d3-${tag}-sale-${randomUUID()}`;

/** Said for a click Core confirms no writable field of. */
const CONTROLLED_BY_CODE =
  "This content is controlled by code, so it can't be edited in Design. Edit it in Code mode.";
const TITLE_BY_CODE =
  "Title is controlled by code on this page. Edit it in Code mode.";

/** The M2 PR 3 case's home page: `<Hero {...hero} />`, fields in `.fields.ts`. */
const PR3_FILES = [
  { path: "astro.config.mjs", content: astroConfig() },
  {
    path: "src/components/Hero.astro",
    content: `---
interface Props {
  title?: string;
  subtitle?: string;
}

const { title = "M2W-DEFAULT-TITLE", subtitle = "M2W-DEFAULT-SUBTITLE" } =
  Astro.props;
---
<section data-m2w-hero>
  <h1>{title}</h1>
  <p>{subtitle}</p>
</section>
`,
  },
  {
    path: "src/components/Hero.fields.ts",
    content: `export const contentFields = {
  title: { type: "text", label: "Title" },
  subtitle: { type: "text", label: "Subtitle" },
} as const;
`,
  },
  {
    path: "src/pages/index.astro",
    content: `---
import { morph } from "@morph/sdk/astro";
import Hero from "../components/Hero.astro";

const home = await morph.pages.get("/");
const { hero } = home;
---
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Home</title>
  </head>
  <body>
    <main>
      <Hero {...hero} />
    </main>
  </body>
</html>
`,
  },
];

/** Selects the M2 PR 3 hero and opens its Content. */
async function selectHero(page: Page, record: EditorRecord) {
  const frame = await liveFrame(page);
  await ensureSelection(page, frame);
  const acceptedBefore = acceptedBasisOps(record.lines).length;
  await frame.locator("[data-m2w-hero] h1").click();
  const content = astroContent(page, "hero");
  await expect(content, "the Inspector opens the hero's fields").toBeVisible({
    timeout: 60_000,
  });
  // Core confirmed the frame's pair and the frame acknowledged the
  // section's basis: the proof an input is sent with.
  await expect
    .poll(() => acceptedBasisOps(record.lines).length, {
      timeout: 120_000,
      message: "the editor takes the frame's applied ack for the hero",
    })
    .toBeGreaterThan(acceptedBefore);
  await page
    .locator("[data-editor-inspector-panel]")
    .getByRole("button", { name: "Content", exact: true })
    .click();
  return content;
}

test.describe("Astro Inspector write on the container Live Preview (M2 PR 3)", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(30 * 60_000);
  test.use({ actionTimeout: 60_000 });

  const theme = caseTheme("astro-inspector-write");
  // D3 row 10: both fields start equal, and the first edit is made from
  // that equal baseline.
  const same = sale("m2w");
  // The row Core writes for this instance: its ref and type are Core's own
  // (`resolveAstroSectionWrite`). A row with no ref is refused as
  // section-row-mismatch, never re-pointed.
  const seeded: D3Document = {
    version: 1,
    sections: [
      {
        id: "hero",
        type: "hero",
        componentRef: "src/components/Hero.astro",
        enabled: true,
        props: { title: same, subtitle: same },
      },
    ],
  };

  test.beforeAll(async ({ browser }) => {
    await theme!.setUp(browser, PR3_FILES, { "/": seeded });
  });
  test.afterAll(async ({ browser }) => {
    await theme?.tearDown(browser);
  });

  test("a click selects the hero, an Inspector edit is stored in the Document, and page, Inspector and Document agree after a reload", async ({
    page,
  }) => {
    const record = recordEditor(page);
    const field = (content: ReturnType<typeof astroContent>, name: string) =>
      astroField(content, name);

    await openEditorAt(page, theme!.editorPath());
    let frame = await liveFrame(page);
    await expect(frame.locator("[data-m2w-hero] h1")).toHaveText(same, {
      timeout: 180_000,
    });
    await expect(page.getByTestId("preview-document-navigation")).toHaveCount(
      0,
      { timeout: 120_000 },
    );
    const before = theme!.draft("/");
    expect(before.document).toEqual(seeded);

    // 1. The click selects; the Inspector shows the declared fields only.
    let content = await selectHero(page, record);
    await expect(field(content, "Title")).toHaveValue(same);
    await expect(field(content, "Subtitle")).toHaveValue(same);
    expect(record.writes, "a click writes nothing").toEqual([]);

    // 2. Typing the title writes it, with Core's identity and digest, from
    //    a baseline where both fields hold the same text (row 10).
    const edited = `m2w-${randomUUID()}`;
    await writeField(page, record, field(content, "Title"), edited);
    // The whole raw draft: that field, one generation on, nothing else
    // (row 11).
    const afterTitleDocument = withProps(seeded, "hero", { title: edited });
    await expect
      .poll(() => theme!.draft("/").document, { timeout: 60_000 })
      .toEqual(afterTitleDocument);
    expect(theme!.draft("/").generation).toBe(before.generation + 1);

    // The page shows it after sync -> confirm -> reload; the other field,
    // equal to the old title, is untouched.
    frame = await frameShowing(page, "[data-m2w-hero] h1", edited);
    await expect(frame.locator("[data-m2w-hero] p")).toHaveText(same);

    // 3. The same text into the subtitle, sent only on the reloaded page's
    //    own basis ack (`writeField` waited for it), and nothing crosses
    //    between the two fields.
    await writeField(page, record, field(content, "Subtitle"), edited);
    const afterSubtitleDocument = withProps(afterTitleDocument, "hero", {
      subtitle: edited,
    });
    await expect
      .poll(() => theme!.draft("/").document, { timeout: 60_000 })
      .toEqual(afterSubtitleDocument);
    const afterSubtitle = theme!.draft("/");
    expect(afterSubtitle.generation).toBe(before.generation + 2);
    frame = await frameShowing(page, "[data-m2w-hero] p", edited);
    await expect(frame.locator("[data-m2w-hero] h1")).toHaveText(edited);

    // 4. An editor reload: the page, the Inspector and D1 agree.
    const sentBeforeReload = record.writes.length;
    await openEditorAt(page, theme!.editorPath());
    frame = await liveFrame(page);
    await expect(frame.locator("[data-m2w-hero] h1")).toHaveText(edited, {
      timeout: 180_000,
    });
    await expect(frame.locator("[data-m2w-hero] p")).toHaveText(edited);
    await expect(page.getByTestId("preview-document-navigation")).toHaveCount(
      0,
      { timeout: 120_000 },
    );
    content = await selectHero(page, record);
    await expect(field(content, "Title")).toHaveValue(edited);
    await expect(field(content, "Subtitle")).toHaveValue(edited);
    expect(theme!.draft("/")).toEqual(afterSubtitle);
    expect(record.writes.length, "the reload and the click wrote nothing").toBe(
      sentBeforeReload,
    );
  });

  // D3 row 20: a write made on a copy another writer has since replaced is
  // refused by Core's draft CAS, the author's text is kept, and nothing is
  // written over the other writer's value or sent again on its own.
  test("an edit made on a draft another writer replaced is refused, kept, and writes nothing", async ({
    page,
  }) => {
    const record = recordEditor(page);
    await openEditorAt(page, theme!.editorPath());
    await expect(page.getByTestId("preview-document-navigation")).toHaveCount(
      0,
      { timeout: 120_000 },
    );
    const content = await selectHero(page, record);
    const title = astroField(content, "Title");
    const held = theme!.draft("/");
    await expect(title).toHaveValue(
      String(held.document.sections[0]!.props!.title),
    );

    // Another writer replaces the draft after this editor read it.
    const theirs = withProps(held.document, "hero", {
      title: `theirs-${randomUUID()}`,
    });
    await theme!.seedDraft("/", theirs);
    const replaced = theme!.draft("/");
    expect(replaced.generation).toBe(held.generation + 1);
    expect(replaced.document).toEqual(theirs);

    const mine = `mine-${randomUUID()}`;
    const answered = page.waitForResponse(
      (response) => isServerFn(response.url(), SECTION_WRITE),
      { timeout: 120_000 },
    );
    await title.fill(mine);
    const refused = await answered;
    expect(await refused.text()).toContain("TEMPLATE_DRAFT_CONFLICT");
    await expect(page.locator("[data-editor-save-status]")).toHaveAttribute(
      "aria-label",
      "Out of date",
      { timeout: 60_000 },
    );
    // Kept: the author's text is still in the field.
    await expect(title).toHaveValue(mine);
    // Nothing written over theirs, and nothing sent again on its own.
    const sent = record.writes.length;
    await page.waitForTimeout(5_000);
    expect(record.writes.length, "nothing is resent without the author").toBe(
      sent,
    );
    expect(theme!.draft("/")).toEqual(replaced);
  });
});

/** The files every D3 Theme shares. */
const D3_COMMON = [
  { path: "astro.config.mjs", content: astroConfig() },
  { path: D3_HERO_PATH, content: D3_HERO },
  { path: D3_HERO_FIELDS_PATH, content: d3HeroFields() },
];

test.describe("Astro D3 shapes: field-wise, aliases, a literal before the spread, a second instance on another page", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(30 * 60_000);
  test.use({ actionTimeout: 60_000 });

  const theme = caseTheme("astro-d3-shapes");
  const SALE = sale("shapes");
  const both = { title: SALE, desc: SALE };
  const home: D3Document = {
    version: 1,
    sections: ["p1", "p2", "c3", "c4a"].map((id) => d3Row(id, { ...both })),
  };
  const about: D3Document = {
    version: 1,
    sections: ["teamA", "teamB"].map((id) => d3Row(id, { ...both })),
  };

  test.beforeAll(async ({ browser }) => {
    await theme!.setUp(
      browser,
      [
        ...D3_COMMON,
        { path: "src/pages/index.astro", content: d3HomePage() },
        { path: "src/pages/about.astro", content: d3AboutPage() },
      ],
      { "/": home, "/about": about },
    );
  });
  test.afterAll(async ({ browser }) => {
    await theme?.tearDown(browser);
  });

  test("each shape edits only its own field, a second same-text instance on /about edits alone, and a reload agrees", async ({
    page,
  }) => {
    const record = recordEditor(page);
    await openEditorAt(page, theme!.editorPath("/"));
    let frame = await liveFrame(page);
    await expect(frame.locator('[data-d3-case="p1"] h1')).toHaveText(SALE, {
      timeout: 180_000,
    });
    await expect(page.getByTestId("preview-document-navigation")).toHaveCount(
      0,
      { timeout: 120_000 },
    );
    const homeStart = theme!.draft("/");
    expect(homeStart.document).toEqual(home);
    expect(theme!.draft("/about").document).toEqual(about);

    // Each edit: which field the Inspector edits, where the page shows it,
    // and what else of the case must still show the starting text.
    const edits = [
      // Row 2, Start p1: field-wise props; desc is edited.
      { section: "p1", label: "Desc", field: "desc", shows: "p", keeps: "h1" },
      // Row 3, Start p2: `title={heading}` where heading is p2.desc. The h1
      // shows desc and the edit writes desc; the stored title reaches
      // nothing here, and the p shows the component's own default.
      { section: "p2", label: "Desc", field: "desc", shows: "h1", keeps: null },
      // Row 3, Start c3: renamed destructuring; the renamed title is edited.
      { section: "c3", label: "Title", field: "title", shows: "h1", keeps: "p" },
      // Row 4, Start c4a: a literal before the spread, the stored section
      // holding the key: the spread's value shows and is edited.
      { section: "c4a", label: "Title", field: "title", shows: "h1", keeps: "p" },
    ] as const;
    let expected = home;
    const values: Record<string, string> = {};
    for (const [index, edit] of edits.entries()) {
      const sentBeforeClick = record.writes.length;
      const content = await selectCase(page, record, edit.section, edit.section);
      if (edit.section === "p2") {
        await expect(
          content.locator('[data-astro-field-code-controlled="title"]'),
        ).toHaveText(TITLE_BY_CODE);
        await expect(astroField(content, "Title")).toHaveCount(0);
      } else {
        await expect(astroField(content, "Title")).toHaveValue(SALE);
      }
      await expect(astroField(content, "Desc")).toHaveValue(SALE);
      expect(record.writes.length, "a click writes nothing").toBe(
        sentBeforeClick,
      );

      const value = `d3-${edit.section}-${randomUUID()}`;
      values[edit.section] = value;
      await writeField(page, record, astroField(content, edit.label), value);
      expected = withProps(expected, edit.section, { [edit.field]: value });
      await expect
        .poll(() => theme!.draft("/").document, { timeout: 60_000 })
        .toEqual(expected);
      expect(theme!.draft("/").generation).toBe(
        homeStart.generation + index + 1,
      );
      frame = await frameShowing(
        page,
        `[data-d3-case="${edit.section}"] ${edit.shows}`,
        value,
      );
      if (edit.keeps) {
        await expect(
          frame.locator(`[data-d3-case="${edit.section}"] ${edit.keeps}`),
        ).toHaveText(SALE);
      }
    }
    await expect(frame.locator('[data-d3-case="p2"] p')).toHaveText(
      D3_DEFAULT_DESC,
    );

    // Rows 12 and 17: /about, a page of its own, and two instances of one
    // component holding the same text. The second is edited; the first and
    // the home page's draft keep every byte.
    await openPageFromList(page, "/about");
    frame = await liveFrame(page);
    await expect(frame.locator('[data-d3-case="teamB"] h1')).toHaveText(SALE, {
      timeout: 120_000,
    });
    const homeBefore = theme!.draft("/");
    const aboutBefore = theme!.draft("/about");
    const teamB = await selectCase(page, record, "teamB", "teamB");
    await expect(astroField(teamB, "Title")).toHaveValue(SALE);
    const second = `d3-teamB-${randomUUID()}`;
    await writeField(page, record, astroField(teamB, "Title"), second);
    const aboutExpected = withProps(about, "teamB", { title: second });
    await expect
      .poll(() => theme!.draft("/about").document, { timeout: 60_000 })
      .toEqual(aboutExpected);
    expect(theme!.draft("/about").generation).toBe(aboutBefore.generation + 1);
    expect(theme!.draft("/")).toEqual(homeBefore);
    frame = await frameShowing(page, '[data-d3-case="teamB"] h1', second);
    await expect(frame.locator('[data-d3-case="teamA"] h1')).toHaveText(SALE);
    await expect(frame.locator('[data-d3-case="teamA"] p')).toHaveText(SALE);
    await expect(frame.locator('[data-d3-case="teamB"] p')).toHaveText(SALE);

    // An editor reload on the home page: page, Inspector and D1 agree.
    const sentBeforeReload = record.writes.length;
    await openEditorAt(page, theme!.editorPath("/"));
    frame = await liveFrame(page);
    await expect(frame.locator('[data-d3-case="p1"] p')).toHaveText(
      values.p1!,
      { timeout: 180_000 },
    );
    await expect(frame.locator('[data-d3-case="p2"] h1')).toHaveText(values.p2!);
    await expect(frame.locator('[data-d3-case="c3"] h1')).toHaveText(values.c3!);
    await expect(frame.locator('[data-d3-case="c4a"] h1')).toHaveText(
      values.c4a!,
    );
    await expect(page.getByTestId("preview-document-navigation")).toHaveCount(
      0,
      { timeout: 120_000 },
    );
    const c4a = await selectCase(page, record, "c4a", "c4a");
    await expect(astroField(c4a, "Title")).toHaveValue(values.c4a!);
    await expect(astroField(c4a, "Desc")).toHaveValue(SALE);
    expect(theme!.draft("/").document).toEqual(expected);
    expect(theme!.draft("/about").document).toEqual(aboutExpected);
    expect(record.writes.length, "the reload and the click wrote nothing").toBe(
      sentBeforeReload,
    );
  });
});

test.describe("Astro D3 shapes Design must not write: literals, an override after the spread, author code, a page value", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(30 * 60_000);
  test.use({ actionTimeout: 60_000 });

  const theme = caseTheme("astro-d3-refused");
  const SALE = sale("refused");
  const both = { title: SALE, desc: SALE };
  const refused: D3Document = {
    version: 1,
    sections: [
      // p4a's stored section has no title: the literal before the spread
      // shows, and title is not CMS data here (Start p4a).
      d3Row("p4a", { desc: SALE }),
      d3Row("p3", { ...both }),
      d3Row("p6", { ...both }),
      d3Row("r9", { ...both }),
      // Stored, but no instance renders it: the literals are not it.
      d3Row("c6a", { ...both }),
    ],
  };
  const home: D3Document = {
    version: 1,
    sections: ["p1", "p2", "c3", "c4a"].map((id) => d3Row(id, { ...both })),
  };

  test.beforeAll(async ({ browser }) => {
    await theme!.setUp(
      browser,
      [
        ...D3_COMMON,
        { path: "src/pages/index.astro", content: d3HomePage() },
        {
          path: `src/pages${D3_REFUSED_PATH}.astro`,
          content: d3RefusedPage(SALE),
        },
      ],
      { "/": home, [D3_REFUSED_PATH]: refused },
    );
  });
  test.afterAll(async ({ browser }) => {
    await theme?.tearDown(browser);
  });

  test("each refused field is shown as controlled by code and writes nothing, its sibling edits, and literals alone select nothing", async ({
    page,
  }) => {
    const record = recordEditor(page);
    // An editor address naming the route template still framed the home
    // page (seen on 07e9158); the page list is how an author opens it.
    await openEditorAt(page, theme!.editorPath("/"));
    await expect(
      (await liveFrame(page)).locator('[data-d3-case="p1"] h1'),
    ).toHaveText(SALE, { timeout: 180_000 });
    await expect(page.getByTestId("preview-document-navigation")).toHaveCount(
      0,
      { timeout: 120_000 },
    );
    await openPageFromList(page, D3_REFUSED_PATH);
    let frame = await liveFrame(page);
    await expect(frame.locator('[data-d3-case="p4a"] h1')).toHaveText(
      D3_P4A_LITERAL,
      { timeout: 180_000 },
    );
    await expect(page.getByTestId("preview-document-navigation")).toHaveCount(
      0,
      { timeout: 120_000 },
    );
    const refusedStart = theme!.draft(D3_REFUSED_PATH);
    expect(refusedStart.document).toEqual(refused);
    const homeBefore = theme!.draft("/");

    // Rows 5 (p4a), 6 (p3), 8 (p6) and 9 (r9): title shows code's value and
    // is controlled by code; desc is CMS and edits.
    const titles: Record<string, string> = {
      p4a: D3_P4A_LITERAL,
      p3: SALE,
      p6: SALE,
      r9: SALE,
    };
    let expected = refused;
    for (const [index, section] of ["p4a", "p3", "p6", "r9"].entries()) {
      const sentBeforeClick = record.writes.length;
      const content = await selectCase(page, record, section, section);
      const byCode = content.locator(
        '[data-astro-field-code-controlled="title"]',
      );
      await expect(
        byCode,
        `${section}'s title is shown as controlled by code`,
      ).toHaveText(TITLE_BY_CODE);
      await expect(astroField(content, "Title")).toHaveCount(0);
      await expect(astroField(content, "Desc")).toHaveValue(SALE);
      // A click on the refused field itself writes nothing either.
      await byCode.click();
      await page.waitForTimeout(1_000);
      expect(record.writes.length, `${section}: clicks write nothing`).toBe(
        sentBeforeClick,
      );

      const value = `d3-${section}-${randomUUID()}`;
      await writeField(page, record, astroField(content, "Desc"), value);
      expected = withProps(expected, section, { desc: value });
      await expect
        .poll(() => theme!.draft(D3_REFUSED_PATH).document, { timeout: 60_000 })
        .toEqual(expected);
      expect(theme!.draft(D3_REFUSED_PATH).generation).toBe(
        refusedStart.generation + index + 1,
      );
      frame = await frameShowing(page, `[data-d3-case="${section}"] p`, value);
      await expect(frame.locator(`[data-d3-case="${section}"] h1`)).toHaveText(
        titles[section]!,
      );
    }
    // p4a was never given a title by Design.
    expect(
      Object.keys(
        theme!
          .draft(D3_REFUSED_PATH)
          .document.sections.find((row) => row.id === "p4a")!.props!,
      ),
    ).toEqual(["desc"]);

    // Row 7 (Start c6a): an instance of literals only renders no section; a
    // click selects nothing, says why, and writes nothing.
    const sent = record.writes.length;
    frame = await liveFrame(page);
    await ensureSelection(page, frame);
    await frame.locator('[data-d3-case="c6a"] h1').click();
    await expect(page.getByText(CONTROLLED_BY_CODE).first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(astroContent(page, "c6a")).toHaveCount(0);
    await page.waitForTimeout(3_000);
    expect(record.writes.length, "the literal-only click writes nothing").toBe(
      sent,
    );
    expect(theme!.draft(D3_REFUSED_PATH).document).toEqual(expected);
    expect(theme!.draft("/")).toEqual(homeBefore);
  });
});

test.describe("Astro D3 fields declared in <Name>.fields.ts", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(30 * 60_000);
  test.use({ actionTimeout: 60_000 });

  const theme = caseTheme("astro-d3-sidecar");
  const SALE = sale("sidecar");
  const seeded: D3Document = {
    version: 1,
    sections: [d3Row("card", { title: SALE, desc: SALE })],
  };

  test.beforeAll(async ({ browser }) => {
    await theme!.setUp(
      browser,
      [
        ...D3_COMMON,
        { path: "src/pages/index.astro", content: d3SidecarPage() },
      ],
      { "/": seeded },
    );
  });
  test.afterAll(async ({ browser }) => {
    await theme?.tearDown(browser);
  });

  async function openCard(page: Page) {
    await openEditorAt(page, theme!.editorPath("/"));
    const frame = await liveFrame(page);
    await expect(frame.locator('[data-d3-case="card"] h1')).toBeVisible({
      timeout: 180_000,
    });
    await expect(page.getByTestId("preview-document-navigation")).toHaveCount(
      0,
      { timeout: 120_000 },
    );
    return frame;
  }

  async function inAnotherTab(
    browser: Browser,
    change: (page: Page) => Promise<{ success: boolean }>,
  ) {
    const other = await signedInPage(browser);
    try {
      await other.goto(theme!.editorPath("/"), {
        waitUntil: "domcontentloaded",
      });
      const result = await change(other);
      expect(result.success, JSON.stringify(result)).toBe(true);
    } finally {
      await other.context().close();
    }
  }

  test("follows a relabelled declaration saved in Code", async ({ page }) => {
    const record = recordEditor(page);
    await openCard(page);
    let content = await selectCase(page, record, "card", "card");
    await expect(astroField(content, "Title")).toHaveValue(SALE);

    const saved = await writeThemeFiles(page, theme!.scope, [
      { path: D3_HERO_FIELDS_PATH, content: d3HeroFields("Heading", "Body") },
    ]);
    expect(saved.success, JSON.stringify(saved)).toBe(true);
    await openCard(page);
    content = await selectCase(page, record, "card", "card");
    await expect(astroField(content, "Heading")).toHaveValue(SALE);
    await expect(astroField(content, "Body")).toHaveValue(SALE);
    await expect(astroField(content, "Title")).toHaveCount(0);
    expect(record.writes, "nothing was written").toEqual([]);
    expect(theme!.draft("/").document).toEqual(seeded);
  });

  test("does not save an edit after another tab deleted the declaration, keeps it, and says so", async ({
    page,
    browser,
  }) => {
    const record = recordEditor(page);
    await openCard(page);
    const content = await selectCase(page, record, "card", "card");
    const heading = astroField(content, "Heading");
    await expect(heading).toHaveValue(SALE);
    const before = theme!.draft("/");

    await inAnotherTab(browser, (other) =>
      removeThemeFiles(other, theme!.scope, [D3_HERO_FIELDS_PATH]),
    );

    const stale = `stale-${randomUUID()}`;
    const answered = page.waitForResponse(
      (response) => isServerFn(response.url(), SECTION_WRITE),
      { timeout: 120_000 },
    );
    await heading.fill(stale);
    const refused = await answered;
    expect(await refused.text()).toContain("SELECTION_SOURCE_CONFLICT");
    await expect(
      page.getByText(/The source code has changed\. Select the field again/),
    ).toBeVisible({ timeout: 30_000 });
    await expect(heading).toHaveValue(stale);
    expect(theme!.draft("/")).toEqual(before);
  });

  test("drops the fields once the declaration is gone", async ({ page }) => {
    const record = recordEditor(page);
    const frame = await openCard(page);
    await ensureSelection(page, frame);
    await frame.locator('[data-d3-case="card"] h1').click();
    await expect(page.getByText(CONTROLLED_BY_CODE).first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(astroContent(page, "card")).toHaveCount(0);
    await page.waitForTimeout(3_000);
    expect(record.writes, "nothing was written").toEqual([]);
    expect(theme!.draft("/").document).toEqual(seeded);
  });

  test("brings the fields back when the declaration is made again, and an edit is stored", async ({
    page,
  }) => {
    const record = recordEditor(page);
    await page.goto(theme!.editorPath("/"), { waitUntil: "domcontentloaded" });
    const saved = await writeThemeFiles(page, theme!.scope, [
      { path: D3_HERO_FIELDS_PATH, content: d3HeroFields() },
    ]);
    expect(saved.success, JSON.stringify(saved)).toBe(true);
    await openCard(page);
    const content = await selectCase(page, record, "card", "card");
    await expect(astroField(content, "Title")).toHaveValue(SALE);
    const before = theme!.draft("/");
    const value = `d3-card-${randomUUID()}`;
    await writeField(page, record, astroField(content, "Title"), value);
    await expect
      .poll(() => theme!.draft("/").document, { timeout: 60_000 })
      .toEqual(withProps(seeded, "card", { title: value }));
    expect(theme!.draft("/").generation).toBe(before.generation + 1);
    const frame = await frameShowing(page, '[data-d3-case="card"] h1', value);
    await expect(frame.locator('[data-d3-case="card"] p')).toHaveText(SALE);
  });
});
