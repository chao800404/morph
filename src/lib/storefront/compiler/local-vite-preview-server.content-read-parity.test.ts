// @vitest-environment node
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CORE_WORKSPACE_PATH,
  astroWorkspaceFiles,
  parityContent,
  readCoreSource,
  renderedHero,
  sha256,
  startWorkspaceFiles,
} from "../theme-framework/content-read-fixtures.test-support";
import { LocalVitePreviewServer } from "./local-vite-preview-server";
import { DEFAULT_APPROVED_DEPENDENCIES } from "./sandbox-vite-theme-build-runner.types";
import { previewContentDigest } from "./theme-preview-content";
import { THEME_PREVIEW_START_CONTENT_ORIGIN } from "./theme-preview-start-runtime";

/**
 * VALIDATION LEVEL: real framework runs. The pure Astro Theme
 * (fixtures/morph/astro-case-a) in a real `astro dev` and the pure Start
 * Theme (fixtures/morph/start-content-read) in a real Start dev server, both
 * Live Previews on the local transport, both reading the same draft through
 * the one TEST PROTOTYPE core (fixtures/morph/content-read-core/core.ts) with
 * their platform wiring. What this proves: each wiring works in its real
 * framework, and the two render the same thing from the same content. Not
 * production Cloudflare, not preview revocation, not Design (no selection,
 * no binding).
 *
 * The Astro Theme has no src/middleware.ts: the wiring's integration adds the
 * middleware with Astro's addMiddleware, through Morph's real wrapper config,
 * import guard and preview Worker entry, none of them changed.
 */
const ASTRO_TOOLCHAIN = path.join(
  process.cwd(),
  "sandbox/toolchains/astro-7.3/node_modules/astro/package.json",
);
const WORKSPACES_ROOT = path.join(process.cwd(), ".morph-previews-content-read-parity-test");
const ASTRO_ID = "content-read-astro";
const START_ID = "content-read-start";

const DRAFT = { title: "PARITY-DRAFT-TITLE", subtitle: "PARITY-DRAFT-SUBTITLE" };
const NEXT = { title: "PARITY-NEXT-TITLE", subtitle: "PARITY-NEXT-SUBTITLE" };
const DEFAULTS = { title: "CASE-A-DEFAULT-TITLE", subtitle: "CASE-A-DEFAULT-SUBTITLE" };

/** A content snapshot as Core writes one: content, ticket and its hash. */
async function snapshot(value: ReturnType<typeof parityContent>, contentTicket: number) {
  return JSON.stringify({
    ...value,
    contentTicket,
    contentHash: await previewContentDigest(JSON.stringify(value)),
  });
}

const available = fsSync.existsSync(ASTRO_TOOLCHAIN);
let astroServer: LocalVitePreviewServer;
let startServer: LocalVitePreviewServer;
const origins = { astro: "", start: "" };

const page = async (framework: keyof typeof origins, pathname: string) => {
  const response = await fetch(`${origins[framework]}${pathname}`);
  return { status: response.status, html: await response.text() };
};

/** The same request to both Themes. */
const both = async (pathname: string) => ({
  astro: await page("astro", pathname),
  start: await page("start", pathname),
});

const servers = () =>
  [
    [astroServer, ASTRO_ID],
    [startServer, START_ID],
  ] as const;

const newServer = () =>
  new LocalVitePreviewServer({
    workspacesRoot: WORKSPACES_ROOT,
    toolchainRoot: process.cwd(),
    approvedDependencies: DEFAULT_APPROVED_DEPENDENCIES,
    readyTimeoutMs: 120_000,
  });

const failure = (started: { stage?: string; errorMessage?: string; logs?: readonly string[] }) =>
  new Error(
    [`${started.stage}: ${started.errorMessage}`, ...(started.logs ?? []).slice(-40)].join("\n"),
  );

beforeAll(async () => {
  if (!available) return;
  await fs.mkdir(WORKSPACES_ROOT, { recursive: true });
  astroServer = newServer();
  startServer = newServer();
  const [astro, start] = await Promise.all([
    astroServer.start({
      previewId: ASTRO_ID,
      files: astroWorkspaceFiles(),
      entry: "",
      previewHostname: "127.0.0.1",
      platformHostEnv: {},
      framework: "astro",
      astroThemes: true,
      previewContent: parityContent(DRAFT) as never,
    }),
    startServer.start({
      previewId: START_ID,
      files: startWorkspaceFiles() as never,
      entry: "src/routes/index.tsx",
      previewHostname: "127.0.0.1",
      platformHostEnv: {},
      previewRuntime: "start",
      previewContent: parityContent(DRAFT) as never,
    }),
  ]);
  if (!astro.ok) throw failure(astro);
  if (!start.ok) throw failure(start);
  origins.astro = new URL(astro.url).origin;
  origins.start = new URL(start.url).origin;
}, 240_000);

