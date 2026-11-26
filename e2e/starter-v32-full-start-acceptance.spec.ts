import { createHash, randomUUID } from "node:crypto";

import {
  expect,
  test,
  type BrowserContext,
  type Frame,
  type Page,
} from "@playwright/test";

import { queryLifecycleD1 } from "../scripts/verify-published-artifact.mjs";
import { STOREFRONT_STARTER_TEMPLATE_VERSION } from "../src/lib/storefront/default-storefront-document";
import { starterThemeWorkspaceFiles } from "../src/lib/storefront/starter-theme-files";
import { STARTER_THEME_CONTENT_MODULE_SOURCE } from "../src/lib/storefront/starter-theme-v3-files";
import { EDITOR_PATH, decodeServerFnResult } from "./helpers";
import { execLocalD1 } from "./helpers/editor-writes-paused";
import {
  RECORDED_PREVIEW_RUNTIME,
  verifyRecordedThemePreviewRuntime,
} from "./helpers/recorded-preview-runtime";
import { insertThrowawayTheme } from "./helpers/throwaway-theme";
import {
  BUILDS,
  DOMAINS,
  THEMES,
  latestRelease,
  openEditor,
  openPublish,
  publishShowingRelease,
  serverFn,
  serverFnPaths,
  signedInPage,
  storefrontFetcher,
  storefrontHarness,
} from "./native-acceptance";
import {
  themeScopeFromEditorPath,
  themeSourceGeneration,
  writeThemeFiles,
  type ThemeScope,
} from "./native-compat";

/**
 * Starter 32, as shipped, on the full Start runtime and the container
 * transport (Lane B of handoff/2026-11-25/v32-ci-lanes-plan.md).
 *
 * The Theme is this spec's own, created in the run's storefront and never
 * used again. It records the full Start preview through the editor's own
 * compare-and-set (`setThemePreviewRuntime`), read back from D1, before the
 * editor's first read provisions it: from Starter 32 the editor gives the
 * Starter's files only to a Theme recording start
 * (`ensureStoredStarterPreview`). The provisioned home, layout and content
 * module are then held to the shipped sources byte for byte, so what runs is
 * the real Starter 32 home: no loader of its own, six sections each gated by
 * `isSectionHidden(slot)`, values from `content(slot)`, every read through
 * one `createServerFn` calling `@morph/sdk/start`.
 *
 * Test-only Theme files (this Theme only, never a Starter file), because the
 * Starter has no non-home route that reads page content (`/account` and
 * `/order-transfer` read none):
 *
 * - `src/routes/e2e-v32-page.tsx`: a non-home route that reads its own Page
 *   Document the Starter way, `!isSectionHidden(slot) && <El {...content(slot)} />`,
 *   for a shown slot and a hidden one, with a `<Link>` back to `/`. Its
 *   Document is created by `ensureStorefrontThemeRouteTemplate`, the editor's
 *   own path for a route document.
 * - `src/components/V32Shown.tsx`, `src/components/V32Hidden.tsx`: one text
 *   field each, with defaults no Document holds, so a section rendered from
 *   defaults is visible as such.
 *
 * Every Document value, hide and render policy is written through the
 * server functions the editor's fields, section toggle and rendering panel
 * end in (`updateStorefrontThemeSectionProps`,
 * `updateStorefrontThemeRenderPolicy`). Hidden sections, each written with an
 * author value first and then hidden, so neither that value nor the
 * component's defaults may show:
 *
 * - home Document: `starter-newsletter`;
 * - layout Document: `starter-footer` (every page renders the layout);
 * - the test route's Page Document: `v32-hidden`.
 *
 * Cases, serial, each building on the one before:
 *
 *   1. the Starter's own home: first load and reload, server-rendered in the
 *      preview, then the live DOM after hydration;
 *   2. in-site navigation from `/` to the test route and back, through
 *      `/_serverFn`, in the preview;
 *   3. direct load and reload of the non-home page (SSR) in the preview;
 *   4. publish on SSR, then read back: the test route is published, then
 *      the home with its page policy explicitly SSR. The releases are this
 *      Theme's and name their build and content; the released artifact is
 *      served, and the public site's SSR, content answer, in-site navigation
 *      and a later draft staying out are checked;
 *   5. refused reads: the preview's `/_serverFn` read without preview access
 *      (no session, and a session without this preview's grant), and the
 *      public site's reads naming a content origin, a render context or a
 *      release it may not see;
 *   6. a static (ssg) home, published once: the publish builds first, sealed
 *      with the home's draft and a new author value. Starter 32 is built by
 *      the platform-owned Start build, whose prerender reads that sealed
 *      content on its first and only pass (`contentDependency: "dependent"`;
 *      the contentless first pass and NATIVE_PRERENDER_CONTENT_UNAVAILABLE
 *      belong to a Theme's own build configuration, not to this one). The
 *      build's own prerendered home, read from this run's R2 and held to its
 *      manifest's size and SHA-256, carries the new value and neither the
 *      hidden newsletter nor the hidden footer. The publish is then refused
 *      by the deliberate guard (PUBLISH_RENDER_POLICY_NOT_READY: no SSG
 *      release until Core is proven to serve the active release's HTML), no
 *      release is made, and the public site keeps case 4's;
 *   7. a static route whose read finds no content fails the publish build: a
 *      test-only static route (`src/routes/e2e-v32-unsealed.tsx`, ssg) whose
 *      loader reads a path no Document of the build's seal has. The sealed
 *      content answers it with a bare 404, which the read reports as
 *      `content_not_found`; only then does the loader throw an error naming
 *      that path, so no other failure can stand in for it. The build fails
 *      at `sandbox-start-compiler` with that error, writes nothing to R2, no
 *      publish is sent, and the public site keeps serving case 4's release.
 *      Last: it leaves a failed build behind.
 *
 * Containers only, run on its own: publishing builds in the Sandbox
 * container, and it moves the storefront's active release to this Theme's.
 */

const STATE_DIR = process.env.MORPH_E2E_STATE_DIR;
const TRANSPORT = process.env.E2E_EXPECT_PREVIEW_TRANSPORT;
const PREVIEW_RUNTIME = process.env.MORPH_E2E_PREVIEW_RUNTIME;

test.skip(
  !EDITOR_PATH || !STATE_DIR,
  "Run through scripts/run-editor-e2e.mjs: this reads and writes the run's own D1 and R2.",
);
test.skip(
  TRANSPORT !== "cloudflare-sandbox",
  "Builds, publishes and the pv- host run in containers (MORPH_E2E_TRANSPORT=cloudflare-sandbox).",
);
test.skip(
  PREVIEW_RUNTIME !== "start",
  "Starter 32 reads through createServerFn, which only the full Start preview runs; run with MORPH_E2E_PREVIEW_RUNTIME=start.",
);

const PREVIEW_SERVER =
  "/src/server/storefront/storefront-theme-preview-server.serverFn.ts";
const THEME_FILES = "/src/server/storefront/storefront-theme-files.serverFn.ts";

/**
 * The Starter files this spec holds to the shipped sources, as a new Theme
 * gets them: `starterThemeWorkspaceFiles()`, the file set the editor's first
 * read initialises (`initStarterTheme`). Its home route imports the
 * page-owned section copies the workspace adopts, so it is not the library
 * constant byte for byte; the content module is the shipped one unchanged.
 */
