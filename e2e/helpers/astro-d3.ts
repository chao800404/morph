import { randomUUID } from "node:crypto";

import {
  expect,
  type Browser,
  type Frame,
  type Locator,
  type Page,
} from "@playwright/test";

import { queryLifecycleD1 } from "../../scripts/verify-published-artifact.mjs";
import { isServerFn } from "./editor-writes-paused";
import {
  THEMES,
  expectHydrated,
  serverFn,
  signedInPage,
  storefrontHarness,
} from "../native-acceptance";
import { writeThemeFiles, type ThemeScope } from "../native-compat";

/**
 * Shared steps of the Astro M2 D3 container cases
 * (`e2e/astro-inspector-write.spec.ts`,
 * `e2e/astro-design-release-acceptance.spec.ts`). Each case runs on an
 * Astro Theme of its own: the row is inserted by the harness (no product
 * entry creates an Astro Theme yet), its files are saved through Code's own
 * write, its pages' Documents are made by the route ensure, and one starting
 * draft per page is seeded into this run's D1. Every value after that is
 * written by Design.
 */

export const SECTION_WRITE = "updateStorefrontThemeSectionProps";
export const PREVIEW =
  "/src/server/storefront/storefront-theme-preview-server.serverFn.ts";

export type D3Section = {
  id: string;
  type?: string;
  componentRef?: string;
  enabled?: boolean;
  props?: Record<string, unknown> | null;
};
export type D3Document = { version?: number; sections: D3Section[] } & Record<
  string,
  unknown
>;
export type D3Draft = { generation: number; document: D3Document };

/** The live preview's frame, once the editor framed it. */
export async function liveFrame(page: Page): Promise<Frame> {
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
export async function frameShowing(
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
export async function ensureSelection(page: Page, frame: Frame) {
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
export function acceptedBasisOps(lines: readonly string[]): string[] {
  return lines.flatMap((line) => {
    const match = /ack accepted op=(section-basis-\d+) .*status=applied/.exec(
      line,
    );
    return match ? [match[1]!] : [];
  });
}

/**
 * What a case watches on its page: the editor's presentation trace and
 * every section write it sends.
 */
export function recordEditor(page: Page) {
  const lines: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (text.startsWith("[preview-presentation]")) lines.push(text);
  });
  const writes: string[] = [];
  page.on("request", (request) => {
    if (isServerFn(request.url(), SECTION_WRITE)) {
      writes.push(request.postData() ?? "");
    }
  });
  return { lines, writes };
}
export type EditorRecord = ReturnType<typeof recordEditor>;

export async function openEditorAt(page: Page, path: string) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  const publish = page.getByRole("button", { name: /^Publish$/ });
  await expect(publish).toBeVisible({ timeout: 45_000 });
  await expectHydrated(publish);
}

/**
 * The page list's name for a page: its path, and "Home /" for the home
 * page (editor-sections-panel.tsx; Start and Astro alike). Batch 1 asked
 * for "/" and found no such entry.
 */
export const pageListName = (routePath: string) =>
  routePath === "/" ? "Home /" : routePath;

/** Switches the editor to another page from the Theme's page list. */
export async function openPageFromList(page: Page, routePath: string) {
  const pages = page.getByRole("list", { name: "Theme pages" });
  await pages
    .getByRole("button", { name: pageListName(routePath), exact: true })
    .click();
  await expect
    .poll(async () => new URL((await liveFrame(page)).url()).pathname, {
      timeout: 120_000,
    })
    .toBe(routePath);
  await expect(page.getByTestId("preview-document-navigation")).toHaveCount(
    0,
    { timeout: 120_000 },
  );
}

/** The Inspector's Content of `sectionId`, the Astro block. */
export const astroContent = (page: Page, sectionId: string) =>
  page.locator(`[data-astro-inspector-content="${sectionId}"]`);

export const astroField = (content: Locator, label: string) =>
  content.getByRole("textbox", { name: label, exact: true });

/**
 * Selects the case `caseId` on the canvas (a click on its heading), waits
 * for the Inspector to open its section's fields and for the editor to take
 * the frame's applied ack for that click: the proof an input is sent with.
 */