afterAll(async () => {
  await astroServer?.stop(ASTRO_ID).catch(() => {});
  await startServer?.stop(START_ID).catch(() => {});
  await fs.rm(WORKSPACES_ROOT, { recursive: true, force: true }).catch(() => {});
}, 60_000);

describe.skipIf(!available)(
  "real runs: the Astro and the Start Theme read the same content through the one core",
  { timeout: 120_000 },
  () => {
    it("runs the core's one file in both workspaces, byte for byte", async () => {
      const expected = sha256(readCoreSource());
      for (const [server, id] of servers()) {
        const onDisk = await fs.readFile(
          path.join(server.workspaceRootFor(id), CORE_WORKSPACE_PATH),
        );
        expect(sha256(onDisk), id).toBe(expected);
      }
    });

    it("read succeeds: both render the draft hero, and the same markup for it", async () => {
      const { astro, start } = await both("/");
      expect(astro.status).toBe(200);
      expect(start.status).toBe(200);
      expect(renderedHero(astro.html)).toEqual(DRAFT);
      expect(renderedHero(start.html)).toEqual(DRAFT);
      expect(astro.html).not.toContain("CASE-A-DEFAULT-");
      expect(start.html).not.toContain("CASE-A-DEFAULT-");
    });

    it("puts neither the content origin nor its header in either page", async () => {
      for (const { html } of Object.values(await both("/"))) {
        expect(html).not.toContain(THEME_PREVIEW_START_CONTENT_ORIGIN);
        expect(html).not.toContain(new URL(THEME_PREVIEW_START_CONTENT_ORIGIN).hostname);
        expect(html.toLowerCase()).not.toContain("x-morph-content-origin");
      }
    });

    it("reads on every request: a newer draft is what both next render", async () => {
      for (const [server, id] of servers()) {
        expect(await server.writeContent(id, await snapshot(parityContent(NEXT), 201))).toEqual({
          applied: true,
          ticket: 201,
        });
      }
      const { astro, start } = await both("/");
      expect(renderedHero(astro.html)).toEqual(NEXT);
      expect(renderedHero(start.html)).toEqual(NEXT);
    });

    it("hidden section: neither renders the stored values, and both render alike", async () => {
      for (const [server, id] of servers()) {
        expect(
          await server.writeContent(id, await snapshot(parityContent(NEXT, { hidden: true }), 202)),
        ).toEqual({ applied: true, ticket: 202 });
      }
      const { astro, start } = await both("/");
      expect(astro.status).toBe(200);
      expect(start.status).toBe(200);
      expect(astro.html).not.toContain("PARITY-NEXT-");
      expect(start.html).not.toContain("PARITY-NEXT-");
      // The current page shape: a hidden section has no values, and the pages
      // spread `hero` as the contract's cases write them, so the component's
      // own defaults show. Not a failed read answered with defaults (the read
      // succeeded); not the end state either, which #187 §4 (the hidden check
      // injected at compile time) is to settle.
      expect(renderedHero(astro.html)).toEqual(DEFAULTS);
      expect(renderedHero(start.html)).toEqual(DEFAULTS);
    });

    it("API refusal: a refused read fails the page in both, never with the component defaults", async () => {
      const astroWritten = await astroServer.writeFiles(ASTRO_ID, [
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
      expect(astroWritten.changed).toEqual(["src/pages/refused.astro"]);
      const startWritten = await startServer.writeFiles(START_ID, [
        {
          path: "src/routes/refused.tsx",
          content: `import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import Hero from "../components/Hero";
import { morph } from "../morph/content";

const getRefused = createServerFn().handler(() => morph.pages.get("no-leading-slash"));

export const Route = createFileRoute("/refused")({
  loader: () => getRefused(),
  component: Refused,
});

function Refused() {
  const { hero } = Route.useLoaderData();
  return <Hero {...hero} />;
}
`,
        },
      ]);
      expect(startWritten.changed).toEqual(["src/routes/refused.tsx"]);
      for (const framework of ["astro", "start"] as const) {
        let result = await page(framework, "/refused");
        for (let attempt = 0; attempt < 40 && result.status === 404; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          result = await page(framework, "/refused");
        }
        expect(result.status, framework).toBe(500);
        // Each dev server's error page names the core's refusal, not another
        // failure: the words of invalid_path.
        expect(result.html, framework).toContain(
          "A page path starts with / and is at most 500 characters.",
        );
        expect(result.html, framework).not.toContain("CASE-A-DEFAULT-");
        expect(result.html, framework).not.toContain("data-case-a-hero");
      }
    });
  },
);
