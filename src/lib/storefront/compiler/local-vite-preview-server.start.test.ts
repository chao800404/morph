// @vitest-environment node
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  NATIVE_COMPAT_COOKIE_HELPER_FILES,
  NATIVE_COMPAT_FILES,
} from "@/lib/storefront/compat/native-compat-theme";
import { STARTER_THEME_FILES } from "@/lib/storefront/starter-theme-files";
import { assertNativeRoutes } from "../compat/assert-native-routes";
import {
  assertCustomServerEntry,
  assertSelectiveRendering,
} from "../compat/assert-native-entry";
import {
  assertAdvancedLoader,
  assertDeferredLoader,
} from "../compat/assert-native-advanced";
import { NATIVE_COMPAT_SERVER_HELPER_FILES } from "../compat/native-compat-server-helper";
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

/**
 * A route reading Morph content the way a hosted Start Theme does: loader →
 * createServerFn → the SDK's Start thin entry, which takes its source from
 * the request the preview Worker forwarded. It renders a media field as an
 * image, so the page shows which URL the thin entry handed back.
 */
const SDK_THIN_ENTRY_ROUTE = {
  path: "src/routes/sdk-thin-entry.tsx",
  content: `import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { morph } from "@morph/sdk/start";

const readHome = createServerFn().handler(async () => {
  const home = await morph.pages.get("/");
  const probe = home["sdk-probe"] ?? {};
  return {
    title: String(probe.title ?? ""),
    hidden: [...home._hidden],
    image: String(probe.image ?? ""),
    gallery: (probe.gallery ?? []).map((item: { src: string }) => String(item.src)),
  };
});

export const Route = createFileRoute("/sdk-thin-entry")({
  loader: () => readHome(),
  component: function SdkThinEntry() {
    const data = Route.useLoaderData();
    return (
      <>
        <p data-sdk="home">{JSON.stringify({ title: data.title, hidden: data.hidden })}</p>
        <img data-sdk="image" src={data.image} alt="" />
        {data.gallery.map((src: string) => <img key={src} data-sdk="gallery" src={src} alt="" />)}
      </>
    );
  },
});
`,
};
const SDK_SNAPSHOT_TITLE = "Draft title from the preview snapshot";
/** Media as Morph's preview snapshot carries it: paths on the page's origin. */
const SDK_SNAPSHOT_IMAGE =
  "/_storefront-media/sdk-probe?version=assets%2Fhero.png";
const SDK_SNAPSHOT_ASSET =
  "/api/store/assets/11111111-1111-1111-1111-111111111111";

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
    platformHostEnv: {},
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
      ...NATIVE_COMPAT_SERVER_HELPER_FILES,
      SDK_THIN_ENTRY_ROUTE,
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
    platformHostEnv: {},
    previewRuntime: "start",
    previewContent: {
      templates: {
        index: {
          slots: {
            "sdk-probe": {
              title: SDK_SNAPSHOT_TITLE,
              image: SDK_SNAPSHOT_IMAGE,
              gallery: [{ src: SDK_SNAPSHOT_ASSET }],
            },
          },
          hiddenSlots: ["sdk-hidden"],
        },
      },
      pages: {},
    },
    loadBinary: async (ref) => {
      const file = NATIVE_COMPAT_PUBLIC_FILES.find(
        (file) =>
          calculateThemeSourceSha256(new TextEncoder().encode(file.content)) ===
          ref.digest,
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
  await fs
    .rm(WORKSPACES_ROOT, { recursive: true, force: true })
    .catch(() => {});
}, 60_000);

const request = (pathname: string, init?: RequestInit) =>
  fetch(origin + pathname, { redirect: "manual", ...init });