export async function selectCase(
  page: Page,
  record: EditorRecord,
  caseId: string,
  sectionId: string,
): Promise<Locator> {
  const frame = await liveFrame(page);
  await ensureSelection(page, frame);
  const acceptedBefore = acceptedBasisOps(record.lines).length;
  await frame.locator(`[data-d3-case="${caseId}"] h1`).click();
  const content = astroContent(page, sectionId);
  await expect(content, `the Inspector opens ${sectionId}'s fields`).toBeVisible(
    { timeout: 60_000 },
  );
  await expect
    .poll(() => acceptedBasisOps(record.lines).length, {
      timeout: 120_000,
      message: `the editor takes the frame's applied ack for ${sectionId}`,
    })
    .toBeGreaterThan(acceptedBefore);
  await page
    .locator("[data-editor-inspector-panel]")
    .getByRole("button", { name: "Content", exact: true })
    .click();
  return content;
}

/**
 * Types `value` into `field`, waits for Core's answer, and then for the
 * reloaded page's own basis ack, so the next input is made on the page that
 * shows this one. Returns the write's body.
 */
export async function writeField(
  page: Page,
  record: EditorRecord,
  field: Locator,
  value: string,
): Promise<string> {
  const sentBefore = record.writes.length;
  const answered = page.waitForResponse(
    (response) => isServerFn(response.url(), SECTION_WRITE),
    { timeout: 120_000 },
  );
  await field.fill(value);
  const answer = await answered;
  expect(answer.ok(), "Core answered the write").toBe(true);
  // What it stored is read back from D1 by the case itself.
  const acceptedAtAnswer = acceptedBasisOps(record.lines).length;
  await expect
    .poll(() => record.writes.length, {
      timeout: 60_000,
      message: "exactly one section write sent",
    })
    .toBe(sentBefore + 1);
  const body = record.writes[sentBefore]!;
  expect(body).toContain("componentDigest");
  expect(body).toContain("identity");
  expect(body).toContain(value);
  await expect
    .poll(() => acceptedBasisOps(record.lines).length, {
      timeout: 120_000,
      message: "the reloaded page acknowledges its basis again",
    })
    .toBeGreaterThan(acceptedAtAnswer);
  return body;
}

/** A copy of `document` with one section's props changed. */
export function withProps(
  document: D3Document,
  sectionId: string,
  props: Record<string, unknown>,
): D3Document {
  const copy = structuredClone(document);
  const section = copy.sections.find((candidate) => candidate.id === sectionId);
  expect(section, `${sectionId} is stored`).toBeTruthy();
  section!.props = { ...(section!.props ?? {}), ...props };
  return copy;
}