const WORKSPACE_FILES = new Map(
  starterThemeWorkspaceFiles().map((file) => [file.path, file.content]),
);
const SHIPPED_PATHS = [
  "src/morph/content.ts",
  "src/routes/index.tsx",
  "src/layouts/StorefrontLayout.tsx",
] as const;
const SHIPPED_FILES = Object.fromEntries(
  SHIPPED_PATHS.map((path) => {
    const content = WORKSPACE_FILES.get(path);
    if (content === undefined) {
      throw new Error(`The Starter workspace has no ${path}.`);
    }
    return [path, content];
  }),
) as Record<(typeof SHIPPED_PATHS)[number], string>;
const PAGE_PATH = "/e2e-v32-page";
const HOST = "v32-start.localhost";
/** Where a Start build writes the prerendered home (theme-prerender.ts). */
const PRERENDERED_HOME = "runtime/client/index.html";

const SHOWN_SLOT = "v32-shown";
const HIDDEN_SLOT = "v32-hidden";
const SHOWN_DEFAULT = "V32 shown default heading";
const HIDDEN_DEFAULT = "V32 hidden default heading";
/** The hidden component's own attribute; in a page only if it rendered. */
const HIDDEN_RENDERED = 'data-v32-section="V32Hidden"';
const HERO = "starter-hero";
const INTRO = "starter-introduction";
/** The shown sections' component defaults (starter-theme-v3-files.ts). */
const HERO_DEFAULT = "Objects for everyday rituals.";
const INTRO_DEFAULT = "Fewer things. Better chosen.";
const NEWSLETTER = "starter-newsletter";
/** Newsletter's component defaults (starter-theme-v3-files.ts). */
const NEWSLETTER_DEFAULTS = [
  "Stay connected",
  "Join our newsletter",
  "Enter your email",
];
const FOOTER = "starter-footer";
/** Footer's component default (starter-theme-v3-files.ts). */
const FOOTER_DEFAULT = "© Online Store";
/** THEME_PREVIEW_START_CONTENT_ORIGIN's host: never written into a page. */
const PREVIEW_CONTENT_HOST = "morph-preview-content.invalid";
/** What the preview gateway tells a request it refuses (preview-access-request.ts). */
const PREVIEW_REFUSAL = "Preview access required";
/** What Core's content endpoint answers a render context it cannot verify. */
const RENDER_CONTEXT_REFUSAL = "RENDER_CONTEXT_INVALID";

/** Case 7: a static route whose loader reads a path no Document of the seal has. */
const UNSEALED_PATH = "/e2e-v32-unsealed";
const NEVER_SEALED_PATH = "/e2e-v32-never-sealed";
/**
 * What the route's loader throws, naming the path, once the read reported
 * `content_not_found` (the platform build's sealed content answers a path it
 * does not hold with a bare 404). Any other failure is thrown as it came.
 */
const UNSEALED_READ_REFUSAL = "V32_UNSEALED_CONTENT_NOT_FOUND";
/** The platform Start build's runtime compile (cloudflare-sandbox-vite-theme-build-runner.ts). */
const START_COMPILER_STAGE = "sandbox-start-compiler";
const UNSEALED_ROUTE = {
  path: "src/routes/e2e-v32-unsealed.tsx",
  content: `import { createFileRoute } from "@tanstack/react-router";
import { morph } from "../morph/content";

export const Route = createFileRoute("${UNSEALED_PATH}")({
  loader: async () => {
    try {
      return await morph.pages.get("${NEVER_SEALED_PATH}");
    } catch (error) {
      if ((error as { code?: unknown } | null)?.code === "content_not_found") {
        const message = "${UNSEALED_READ_REFUSAL}: no content for ${NEVER_SEALED_PATH}";
        console.error(message);
        throw new Error(message);
      }
      throw error;
    }
  },
  component: V32Unsealed,
});

function V32Unsealed() {
  return <main data-v32-unsealed="">v32 unsealed route</main>;
}
`,
} as const;

const RUN = randomUUID().slice(0, 8);
const HERO_MARKER = `v32-hero-${RUN}`;
const INTRO_MARKER = `v32-intro-${RUN}`;
const NEWSLETTER_MARKER = `v32-newsletter-${RUN}`;
const FOOTER_MARKER = `v32-footer-${RUN}`;
const SHOWN_MARKER = `v32-shown-${RUN}`;
const HIDDEN_MARKER = `v32-hidden-${RUN}`;
const DRAFT_MARKER = `v32-draft-${RUN}`;
/** Case 6: the hero's value in the static home's draft, never published. */
const SSG_HERO_MARKER = `v32-ssg-hero-${RUN}`;

const componentSource = (name: string, fallback: string) => `import type { ThemeContentFields } from "../morph/content-fields";

export const contentFields = {
  heading: { type: "text", label: "Heading", maxLength: 200 },
} as const satisfies ThemeContentFields;

export default function ${name}({ heading = ${JSON.stringify(fallback)} }: { heading?: string }) {
  return (
    <section data-v32-section="${name}">
      <h2>{heading}</h2>
    </section>
  );
}
`;

const PAGE_ROUTE_SOURCE = `import { Link, createFileRoute } from "@tanstack/react-router";
import { content, isSectionHidden } from "../morph/content";
import V32Shown from "../components/V32Shown";
import V32Hidden from "../components/V32Hidden";

export const Route = createFileRoute("${PAGE_PATH}")({
  component: V32Page,
});

function V32Page() {
  return (
    <main data-v32-page="">
      {!isSectionHidden("${SHOWN_SLOT}") && <V32Shown {...content("${SHOWN_SLOT}")} />}
      {!isSectionHidden("${HIDDEN_SLOT}") && <V32Hidden {...content("${HIDDEN_SLOT}")} />}
      <Link to="/" data-v32-home-link="">
        Home
      </Link>
    </main>
  );
}
`;

const TEST_FILES = [
  {
    path: "src/components/V32Shown.tsx",
    content: componentSource("V32Shown", SHOWN_DEFAULT),
  },
  {
    path: "src/components/V32Hidden.tsx",
    content: componentSource("V32Hidden", HIDDEN_DEFAULT),
  },
  { path: "src/routes/e2e-v32-page.tsx", content: PAGE_ROUTE_SOURCE },
] as const;

const sqlText = (value: string) => `'${value.replace(/'/g, "''")}'`;

type Template = {
  id: string;
  type: string;
  routePath?: string | null;
  draftGeneration: number;
  document: {
    renderPolicy?: { mode: string } | null;
    sections: Array<{
      id: string;
      enabled?: boolean;
      props?: Record<string, unknown> | null;
    }>;
  };
};

/** One `/_serverFn` exchange a page made, as the browser saw it. */
type ServerFnCall = {
  url: string;
  method: string;
  status: number;
  body: string;
  headers: Record<string, string>;
};

/**
 * Records, on `target`, the `/_serverFn` exchanges and the `/_morph/content`
 * requests made on `origin()`, and console errors. Starter 31 read
 * `/_morph/content` from the browser; Starter 32 must not.
 */
function recordReads(target: Page, origin: () => string | null) {
  const calls: ServerFnCall[] = [];
  const contentReads: string[] = [];
  const consoleErrors: string[] = [];
  target.on("response", async (response) => {
    const url = new URL(response.url());
    if (url.origin !== origin() || !url.pathname.startsWith("/_serverFn")) {
      return;
    }
    const request = response.request();
    calls.push({
      url: response.url(),
      method: request.method(),
      status: response.status(),
      body: await response.text().catch(() => ""),
      headers: request.headers(),
    });
  });
  target.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin === origin() && url.pathname === "/_morph/content") {
      contentReads.push(request.url());
    }
  });
  target.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  return { calls, contentReads, consoleErrors };
}