describe(
  "the Start Live Preview on the local transport (prototype)",
  { timeout: 120_000 },
  () => {
    it("executes a local .server helper through Start without shipping it to the client", async () => {
      const response = await request("/server-helper");
      expect(response.status).toBe(200);
      const html = await response.text();
      const url = /data-helper-url="([^"]+)"/.exec(html)?.[1];
      expect(url).toBeTruthy();
      const result = await request(url!.replace(/&amp;/g, "&"), {
        headers: { "x-tsr-serverFn": "true" },
      });
      expect(result.status).toBe(200);
      expect(await result.text()).toBe("server-helper-ran");
      const client = await request("/src/routes/server-helper.tsx");
      expect(client.status).toBe(200);
      const javascript = await client.text();
      // Router code-splits the component into a separate module; the route
      // module must still be real transformed JavaScript, not an empty stub.
      expect(javascript).toContain("createFileRoute");
      expect(javascript).not.toContain("private-data.server");
      expect(javascript).not.toContain("MORPH_SERVER_ONLY_BOUNDARY_SENTINEL");
      expect(html).not.toContain("MORPH_SERVER_ONLY_BOUNDARY_SENTINEL");
      const helperClient = await request("/src/private-data.server.ts");
      expect(helperClient.status).toBe(403);
      const helperSource = await helperClient.text();
      expect(helperSource).not.toContain("MORPH_SERVER_ONLY_BOUNDARY_SENTINEL");
      const map =
        /sourceMappingURL=data:application\/json;base64,([^\s]+)/.exec(
          helperSource,
        )?.[1];
      if (map)
        expect(Buffer.from(map, "base64").toString("utf8")).not.toContain(
          "MORPH_SERVER_ONLY_BOUNDARY_SENTINEL",
        );
      for (const path of [
        "/src/private-data.server.ts?raw",
        "/src/private-data.server.ts.map",
        "/src/private-data%2eserver.ts",
      ]) {
        const refused = await request(path);
        expect(refused.status).toBe(403);
        expect(refused.headers.get("cache-control")).toBe("no-store");
        expect(await refused.text()).not.toContain(
          "MORPH_SERVER_ONLY_BOUNDARY_SENTINEL",
        );
      }
    });
    it("preserves raw Response status, headers and binary body from a server function", async () => {
      await assertRawResponse(request);
    });
    it("resolves Theme aliases and renders a custom serialized loader value", async () => {
      await assertAdvancedLoader(request);
    });
    it("executes the Theme server entry and custom stream renderer", async () => {
      await assertCustomServerEntry(request);
    });
    it("honors disabled and data-only route SSR", async () => {
      await assertSelectiveRendering(request);
    });
    it("streams the loader shell before its deferred value is released", async () => {
      await assertDeferredLoader(request);
    });
    it("supports dynamic and splat routes with route and method middleware", async () => {
      await assertNativeRoutes(request);
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
          file.mimeType === "application/xml"
            ? ["application/xml", "text/xml"]
            : [file.mimeType],
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
      expect(html).toContain(
        '<script type="module" src="/__morph_preview_client.ts"></script>',
      );
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
      const page = await (
        await request("/compat-cookies", { headers: { cookie } })
      ).text();
      expect(page).toContain(
        'data-compat="cookie">{&quot;value&quot;:&quot;set&quot;}',
      );
    });

    it("reads the draft snapshot through the SDK's Start thin entry from a loader's server function", async () => {
      const read = async (init?: RequestInit) => {
        const response = await request("/sdk-thin-entry", init);
        const html = (await response.text()).replace(/<!-- -->/g, "");
        return { status: response.status, html };
      };
      const expected = `data-sdk="home">${JSON.stringify({
        title: SDK_SNAPSHOT_TITLE,
        hidden: ["sdk-hidden"],
      }).replace(/"/g, "&quot;")}`;
      const plain = await read();
      expect(plain.status, plain.html.slice(0, 2000)).toBe(200);
      expect(plain.html).toContain(expected);
      // A source named by the caller has no effect: the preview Worker sets
      // the header on every request it forwards.
      const forged = await read({
        headers: { "x-morph-content-origin": "http://127.0.0.1:1" },
      });
      expect(forged.status).toBe(200);
      expect(forged.html).toContain(expected);
      // Media stay the relative paths Morph sent: the content origin the
      // preview Worker names (morph-preview-content.invalid) answers only
      // inside the Worker and must never reach the page.
      for (const { html } of [plain, forged]) {
        expect(html).toContain(`data-sdk="image" src="${SDK_SNAPSHOT_IMAGE}"`);
        expect(html).toContain(
          `data-sdk="gallery" src="${SDK_SNAPSHOT_ASSET}"`,
        );
        expect(html).not.toContain("morph-preview-content.invalid");
        expect(html).not.toMatch(/src="https?:\/\/[^"]*\/_storefront-media\//);
      }
      // The thin entry's request access stays out of the browser's module.
      const client = await request("/src/routes/sdk-thin-entry.tsx");
      expect(client.status).toBe(200);
      const javascript = await client.text();
      expect(javascript).toContain("createFileRoute");
      expect(javascript).not.toContain("@morph/sdk/start");
      expect(javascript).not.toContain(".morph/sdk/start");
    });

    it("renders a loader error through errorComponent with Start's 500", async () => {
      const response = await request("/compat-error");
      expect(response.status).toBe(500);
      expect((await response.text()).replace(/<!-- -->/g, "")).toContain(
        "caught compat-loader-error",
      );
    });
  },
);
