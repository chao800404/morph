import { randomUUID } from "node:crypto";

import { expect, test, type Frame, type Page } from "@playwright/test";

import { queryLifecycleD1 } from "../scripts/verify-published-artifact.mjs";
import { EDITOR_PATH } from "./helpers";
import { isServerFn } from "./helpers/editor-writes-paused";
import {
  THEMES,
  expectHydrated,
  serverFn,
  signedInPage,
  storefrontHarness,
} from "./native-acceptance";
import {
  themeScopeFromEditorPath,
  writeThemeFiles,
  type ThemeScope,
} from "./native-compat";
import { astroConfig } from "../src/lib/storefront/theme-framework/astro-native-prerender.fixtures";

/**
 * Astro M2 PR 3, the first result: on a real Astro Live Preview (`astro dev`
 * in the container, behind the preview Worker), a click in Design on a
 * section Core's binding view confirms selects it and opens its declared
 * fields in the Inspector (owner decision D2). Typing into a field writes
 * the Document through the editor's one content write path, gated on the
 * section's acknowledged basis (option B, the #399 proof), and carries the
 * identity and Core's component digest. Then:
 *
 * 1. the raw D1 draft holds the typed value at exactly that field, one
 *    draft generation on, and nothing else in the Document changed;
 * 2. the page, after sync -> confirm -> reload, shows it;
 * 3. a second field typed after that reload is sent only once the
 *    reloaded page acknowledged the section again, and it may hold the same
 *    text as the first without either crossing into the other;
 * 4. after an editor reload, the page, the Inspector and D1 agree.
 *
 * The Theme row is inserted by the harness (no product entry creates an
 * Astro Theme yet), and one starting draft is seeded into this run's D1 as
 * in astro-basis-ack.spec.ts. Every value after that is written by the
 * Inspector.
 *
 * Container transport only, with Astro on (`MORPH_ASTRO_THEMES=1`) and the
 * `.astro` parser behind Core's `ASTRO_PARSER` (`MORPH_E2E_ASTRO_PARSER=1`):
 * without it Core's binding view refuses every click. Every gate is a file
 * gate: where one does not hold the whole file skips, and its container
 * acceptance (scripts/container-acceptance-targets/astro-inspector-write.mjs)
 * then fails for the missing case rather than passing.
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

const PREVIEW =
  "/src/server/storefront/storefront-theme-preview-server.serverFn.ts";
const SECTION_WRITE = "updateStorefrontThemeSectionProps";

/** The M2 case's home page: `<Hero {...hero} />`, fields in `.fields.ts`. */
const FILES = [
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

type Hero = { title: string; subtitle: string };
type DraftRow = {
  generation: number;
  sections: Array<{
    id: string;
    type?: string;
    enabled?: boolean;
    props?: Record<string, unknown> | null;
  }>;
};

/** The live preview's frame, once the editor framed it. */
async function liveFrame(page: Page): Promise<Frame> {
  const iframe = page.locator("iframe").first();
  await expect(iframe).toBeVisible({ timeout: 180_000 });
  const host = new URL((await iframe.getAttribute("src"))!).hostname;
  let frame: Frame | null = null;
  await expect
    .poll(() => (frame = page.frame({ url: (url) => url.hostname === host })), {
      timeout: 180_000,
    })
    .toBeTruthy();
  return frame!;
}

/**
 * The live frame once `selector` in it shows `text`. A write's sync ->
 * confirm -> reload can replace the canvas frame while this waits, so the
 * frame is looked up again on every poll rather than held from before.
 */
async function frameShowing(
  page: Page,
  selector: string,
  text: string,
): Promise<Frame> {
  await expect
    .poll(
      async () => {
        const frame = await liveFrame(page);
        return frame
          .locator(selector)
          .textContent({ timeout: 5_000 })
          .catch(() => null);
      },
      { timeout: 120_000, message: `the page shows ${text} at ${selector}` },
    )
    .toBe(text);
  return liveFrame(page);
}

/** Turns the pointer tool on, unless it is on, and waits for the frame. */
async function ensureSelection(page: Page, frame: Frame) {
  const off = page.getByRole("button", { name: "Disable section selection" });
  if (!(await off.isVisible().catch(() => false))) {
    const on = page.getByRole("button", { name: "Enable section selection" });
    await expect(on, "the canvas offers the selection tool").toBeVisible({
      timeout: 60_000,
    });
    await expectHydrated(on);
    await on.click();
    await expect(off).toBeVisible();
  }
  await expect(
    frame.locator("html[data-storefront-editor-selection-enabled]"),
  ).toBeAttached({ timeout: 45_000 });
}

/** `[preview-presentation]` lines: the ops whose `applied` the editor took. */
function acceptedBasisOps(lines: readonly string[]): string[] {
  return lines.flatMap((line) => {
    const match = /ack accepted op=(section-basis-\d+) .*status=applied/.exec(
      line,
    );
    return match ? [match[1]!] : [];
  });
}

test.describe("Astro Inspector write on the container Live Preview (M2 PR 3)", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(30 * 60_000);
  test.use({ actionTimeout: 60_000 });

  const scope: ThemeScope | null = EDITOR_PATH
    ? { ...themeScopeFromEditorPath(EDITOR_PATH), themeId: randomUUID() }
    : null;
  const harness =
    STATE_DIR && scope ? storefrontHarness({ scope, stateDir: STATE_DIR }) : null;
  let homeId: string | null = null;
  let editorPath: string | null = null;
  const start: Hero = {
    title: `m2w-start-${randomUUID()}-title`,
    subtitle: `m2w-start-${randomUUID()}-subtitle`,
  };

  /** The home template's draft, read from this run's D1 itself. */
  const draftRow = (): DraftRow => {
    const rows = queryLifecycleD1(
      STATE_DIR!,
      `SELECT t.draft_generation AS generation, r.document AS document
         FROM storefront_theme_templates t
         JOIN storefront_theme_template_revisions r ON r.id = t.draft_revision_id
        WHERE t.id = ?1 AND t.theme_id = ?2 AND t.deleted_at IS NULL`,
      homeId!,
      scope!.themeId,
    ) as Array<{ generation: number; document: string }>;
    expect(rows, "the home template has one draft").toHaveLength(1);
    const document = JSON.parse(rows[0]!.document) as {
      sections: DraftRow["sections"];
    };
    return { generation: rows[0]!.generation, sections: document.sections };
  };
  const heroOf = (row: DraftRow) =>
    row.sections.find((section) => section.id === "hero")?.props ?? null;

  /** The one starting draft (harness seeding; see the header). */
  async function seedStart() {
    const author = process.env.E2E_EMAIL;
    expect(author, "E2E_EMAIL names the revision's author").toBeTruthy();
    const revisionId = randomUUID();
    const now = new Date().toISOString();
    expect(
      await harness!.writeD1(
        `INSERT INTO storefront_theme_template_revisions
           (id, template_id, version, document, created_by, created_at)
         SELECT ?1, ?2,
           COALESCE((SELECT MAX(version) FROM storefront_theme_template_revisions WHERE template_id = ?2), 0) + 1,
           ?3, id, ?4
         FROM users WHERE email = ?5`,
        revisionId,
        homeId!,
        JSON.stringify({
          version: 1,
          // The row Core writes for this instance: its ref and type are
          // Core's own (`resolveAstroSectionWrite`). A row with no ref is
          // refused as section-row-mismatch, never re-pointed.
          sections: [
            {
              id: "hero",
              type: "hero",
              componentRef: "src/components/Hero.astro",
              enabled: true,
              props: { ...start },
            },
          ],
        }),
        now,
        author,
      ),
    ).toBe(1);
    expect(
      await harness!.writeD1(
        `UPDATE storefront_theme_templates
            SET draft_revision_id = ?1, draft_generation = draft_generation + 1, updated_at = ?2
          WHERE id = ?3 AND theme_id = ?4 AND deleted_at IS NULL`,
        revisionId,
        now,
        homeId!,
        scope!.themeId,
      ),
    ).toBe(1);
  }

  async function openCaseEditor(page: Page) {
    await page.goto(editorPath!, { waitUntil: "domcontentloaded" });
    const publish = page.getByRole("button", { name: /^Publish$/ });
    await expect(publish).toBeVisible({ timeout: 45_000 });
    await expectHydrated(publish);
  }

  test.beforeAll(async ({ browser }) => {
    const page = await signedInPage(browser);
    await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
    const now = new Date().toISOString();
    expect(
      await harness!.writeD1(
        `INSERT INTO storefront_themes
           (id, storefront_id, name, framework, metadata, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'astro', '{"starterTemplateVersion":1}', ?4, ?4)`,
        scope!.themeId,
        scope!.storefrontId,
        `astro-inspector-write-${scope!.themeId}`,
        now,
      ),
    ).toBe(1);
    const saved = await writeThemeFiles(page, scope!, FILES);
    expect(saved.success, JSON.stringify(saved)).toBe(true);
    const ensured = (await serverFn(
      page,
      THEMES,
      "ensureStorefrontThemeRouteTemplate",
      { ...scope!, routePath: "/" },
    )) as { success: boolean; data?: { id: string; createdByThisCall: boolean } };
    expect(ensured.success, JSON.stringify(ensured)).toBe(true);
    expect(ensured.data?.createdByThisCall).toBe(true);
    homeId = ensured.data!.id;
    editorPath = `/store/${scope!.storefrontId}/themes/${scope!.themeId}/editor?templateId=${homeId}`;
    await seedStart();
    await page.context().close();
  });

  test.afterAll(async ({ browser }) => {
    await harness?.dispose();
    if (!scope) return;
    const page = await signedInPage(browser);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await serverFn(page, PREVIEW, "stopThemePreviewServer", scope).catch(
      () => {},
    );
    await page.context().close();
  });

  test("a click selects the hero, an Inspector edit is stored in the Document, and page, Inspector and Document agree after a reload", async ({
    page,
  }) => {
    const lines: string[] = [];
    page.on("console", (message) => {
      const text = message.text();
      if (text.startsWith("[preview-presentation]")) lines.push(text);
    });
    const writeBodies: string[] = [];
    page.on("request", (request) => {
      if (isServerFn(request.url(), SECTION_WRITE)) {
        writeBodies.push(request.postData() ?? "");
      }
    });
    const inspector = page.locator("[data-editor-inspector-panel]");
    const content = page.locator('[data-astro-inspector-content="hero"]');
    const field = (name: "Title" | "Subtitle") =>
      content.getByRole("textbox", { name, exact: true });
    const written = (count: number) =>
      expect
        .poll(() => writeBodies.length, {
          timeout: 60_000,
          message: `${count} section write(s) sent`,
        })
        .toBe(count);
    const answered = () =>
      page.waitForResponse(
        (response) => isServerFn(response.url(), SECTION_WRITE),
        { timeout: 120_000 },
      );

    /** Selects the hero on the canvas: Design, not Code (D2). */
    const selectHero = async (frame: Frame) => {
      await ensureSelection(page, frame);
      const acceptedBefore = acceptedBasisOps(lines).length;
      await frame.locator("[data-m2w-hero] h1").click();
      await expect(content, "the Inspector opens the hero's fields").toBeVisible({
        timeout: 60_000,
      });
      // Core confirmed the frame's pair and the frame acknowledged the
      // section's basis: the proof an input is sent with.
      await expect
        .poll(() => acceptedBasisOps(lines).length, {
          timeout: 120_000,
          message: "the editor takes the frame's applied ack for the hero",
        })
        .toBeGreaterThan(acceptedBefore);
    };

    await openCaseEditor(page);
    let frame = await liveFrame(page);
    await expect(frame.locator("[data-m2w-hero] h1")).toHaveText(start.title, {
      timeout: 180_000,
    });
    await expect(page.getByTestId("preview-document-navigation")).toHaveCount(
      0,
      { timeout: 120_000 },
    );
    const before = draftRow();
    expect(heroOf(before)).toEqual(start);

    // 1. The click selects; the Inspector shows the declared fields only.
    await selectHero(frame);
    await inspector.getByRole("button", { name: "Content", exact: true }).click();
    await expect(field("Title")).toHaveValue(start.title);
    await expect(field("Subtitle")).toHaveValue(start.subtitle);
    expect(writeBodies, "a click writes nothing").toEqual([]);

    // 2. Typing the title writes it, with Core's identity and digest.
    const edited = `m2w-${randomUUID()}`;
    const firstAnswer = answered();
    await field("Title").fill(edited);
    expect((await firstAnswer).ok()).toBe(true);
    const acceptedAtFirstAnswer = acceptedBasisOps(lines).length;
    await written(1);
    expect(writeBodies[0]).toContain("componentDigest");
    expect(writeBodies[0]).toContain("identity");
    expect(writeBodies[0]).toContain(edited);
    // The raw draft: that field, one generation on, nothing else changed.
    await expect
      .poll(() => heroOf(draftRow())?.title, { timeout: 60_000 })
      .toBe(edited);
    const afterTitle = draftRow();
    expect(afterTitle.generation).toBe(before.generation + 1);
    expect(afterTitle.sections.map((section) => section.id)).toEqual(
      before.sections.map((section) => section.id),
    );
    expect(heroOf(afterTitle)).toEqual({ ...start, title: edited });

    // The page shows it after sync -> confirm -> reload.
    frame = await frameShowing(page, "[data-m2w-hero] h1", edited);
    await expect(frame.locator("[data-m2w-hero] p")).toHaveText(start.subtitle);

    // 3. The same text into the subtitle, sent only on the reloaded page's
    //    own basis ack, and nothing crosses between the two fields.
    await expect
      .poll(() => acceptedBasisOps(lines).length, {
        timeout: 120_000,
        message: "the reloaded page acknowledges the hero's basis again",
      })
      .toBeGreaterThan(acceptedAtFirstAnswer);
    const secondAnswer = answered();
    await field("Subtitle").fill(edited);
    expect((await secondAnswer).ok()).toBe(true);
    await written(2);
    expect(writeBodies[1]).toContain("componentDigest");
    await expect
      .poll(() => heroOf(draftRow())?.subtitle, { timeout: 60_000 })
      .toBe(edited);
    const afterSubtitle = draftRow();
    expect(afterSubtitle.generation).toBe(before.generation + 2);
    expect(heroOf(afterSubtitle)).toEqual({ title: edited, subtitle: edited });
    expect(afterSubtitle.sections.map((section) => section.id)).toEqual(
      before.sections.map((section) => section.id),
    );
    frame = await frameShowing(page, "[data-m2w-hero] p", edited);
    await expect(frame.locator("[data-m2w-hero] h1")).toHaveText(edited);

    // 4. An editor reload: the page, the Inspector and D1 agree.
    await openCaseEditor(page);
    frame = await liveFrame(page);
    await expect(frame.locator("[data-m2w-hero] h1")).toHaveText(edited, {
      timeout: 180_000,
    });
    await expect(frame.locator("[data-m2w-hero] p")).toHaveText(edited);
    await expect(page.getByTestId("preview-document-navigation")).toHaveCount(
      0,
      { timeout: 120_000 },
    );
    await selectHero(frame);
    await inspector.getByRole("button", { name: "Content", exact: true }).click();
    await expect(field("Title")).toHaveValue(edited);
    await expect(field("Subtitle")).toHaveValue(edited);
    const afterReload = draftRow();
    expect(afterReload.generation).toBe(afterSubtitle.generation);
    expect(heroOf(afterReload)).toEqual({ title: edited, subtitle: edited });
    expect(writeBodies, "the reload and the click wrote nothing").toHaveLength(2);
  });
});