/** The headers Start's client sent with a server function call, to send it again. */
function replayHeaders(call: ServerFnCall): Record<string, string> {
  return Object.fromEntries(
    Object.entries(call.headers).filter(
      ([name]) => name === "accept" || name.startsWith("x-tsr"),
    ),
  );
}

/** Fetches `url` from inside `target`, on its origin, with `headers`. */
function fetchIn(
  target: Page,
  url: string,
  headers: Record<string, string> = {},
) {
  return target.evaluate(
    async ({ url, headers }) => {
      const response = await fetch(url, { cache: "no-store", headers });
      return { status: response.status, body: await response.text() };
    },
    { url, headers },
  );
}

/** Waits until Start's client router exists and the document has loaded. */
async function waitForRouter(target: Page) {
  await expect
    .poll(
      () =>
        target.evaluate(
          () =>
            Boolean(
              (window as unknown as { __TSR_ROUTER__?: unknown }).__TSR_ROUTER__,
            ) && document.readyState === "complete",
        ),
      { timeout: 60_000, message: "Start's client router is running" },
    )
    .toBe(true);
}

/** Marks the current document, so a later check can tell it was not replaced. */
async function markDocument(target: Page): Promise<string> {
  const token = randomUUID();
  await target.evaluate((token) => {
    (window as unknown as { __v32Document?: string }).__v32Document = token;
  }, token);
  return token;
}

async function sameDocument(target: Page, token: string) {
  return target.evaluate(
    () => (window as unknown as { __v32Document?: string }).__v32Document,
  ).then((value) => value === token);
}

/** Navigates in-site with Start's own router, as a `<Link>` does. */
async function navigateInSite(target: Page, to: string) {
  await target.evaluate(async (to) => {
    const router = (
      window as unknown as {
        __TSR_ROUTER__: { navigate: (options: { to: string }) => Promise<void> };
      }
    ).__TSR_ROUTER__;
    await router.navigate({ to });
  }, to);
}

/** The layout's hidden Footer is absent from a rendered page. */
function expectFooterHidden(html: string, where: string) {
  expect(html, `${where}: no <footer>`).not.toContain("<footer");
  expect(html, `${where}: not the Footer's default`).not.toContain(
    FOOTER_DEFAULT,
  );
  expect(html, `${where}: not the author's Footer value`).not.toContain(
    FOOTER_MARKER,
  );
}

/**
 * The Starter's home as its Document says: the author's values in place of
 * the defaults, neither the hidden newsletter nor the hidden Footer.
 */
function expectHomeHtml(html: string, where: string, hero = HERO_MARKER) {
  expect(html, `${where}: the hero's Document value`).toContain(hero);
  expect(html, `${where}: the introduction's Document value`).toContain(
    INTRO_MARKER,
  );
  expect(html, `${where}: not the hero's default`).not.toContain(HERO_DEFAULT);
  expect(html, `${where}: not the introduction's default`).not.toContain(
    INTRO_DEFAULT,
  );
  expect(html, `${where}: not the hidden newsletter's value`).not.toContain(
    NEWSLETTER_MARKER,
  );
  for (const text of NEWSLETTER_DEFAULTS) {
    expect(html, `${where}: not the hidden newsletter's default`).not.toContain(
      text,
    );
  }
  expectFooterHidden(html, where);
  expect(html, `${where}: no platform content address`).not.toContain(
    PREVIEW_CONTENT_HOST,
  );
}

/** The test route as its Page Document says. */
function expectPageHtml(html: string, shown: string, where: string) {
  expect(html, `${where}: the shown slot's Document value`).toContain(shown);
  expect(html, `${where}: not the shown slot's default`).not.toContain(
    SHOWN_DEFAULT,
  );
  expect(html, `${where}: the hidden section did not render`).not.toContain(
    HIDDEN_RENDERED,
  );
  expect(html, `${where}: not the hidden slot's default`).not.toContain(
    HIDDEN_DEFAULT,
  );
  expect(html, `${where}: not the hidden slot's value`).not.toContain(
    HIDDEN_MARKER,
  );
  expectFooterHidden(html, where);
  expect(html, `${where}: no platform content address`).not.toContain(
    PREVIEW_CONTENT_HOST,
  );
}

/** The same, in the live DOM after hydration. */
async function expectHomeDom(target: Page) {
  await expect(target.getByText(HERO_MARKER).first()).toBeVisible({
    timeout: 60_000,
  });
  await expect(target.getByText(INTRO_MARKER).first()).toBeVisible();
  await expect(target.getByText(HERO_DEFAULT)).toHaveCount(0);
  await expect(target.getByText(NEWSLETTER_MARKER)).toHaveCount(0);
  for (const text of NEWSLETTER_DEFAULTS) {
    await expect(target.getByText(text)).toHaveCount(0);
  }
  await expect(target.locator("footer")).toHaveCount(0);
  await expect(target.getByText(FOOTER_DEFAULT)).toHaveCount(0);
}

async function expectPageDom(target: Page, shown: string) {
  await expect(target.locator("main[data-v32-page]")).toBeVisible({
    timeout: 60_000,
  });
  await expect(target.getByText(shown).first()).toBeVisible();
  await expect(target.getByText(SHOWN_DEFAULT)).toHaveCount(0);
  await expect(target.locator('[data-v32-section="V32Hidden"]')).toHaveCount(0);
  await expect(target.getByText(HIDDEN_DEFAULT)).toHaveCount(0);
  await expect(target.getByText(HIDDEN_MARKER)).toHaveCount(0);
  await expect(target.locator("footer")).toHaveCount(0);
}

/** A `/_serverFn` page read answered with `marker`, waited for. */
async function readCarrying(
  calls: ServerFnCall[],
  from: number,
  marker: string,
  what: string,
): Promise<ServerFnCall> {
  let found: ServerFnCall | undefined;
  await expect
    .poll(
      () => {
        found = calls
          .slice(from)
          .find(
            (call) =>
              call.method === "GET" &&
              call.status === 200 &&
              call.body.includes(marker),
          );
        return Boolean(found);
      },
      { timeout: 60_000, message: what },
    )
    .toBe(true);
  return found!;
}

/** The editor's preview frame once it has come back from the access flow. */
async function previewDocument(page: Page): Promise<Frame> {
  let found: Frame | undefined;
  await expect
    .poll(
      () => {
        found = page.frames().find((frame) => {
          const url = new URL(frame.url() || "about:blank");
          return (
            url.hostname.startsWith("pv-") &&
            !url.pathname.startsWith("/__morph/preview-auth/")
          );
        });
        return Boolean(found);
      },
      { timeout: 90_000, message: "the preview frame lands on its pv- host" },
    )
    .toBe(true);
  return found!;
}

/** What a browser context gets for `url`, as a top-level navigation. */
async function visit(context: BrowserContext, url: string) {
  const page = await context.newPage();
  try {
    const response = await page.goto(url, { waitUntil: "commit" });
    expect(response, `a response for ${url}`).not.toBeNull();
    expect(response!.url(), "answered by the URL itself").toBe(url);
    return { status: response!.status(), body: await response!.text() };
  } finally {
    await page.close();
  }
}

