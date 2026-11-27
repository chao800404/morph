import { randomUUID } from "node:crypto";

import { expect, test, type Frame, type Page } from "@playwright/test";

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
  themeSourceGeneration,
  writeThemeFiles,
  type ThemeScope,
} from "./native-compat";
import { ASTRO_BASIS_UNCONFIRMED_MESSAGE } from "../src/lib/storefront/editor/astro-basis-presentation";
import { astroConfig } from "../src/lib/storefront/theme-framework/astro-native-prerender.fixtures";

/**
 * The Astro basis acknowledgement (option B,
 * handoff/2026-11-24/astro-presentation-ack-options.md), on a real Astro
 * Live Preview: `astro dev` in the container, behind the preview Worker that
 * pins one content snapshot per request and stamps it as
 * `Server-Timing: morph-content;desc="<ticket>.<instance>"`.
 *
 * What each test shows, from what the browser and Core answer, never from a
 * wait:
 * 1. A page's content is the stamped snapshot's, for two snapshots in a row,
 *    including a read made by a component that renders while the body
 *    streams, from a module it loads with `import()`. A content read that
 *    left the request's pinned snapshot is refused by the Worker (503), so a
 *    late read that returns the draft is a read the pin reached.
 * 2. A click on a section Core's binding view confirms is acknowledged as
 *    the basis only after Core has confirmed the frame's own ticket and
 *    instance: while that confirmation is held back the click is refused
 *    with the reload hint and nothing is posted to the frame; Core's answer
 *    itself then issues that kept click's basis token, naming that same
 *    pair, the frame answers `applied`, and the editor takes it; the next
 *    click yields exactly one more token. No post is without its cause.
 *    Then a stale document: content another writer synced after the
 *    editor's basis is shown by a reloaded frame whose stamp Core never
 *    confirmed to this editor. The click is refused with the same hint, and
 *    nothing is posted or acknowledged for that document.
 * 3. A Start frame never names `astro-basis-ack-v1` and its page carries no
 *    `morph-content` stamp.
 *
 * Drafts are seeded by the harness straight into this run's D1, as in the
 * M2 case spec (test/astro-m2-case-product-path): the Astro Inspector write
 * is later work, and nothing here writes through Design. Syncs are made
 * through Core's own server functions from a second page, so the editor
 * under test learns of them only from the frame.
 *
 * Container transport only, with Astro on (`MORPH_ASTRO_THEMES=1`, in the
 * Worker's `.dev.vars` and in this process) and the `.astro` parser behind
 * Core's `ASTRO_PARSER` binding (`MORPH_E2E_ASTRO_PARSER=1`): without it
 * Core's binding view refuses every click (`parser-binding-missing`), and no
 * basis is issued. With the parser opted in, the runner itself makes one
 * real parse through Core's binding before any test and refuses the run if
 * it is not confirmed (`confirmAstroParserBinding` in
 * scripts/run-editor-e2e.mjs). Every gate is a file gate: where one does not
 * hold, the whole file skips, and its container acceptance
 * (scripts/container-acceptance-targets/astro-basis-ack.mjs) then fails for
 * the missing cases rather than passing.
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
const STREAM_ROUTE = "/basis-stream";
const DEFAULTS = {
  title: "BASIS-DEFAULT-TITLE",
  subtitle: "BASIS-DEFAULT-SUBTITLE",
} as const;

/**
 * The Theme: the M2 case's home page (`morph.pages.get("/")`,
 * `const { hero } = home`, `<Hero {...hero} />`, fields in `Hero.fields.ts`),
 * which Core's binding view confirms, and a second page that reads the same
 * content twice: in its own frontmatter, and in a component whose frontmatter
 * first loads a module with `import()` and then reads, while the body
 * streams.
 */
