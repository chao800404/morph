// @vitest-environment node
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { astroThemeFiles } from "../theme-framework/astro-native-prerender.fixtures";
import { LocalVitePreviewServer } from "./local-vite-preview-server";
import { DEFAULT_APPROVED_DEPENDENCIES } from "./sandbox-vite-theme-build-runner.types";
import { THEME_PREVIEW_START_CLIENT_PATH } from "./theme-preview-start-runtime";
import { previewContentDigest } from "./theme-preview-content";

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

/** A content snapshot as Core writes one: content, ticket and its hash. */
async function snapshot(headline: string, contentTicket: number) {
  const content = {
    templates: { index: { slots: { hero: { headline } }, hiddenSlots: [] } },
    pages: {},
  };
  return JSON.stringify({
    ...content,
    contentTicket,
    contentHash: await previewContentDigest(JSON.stringify(content)),
  });
}

/** Which A6B marker the server-rendered page shows now. */
async function shown() {
  const html = await (await fetch(`${origin}/live`)).text();
  return /A6B-[A-Z]/.exec(html)?.[0] ?? null;
}

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
  if (!started.ok) {
    // The dev server's own last lines say which part of it failed.
    throw new Error(
      [
        `${started.stage}: ${started.errorMessage}`,
        ...(started.logs ?? []).slice(-40),
      ].join("\n"),
    );
  }
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

    // docs/astro-theme-plan.md 6.5: draft content reaches the server-rendered
    // page as a ticketed snapshot, confirmed through the Worker before a
    // page may reload; a late older one never replaces a newer one.
    it("keeps the newest content snapshot, whatever order they arrive in", async () => {

      // A, then C; B, taken between them, arrives last.
      expect(await server.writeContent(PREVIEW_ID, await snapshot("A6B-A", 101))).toEqual({
        applied: true,
        ticket: 101,
      });
      expect(await shown()).toBe("A6B-A");
      expect(await server.writeContent(PREVIEW_ID, await snapshot("A6B-C", 103))).toEqual({
        applied: true,
        ticket: 103,
      });
      expect(await shown()).toBe("A6B-C");
      expect(await server.writeContent(PREVIEW_ID, await snapshot("A6B-B", 102))).toEqual({
        applied: false,
        reason: "PREVIEW_CONTENT_SUPERSEDED",
        ticket: 103,
      });
      // Every reload after it: C, never back to A or B.
      for (let reload = 0; reload < 5; reload++) {
        expect(await shown()).toBe("A6B-C");
      }

      // A start read before C, landing after it, leaves C — this transport
      // lays a start with other content out again, and the newer snapshot
      // on disk is kept; one read after C replaces it.
      const restart = async (headline: string, contentTicket: number) => {
        const started = await server.start({
          previewId: PREVIEW_ID,
          files: astroThemeFiles({
            extra: [{ path: "src/pages/live.astro", content: PAGE("live-v2") }],
          }),
          entry: "",
          previewHostname: "127.0.0.1",
          platformHostEnv: {},
          framework: "astro",
          astroThemes: true,
          previewContent: JSON.parse(await snapshot(headline, contentTicket)),
        });
        expect(started).toMatchObject({ ok: true });
        // Laid out again, it listens on a port of its own.
        if (started.ok) origin = new URL(started.url).origin;
      };
      await restart("A6B-A", 102);
      expect(await shown()).toBe("A6B-C");
      await restart("A6B-D", 104);
      await expect.poll(shown, { timeout: 10_000 }).toBe("A6B-D");
    });

    // docs/astro-theme-plan.md 6.6: one ticket names one content, and only
    // the dev server a snapshot was written to may confirm it.
    it("confirms a resend of the same snapshot, and refuses its ticket with other content", async () => {
      // D (104) is what the preview holds after the test above.
      expect(await server.writeContent(PREVIEW_ID, await snapshot("A6B-D", 104))).toEqual({
        applied: true,
        ticket: 104,
      });
      expect(await server.writeContent(PREVIEW_ID, await snapshot("A6B-E", 104))).toEqual({
        applied: false,
        reason: "PREVIEW_CONTENT_TICKET_CONFLICT",
        ticket: 104,
      });
      expect(await shown()).toBe("A6B-D");
    });

    it("is confirmed only by the dev server it was written to", async () => {
      const contentFile = path.join(
        server.workspaceRootFor(PREVIEW_ID),
        ".morph-preview-content.json",
      );
      // F (105) as another server wrote it: the Worker now reads a file that
      // names that server. A resend of F is the same write, and its report
      // is about another server, so it confirms nothing.
      const f = await snapshot("A6B-F", 105);
      await fs.writeFile(
        contentFile,
        JSON.stringify({ ...JSON.parse(f), previewInstance: "an-earlier-server" }),
      );
      await expect.poll(shown, { timeout: 10_000 }).toBe("A6B-F");
      expect(
        await server.writeContent(PREVIEW_ID, f, { confirmTimeoutMs: 3_000 }),
      ).toMatchObject({ applied: false, reason: "PREVIEW_CONTENT_NOT_CONFIRMED" });
      // Written by this server's transport, stamped with this server: G is
      // confirmed.
      expect(
        await server.writeContent(PREVIEW_ID, await snapshot("A6B-G", 106)),
      ).toEqual({ applied: true, ticket: 106 });
      expect(await shown()).toBe("A6B-G");
    });

    it("confirms a ticket it holds without writing, and not one it does not", async () => {
      // G (106) is what the preview holds after the tests above.
      expect(await server.confirmContent(PREVIEW_ID, 106)).toEqual({
        applied: true,
        ticket: 106,
      });
      expect(
        await server.confirmContent(PREVIEW_ID, 999, { confirmTimeoutMs: 1_000 }),
      ).toEqual({ applied: false, reason: "PREVIEW_CONTENT_NOT_CONFIRMED", ticket: 106 });
      expect(await shown()).toBe("A6B-G");
    });

    it("refuses a snapshot without a ticket, or whose hash is not its content's", async () => {
      await expect(
        server.writeContent(
          PREVIEW_ID,
          JSON.stringify({ templates: {}, pages: {} }),
        ),
      ).rejects.toThrow(/^PREVIEW_CONTENT_INVALID: /);
      const forged = JSON.parse(await snapshot("A6B-H", 107));
      forged.templates.index.slots.hero.headline = "A6B-I";
      await expect(
        server.writeContent(PREVIEW_ID, JSON.stringify(forged)),
      ).rejects.toThrow(/^PREVIEW_CONTENT_INVALID: .*hash/);
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
