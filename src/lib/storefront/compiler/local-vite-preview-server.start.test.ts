// @vitest-environment node
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  NATIVE_COMPAT_COOKIE_HELPER_FILES,
  NATIVE_COMPAT_FILES,
} from "@/lib/storefront/compat/native-compat-theme";
import { STARTER_THEME_FILES } from "@/lib/storefront/starter-theme-files";
import { NATIVE_COMPAT_PUBLIC_FILES } from "../compat/native-compat-public-files";
import {
  assertRawResponse,
  assertMultipart,
  assertByteStreaming,
} from "../compat/assert-native-transport";
import { calculateThemeSourceSha256 } from "../storage/cloudflare-r2-theme-source-blob-store";

import { LocalVitePreviewServer } from "./local-vite-preview-server";
import { DEFAULT_APPROVED_DEPENDENCIES } from "./sandbox-vite-theme-build-runner.types";

/**
 * PROTOTYPE: the Start Live Preview on the local transport (the one CI runs),
 * against a real Vite dev server running Start's server in workerd.
 *
 * The same Theme files as `native-compat.test.ts`, which checks the built
 * Worker; here the preview answers the same requests the same way.
 */

const WORKSPACES_ROOT = path.join(process.cwd(), ".morph-previews-start-test");
const PREVIEW_ID = "start-preview-test";
let server: LocalVitePreviewServer;
let origin = "";

beforeAll(async () => {
  await fs.mkdir(WORKSPACES_ROOT, { recursive: true });
  server = new LocalVitePreviewServer({
    workspacesRoot: WORKSPACES_ROOT,
    toolchainRoot: process.cwd(),
    approvedDependencies: DEFAULT_APPROVED_DEPENDENCIES,
    readyTimeoutMs: 120_000,
  });
  // A first start without `src/start.ts`, replaced by one with it: in one
  // process the Cloudflare plugin kept the first Worker's module runner, and
  // the request middleware below never ran. Each start now has its process.
  const first = await server.start({
    previewId: PREVIEW_ID,
    files: [...STARTER_THEME_FILES] as never,
    entry: "src/routes/index.tsx",
    previewHostname: "127.0.0.1",
    env: {},
    previewRuntime: "start",
  });
  if (!first.ok) throw new Error(`${first.stage}: ${first.errorMessage}`);
  expect((await fetch(first.url)).status).toBe(200);

  const started = await server.start({
    previewId: PREVIEW_ID,
    files: [
      ...STARTER_THEME_FILES,
      ...NATIVE_COMPAT_FILES,
      ...NATIVE_COMPAT_COOKIE_HELPER_FILES,
      ...NATIVE_COMPAT_PUBLIC_FILES.map((file) => {
        const bytes = new TextEncoder().encode(file.content);
        return {
          path: file.path,
          binary: {
            digest: calculateThemeSourceSha256(bytes),
            sizeBytes: bytes.byteLength,
          },
        };
      }),
    ] as never,
    entry: "src/routes/index.tsx",
    previewHostname: "127.0.0.1",
    env: {},
    previewRuntime: "start",
    loadBinary: async (ref) => {
      const file = NATIVE_COMPAT_PUBLIC_FILES.find(
        (file) => calculateThemeSourceSha256(new TextEncoder().encode(file.content)) === ref.digest,
      );
      if (!file) throw new Error("Missing fixture blob");
      return new TextEncoder().encode(file.content);
    },
  });
  if (!started.ok) throw new Error(`${started.stage}: ${started.errorMessage}`);
  const url = new URL(started.url);
  expect(url.pathname).toBe("/");
  origin = url.origin;
}, 180_000);

afterAll(async () => {
  await server?.stop(PREVIEW_ID).catch(() => {});
  await fs.rm(WORKSPACES_ROOT, { recursive: true, force: true }).catch(() => {});
}, 60_000);

const request = (pathname: string, init?: RequestInit) =>
  fetch(origin + pathname, { redirect: "manual", ...init });

describe("the Start Live Preview on the local transport (prototype)", { timeout: 120_000 }, () => {
  it("preserves raw Response status, headers and binary body from a server function", async () => {
    await assertRawResponse(request);
  });
  it("delivers the first server-function stream bytes before releasing the remainder", async () => {
    await assertByteStreaming(request);
  });
  it("accepts POST FormData fields and a binary file through a server function", async () => {
    await assertMultipart(request);
  });
  it("serves data public files byte-for-byte with their format MIME types", async () => {
    for (const file of NATIVE_COMPAT_PUBLIC_FILES) {
      const response = await request(file.path.slice("public".length));
      expect(response.status, file.path).toBe(200);
      // Vite's static middleware uses text/xml; artifacts use application/xml.
      // Accept the two XML MIME types, never an HTML/octet-stream fallback.
      const mime = response.headers.get("content-type")?.split(";")[0];
      expect(
        file.mimeType === "application/xml" ? ["application/xml", "text/xml"] : [file.mimeType],
        file.path,
      ).toContain(mime);
      expect(new Uint8Array(await response.arrayBuffer()), file.path).toEqual(
        new TextEncoder().encode(file.content),
      );
    }
  });
  it("server-renders a loader calling a server function, with request middleware", async () => {
    const response = await request("/compat");
    expect(response.status).toBe(200);
    expect(response.headers.get("x-compat-request-mw")).toBe("1");
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
    // The preview's own scripts are added to the document, first in <head>.
    expect(html).toContain('<script type="module" src="/__morph_preview_client.ts"></script>');
  });

  it("answers server routes and redirects as the built Worker does", async () => {
    const get = await request("/api/compat?q=hi");
    expect(get.headers.get("x-compat-request-mw")).toBe("1");
    expect(await get.json()).toEqual({ ok: true, method: "GET", q: "hi" });
    const moved = await request("/api/compat-redirect");
    expect(moved.status).toBe(302);
    expect(moved.headers.get("location")).toBe("/compat-other");
    const robots = await request("/robots.txt");
    expect(robots.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(await robots.text()).toBe("User-agent: *\nAllow: /\n");
    const beforeLoad = await request("/compat-redirect");
    expect(beforeLoad.status).toBeGreaterThanOrEqual(300);
    expect(beforeLoad.headers.get("location")).toContain("/compat-other");
  });

  it("round-trips an HttpOnly cookie through Start's cookie helpers", async () => {
    const first = await request("/api/compat-cookie");
    const setCookie = first.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/^compat_helper=set;/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(await first.json()).toEqual({ before: null });
    const cookie = setCookie.split(";")[0]!;
    const second = await request("/api/compat-cookie", {
      headers: { cookie },
    });
    expect(await second.json()).toEqual({ before: "set" });
    const page = await (await request("/compat-cookies", { headers: { cookie } })).text();
    expect(page).toContain('data-compat="cookie">{&quot;value&quot;:&quot;set&quot;}');
  });

  it("renders a loader error through errorComponent with Start's 500", async () => {
    const response = await request("/compat-error");
    expect(response.status).toBe(500);
    expect((await response.text()).replace(/<!-- -->/g, "")).toContain(
      "caught compat-loader-error",
    );
  });
});