const FILES = [
  { path: "astro.config.mjs", content: astroConfig() },
  {
    path: "src/components/Hero.astro",
    content: `---
interface Props {
  title?: string;
  subtitle?: string;
}

const { title = "${DEFAULTS.title}", subtitle = "${DEFAULTS.subtitle}" } =
  Astro.props;
---
<section data-basis-hero>
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
  {
    path: "src/lib/basis-read.ts",
    content: `import { morph } from "@morph/sdk/astro";

/** The home hero's title, or why it could not be read. */
export async function heroTitle(): Promise<string> {
  try {
    const home = (await morph.pages.get("/")) as unknown as {
      hero?: { title?: unknown };
    };
    return typeof home.hero?.title === "string" ? home.hero.title : "missing";
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    return "error:" + String(code ?? (error as Error | null)?.message ?? error);
  }
}
`,
  },
  {
    path: "src/components/BasisLate.astro",
    content: `---
// Loaded on demand while the page body streams, then read.
const { heroTitle } = await import("../lib/basis-read");
const late = await heroTitle();
---
<p data-basis-late={late}>late:{late}</p>
`,
  },
  {
    path: `src/pages${STREAM_ROUTE}.astro`,
    content: `---
import { heroTitle } from "../lib/basis-read";
import BasisLate from "../components/BasisLate.astro";

const early = await heroTitle();
---
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>basis-stream</title>
  </head>
  <body>
    <main>
      <p data-basis-early={early}>early:{early}</p>
      <BasisLate />
    </main>
  </body>
</html>
`,
  },
];

type Content = { title: string; subtitle: string };
type Served = { ticket: number; instance: string };
type SyncAnswer = {
  success: boolean;
  error?: string;
  message?: string;
  data?: {
    ticket: number;
    sentTicket: number;
    draftGenerations: Record<string, number>;
    instance?: string;
  };
};
type ConfirmAnswer = {
  success: boolean;
  error?: string;
  data?: { ticket: number; instance?: string };
};
type Template = {
  id: string;
  draftGeneration: number;
  document: {
    sections: Array<{ id: string; props?: Record<string, unknown> | null }>;
  };
};

const content = (name: string): Content => {
  const id = `basis-${name}-${randomUUID()}`;
  return { title: `${id}-title`, subtitle: `${id}-subtitle` };
};

const heroDocument = (hero: Content) => ({
  version: 1,
  sections: [{ id: "hero", type: "hero", enabled: true, props: { ...hero } }],
});

/** Every `morph-content` stamp in a `Server-Timing` header value. */
function stampsOf(serverTiming: string | null): Served[] {
  return [
    ...(serverTiming ?? "").matchAll(
      /morph-content;desc="([1-9]\d*)\.([A-Za-z0-9-]{8,64})"/g,
    ),
  ].map((match) => ({ ticket: Number(match[1]), instance: match[2]! }));
}

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
 * Fetches `route` from inside the preview and reads its body as it streams:
 * the stamp header and each chunk as it arrived.
 */
async function streamed(frame: Frame, route: string) {
  return frame.evaluate(async (route) => {
    const response = await fetch(route, { cache: "no-store" });
    const chunks: string[] = [];
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return {
      status: response.status,
      serverTiming: response.headers.get("server-timing"),
      chunks,
    };
  }, route);
}

/** The `morph-content` entries of the frame document's own navigation. */
async function navigationStamps(frame: Frame) {
  return frame.evaluate(() =>
    (performance.getEntriesByType("navigation") as PerformanceNavigationTiming[])
      .flatMap((entry) => [...(entry.serverTiming ?? [])])
      .filter((timing) => timing.name === "morph-content")
      .map((timing) => timing.description),
  );
}

type Ready = {
  previewDocument: string;
  capabilities: string[];
  servedContent: Served | null;
};
type Ack = {
  previewDocument: string;
  status: string;
  operationId: string;
};
type BasisPost = { operationId: string; basis: unknown };

/**
 * Records, in the editor's window, every ready and presentation ack a
 * preview document sends, and, in each preview document, every basis token
 * the editor sends it. Observation only: nothing is changed or answered.
 */
async function observeBasisMessages(page: Page) {
  await page.addInitScript(() => {
    if (window.top !== window) {
      if (window.parent !== window.top) return;
      // Kept in the tab's sessionStorage for the preview's origin, which
      // every preview document of this tab shares, so a reload or a canvas
      // taken down in Code mode loses nothing.
      window.addEventListener("message", (event) => {
        if (event.source !== window.parent) return;
        const data = event.data as {
          type?: unknown;
          presentationToken?: { operationId?: unknown; basis?: unknown };
        } | null;
        if (data?.type !== "morph:storefront-preview-confirm-section-basis") {
          return;
        }
        const key = "__morphBasisPosts";
        const posts = JSON.parse(sessionStorage.getItem(key) ?? "[]") as unknown[];
        posts.push({
          operationId: String(data.presentationToken?.operationId ?? ""),
          basis: data.presentationToken?.basis ?? null,
        });
        sessionStorage.setItem(key, JSON.stringify(posts));
      });
      return;
    }
    const state = {
      readies: [] as Array<{
        previewDocument: string;
        capabilities: string[];
        servedContent: unknown;
      }>,
      acks: [] as Array<{
        previewDocument: string;
        status: string;
        operationId: string;
      }>,
    };
    (window as unknown as { __morphBasisLifecycle?: typeof state }).__morphBasisLifecycle =
      state;
    window.addEventListener("message", (event) => {
      const data = event.data as Record<string, unknown> | null;
      if (!data || typeof data !== "object") return;
      const previewDocument =
        typeof data.previewDocument === "string" ? data.previewDocument : "";
      if (!previewDocument) return;
      if (data.type === "morph:storefront-preview-ready") {
        state.readies.push({
          previewDocument,
          capabilities: Array.isArray(data.capabilities)
            ? data.capabilities.map(String)
            : [],
          servedContent: data.servedContent ?? null,
        });
      } else if (
        data.type === "morph:storefront-preview-section-presentation-ack"
      ) {
        state.acks.push({
          previewDocument,
          status: typeof data.status === "string" ? data.status : "",
          operationId:
            typeof data.operationId === "string" ? data.operationId : "",
        });
      }
    });
  });
  const lines: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (text.startsWith("[preview-presentation]")) lines.push(text);
  });
  return {
    /** `[preview-presentation]` trace lines the editor logged. */
    lines,
    lifecycle: () =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __morphBasisLifecycle?: { readies: Ready[]; acks: Ack[] };
            }
          ).__morphBasisLifecycle ?? { readies: [], acks: [] },
      ),
    /** Every basis token a preview document of this tab received. */
    posts: (frame: Frame) =>
      frame.evaluate(
        () =>
          JSON.parse(
            sessionStorage.getItem("__morphBasisPosts") ?? "[]",
          ) as BasisPost[],
      ),
  };
}

/** Turns the pointer tool on, unless it is on, and waits for the frame to say so. */
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

/**
 * Back to Design (an Astro click locates its source and opens Code), and
 * the canvas frame as it is then: the same one, or a new one if Code mode
 * took the canvas down.
 */
async function backToDesign(page: Page): Promise<Frame> {
  const design = page.getByRole("button", { name: "Design", exact: true });
  await expect(design).toBeEnabled({ timeout: 30_000 });
  await design.click();
  return liveFrame(page);
}

test.describe("Astro basis acknowledgement on the container Live Preview (option B)", () => {
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

  /**
   * A new draft revision holding `hero` for the home template, recorded the
   * way a draft write records one. Harness seeding: see the header.
   */
  async function seedDraft(hero: Content) {
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
        JSON.stringify(heroDocument(hero)),
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

  /** The home template as Core reads it now. */
  async function homeTemplate(page: Page): Promise<Template> {
    const result = (await serverFn(page, THEMES, "getStorefrontThemeEditor", scope)) as {
      success: boolean;
      message?: string;
      data: { templates: Template[] };
    };
    expect(result.success, result.message).toBe(true);
    const template = result.data.templates.find((entry) => entry.id === homeId);
    expect(template, "the home template").toBeTruthy();
    return template!;
  }

  /**
   * Seeds `hero` and syncs it into the running preview through Core's own
   * server function, from `writer` (never the editor under test). Returns
   * what Core says it wrote and who confirmed it.
   */
  async function seedAndSync(writer: Page, hero: Content) {
    await seedDraft(hero);
    const generation = (await homeTemplate(writer)).draftGeneration;
    const synced = (await serverFn(
      writer,
      PREVIEW,
      "syncThemePreviewContent",
      scope,
    )) as SyncAnswer;
    expect(synced, JSON.stringify(synced)).toMatchObject({ success: true });
    const data = synced.data!;
    expect(
      data.instance,
      "Core names the instance that confirmed the sync",
    ).toMatch(/^[A-Za-z0-9-]{8,64}$/);
    expect(
      data.draftGenerations[homeId!],
      "Core's generation of the home template in the snapshot it wrote",
    ).toBe(generation);
    return data as Required<NonNullable<SyncAnswer["data"]>>;
  }

  async function confirmed(writer: Page, ticket: number) {
    return (await serverFn(writer, PREVIEW, "confirmThemePreviewContent", {
      ...scope!,
      ticket,
    })) as ConfirmAnswer;
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
    // The Theme, recorded as Astro by the harness (no product entry creates
    // an Astro Theme yet). Its Document comes from the product path.
    const now = new Date().toISOString();
    expect(
      await harness!.writeD1(
        `INSERT INTO storefront_themes
           (id, storefront_id, name, framework, metadata, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'astro', '{"starterTemplateVersion":1}', ?4, ?4)`,
        scope!.themeId,
        scope!.storefrontId,
        `astro-basis-ack-${scope!.themeId}`,
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
    await seedDraft(content("start"));
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
    // The Theme is this run's own and is left as it is.
    await page.context().close();
  });

  test("serves each page from the one snapshot it stamps, through import() and the streamed body", async ({
    page,
    browser,
  }) => {
    await openCaseEditor(page);
    const frame = await liveFrame(page);
    // The preview's own document is up (past its access redirect).
    await expect(frame.locator("[data-basis-hero] h1")).toBeVisible({
      timeout: 180_000,
    });
    const writer = await signedInPage(browser);
    await writer.goto("/", { waitUntil: "domcontentloaded" });

    for (const name of ["b", "c"]) {
      const hero = content(name);
      const synced = await seedAndSync(writer, hero);
      // Core confirms the same pair on its own when asked.
      expect(await confirmed(writer, synced.sentTicket)).toMatchObject({
        success: true,
        data: { ticket: synced.sentTicket, instance: synced.instance },
      });

      const served = await streamed(frame, STREAM_ROUTE);
      const body = served.chunks.join("");
      expect(served.status, body.slice(0, 500)).toBe(200);
      // One stamp, naming the snapshot Core wrote and the instance that
      // confirmed it.
      expect(stampsOf(served.serverTiming), String(served.serverTiming)).toEqual([
        { ticket: synced.sentTicket, instance: synced.instance },
      ]);
      // Both reads are that snapshot's: the frontmatter's, and the one made
      // from a module loaded with import() by a component rendered in the
      // streamed body. A read outside the pinned request is refused (503 ->
      // "error:..."), never answered from another snapshot.
      const early = /data-basis-early="([^"]*)"/.exec(body)?.[1];
      const late = /data-basis-late="([^"]*)"/.exec(body)?.[1];
      expect(early, body.slice(0, 2000)).toBe(hero.title);
      expect(late, body.slice(0, 2000)).toBe(hero.title);
      expect(body).not.toContain(DEFAULTS.title);

      // Where in the stream each read's output arrived. Recorded, not
      // asserted: a transport may join chunks. A later chunk for the late
      // read is the run's evidence that it ran while the body streamed.
      const chunkOf = (attribute: string) =>
        served.chunks.findIndex((chunk) => chunk.includes(attribute));
      test.info().annotations.push({
        type: `stream chunks (${name})`,
        description: `chunks=${served.chunks.length} early=${chunkOf("data-basis-early=")} late=${chunkOf("data-basis-late=")}`,
      });

      // The home page, read the same way: Core's content under the same stamp.
      const home = await streamed(frame, "/");
      expect(stampsOf(home.serverTiming)).toEqual([
        { ticket: synced.sentTicket, instance: synced.instance },
      ]);
      expect(home.chunks.join("")).toContain(hero.title);
      expect(home.chunks.join("")).toContain(hero.subtitle);
    }
    await writer.context().close();
  });

  test("acknowledges a clicked section's basis only on Core's confirmed pair, and refuses a stale document", async ({
    page,
    browser,
  }) => {
    const writer = await signedInPage(browser);
    await writer.goto("/", { waitUntil: "domcontentloaded" });

    // Precondition: Core's binding view of `/` confirms the hero instance.
    // Without it no click is a Design selection and nothing below can happen.
    const view = (await serverFn(writer, THEMES, "readThemeRouteBindings", {
      ...scope!,
      routePath: "/",
      expectedSourceGeneration: await themeSourceGeneration(writer, scope!),
    })) as {
      success: boolean;
      data?: {
        status: { kind: string; reason?: string };
        instances: Array<{ section: string | null }>;
      };
    };
    expect(view, JSON.stringify(view)).toMatchObject({
      success: true,
      data: { status: { kind: "confirmed" } },
    });
    expect(view.data!.instances.map((instance) => instance.section)).toContain(
      "hero",
    );

    const observed = await observeBasisMessages(page);
    // The editor's own confirmations are held until released: what the
    // editor does while Core has not named the frame's instance.
    let released = false;
    let release: () => void = () => {};
    const releasedPromise = new Promise<void>((resolve) => {
      release = () => {
        released = true;
        resolve();
      };
    });
    let heldConfirms = 0;
    await page.route(
      (url) => isServerFn(url.toString(), "confirmThemePreviewContent"),
      async (route) => {
        if (!released) {
          heldConfirms += 1;
          await releasedPromise;
        }
        await route.continue();
      },
    );
    const bindingsRead = page.waitForResponse(
      (response) =>
        isServerFn(response.url(), "readThemeRouteBindings") && response.ok(),
      { timeout: 180_000 },
    );
    // Where the editor says it (a toast, or the section's notice and the
    // Code-mode status bar), only what is on screen.
    const hint = page
      .getByText(ASTRO_BASIS_UNCONFIRMED_MESSAGE)
      .filter({ visible: true });

    try {
      await openCaseEditor(page);
      let frame = await liveFrame(page);
      await bindingsRead;
      await expect(page.getByTestId("preview-document-navigation")).toHaveCount(
        0,
        { timeout: 120_000 },
      );
      // The frame's ready names the stamp of its own navigation response.
      await expect
        .poll(async () => (await observed.lifecycle()).readies.at(-1)?.servedContent ?? null, {
          timeout: 120_000,
        })
        .not.toBeNull();
      const firstReady = (await observed.lifecycle()).readies.at(-1)!;
      expect(firstReady.capabilities).toEqual(
        expect.arrayContaining([
          "section-presentation-ack-v1",
          "astro-identity-v2",
          "astro-basis-ack-v1",
        ]),
      );
      const stamp = firstReady.servedContent!;
      expect(await navigationStamps(frame)).toEqual([
        `${stamp.ticket}.${stamp.instance}`,
      ]);
      // The editor asks Core which instance reads its ticket (it does so
      // only when the frame's stamp names the start's ticket); held here.
      await expect
        .poll(() => heldConfirms, {
          timeout: 60_000,
          message:
            "the editor asks Core which instance reads the frame's ticket (the start's snapshot)",
        })
        .toBeGreaterThan(0);

      // A. Core has not named the instance yet: the click is refused with
      //    the reload hint, and no basis token reaches the frame.
      await ensureSelection(page, frame);
      await frame.locator("[data-basis-hero] h1").click();
      await expect(hint.first()).toBeVisible({ timeout: 30_000 });
      expect(
        observed.lines.some(
          (line) =>
            line.includes("basis not issued") &&
            line.includes("reason=unconfirmed-instance"),
        ),
        observed.lines.join("\n"),
      ).toBe(true);
      frame = await backToDesign(page);
      expect(await observed.posts(frame)).toEqual([]);
      expect(
        (await observed.lifecycle()).acks.filter((ack) => ack.status === "applied"),
      ).toEqual([]);

      // B. Core answers. The section the author clicked while the confirm
      //    was held is kept (hints review finding 2): Core's answer itself
      //    issues its basis token, naming the frame's stamp, with no new
      //    click. The author's next click then yields exactly one more
      //    token. Every post has its cause (the answer, then the click), and
      //    every accepted op is exactly one post: an extra or duplicate post
      //    fails here.
      const linesBefore = observed.lines.length;
      const acceptedOps = (): string[] =>
        observed.lines
          .slice(linesBefore)
          .flatMap((line) => {
            const match = /ack accepted op=(section-basis-\d+) .*status=applied/.exec(
              line,
            );
            return match ? [match[1]!] : [];
          });
      const confirmAnswered = page.waitForResponse(
        (response) =>
          isServerFn(response.url(), "confirmThemePreviewContent") &&
          response.ok(),
        { timeout: 60_000 },
      );
      release();
      await confirmAnswered;
      // The answer's token, accepted, before any new click.
      await expect
        .poll(() => acceptedOps().length, {
          timeout: 30_000,
          message: "Core's answer issues the held click's basis token, and the editor accepts it",
        })
        .toBe(1);
      await expect(hint).toHaveCount(0, { timeout: 30_000 });
      frame = await backToDesign(page);
      const answered = await observed.posts(frame);
      expect(answered, "one token, issued on Core's answer, for the held click").toHaveLength(1);
      const answerPost = answered[0]!;
      expect(answerPost.operationId).toBe(acceptedOps()[0]);
      expect(answerPost.basis).toMatchObject({
        kind: "astro-boundary",
        servedContent: { ticket: stamp.ticket, instance: stamp.instance },
      });
      await ensureSelection(page, frame);
      // Still a document of the start's snapshot (a new one if the canvas
      // was taken down in Code mode).
      expect((await observed.lifecycle()).readies.at(-1)?.servedContent).toEqual(
        stamp,
      );
      await frame.locator("[data-basis-hero] h1").click();
      await expect
        .poll(() => acceptedOps().length, {
          timeout: 30_000,
          message: "the editor accepts the frame's applied ack for the click's token",
        })
        .toBe(2);
      frame = await backToDesign(page);
      const posts = await observed.posts(frame);
      expect(posts, "the answer's token and exactly one for the click").toHaveLength(2);
      expect(posts[0]).toEqual(answerPost);
      const post = posts[1]!;
      expect(new Set(posts.map((each) => each.operationId)).size).toBe(2);
      expect(post.operationId).toBe(acceptedOps()[1]);
      expect([...acceptedOps()].sort()).toEqual(
        posts.map((each) => each.operationId).sort(),
      );
      // The same section both times: the held click's and this click's.
      expect(post.basis).toEqual(answerPost.basis);
      expect(post.basis).toMatchObject({
        kind: "astro-boundary",
        servedContent: { ticket: stamp.ticket, instance: stamp.instance },
      });
      const { acks } = await observed.lifecycle();
      for (const each of posts) {
        expect(
          acks.filter(
            (ack) =>
              ack.operationId === each.operationId && ack.status === "applied",
          ),
          `one applied ack for ${each.operationId}`,
        ).toHaveLength(1);
      }
      expect(
        observed.lines.slice(linesBefore).some((line) => line.includes("basis ack held")),
        observed.lines.join("\n"),
      ).toBe(false);
      // Nothing more is posted after a settle.
      expect(await observed.posts(frame)).toEqual(posts);
      // The pair the token named is Core's own, asked independently.
      expect(await confirmed(writer, stamp.ticket)).toMatchObject({
        success: true,
        data: { ticket: stamp.ticket, instance: stamp.instance },
      });

      // C. Stale: another writer syncs new content after the editor's
      //    basis. The frame, reloaded, names a ticket Core never confirmed to
      //    this editor; a click is refused with the reload hint, and nothing
      //    is posted or acknowledged for that document.
      const stale = content("stale");
      const synced = await seedAndSync(writer, stale);
      expect(synced.sentTicket).toBeGreaterThan(stamp.ticket);
      // From the reload on: the kept selection is re-derived on the new
      // document and its basis asked for again, so the refusal can be logged
      // before the click as well as on it.
      const linesBeforeStale = observed.lines.length;
      await frame.evaluate(() => {
        setTimeout(() => location.reload(), 0);
      });
      await expect
        .poll(
          async () =>
            (await observed.lifecycle()).readies.at(-1)?.servedContent?.ticket ??
            null,
          { timeout: 120_000 },
        )
        .toBe(synced.sentTicket);
      await expect(frame.locator("[data-basis-hero] h1")).toHaveText(
        stale.title,
        { timeout: 60_000 },
      );
      await expect(page.getByTestId("preview-document-navigation")).toHaveCount(
        0,
        { timeout: 60_000 },
      );
      await ensureSelection(page, frame);
      // The document clicked: the stale snapshot's, not the basis's.
      const staleReady = (await observed.lifecycle()).readies.at(-1)!;
      expect(staleReady.servedContent).toEqual({
        ticket: synced.sentTicket,
        instance: synced.instance,
      });
      expect(staleReady.previewDocument).not.toBe(firstReady.previewDocument);
      expect(await navigationStamps(frame)).toEqual([
        `${synced.sentTicket}.${synced.instance}`,
      ]);
      await frame.locator("[data-basis-hero] h1").click();
      await expect(hint.first()).toBeVisible({ timeout: 30_000 });
      // Refused for this document, the stale snapshot's.
      const staleDoc = `doc=${staleReady.previewDocument.slice(0, 8)}`;
      expect(
        observed.lines
          .slice(linesBeforeStale)
          .some(
            (line) =>
              line.includes("basis not issued") &&
              line.includes("reason=other-ticket") &&
              line.includes(staleDoc),
          ),
        observed.lines.join("\n"),
      ).toBe(true);
      frame = await backToDesign(page);
      expect(
        await observed.posts(frame),
        "no basis token after the stale click",
      ).toEqual(posts);
      expect(
        (await observed.lifecycle()).acks.filter(
          (ack) =>
            ack.previewDocument === staleReady.previewDocument &&
            ack.status === "applied",
        ),
      ).toEqual([]);
    } finally {
      release();
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await writer.context().close();
    }
  });
});

test.describe("a Start frame on the container Live Preview", () => {
  test.setTimeout(10 * 60_000);
  test.use({ actionTimeout: 60_000 });

  test("never names astro-basis-ack-v1 and carries no morph-content stamp", async ({
    page,
  }) => {
    const observed = await observeBasisMessages(page);
    await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
    const publish = page.getByRole("button", { name: /^Publish$/ });
    await expect(publish).toBeVisible({ timeout: 45_000 });
    const frame = await liveFrame(page);
    // A Start bridge's ready: it acknowledges presentation tokens.
    await expect
      .poll(
        async () =>
          (await observed.lifecycle()).readies.some((ready) =>
            ready.capabilities.includes("section-presentation-ack-v1"),
          ),
        { timeout: 180_000 },
      )
      .toBe(true);
    const { readies } = await observed.lifecycle();
    test.info().annotations.push({
      type: "preview runtime",
      description: process.env.MORPH_E2E_PREVIEW_RUNTIME ?? "(unset)",
    });
    for (const ready of readies) {
      expect(ready.capabilities).not.toContain("astro-basis-ack-v1");
      expect(ready.servedContent).toBeNull();
    }
    expect(await navigationStamps(frame)).toEqual([]);
    const served = await streamed(frame, new URL(frame.url()).pathname);
    expect(stampsOf(served.serverTiming)).toEqual([]);
  });
});
