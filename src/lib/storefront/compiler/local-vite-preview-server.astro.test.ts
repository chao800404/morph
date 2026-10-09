// @vitest-environment node
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { astroThemeFiles } from "../theme-framework/astro-native-prerender.fixtures";
import { LocalVitePreviewServer } from "./local-vite-preview-server";
import { DEFAULT_APPROVED_DEPENDENCIES } from "./sandbox-vite-theme-build-runner.types";
import { THEME_PREVIEW_START_CLIENT_PATH } from "./theme-preview-start-runtime";

/**
 * docs/astro-theme-plan.md A6: an Astro Live Preview on the local transport,
 * started through `LocalVitePreviewServer` with the site's framework and the
 * server's switch, as the Worker starts it. `astro dev` runs from the pinned
 * Astro toolchain (`pnpm toolchain:astro`), through Morph's wrapper config
 * and preview Worker entry.
 */
const ASTRO_TOOLCHAIN = path.join(
  process.cwd(),
  "sandbox/toolchains/astro-7.3/node_modules/astro/package.json",
);
const WORKSPACES_ROOT = path.join(process.cwd(), ".morph-previews-astro-test");
const PREVIEW_ID = "astro-local-preview";
const DRAFT = "A6-DRAFT-HEADLINE";

/** A page as an author may write it: a <head>, an SSR read of its content. */
const PAGE = (marker: string) => `---
import Hero from "../components/Hero.astro";
import { heroHeadline } from "../morph/content";
export const prerender = false;
const headline = await heroHeadline(Astro.request, "/");
---
<html><head><title>${marker}</title></head><body><Hero headline={headline} /><p data-marker>${marker}</p></body></html>
`;

const files = astroThemeFiles({
  extra: [{ path: "src/pages/live.astro", content: PAGE("live-v1") }],
});
const previewContent = {
  templates: { index: { slots: { hero: { headline: DRAFT } }, hiddenSlots: [] } },
  pages: {},
};

let server: LocalVitePreviewServer;
let origin = "";

const available = fsSync.existsSync(ASTRO_TOOLCHAIN);

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
    files,
    entry: "",
    previewHostname: "127.0.0.1",
    platformHostEnv: {},
    framework: "astro",
    astroThemes: true,
    previewContent: previewContent as never,
  });
  if (!started.ok) throw new Error(`${started.stage}: ${started.errorMessage}`);
  origin = new URL(started.url).origin;
  expect(started.url).toBe(`${origin}/`);
}, 180_000);

afterAll(async () => {
  await server?.stop(PREVIEW_ID).catch(() => {});
  await fs.rm(WORKSPACES_ROOT, { recursive: true, force: true }).catch(() => {});
}, 60_000);

describe.skipIf(!available)(
  "an Astro Live Preview on the local transport",
  { timeout: 120_000 },
  () => {
    it("answers the address probe with its own id", async () => {
      const probe = await fetch(`${origin}/_morph/preview-health`);
      expect(probe.status).toBe(204);
      expect(probe.headers.get("x-morph-preview-id")).toBe(PREVIEW_ID);
    });

    it("renders the draft content with the editor's scripts first in <head>", async () => {
      const html = await (await fetch(`${origin}/live`)).text();
      expect(html).toContain(DRAFT);
      const head = /<head>([\s\S]*?)<\/head>/.exec(html)?.[1] ?? "";
      expect(head.indexOf(`/${THEME_PREVIEW_START_CLIENT_PATH}`)).toBeGreaterThan(-1);
      expect(head.indexOf(`/${THEME_PREVIEW_START_CLIENT_PATH}`)).toBeLessThan(
        head.indexOf("<title>"),
      );
    });

    it("injects into a page written without a <head>, and into a prerendered one", async () => {
      // The fixture's pages have no <head>, and index.astro is prerendered.
      const html = await (await fetch(`${origin}/`)).text();
      expect(html).toContain(DRAFT);
      expect(html).toContain(`/${THEME_PREVIEW_START_CLIENT_PATH}`);
    });

    it("keeps Miniflare state out of the workspace", () => {
      expect(
        fsSync.existsSync(
          path.join(server.workspaceRootFor(PREVIEW_ID), ".wrangler"),
        ),
      ).toBe(false);
    });

    it("refuses a read outside the workspace", async () => {
      const escaped = await fetch(`${origin}/@fs/etc/passwd`);
      expect(escaped.status).toBeGreaterThanOrEqual(400);
      expect(await escaped.text()).not.toContain("root:");
    });

    it("relays a full reload when an .astro page changes", async () => {
      const cursor = (await (
        await fetch(`${origin}/_morph/hmr?cursor=1`)
      ).json()) as { sequence: number };
      const written = await server.writeFiles(PREVIEW_ID, [
        { path: "src/pages/live.astro", content: PAGE("live-v2") },
      ]);
      expect(written.changed).toEqual(["src/pages/live.astro"]);
      let types: string[] = [];
      for (let attempt = 0; attempt < 20 && !types.includes("full-reload"); attempt++) {
        const relayed = (await (
          await fetch(`${origin}/_morph/hmr?after=${cursor.sequence}`)
        ).json()) as { entries: Array<{ payload: { type: string } }> };
        types = relayed.entries.map((entry) => entry.payload.type);
      }
      expect(types).toContain("full-reload");
      expect(await (await fetch(`${origin}/live`)).text()).toContain("live-v2");
    });
  },
);

describe.skipIf(!available)("without the server's switch", () => {
  it("refuses an Astro site, never previewing it as Start", async () => {
    const refusing = new LocalVitePreviewServer({
      workspacesRoot: WORKSPACES_ROOT,
      toolchainRoot: process.cwd(),
    });
    const started = await refusing.start({
      previewId: "astro-refused",
      files,
      entry: "",
      previewHostname: "127.0.0.1",
      platformHostEnv: {},
      framework: "astro",
    });
    expect(started).toMatchObject({
      ok: false,
      stage: "preview-framework",
      errorMessage: expect.stringMatching(/^THEME_FRAMEWORK_UNAVAILABLE: /),
    });
  });
});
