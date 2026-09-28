// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unstable_startWorker } from "wrangler";

import {
  NATIVE_COMPAT_COOKIE_HELPER_FILES,
  NATIVE_COMPAT_FILES,
} from "@/lib/storefront/compat/native-compat-theme";
import { STARTER_THEME_FILES } from "@/lib/storefront/starter-theme-files";

import { LocalViteThemeBuildRunner } from "./local-vite-theme-build-runner";
import { buildThemeRouteRegistry } from "./theme-route-registry";
import type { ThemeBuildRunnerInput } from "./theme-build-runner.types";

/**
 * TanStack Start behaviour of a built Theme, in the Worker its build produces.
 *
 * The Theme is the starter plus ordinary Start code (`native-compat-theme.ts`).
 * The claim under test is that a Theme behaves like the same source in a plain
 * Start app on Cloudflare Workers, so the assertions are Start's own behaviour,
 * not Morph's. This covers the built Worker only; Live Preview and the
 * published storefront through Morph Core are covered end to end.
 *
 * A `KNOWN GAP` test asserts that a gap still exists. It fails the moment the
 * gap is closed, so whoever closes it has to turn it into an ordinary test
 * rather than leave a claim about the product that is no longer true.
 */

const BUILD_BUDGET_MS = 240_000;

const input = (
  files: ThemeBuildRunnerInput["files"],
  buildId: string,
): ThemeBuildRunnerInput => ({
  buildId,
  storefrontId: "storefront-compat",
  themeId: "theme-compat",
  sourceRevisionId: `rev-${buildId}`,
  revisionNumber: 1,
  entry: "src/routes/index.tsx",
  inputHash: "c".repeat(64),
  compilerId: "tailwind-v4-build",
  compilerVersion: "4.1.17",
  files,
});

const THEME_FILES = [...STARTER_THEME_FILES, ...NATIVE_COMPAT_FILES];

describe("a Theme's TanStack Start routes, as Code mode reads them", () => {
  it("accepts pages, server routes and a dotted route file without diagnostics", () => {
    const registry = buildThemeRouteRegistry(THEME_FILES as never);
    expect(registry.diagnostics).toEqual([]);
    expect(registry.valid).toBe(true);
    const paths = registry.routes.map((route) => route.fullPath);
    for (const path of [
      "/compat",
      "/compat-other",
      "/compat-redirect",
      "/compat-error",
      "/api/compat",
      "/api/compat-redirect",
      "/robots.txt",
    ]) {
      expect(paths).toContain(path);
    }
  });
});

describe(
  "a built Theme's TanStack Start behaviour in its Worker",
  { timeout: BUILD_BUDGET_MS + 60_000 },
  () => {
    let dir = "";
    let worker: Awaited<ReturnType<typeof unstable_startWorker>> | null = null;

    beforeAll(async () => {
      const result = await new LocalViteThemeBuildRunner({
        maxDurationMs: BUILD_BUDGET_MS,
      }).run(input(THEME_FILES as never, "native-compat"));
      if (!result.success) throw new Error(result.errorMessage);

      dir = mkdtempSync(join(tmpdir(), "native-compat-"));
      for (const artifact of result.artifacts) {
        const path = join(dir, artifact.path);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, artifact.content as Uint8Array | string);
      }
      // The build writes the Worker's own config beside its entry; that is
      // what a deployment starts from.
      worker = await unstable_startWorker({
        config: join(dir, "runtime/server/wrangler.json"),
        dev: { server: { port: 0 }, inspector: false, logLevel: "error" },
      });
      await worker.ready;
    }, BUILD_BUDGET_MS + 60_000);

    afterAll(async () => {
      await worker?.dispose();
      if (dir) rmSync(dir, { recursive: true, force: true });
    });

    type WorkerInit = Parameters<
      Awaited<ReturnType<typeof unstable_startWorker>>["fetch"]
    >[1];
    const request = (path: string, init?: WorkerInit) =>
      worker!.fetch(`http://localhost${path}`, { redirect: "manual", ...init });
    const visibleText = (html: string) =>
      html
        .replace(/<script[\s\S]*?<\/script>/g, "")
        .replace(/<!-- -->/g, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ");

    it("server-renders a page whose loader calls a GET server function through function middleware", async () => {
      const response = await request("/compat");
      expect(response.status).toBe(200);
      const html = await response.text();
      const loaded = JSON.parse(
        /data-compat="loader">([^<]*)</.exec(html)![1]!.replace(/&quot;/g, '"'),
      );
      expect(loaded).toEqual({
        greeting: "hello loader",
        middleware: "fn-mw-ok",
        ranOnServer: true,
        method: "GET",
      });
      // A conditional branch and a list, rendered on the server.
      expect(visibleText(html)).toContain("server-rendered-branch");
      expect(visibleText(html)).toContain("alpha beta");
    });

    it("runs global request middleware from src/start.ts on pages and server routes", async () => {
      for (const path of ["/compat", "/api/compat"]) {
        const response = await request(path);
        expect(response.headers.get("x-compat-request-mw"), path).toBe("1");
      }
    });

    it("answers server routes: JSON GET and POST, a redirect, and plain text", async () => {
      const get = await request("/api/compat?q=hi");
      expect(get.status).toBe(200);
      expect(await get.json()).toEqual({ ok: true, method: "GET", q: "hi" });

      const post = await request("/api/compat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hello: "world" }),
      });
      expect(await post.json()).toEqual({
        ok: true,
        method: "POST",
        body: { hello: "world" },
      });

      const moved = await request("/api/compat-redirect");
      expect(moved.status).toBe(302);
      expect(moved.headers.get("location")).toBe("/compat-other");

      const robots = await request("/robots.txt");
      expect(robots.status).toBe(200);
      expect(robots.headers.get("content-type")).toMatch(/^text\/plain/);
      expect(await robots.text()).toBe("User-agent: *\nAllow: /\n");
    });

    it("redirects from beforeLoad during SSR", async () => {
      const response = await request("/compat-redirect");
      expect(response.status).toBeGreaterThanOrEqual(300);
      expect(response.status).toBeLessThan(400);
      expect(response.headers.get("location")).toContain("/compat-other");
    });

    it("renders a loader error through the route's errorComponent, with Start's 500", async () => {
      const response = await request("/compat-error");
      expect(response.status).toBe(500);
      expect(visibleText(await response.text())).toContain(
        "caught compat-loader-error",
      );
    });
  },
);

describe(
  "a Theme using Start's cookie helpers",
  { timeout: BUILD_BUDGET_MS + 60_000 },
  () => {
    // A plain Start app builds this. When it builds here too, replace this with
    // a test that it builds and that the helpers work in the Worker.
    it("KNOWN GAP: fails the whole build, because the preview stub lacks getCookie", async () => {
      const result = await new LocalViteThemeBuildRunner({
        maxDurationMs: BUILD_BUDGET_MS,
      }).run(
        input(
          [...THEME_FILES, ...NATIVE_COMPAT_COOKIE_HELPER_FILES] as never,
          "native-compat-cookies",
        ),
      );
      // Every Theme build also runs the client-only preview build, and its
      // stand-in for `@tanstack/react-start/server` has no cookie helpers.
      expect(result.success).toBe(false);
      expect(result.success ? "" : result.errorMessage).toMatch(
        /"getCookie" is not exported by "\u0000morph-theme-start-server-stub"/,
      );
    });
  },
);