/** One Astro Theme of a case's own, its files, Documents and drafts. */
export function astroCaseTheme(options: {
  name: string;
  editorPath: string;
  stateDir: string;
  scope: ThemeScope;
}) {
  const { scope, stateDir } = options;
  const harness = storefrontHarness({ scope, stateDir });
  const templates = new Map<string, string>();

  const templateOf = (routePath: string) => {
    const id = templates.get(routePath);
    expect(id, `the ${routePath} template was made`).toBeTruthy();
    return id!;
  };

  /** A page's draft, read from this run's D1 itself. */
  const draft = (routePath: string): D3Draft => {
    const rows = queryLifecycleD1(
      stateDir,
      `SELECT t.draft_generation AS generation, r.document AS document
         FROM storefront_theme_templates t
         JOIN storefront_theme_template_revisions r ON r.id = t.draft_revision_id
        WHERE t.id = ?1 AND t.theme_id = ?2 AND t.deleted_at IS NULL`,
      templateOf(routePath),
      scope.themeId,
    ) as Array<{ generation: number; document: string }>;
    expect(rows, `${routePath} has one draft`).toHaveLength(1);
    return {
      generation: rows[0]!.generation,
      document: JSON.parse(rows[0]!.document) as D3Document,
    };
  };

  /**
   * A new draft revision of a page, as another writer would leave it: the
   * harness seeding of the starting drafts, and a concurrent writer.
   */
  async function seedDraft(routePath: string, document: D3Document) {
    const author = process.env.E2E_EMAIL;
    expect(author, "E2E_EMAIL names the revision's author").toBeTruthy();
    const templateId = templateOf(routePath);
    const revisionId = randomUUID();
    const now = new Date().toISOString();
    expect(
      await harness.writeD1(
        `INSERT INTO storefront_theme_template_revisions
           (id, template_id, version, document, created_by, created_at)
         SELECT ?1, ?2,
           COALESCE((SELECT MAX(version) FROM storefront_theme_template_revisions WHERE template_id = ?2), 0) + 1,
           ?3, id, ?4
         FROM users WHERE email = ?5`,
        revisionId,
        templateId,
        JSON.stringify(document),
        now,
        author,
      ),
    ).toBe(1);
    expect(
      await harness.writeD1(
        `UPDATE storefront_theme_templates
            SET draft_revision_id = ?1, draft_generation = draft_generation + 1, updated_at = ?2
          WHERE id = ?3 AND theme_id = ?4 AND deleted_at IS NULL`,
        revisionId,
        now,
        templateId,
        scope.themeId,
      ),
    ).toBe(1);
  }

  /**
   * A template no route ensure makes (the shared `layout`), inserted by the
   * harness under `key` with an empty document; its first draft comes from
   * `seedDraft(key, ...)`. No product entry makes one for an Astro Theme.
   */
  async function seedTemplate(key: string, type: string, name: string) {
    const id = randomUUID();
    const now = new Date().toISOString();
    expect(
      await harness.writeD1(
        `INSERT INTO storefront_theme_templates
           (id, theme_id, type, name, document, draft_generation, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, '{"version":1,"sections":[]}', 1, ?5, ?5)`,
        id,
        scope.themeId,
        type,
        name,
        now,
      ),
    ).toBe(1);
    templates.set(key, id);
    return id;
  }

  /** A template's row as stored: its draft and published revisions. */
  const templateRow = (key: string) => {
    const rows = queryLifecycleD1(
      stateDir,
      `SELECT draft_revision_id AS draft, published_revision_id AS published
         FROM storefront_theme_templates
        WHERE id = ?1 AND theme_id = ?2 AND deleted_at IS NULL`,
      templateOf(key),
      scope.themeId,
    ) as Array<{ draft: string | null; published: string | null }>;
    expect(rows, `${key} has one row`).toHaveLength(1);
    return rows[0]!;
  };

  return {
    scope,
    harness,
    templateOf,
    draft,
    seedDraft,
    seedTemplate,
    templateRow,
    editorPath: (routePath = "/") =>
      `/store/${scope.storefrontId}/themes/${scope.themeId}/editor?templateId=${templateOf(routePath)}`,

    /** The Theme row, its files, a Document per page and its first draft. */
    async setUp(
      browser: Browser,
      files: readonly { path: string; content: string }[],
      drafts: Readonly<Record<string, D3Document>>,
    ) {
      const page = await signedInPage(browser);
      try {
        await page.goto(options.editorPath, { waitUntil: "domcontentloaded" });
        const now = new Date().toISOString();
        expect(
          await harness.writeD1(
            `INSERT INTO storefront_themes
               (id, storefront_id, name, framework, metadata, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'astro', '{"starterTemplateVersion":1}', ?4, ?4)`,
            scope.themeId,
            scope.storefrontId,
            `${options.name}-${scope.themeId}`,
            now,
          ),
        ).toBe(1);
        const saved = await writeThemeFiles(page, scope, files);
        expect(saved.success, JSON.stringify(saved)).toBe(true);
        for (const routePath of Object.keys(drafts)) {
          const ensured = (await serverFn(
            page,
            THEMES,
            "ensureStorefrontThemeRouteTemplate",
            { ...scope, routePath },
          )) as {
            success: boolean;
            data?: { id: string; createdByThisCall: boolean };
          };
          expect(ensured.success, JSON.stringify(ensured)).toBe(true);
          expect(ensured.data?.createdByThisCall).toBe(true);
          templates.set(routePath, ensured.data!.id);
          await seedDraft(routePath, drafts[routePath]!);
        }
      } finally {
        await page.context().close();
      }
    },

    async tearDown(browser: Browser) {
      await harness.dispose();
      const page = await signedInPage(browser);
      try {
        await page.goto("/", { waitUntil: "domcontentloaded" });
        await serverFn(page, PREVIEW, "stopThemePreviewServer", scope).catch(
          () => {},
        );
      } finally {
        await page.context().close();
      }
    },
  };
}
