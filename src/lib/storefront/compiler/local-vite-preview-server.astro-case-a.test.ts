// @vitest-environment node
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { caseAFixtureFiles } from "../theme-framework/astro-case-a-fixture.test-support";
import { LocalVitePreviewServer } from "./local-vite-preview-server";
import { DEFAULT_APPROVED_DEPENDENCIES } from "./sandbox-vite-theme-build-runner.types";
import { previewContentDigest } from "./theme-preview-content";
import { THEME_PREVIEW_START_CONTENT_ORIGIN } from "./theme-preview-start-runtime";

/**
 * The pure Astro Theme for case A (fixtures/morph/astro-case-a) in a real
 * Astro Live Preview on the local transport, started as
 * local-vite-preview-server.astro.test.ts starts one: `astro dev` from the
 * pinned Astro toolchain, through Morph's wrapper config, import guard and
 * preview Worker entry, none of them changed for it.
 *
 * What it shows: the page's frontmatter reads its content with
 * `morph.pages.get("/")`, destructures `hero` and spreads it onto `<Hero>`,
 * from the origin the preview Worker forwards. Not Design: no selection, no
 * binding (L1.5).
 */
const ASTRO_TOOLCHAIN = path.join(
  process.cwd(),
  "sandbox/toolchains/astro-7.3/node_modules/astro/package.json",
);
const WORKSPACES_ROOT = path.join(process.cwd(), ".morph-previews-astro-case-a-test");
const PREVIEW_ID = "astro-case-a";

const content = (title: string, subtitle: string) => ({
  templates: { index: { slots: { hero: { title, subtitle } }, hiddenSlots: [] } },
  pages: {},
});

/** A content snapshot as Core writes one: content, ticket and its hash. */
async function snapshot(title: string, subtitle: string, contentTicket: number) {
  const value = content(title, subtitle);
  return JSON.stringify({
    ...value,
    contentTicket,
    contentHash: await previewContentDigest(JSON.stringify(value)),
  });
}

const available = fsSync.existsSync(ASTRO_TOOLCHAIN);
let server: LocalVitePreviewServer;
let origin = "";

const page = async (pathname: string) => {
  const response = await fetch(`${origin}${pathname}`);
  return { status: response.status, html: await response.text() };
};

/** The hero's heading and paragraph, as the server rendered them. */
const hero = (html: string) => {
  const section = /<section data-case-a-hero[^>]*>([\s\S]*?)<\/section>/.exec(html)?.[1];
  return section === undefined
    ? null
    : {
        title: /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(section)?.[1]?.trim(),
        subtitle: /<p[^>]*>([\s\S]*?)<\/p>/.exec(section)?.[1]?.trim(),
      };
};

beforeAll(async () => {
  if (!available) return;
  await fs.mkdir(WORKSPACES_ROOT, { recursive: true });
  server = new LocalVitePreviewServer({
    workspacesRoot: WORKSPACES_ROOT,
    toolchainRoot: process.cwd(),
    approvedDependencies: DEFAULT_APPROVED_DEPENDENCIES,
    readyTimeoutMs: 120_000,
  });
  const started = await server.start({
    previewId: PREVIEW_ID,
    files: caseAFixtureFiles(),
    entry: "",
    previewHostname: "127.0.0.1",
    platformHostEnv: {},
    framework: "astro",
    astroThemes: true,
    previewContent: content("CASE-A-DRAFT-TITLE", "CASE-A-DRAFT-SUBTITLE") as never,
  });
  if (!started.ok) {
    throw new Error(
      [`${started.stage}: ${started.errorMessage}`, ...(started.logs ?? []).slice(-40)].join(
        "\n",
      ),
    );
  }
  origin = new URL(started.url).origin;
}, 180_000);

afterAll(async () => {
  await server?.stop(PREVIEW_ID).catch(() => {});
  await fs.rm(WORKSPACES_ROOT, { recursive: true, force: true }).catch(() => {});
}, 60_000);

describe.skipIf(!available)(
  "the case A Astro Theme in a real Astro Live Preview",
  { timeout: 120_000 },
  () => {
    it("renders the draft hero read in frontmatter and spread onto the component", async () => {
      const { status, html } = await page("/");
      expect(status).toBe(200);
      expect(hero(html)).toEqual({
        title: "CASE-A-DRAFT-TITLE",
        subtitle: "CASE-A-DRAFT-SUBTITLE",
      });
      expect(html).not.toContain("CASE-A-DEFAULT-");
    });

    it("puts neither the content origin nor its header in the page", async () => {
      const { html } = await page("/");
      expect(html).not.toContain(THEME_PREVIEW_START_CONTENT_ORIGIN);
      expect(html).not.toContain(new URL(THEME_PREVIEW_START_CONTENT_ORIGIN).hostname);
      expect(html.toLowerCase()).not.toContain("x-morph-content-origin");
    });

    it("reads on every request: a newer draft is what the next render shows", async () => {
      expect(
        await server.writeContent(
          PREVIEW_ID,
          await snapshot("CASE-A-NEXT-TITLE", "CASE-A-NEXT-SUBTITLE", 201),
        ),
      ).toEqual({ applied: true, ticket: 201 });
      expect(hero((await page("/")).html)).toEqual({
        title: "CASE-A-NEXT-TITLE",
        subtitle: "CASE-A-NEXT-SUBTITLE",
      });
    });

    it("fails a page whose read fails, rather than rendering the component defaults", async () => {
      // A page of the same Theme that asks for a path the reader refuses.
      const written = await server.writeFiles(PREVIEW_ID, [
        {
          path: "src/pages/refused.astro",
          content: `---
import Hero from "../components/Hero.astro";
import { morph } from "../morph/content";
const page = await morph.pages.get("no-leading-slash");
const { hero } = page;
---
<html><body><Hero {...hero} /></body></html>
`,
        },
      ]);
      expect(written.changed).toEqual(["src/pages/refused.astro"]);
      let result = await page("/refused");
      for (let attempt = 0; attempt < 20 && result.status === 404; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        result = await page("/refused");
      }
      expect(result.status).toBe(500);
      // The dev server's error page names the reader's refusal, not another
      // failure: the words of invalid_path.
      expect(result.html).toContain("A page path starts with / and is at most 500 characters.");
      expect(result.html).not.toContain("CASE-A-DEFAULT-");
      expect(result.html).not.toContain("data-case-a-hero");
      // The rest of the Theme still renders.
      expect(hero((await page("/")).html)?.title).toBe("CASE-A-NEXT-TITLE");
    });
  },
);