test.describe("Starter 32 on the full Start runtime", () => {
  test.describe.configure({ mode: "serial", timeout: 30 * 60_000 });
  test.use({ actionTimeout: 60_000 });

  let shared: Page | null = null;
  let scope: ThemeScope | null = null;
  let homeTemplateId = "";
  let layoutTemplateId = "";
  let pageTemplateId = "";
  let homeEditorPath = "";
  let pageEditorPath = "";
  let harness: ReturnType<typeof storefrontHarness> | null = null;
  const domainIds: string[] = [];

  /** The preview's pv- origin, and its own tab (P3 grant). */
  let previewOrigin: string | null = null;
  let tab: Page | null = null;
  let tabReads: ReturnType<typeof recordReads> | null = null;

  /** An anonymous visitor on the public site (case 4). */
  let visitor: Page | null = null;
  /** The in-site `/_serverFn` reads of the test route, in the preview (case 2) and on the public site (case 4). */
  let previewPageRead: ServerFnCall | null = null;
  let publicPageRead: ServerFnCall | null = null;
  /** Case 4's release, which cases 6 and 7 must leave serving. */
  let servingRelease = "";

  const queryD1 = (sql: string, ...params: unknown[]) =>
    queryLifecycleD1(STATE_DIR!, sql, ...params);

  const themeRow = () => {
    const rows = queryD1(
      "SELECT preview_runtime, metadata FROM storefront_themes WHERE id = ?1 AND storefront_id = ?2",
      scope!.themeId,
      scope!.storefrontId,
    );
    expect(rows, "this spec's Theme row").toHaveLength(1);
    return rows[0] as { preview_runtime: string | null; metadata: string | null };
  };
  const recordedRuntime = () => themeRow().preview_runtime;

  const publicOrigin = () =>
    `http://${HOST}:${new URL(test.info().project.use.baseURL!).port}`;

  async function workspace(page: Page): Promise<Record<string, string>> {
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
      { module: THEME_FILES, scope: scope! },
    );
  }

  async function templates(page: Page): Promise<Template[]> {
    const result = (await serverFn(page, THEMES, "getStorefrontThemeEditor", {
      ...scope!,
    })) as { success: boolean; message?: string; data?: { templates: Template[] } };
    expect(result.success, result.message).toBe(true);
    return result.data!.templates;
  }

  async function template(page: Page, id: string): Promise<Template> {
    const found = (await templates(page)).find((item) => item.id === id);
    expect(found, `template ${id} is in the editor context`).toBeDefined();
    return found!;
  }

  async function storedSection(page: Page, templateId: string, sectionId: string) {
    return (await template(page, templateId)).document.sections.find(
      (section) => section.id === sectionId,
    );
  }

  /** One Design write, the way the editor's fields and section toggle send it. */
  async function writeSection(
    page: Page,
    templateId: string,
    sectionId: string,
    props: Record<string, unknown>,
    routePath?: string,
  ) {
    const current = await template(page, templateId);
    const written = (await serverFn(
      page,
      THEMES,
      "updateStorefrontThemeSectionProps",
      {
        ...scope!,
        templateId,
        sectionId,
        props,
        expectedDraftGeneration: current.draftGeneration,
        expectedSourceGeneration: await themeSourceGeneration(page, scope!),
        ...(routePath ? { routePath } : {}),
      },
    )) as { success: boolean; message?: string; error?: string };
    expect(
      written.success,
      `${sectionId} ${JSON.stringify(props)}: ${written.error ?? ""} ${written.message ?? ""}`,
    ).toBe(true);
  }

  /** Writes an author value, then hides the section; reads both back. */
  async function valueThenHide(
    page: Page,
    templateId: string,
    sectionId: string,
    props: Record<string, unknown>,
    routePath?: string,
  ) {
    await writeSection(page, templateId, sectionId, props, routePath);
    expect((await storedSection(page, templateId, sectionId))?.props).toMatchObject(
      props,
    );
    await writeSection(page, templateId, sectionId, { enabled: false }, routePath);
    expect(
      (await storedSection(page, templateId, sectionId))?.enabled,
      `${sectionId} is hidden in its Document`,
    ).toBe(false);
  }

  /** A page's render policy, through the rendering panel's write; read back. */
  async function setPagePolicy(page: Page, templateId: string, mode: "ssr" | "ssg") {
    const draft = await template(page, templateId);
    const policy = (await serverFn(page, THEMES, "updateStorefrontThemeRenderPolicy", {
      ...scope!,
      templateId,
      expectedDraftGeneration: draft.draftGeneration,
      expectedSourceGeneration: await themeSourceGeneration(page, scope!),
      setting: { scope: "page", policy: { mode } },
    })) as { success: boolean; message?: string; error?: string };
    expect(policy.success, `${templateId} ${mode}: ${policy.error ?? policy.message}`).toBe(
      true,
    );
    expect(
      (await template(page, templateId)).document.renderPolicy?.mode,
      `the Document's page policy is ${mode}`,
    ).toBe(mode);
  }

  type BuildRow = {
    id: string;
    status: string;
    error_message: string | null;
    content_publication_id: string | null;
  };
  const buildRow = (buildId: string) =>
    queryD1(
      "SELECT id, status, error_message, content_publication_id FROM storefront_theme_builds WHERE id = ?1 AND theme_id = ?2",
      buildId,
      scope!.themeId,
    )[0] as BuildRow | undefined;

  /**
   * The build the editor's next publish makes: its id, from the answer to
   * the createPreviewBuild the page sends, and the build and publish POSTs
   * counted from now on.
   */
  async function watchPublish(page: Page) {
    const paths = await serverFnPaths(page);
    const posts = { build: 0, publish: 0 };
    page.on("request", (request) => {
      if (request.method() !== "POST") return;
      const path = new URL(request.url()).pathname;
      if (path === paths.build) posts.build += 1;
      if (path === paths.publish) posts.publish += 1;
    });
    const created = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === paths.build,
      { timeout: 5 * 60_000 },
    );
    return {
      paths,
      posts,
      async buildId() {
        const answer = decodeServerFnResult(await (await created).text()) as {
          success?: boolean;
          message?: string;
          data?: { id?: string };
        };
        expect(answer.success, `the publish build was created: ${answer.message}`).toBe(true);
        expect(answer.data?.id, "the created build's id").toBeTruthy();
        return answer.data!.id!;
      },
    };
  }

  /** A build row once it is done (queued and building are not). */
  async function finishedBuild(buildId: string): Promise<BuildRow> {
    let finished: BuildRow | undefined;
    await expect
      .poll(
        () => {
          finished = buildRow(buildId);
          return finished && finished.status !== "queued" && finished.status !== "building"
            ? finished.status
            : null;
        },
        { timeout: 9 * 60_000, message: `build ${buildId} finished` },
      )
      .not.toBeNull();
    test.info().annotations.push({
      type: "observed",
      description: JSON.stringify(finished),
    });
    return finished!;
  }

  test.beforeAll(async ({ browser }) => {
    // This spec's Theme records full Start itself; a record-mode run
    // declaring client contradicts it.
    expect(RECORDED_PREVIEW_RUNTIME, "not a client record-mode run").not.toBe(
      "client",
    );
    const page = await signedInPage(browser);
    shared = page;
    const created: ThemeScope = {
      storefrontId: themeScopeFromEditorPath(EDITOR_PATH!).storefrontId,
      themeId: randomUUID(),
    };
    scope = created;
    // A fresh Theme, recorded as Starter 1 with no files and no runtime,
    // through the shared throwaway-Theme helper as the other single-use
    // Themes are. No runtime on purpose: the editor's own compare-and-set
    // records start below.
    insertThrowawayTheme({
      storefrontId: created.storefrontId,
      themeId: created.themeId,
      name: `v32-start-${created.themeId}`,
      previewRuntime: null,
      // An empty row, for the editor to provision Starter 32 into.
      rowOnly: true,
    });
    await page.goto("/", { waitUntil: "domcontentloaded" });

    // Full Start first, through the editor's compare-and-set: from Starter
    // 32 the editor provisions the Starter only into a Theme recording start.
    const before = recordedRuntime();
    expect(before, "a new Theme records no runtime").toBeNull();
    const saved = (await serverFn(page, PREVIEW_SERVER, "setThemePreviewRuntime", {
      ...created,
      previewRuntime: "start",
      expectedPreviewRuntime: before,
    })) as { success: boolean; message?: string; error?: string };
    expect(saved.success, `record full Start: ${saved.error ?? saved.message}`).toBe(
      true,
    );
    expect(recordedRuntime(), "the Theme records full Start in D1").toBe("start");
    verifyRecordedThemePreviewRuntime(created);

    // The editor's first read provisions the current Starter
    // (`ensureStoredStarterPreview`).
    const provisioned = await templates(page);
    const home = provisioned.find((item) => item.type === "index");
    const layout = provisioned.find((item) => item.type === "layout");
    expect(home, "the editor created the home template").toBeDefined();
    expect(layout, "the editor created the layout template").toBeDefined();
    homeTemplateId = home!.id;
    layoutTemplateId = layout!.id;
    expect(STOREFRONT_STARTER_TEMPLATE_VERSION, "the shipped Starter").toBe(32);
    expect(
      JSON.parse(themeRow().metadata ?? "{}").starterTemplateVersion,
      "the Theme records the shipped Starter's version",
    ).toBe(STOREFRONT_STARTER_TEMPLATE_VERSION);

    // The shipped Starter 32, byte for byte: its home, layout and content
    // module; then the test-only files beside them, every provisioned file
    // left as it was.
    const original = await workspace(page);
    for (const [path, source] of Object.entries(SHIPPED_FILES)) {
      expect(original[path], `${path} is the shipped Starter 32 source`).toBe(source);
    }
    // The workspace's module is the Starter 32 module itself (the SDK read
    // source), not a copy the adoption rewrote.
    expect(original["src/morph/content.ts"]).toBe(STARTER_THEME_CONTENT_MODULE_SOURCE);
    // The home still gates every section the Starter way.
    expect(original["src/routes/index.tsx"]).toContain(`!isSectionHidden("${NEWSLETTER}")`);
    for (const file of TEST_FILES) {
      expect(original[file.path], `${file.path} is not a Starter file`).toBeUndefined();
    }
    const written = await writeThemeFiles(page, created, TEST_FILES);
    expect(written.success, JSON.stringify(written)).toBe(true);
    const installed = await workspace(page);
    for (const file of TEST_FILES) {
      expect(installed[file.path], file.path).toBe(file.content);
    }
    for (const [path, content] of Object.entries(original)) {
      expect(installed[path], `${path} is the provisioned Starter's`).toBe(content);
    }
    expect(recordedRuntime(), "still full Start after the test files").toBe("start");

    const ensured = (await serverFn(page, THEMES, "ensureStorefrontThemeRouteTemplate", {
      ...created,
      routePath: PAGE_PATH,
    })) as { success: boolean; message?: string; data?: { id: string } };
    expect(ensured.success, ensured.message).toBe(true);
    pageTemplateId = ensured.data!.id;

    // The Documents: author values on the home, then the hides.
    await writeSection(page, homeTemplateId, HERO, { heading: HERO_MARKER });
    await writeSection(page, homeTemplateId, INTRO, { heading: INTRO_MARKER });
    for (const [sectionId, marker] of [
      [HERO, HERO_MARKER],
      [INTRO, INTRO_MARKER],
    ] as const) {
      const stored = await storedSection(page, homeTemplateId, sectionId);
      expect(stored?.props, `${sectionId} holds the author's value`).toMatchObject({
        heading: marker,
      });
      expect(stored?.enabled, `${sectionId} is shown`).not.toBe(false);
    }
    await valueThenHide(page, homeTemplateId, NEWSLETTER, {
      heading: NEWSLETTER_MARKER,
    });
    await valueThenHide(page, layoutTemplateId, FOOTER, {
      copyrightText: FOOTER_MARKER,
    });
    await writeSection(
      page,
      pageTemplateId,
      SHOWN_SLOT,
      { heading: SHOWN_MARKER },
      PAGE_PATH,
    );
    await valueThenHide(
      page,
      pageTemplateId,
      HIDDEN_SLOT,
      { heading: HIDDEN_MARKER },
      PAGE_PATH,
    );
    expect((await storedSection(page, pageTemplateId, SHOWN_SLOT))?.props).toMatchObject({
      heading: SHOWN_MARKER,
    });
    expect((await storedSection(page, pageTemplateId, SHOWN_SLOT))?.enabled).not.toBe(false);

    homeEditorPath = `/store/${created.storefrontId}/themes/${created.themeId}/editor?templateId=${homeTemplateId}`;
    pageEditorPath = `/store/${created.storefrontId}/themes/${created.themeId}/editor?templateId=${pageTemplateId}&routePath=${PAGE_PATH}`;
    harness = storefrontHarness({ scope: created, stateDir: STATE_DIR! });
  });

  test.afterAll(async () => {
    // The Theme is left as the run ended it: single use, nothing else opens
    // it. The domain this spec connected is removed.
    const failures: string[] = [];
    try {
      if (shared && domainIds.length) {
        for (const domainId of domainIds.splice(0)) {
          try {
            // As starter-upgrade-publish-acceptance.spec.ts: the local
            // stand-in domain has no Cloudflare custom domain, and a primary
            // domain cannot be deleted, so the row is made deletable first.
            execLocalD1(
              `UPDATE storefront_domains SET is_primary = 0, cloudflare_domain_id = NULL WHERE id = ${sqlText(domainId)};`,
            );
            const deleted = (await serverFn(shared, DOMAINS, "deleteStorefrontDomains", {
              ids: [domainId],
            })) as { success: boolean; message?: string };
            if (!deleted.success) failures.push(`domain ${domainId}: ${deleted.message}`);
          } catch (error) {
            failures.push(`domain ${domainId}: ${String(error)}`);
          }
        }
      }
    } finally {
      await visitor?.context().close();
      await tab?.close().catch(() => {});
      await shared?.context().close();
      await harness?.dispose();
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });

  test("the Starter's own home: first load and reload render its Document on the server, the hidden sections absent", async () => {
    const page = shared!;
    await openEditor(page, homeEditorPath);
    const frame = await previewDocument(page);
    await expect(
      frame.getByText(HERO_MARKER).first(),
      "the editor's preview shows the home Document",
    ).toBeVisible({ timeout: 180_000 });
    previewOrigin = new URL(frame.url()).origin;

    // The preview in a tab of its own (its own grant, #214 P3), so requests
    // and loads are the tab's alone and no editor frame bridge is involved.
    const [opened] = await Promise.all([
      page.context().waitForEvent("page"),
      page.getByRole("button", { name: "Open preview in new tab" }).click(),
    ]);
    await opened.waitForURL(
      (url) =>
        url.origin === previewOrigin &&
        !url.pathname.startsWith("/__morph/preview-auth/"),
      { timeout: 90_000 },
    );
    tab = opened;
    tabReads = recordReads(tab, () => previewOrigin);

    // The full Start preview Worker answers its address probe; the
    // client-only preview has none.
    const probe = await tab.evaluate(async () => {
      const response = await fetch("/_morph/preview-health", { cache: "no-store" });
      return {
        status: response.status,
        ticket: response.headers.get("x-morph-content-ticket"),
      };
    });
    expect(probe.status, "the full Start preview Worker answers").toBe(200);
    expect(probe.ticket, "it names the content snapshot it reads").not.toBeNull();

    const response = await tab.goto(`${previewOrigin}/`, {
      waitUntil: "domcontentloaded",
    });
    expect(response, "a response for /").not.toBeNull();
    expect(response!.status()).toBe(200);
    expectHomeHtml(await response!.text(), "preview / (SSR)");
    // The home Document is the same on a reload: the same values, the same
    // hidden newsletter and Footer.
    const reloaded = await tab.reload({ waitUntil: "domcontentloaded" });
    expect(reloaded, "a response for the reload of /").not.toBeNull();
    expect(reloaded!.status()).toBe(200);
    expectHomeHtml(await reloaded!.text(), "preview / (reload, SSR)");
    await waitForRouter(tab);
    await expectHomeDom(tab);
  });

  test("in-site navigation to a non-home page and back reads each Document through /_serverFn", async () => {
    const reads = tabReads!;
    await waitForRouter(tab!);
    const token = await markDocument(tab!);
    const callsBefore = reads.calls.length;
    const contentReadsBefore = reads.contentReads.length;

    await navigateInSite(tab!, PAGE_PATH);
    await expectPageDom(tab!, SHOWN_MARKER);
    expect(new URL(tab!.url()).pathname).toBe(PAGE_PATH);
    expect(await sameDocument(tab!, token), "in-site navigation, not a document load").toBe(
      true,
    );
    const read = await readCarrying(
      reads.calls,
      callsBefore,
      SHOWN_MARKER,
      "the navigation read the test route's Document through /_serverFn",
    );
    expect(read.body, "the read names the hidden section as hidden").toContain(HIDDEN_SLOT);
    expect(read.body, "and the layout's").toContain(FOOTER);
    expect(read.body, "not the hidden section's value").not.toContain(HIDDEN_MARKER);
    expect(read.body, "not the hidden Footer's value").not.toContain(FOOTER_MARKER);
    previewPageRead = read;

    // Back to / with the route's own <Link>: another /_serverFn read, and the
    // Starter's home as its Document says, not as the components' defaults.
    const backBefore = reads.calls.length;
    await tab!.locator("[data-v32-home-link]").click();
    await expectHomeDom(tab!);
    expect(new URL(tab!.url()).pathname).toBe("/");
    expect(await sameDocument(tab!, token), "still the same document").toBe(true);
    const back = await readCarrying(
      reads.calls,
      backBefore,
      HERO_MARKER,
      "the navigation back read the home Document through /_serverFn",
    );
    expect(back.body, "the read names the newsletter as hidden").toContain(NEWSLETTER);
    expect(back.body).not.toContain(NEWSLETTER_MARKER);

    expect(
      reads.contentReads.slice(contentReadsBefore),
      "no /_morph/content read from the browser (Starter 31's path)",
    ).toEqual([]);
    expect(
      reads.consoleErrors.filter((text) =>
        /invalid_content_origin|no_content_source|MorphContentError|store_error/.test(text),
      ),
      "no content error in the console",
    ).toEqual([]);
  });

  test("direct load and reload of the non-home page render its Document on the server", async () => {
    const loaded = await tab!.goto(`${previewOrigin}${PAGE_PATH}`, {
      waitUntil: "domcontentloaded",
    });
    expect(loaded, `a response for ${PAGE_PATH}`).not.toBeNull();
    expect(loaded!.status()).toBe(200);
    expectPageHtml(await loaded!.text(), SHOWN_MARKER, `preview ${PAGE_PATH} (SSR)`);

    const reloaded = await tab!.reload({ waitUntil: "domcontentloaded" });
    expect(reloaded, "a response for the reload").not.toBeNull();
    expect(reloaded!.status()).toBe(200);
    expectPageHtml(
      await reloaded!.text(),
      SHOWN_MARKER,
      `preview ${PAGE_PATH} (reload, SSR)`,
    );
    await waitForRouter(tab!);
    await expectPageDom(tab!, SHOWN_MARKER);
  });

  test("publish on SSR, then read back: the released home carries the author's values, the hidden newsletter and footer absent", async ({
    browser,
  }) => {
    const page = shared!;
    const domain = (await serverFn(page, DOMAINS, "createStorefrontDomain", {
      storefrontId: scope!.storefrontId,
      hostname: HOST,
    })) as { success: boolean; message?: string; data?: { id: string } };
    expect(domain.success, domain.message).toBe(true);
    domainIds.push(domain.data!.id);

    // Publishing is per page (with the layout); both pages are published,
    // the test route first, so the active release carries both.
    await openEditor(page, pageEditorPath);
    await (await publishShowingRelease(page)).close();
    const pageRelease = await latestRelease(page, scope!);

    // The home explicitly on SSR, through the rendering panel's write. A
    // static (ssg) release is refused until Core is proven to serve the
    // active release's HTML (PUBLISH_RENDER_POLICY_NOT_READY); case 6 holds
    // the static home's build to its prerendered HTML instead.
    await setPagePolicy(page, homeTemplateId, "ssr");

    await openEditor(page, homeEditorPath);
    await (await publishShowingRelease(page)).close();
    const release = await latestRelease(page, scope!);
    for (const releaseId of [pageRelease, release]) {
      const [made] = queryD1(
        "SELECT theme_id FROM storefront_releases WHERE id = ?1",
        releaseId,
      );
      expect(made?.theme_id, "the release is this spec's Theme's").toBe(scope!.themeId);
    }
    const built = await harness!.releaseBuild(release);
    expect(built.buildId, "the release names its build").toBeTruthy();
    expect(built.releaseContent, "the release names its content").toBeTruthy();
    await harness!.serveActiveRelease(SHOWN_MARKER, release, publicOrigin());
    servingRelease = release;

    // The public site, through Core and the released Theme Worker.
    const storefront = storefrontFetcher(publicOrigin());
    const home = await storefront("/");
    expect(home.status).toBe(200);
    expectHomeHtml(home.body, "public / (released)");
    const other = await storefront(PAGE_PATH);
    expect(other.status).toBe(200);
    expectPageHtml(other.body, SHOWN_MARKER, `public ${PAGE_PATH} (SSR)`);
    const answer = await storefront(
      `/_morph/content?path=${encodeURIComponent(PAGE_PATH)}`,
    );
    expect(answer.status).toBe(200);
    const parsed = JSON.parse(answer.body) as {
      slots: Record<string, Record<string, unknown>>;
      hiddenSlots: string[];
    };
    expect(parsed.slots[SHOWN_SLOT]?.heading).toBe(SHOWN_MARKER);
    expect(Object.keys(parsed.slots)).not.toContain(HIDDEN_SLOT);
    expect(parsed.hiddenSlots).toEqual(expect.arrayContaining([HIDDEN_SLOT, FOOTER]));

    // An anonymous visitor's in-site navigation on the public site reads
    // through /_serverFn too.
    const context = await browser.newContext();
    // Negative control for the Live Preview's accessor: a page here that
    // defines one of the same name, answering a draft marker, is never asked.
    // The published build sets __MORPH_START_LIVE_PREVIEW__ false, so the
    // branch that would ask is not in the bundle at all.
    const FAKE_LIVE_MARKER = `v32-fake-live-${RUN}`;
    await context.addInitScript(
      ({ marker, slot }) => {
        const calls: string[] = [];
        Object.defineProperty(window, "__morphFakeLiveCalls", { value: calls });
        Object.defineProperty(window, "__morphLivePreviewContent", {
          value: Object.freeze({
            overlay: (pathname: string) => {
              calls.push(pathname);
              return { slots: { [slot]: { heading: marker } }, hiddenSlots: [] };
            },
          }),
        });
      },
      { marker: FAKE_LIVE_MARKER, slot: SHOWN_SLOT },
    );
    visitor = await context.newPage();
    const visitorReads = recordReads(visitor, publicOrigin);
    const landed = await visitor.goto(`${publicOrigin()}/`, {
      waitUntil: "domcontentloaded",
    });
    expect(landed!.status()).toBe(200);
    await waitForRouter(visitor);
    await expectHomeDom(visitor);
    const token = await markDocument(visitor);
    const before = visitorReads.calls.length;
    await navigateInSite(visitor, PAGE_PATH);
    await expectPageDom(visitor, SHOWN_MARKER);
    expect(await sameDocument(visitor, token), "in-site navigation, not a document load").toBe(
      true,
    );
    const read = await readCarrying(
      visitorReads.calls,
      before,
      SHOWN_MARKER,
      "the public navigation read the release through /_serverFn",
    );
    expect(read.body).toContain(HIDDEN_SLOT);
    expect(read.body).not.toContain(HIDDEN_MARKER);
    expect(visitorReads.contentReads, "no /_morph/content read from the browser").toEqual(
      [],
    );
    expect(
      await visitor.evaluate(
        () => (window as unknown as { __morphFakeLiveCalls: string[] }).__morphFakeLiveCalls,
      ),
      "the published build never asks a live content accessor",
    ).toEqual([]);
    expect(await visitor.locator("body").innerText()).not.toContain(FAKE_LIVE_MARKER);
    publicPageRead = read;

    // A draft written after the publish stays out of the public site, on
    // both read paths.
    await writeSection(
      page,
      pageTemplateId,
      SHOWN_SLOT,
      { heading: DRAFT_MARKER },
      PAGE_PATH,
    );
    expect((await storedSection(page, pageTemplateId, SHOWN_SLOT))?.props).toMatchObject({
      heading: DRAFT_MARKER,
    });
    const after = await storefront(PAGE_PATH);
    expect(after.status).toBe(200);
    expect(after.body).toContain(SHOWN_MARKER);
    expect(after.body).not.toContain(DRAFT_MARKER);
    const again = await fetchIn(visitor, read.url, replayHeaders(read));
    expect(again.status).toBe(200);
    expect(again.body).toContain(SHOWN_MARKER);
    expect(again.body).not.toContain(DRAFT_MARKER);
  });

  test("a read without preview access, or naming a release it may not see, is refused and says why", async ({
    browser,
  }) => {
    const previewRead = previewPageRead!;
    const publicRead = publicPageRead!;
    const draftValues = [SHOWN_MARKER, DRAFT_MARKER, HIDDEN_MARKER];

    // Control: the preview tab, holding its grant, gets the read.
    const granted = await fetchIn(tab!, previewRead.url, replayHeaders(previewRead));
    expect(granted.status, "the granted tab's read").toBe(200);
    expect(granted.body).toContain(SHOWN_SLOT);

    // The same /_serverFn read in a browser with no session, and in one
    // signed in without this preview's grant: refused by the preview
    // gateway, saying so, with no draft byte.
    const stranger = await browser.newContext();
    try {
      const refused = await visit(stranger, previewRead.url);
      expect(refused.status, "no session").toBe(401);
      expect(refused.body).toContain(PREVIEW_REFUSAL);
      for (const value of draftValues) expect(refused.body).not.toContain(value);
    } finally {
      await stranger.close();
    }
    const signedIn = await signedInPage(browser);
    try {
      const refused = await visit(signedIn.context(), previewRead.url);
      expect(refused.status, "a session is not a preview grant").toBe(401);
      expect(refused.body).toContain(PREVIEW_REFUSAL);
      for (const value of draftValues) expect(refused.body).not.toContain(value);
    } finally {
      await signedIn.context().close();
    }

    // The public site: a /_serverFn read that names the preview's content
    // address and a render context of its own reads the active release, not
    // anything it named (Core drops inbound x-morph-* headers).
    const forged = await fetchIn(visitor!, publicRead.url, {
      ...replayHeaders(publicRead),
      "x-morph-content-origin": `http://${PREVIEW_CONTENT_HOST}`,
      "x-morph-render-context": "v1.forged.forged",
    });
    expect(forged.status).toBe(200);
    expect(forged.body).toContain(SHOWN_MARKER);
    expect(forged.body).not.toContain(DRAFT_MARKER);
    expect(forged.body).not.toContain(HIDDEN_MARKER);

    // A content read naming a release Core did not resolve for this request
    // is refused, by name, rather than read as the active release.
    const pinned = await fetchIn(
      visitor!,
      `/_morph/content?path=${encodeURIComponent(PAGE_PATH)}`,
      { "x-morph-render-context": "v1.forged.forged" },
    );
    expect(pinned.status).toBe(409);
    expect(pinned.body).toContain(RENDER_CONTEXT_REFUSAL);
    for (const value of draftValues) expect(pinned.body).not.toContain(value);
  });

  // The static home, published once. The publish builds first, sealed with
  // the home's draft (prerendering it needs the content), and the platform
  // Start build's prerender reads that seal on its only pass. The guard then
  // refuses the publish itself: no static release until Core is proven to
  // serve the active release's HTML. The build, its seal and its artifact
  // stay; nothing is released, and the site stays on case 4's release.
  test("a static (ssg) home publish prerenders the sealed draft, then is refused before release and the serving release stays live", async () => {
    const page = shared!;
    const before = await harness!.publishedState();
    expect(before.active, "case 4's release is serving").toBe(servingRelease);

    // A value no release has, so the prerendered home can only be this
    // build's seal of the draft.
    await writeSection(page, homeTemplateId, HERO, { heading: SSG_HERO_MARKER });
    expect((await storedSection(page, homeTemplateId, HERO))?.props).toMatchObject({
      heading: SSG_HERO_MARKER,
    });
    await setPagePolicy(page, homeTemplateId, "ssg");

    await openEditor(page, homeEditorPath);
    const watched = await watchPublish(page);
    const refusal = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === watched.paths.publish,
      { timeout: 10 * 60_000 },
    );
    await openPublish(page);
    const buildId = await watched.buildId();

    // The exact build: succeeded, sealed, proven to carry that content.
    const done = await finishedBuild(buildId);
    expect(done.status, "the publish build succeeded").toBe("succeeded");
    const answer = (await serverFn(page, BUILDS, "getThemeBuild", {
      ...scope!,
      buildId,
    })) as {
      success: boolean;
      message?: string;
      data?: {
        status: string;
        contentPublicationId?: string | null;
        contentDependency?: string | null;
        artifactPrefix: string | null;
        manifestJson: { files?: { path: string; sizeBytes: number; sha256: string }[] } | null;
      };
    };
    expect(answer.success, answer.message).toBe(true);
    const build = answer.data!;
    expect(build.status).toBe("succeeded");
    expect(build.contentPublicationId, "the build is sealed with content").toBeTruthy();
    expect(
      build.contentDependency,
      "the build read its sealed content: the home was prerendered from it",
    ).toBe("dependent");
    expect(build.artifactPrefix, "the build recorded its artifact").toBeTruthy();
    const [sealed] = queryD1(
      `SELECT count(*) AS carries
         FROM storefront_content_publication_items i
         JOIN storefront_theme_template_revisions t ON t.id = i.revision_id
        WHERE i.publication_id = ?1 AND instr(t.document, ?2) > 0`,
      build.contentPublicationId,
      SSG_HERO_MARKER,
    ) as { carries: number }[];
    expect(sealed?.carries, "the seal holds the home's draft value").toBeGreaterThan(0);

    // The prerendered home, as the build wrote it to this run's R2, held to
    // the build's manifest.
    const entry = build.manifestJson?.files?.find((file) => file.path === PRERENDERED_HOME);
    expect(entry, `the manifest lists ${PRERENDERED_HOME}`).toBeDefined();
    const stored = await harness!.buildObjects(build.artifactPrefix!, [
      "manifest.json",
      PRERENDERED_HOME,
    ]);
    expect(stored.keys, `R2 holds ${PRERENDERED_HOME} under the build's prefix`).toContain(
      `${build.artifactPrefix}/${PRERENDERED_HOME}`,
    );
    const storedManifest = JSON.parse(
      new TextDecoder().decode(stored.objects["manifest.json"] ?? new Uint8Array()),
    ) as { files?: { path: string; sizeBytes: number; sha256: string }[] };
    expect(
      storedManifest.files?.find((file) => file.path === PRERENDERED_HOME),
      "R2's manifest and the build's agree on the prerendered home",
    ).toEqual(entry);
    const bytes = stored.objects[PRERENDERED_HOME];
    expect(bytes, `${PRERENDERED_HOME} is in R2`).toBeTruthy();
    expect(bytes!.byteLength, "its size is the manifest's").toBe(entry!.sizeBytes);
    expect(
      createHash("sha256").update(bytes!).digest("hex"),
      "its SHA-256 is the manifest's",
    ).toBe(entry!.sha256);
    const prerendered = new TextDecoder().decode(bytes!);
    expectHomeHtml(prerendered, `build ${PRERENDERED_HOME}`, SSG_HERO_MARKER);
    expect(prerendered, "not the released hero value").not.toContain(HERO_MARKER);

    // The publish itself is refused by the guard, saying so; nothing is
    // released and the editor reports no publish.
    const refused = decodeServerFnResult(await (await refusal).text()) as {
      success?: boolean;
      error?: string;
    };
    expect(refused.success, "the publish is refused").toBe(false);
    expect(refused.error).toBe("PUBLISH_RENDER_POLICY_NOT_READY");
    await expect(page.locator("[data-publish-pending]")).toHaveAttribute(
      "data-publish-pending",
      "false",
      { timeout: 60_000 },
    );
    expect(watched.posts, "one build, one publish").toEqual({ build: 1, publish: 1 });
    await expect(
      page.locator("[data-editor-save-status]"),
      "the editor does not report a publish",
    ).not.toHaveAttribute("aria-label", "Published");
    await expect(page.locator('iframe[data-build-preview="release"]')).toHaveCount(0);
    expect(await harness!.publishedState(), "no release, no publication").toEqual(before);

    // The public site still serves case 4's release, on SSR.
    const storefront = storefrontFetcher(publicOrigin());
    const home = await storefront("/");
    expect(home.status).toBe(200);
    expectHomeHtml(home.body, "public / (after the refused publish)");
    expect(home.body, "not the refused draft's value").not.toContain(SSG_HERO_MARKER);
  });

  // The read-failure trap, at build time. Starter 32 rejects a failed read
  // instead of rendering defaults. The platform Start build gives its
  // prerender the sealed content on its only pass; here the route's loader
  // names a path no Document of that seal has, which the sealed content
  // answers with a bare 404 (`content_not_found`). That must be a failed
  // build, never static HTML from defaults, no publish may be sent, and the
  // site must stay on the release it was serving.
  test("a static route whose read finds no sealed content fails the publish build, writes no artifact, and leaves the serving release live", async () => {
    const page = shared!;
    const before = await harness!.publishedState();
    expect(before.active, "case 4's release is serving").toBe(servingRelease);

    const written = await writeThemeFiles(page, scope!, [UNSEALED_ROUTE]);
    expect(written.success, JSON.stringify(written)).toBe(true);
    expect((await workspace(page))[UNSEALED_ROUTE.path]).toBe(UNSEALED_ROUTE.content);
    const ensured = (await serverFn(page, THEMES, "ensureStorefrontThemeRouteTemplate", {
      ...scope!,
      routePath: UNSEALED_PATH,
    })) as { success: boolean; message?: string; data?: { id: string } };
    expect(ensured.success, ensured.message).toBe(true);
    const unsealedTemplateId = ensured.data!.id;
    const draft = await template(page, unsealedTemplateId);
    const policy = (await serverFn(page, THEMES, "updateStorefrontThemeRenderPolicy", {
      ...scope!,
      templateId: unsealedTemplateId,
      expectedDraftGeneration: draft.draftGeneration,
      expectedSourceGeneration: await themeSourceGeneration(page, scope!),
      setting: { scope: "page", policy: { mode: "ssg" } },
    })) as { success: boolean; message?: string; error?: string };
    expect(policy.success, `${UNSEALED_PATH} ssg: ${policy.error ?? policy.message}`).toBe(
      true,
    );
    expect(
      (await template(page, unsealedTemplateId)).document.renderPolicy?.mode,
    ).toBe("ssg");

    await openEditor(
      page,
      `/store/${scope!.storefrontId}/themes/${scope!.themeId}/editor?templateId=${unsealedTemplateId}&routePath=${UNSEALED_PATH}`,
    );
    const watched = await watchPublish(page);
    await openPublish(page);
    const buildId = await watched.buildId();
    const finished = await finishedBuild(buildId);
    expect(finished.status, "the publish build failed").toBe("failed");
    expect(finished.content_publication_id, "the build was sealed with content").toBeTruthy();
    const answer = (await serverFn(page, BUILDS, "getThemeBuild", {
      ...scope!,
      buildId,
    })) as {
      success: boolean;
      message?: string;
      data?: {
        artifactPrefix: string | null;
        diagnosticsJson: { stage?: unknown } | null;
        errorMessage: string | null;
      };
    };
    expect(answer.success, answer.message).toBe(true);
    expect(
      answer.data!.diagnosticsJson?.stage,
      "it failed in the platform Start build's runtime compile",
    ).toBe(START_COMPILER_STAGE);
    expect(finished.error_message ?? "", "it says why, by name").toContain(
      UNSEALED_READ_REFUSAL,
    );
    expect(finished.error_message ?? "", "and names the unreadable path").toContain(
      NEVER_SEALED_PATH,
    );
    expect(answer.data!.artifactPrefix, "a failed build records no artifact").toBeNull();
    const stored = await harness!.buildObjects(
      `storefronts/${scope!.storefrontId}/themes/${scope!.themeId}/builds/${buildId}`,
    );
    expect(stored.keys, "the failed build wrote nothing to R2").toEqual([]);

    // The editor gives up after the build: no publish is sent.
    await expect(page.locator("[data-publish-pending]")).toHaveAttribute(
      "data-publish-pending",
      "false",
      { timeout: 60_000 },
    );
    expect(watched.posts, "one build, and no publish after it failed").toEqual({
      build: 1,
      publish: 0,
    });
    await expect(
      page.locator("[data-editor-save-status]"),
      "the editor does not report a publish",
    ).not.toHaveAttribute("aria-label", "Published");

    // No release was made or activated: the site stays on case 4's.
    const after = await harness!.publishedState();
    expect(after.active, "the serving release is unchanged").toBe(servingRelease);
    expect(after.releases, "no release was made").toBe(before.releases);
    expect(after, "no release, no publication").toEqual(before);
    const storefront = storefrontFetcher(publicOrigin());
    const home = await storefront("/");
    expect(home.status).toBe(200);
    expectHomeHtml(home.body, "public / (after the failed build)");
    const other = await storefront(PAGE_PATH);
    expect(other.status).toBe(200);
    expectPageHtml(other.body, SHOWN_MARKER, `public ${PAGE_PATH} (after the failed build)`);
    const unsealed = await storefront(UNSEALED_PATH);
    expect(unsealed.body, "the failed build's route is not served").not.toContain(
      "data-v32-unsealed",
    );
  });
});
