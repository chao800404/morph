// @vitest-environment node
import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unstable_startWorker } from "wrangler";
import { STARTER_THEME_FILES } from "@/lib/storefront/starter-theme-files";
import { startCorePublicEntry } from "@/lib/storefront/service/core-public-entry.test-support";
import type { PublishedDocument } from "@/lib/storefront/service/storefront-content-runtime";
import { NATIVE_WRANGLER_CONFIG_PATH } from "./tanstack-start-native-build";
import { checkNativeWranglerConfig } from "./cloudflare-native-build";
import {
  NATIVE_PROOF_VERSION,
  nativeSdkSentinel,
  readNativeBuildProof,
} from "./native-start-proof";
import { THEME_MORPH_SDK_MODULES } from "@/lib/storefront/compiler/theme-morph-sdk";
import { THEME_START_TOOLCHAIN } from "@/lib/storefront/compiler/theme-start-toolchain";
import { themeFramework } from ".";
import { NATIVE_START_COMPILER_ID } from "./tanstack-start-native-build";
import { planThemeWorkerDeployment } from "@/lib/storefront/service/theme-worker-deployment-plan";
import type { CanonicalThemeBuildManifest } from "@/lib/storefront/compiler/theme-build-artifact-store.types";

/** The build pass's nonce, as a runner would give it. */
const NONCE = "0f1e2d3c4b5a69788796a5b4c3d2e1f0";

/**
 * Two releases' published content. Release A's author replaced the hero
 * heading and hid the newsletter section and the footer; release B differs
 * in each, so a page shows which release it read.
 */
const RELEASE_CONTENT: Record<
  string,
  { index: PublishedDocument; layout: PublishedDocument }
> = {
  pub_A: {
    index: {
      sections: [
        { id: "starter-hero", props: { heading: "release-a-heading" } },
        { id: "starter-newsletter", enabled: false, props: {} },
      ],
    },
    layout: { sections: [{ id: "starter-footer", enabled: false, props: {} }] },
  },
  pub_B: {
    index: {
      sections: [{ id: "starter-hero", props: { heading: "release-b-heading" } }],
    },
    layout: {
      sections: [{ id: "starter-footer", props: { storeName: "release-b-store" } }],
    },
  },
};

/**
 * A TanStack Start project built with its own configuration, end to end:
 * Morph's plan, the project's own `vite build` with the pinned toolchain, the
 * output moved into Morph's artifact layout, and the Worker answering from it.
 *
 * The project is the starter Theme written the way the official Start
 * Cloudflare example is: its own vite.config.ts and wrangler.jsonc.
 */
const VITE_CONFIG = `import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
});
`;
const WRANGLER = `{
  // The author's own deployment config.
  "name": "native-starter",
  "compatibility_date": "2025-09-02",
  "compatibility_flags": ["nodejs_compat"],
  "main": "@tanstack/react-start/server-entry",
  "observability": { "enabled": true },
  // Local-only settings: stripped from the copy the build reads.
  "dev": { "port": 8788 },
}
`;
const BUILD_BUDGET_MS = 180_000;

/**
 * A route reading content through the SDK's Start thin entry: loader ->
 * createServerFn -> `morph.pages.get("/")`, from whichever origin the request
 * names in x-morph-content-origin, as Core names it on the public site. Not
 * prerendered: it is read per request. A media field is rendered as an
 * image, so the page shows which URL the thin entry handed back.
 */
const SDK_ROUTE = {
  path: "src/routes/sdk-thin-entry.tsx",
  content: `import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { morph } from "@morph/sdk/start";

const readHome = createServerFn().handler(async () => {
  const home = await morph.pages.get("/");
  return {
    title: String(home["sdk-probe"]?.title ?? ""),
    image: String(home["sdk-probe"]?.image ?? ""),
  };
});

export const Route = createFileRoute("/sdk-thin-entry")({
  loader: () => readHome(),
  component: function SdkThinEntry() {
    const data = Route.useLoaderData();
    return (
      <>
        <p data-sdk="home">{data.title}</p>
        <img data-sdk="image" src={data.image} alt="" />
      </>
    );
  },
});
`,
};
/** Page media as Core sends it: a path on the public site's own origin. */
const SDK_IMAGE = "/_storefront-media/sdk-probe?version=assets%2Fhero.png";

/** A content service on loopback answering every page with its own name. */
async function contentStore(name: string, delayMs: number) {
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://store.invalid");
    if (url.pathname !== "/_morph/content") {
      res.statusCode = 404;
      res.end();
      return;
    }
    setTimeout(() => {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          slots: { "sdk-probe": { title: name, image: SDK_IMAGE } },
          hiddenSlots: [],
        }),
      );
    }, delayMs);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { origin: "http://127.0.0.1:" + port, close: () => server.close() };
}

function walk(root: string, dir = root): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.name === "node_modules") return [];
    return entry.isDirectory() ? walk(root, full) : [relative(root, full)];
  });
}

describe("a TanStack Start project built with its own configuration", () => {
  let workspace = "";
  let artifactDir = "";
  let worker: Awaited<ReturnType<typeof unstable_startWorker>> | null = null;
  let serverWranglerConfig: Record<string, unknown> = {};
  let workerSource = "";
  let nativeProof: unknown;
  let records: Record<string, Record<string, unknown>> = {};

  beforeAll(async () => {
    const inputs = [
      ...STARTER_THEME_FILES,
      SDK_ROUTE,
      { path: "vite.config.ts", content: VITE_CONFIG },
      { path: "wrangler.jsonc", content: WRANGLER },
    ];
    const plan = themeFramework().build.native.plan(inputs, { nonce: NONCE });
    if (!plan.ok) throw new Error(plan.message);

    workspace = mkdtempSync(join(tmpdir(), "native-start-build-"));
    for (const file of plan.workspaceFiles) {
      // Morph's copy carries something the author's config does not, so the
      // build output shows which config the plugin read.
      const content =
        file.path === NATIVE_WRANGLER_CONFIG_PATH
          ? JSON.stringify({
              ...JSON.parse(file.content),
              vars: { CONFIG_PROBE: "used" },
            })
          : file.content;
      mkdirSync(dirname(join(workspace, file.path)), { recursive: true });
      writeFileSync(join(workspace, file.path), content);
    }
    // The pinned toolchain, the same packages Morph's own builds resolve.
    symlinkSync(
      join(process.cwd(), "node_modules"),
      join(workspace, "node_modules"),
    );

    const [command, ...args] = plan.command;
    expect(command).toBe("vite");
    execFileSync(process.execPath, ["node_modules/vite/bin/vite.js", ...args], {
      cwd: workspace,
      env: { ...process.env, ...plan.env },
      stdio: "pipe",
      timeout: BUILD_BUDGET_MS,
    });

    const outputs = new Map(
      walk(workspace).map((path) => [
        path,
        readFileSync(join(workspace, path)),
      ]),
    );
    const artifact = themeFramework().build.native.collect(
      new Map(
        [...outputs].map(([path, bytes]) => [path, new Uint8Array(bytes)]),
      ),
      NONCE,
      inputs,
    );
    nativeProof = artifact.metadata?.nativeProof;
    records = Object.fromEntries(
      [...outputs]
        .filter(([path]) => path.startsWith(".morph/records/resolution."))
        .map(([path, bytes]) => [path, JSON.parse(bytes.toString("utf8"))]),
    );

    artifactDir = mkdtempSync(join(tmpdir(), "native-start-artifact-"));
    for (const [path, content] of artifact.files) {
      mkdirSync(dirname(join(artifactDir, path)), { recursive: true });
      writeFileSync(join(artifactDir, path), content);
    }
    serverWranglerConfig = JSON.parse(
      readFileSync(join(artifactDir, "runtime/server/wrangler.json"), "utf8"),
    );
    workerSource = walk(join(artifactDir, "runtime/server"))
      .filter((path) => path.endsWith(".js"))
      .map((path) =>
        readFileSync(join(artifactDir, "runtime/server", path), "utf8"),
      )
      .join("\n");
    expect(artifact.workerEntry).toBe("runtime/server/index.js");

    // Started the way a release starts: from the Worker's own config.
    worker = await unstable_startWorker({
      config: join(artifactDir, "runtime/server/wrangler.json"),
      dev: { server: { port: 0 }, inspector: false, logLevel: "error" },
    });
    await worker.ready;
  }, BUILD_BUDGET_MS + 60_000);

  afterAll(async () => {
    await worker?.dispose();
    for (const dir of [workspace, artifactDir]) {
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  const request = (path: string) =>
    worker!.fetch(`http://localhost${path}`, { redirect: "manual" });

  it("built with Morph's copy of the Wrangler config", () => {
    expect(serverWranglerConfig).toMatchObject({
      name: "native-starter",
      vars: { CONFIG_PROBE: "used" },
      main: "index.js",
      assets: { directory: "../client" },
      // Kept by the Wrangler key contract, as the plugin wrote it.
      observability: { enabled: true },
    });
    // The collector held the plugin's output to the contract's emitted
    // shape; the deploy plan checks it again.
    expect(
      checkNativeWranglerConfig(serverWranglerConfig, {
        shape: "emitted",
        file: "runtime/server/wrangler.json",
      }),
    ).toBeNull();
  });

  it("proves @morph/sdk resolved to Morph's copy in each environment, from the records and the bytes", () => {
    // One record per environment the build ran, each from this pass.
    expect(Object.keys(records).sort()).toEqual([
      ".morph/records/resolution.client.json",
      ".morph/records/resolution.ssr.json",
    ]);
    for (const record of Object.values(records)) {
      expect(record.nonce).toBe(NONCE);
      expect(record.vite).toBe(THEME_START_TOOLCHAIN.vite);
    }
    const proof = readNativeBuildProof(nativeProof);
    expect(proof).not.toBeNull();
    expect(proof!.version).toBe(NATIVE_PROOF_VERSION);
    expect(proof!.toolchain).toEqual({ vite: THEME_START_TOOLCHAIN.vite });
    expect(proof!.html).toEqual([]);
    const ssr = proof!.sdk.environments.find((entry) => entry.output === "server");
    const client = proof!.sdk.environments.find(
      (entry) => entry.output === "client",
    );
    expect(ssr).toMatchObject({ name: "ssr" });
    expect(client).toMatchObject({ name: "client" });
    // The route's `@morph/sdk/start` and the Starter's own content module
    // reach the Worker through Morph's copy, and its sentinel is in the
    // Worker's code.
    expect(ssr!.specifiers).toContain("@morph/sdk/start");
    expect(ssr!.edges).toBeGreaterThan(0);
    expect(ssr!.sentinelFiles.length).toBeGreaterThan(0);
    expect(workerSource).toContain(nativeSdkSentinel(NONCE, "@morph/sdk/start"));
    // Every edge either graph records resolved to the file its name maps to.
    for (const record of Object.values(records)) {
      for (const edge of record.edges as Array<{
        specifier: string;
        resolved: { path?: string };
      }>) {
        expect(edge.resolved.path).toBe(
          THEME_MORPH_SDK_MODULES[edge.specifier],
        );
      }
    }
  });

  it("ships none of the editor's markers", () => {
    expect(workerSource.length).toBeGreaterThan(0);
    expect(workerSource).not.toMatch(/data-morph-(node|section|loc)/);
  });

  it("serves the starter's pages through Core's public entry, with the content of the release each request resolved", async () => {
    // The active release moves from A to B as soon as a page request has
    // resolved it, the way a publish can land mid-render, so a page that shows
    // A read the release its request pinned.
    const core = await startCorePublicEntry(
      {
        // Wrangler's fetch has its own Request/Response types; the values are
        // the same Fetch objects.
        fetch: (forwarded) =>
          worker!.fetch(forwarded.url, {
            method: forwarded.method,
            headers: Object.fromEntries(forwarded.headers),
            redirect: "manual",
          }) as unknown as Promise<Response>,
      },
      {
        releases: {
          pub_A: RELEASE_CONTENT.pub_A!,
          pub_B: RELEASE_CONTENT.pub_B!,
        },
        activeOrder: ["pub_A", "pub_B"],
      },
    );
    try {
      for (const path of ["/", "/account", "/order-transfer"]) {
        core.reset();
        const response = await fetch(core.origin + path, { redirect: "manual" });
        const html = await response.text();
        expect(response.status, `${path}: ${html.slice(0, 1000)}`).toBe(200);
        expect(response.headers.get("content-type"), path).toContain(
          "text/html",
        );
        // Release A's layout: its author hid the footer.
        expect(html, path).not.toContain("<footer");
        expect(html, path).not.toContain("© Online Store");
        expect(html, path).not.toContain("release-b-store");
        if (path === "/") {
          expect(html).toContain("release-a-heading");
          expect(html).not.toContain("release-b-heading");
          expect(html).not.toContain("Objects for everyday rituals.");
          expect(html).not.toContain("Join our newsletter");
        }
      }
      // Every read was answered from release A, though B went live after
      // each page request resolved.
      expect(core.contentReads.length).toBeGreaterThan(0);
      expect(core.contentReads.every((read) => read.startsWith("pub_A:"))).toBe(
        true,
      );
    } finally {
      core.close();
    }
  });

  it("refuses a page request that reaches the Worker with no content source, rendering no defaults", async () => {
    // The Worker called directly, as nothing but Core should: no
    // x-morph-content-origin. The read fails; nothing is shown as published.
    for (const path of ["/", "/account", "/order-transfer"]) {
      const response = await request(path);
      const html = await response.text();
      expect(response.status, path).toBeGreaterThanOrEqual(500);
      expect(html, path).not.toContain("Objects for everyday rituals.");
      expect(html, path).not.toContain("<footer");
      expect(html, path).not.toContain("© Online Store");
      expect(html, path).toContain("No content source.");
    }
  });

  it("answers an unknown page with 404", async () => {
    expect((await request("/no-such-page")).status).toBe(404);
  });

  it("reads each request's own content origin through the SDK's Start thin entry", async () => {
    // The slow store answers after the fast one: the first request is still
    // waiting on its read while the second is served completely.
    const slow = await contentStore("from-slow-store", 300);
    const fast = await contentStore("from-fast-store", 0);
    try {
      const read = async (headers: Record<string, string>) => {
        const response = await worker!.fetch(
          "http://localhost/sdk-thin-entry",
          {
            redirect: "manual",
            headers,
          },
        );
        return { status: response.status, html: await response.text() };
      };
      const [a, b] = await Promise.all([
        read({ "x-morph-content-origin": slow.origin }),
        read({ "x-morph-content-origin": fast.origin }),
      ]);
      expect(a.status, a.html.slice(0, 1000)).toBe(200);
      expect(b.status, b.html.slice(0, 1000)).toBe(200);
      expect(a.html).toContain('data-sdk="home">from-slow-store<');
      expect(a.html).not.toContain("from-fast-store");
      expect(b.html).toContain('data-sdk="home">from-fast-store<');
      expect(b.html).not.toContain("from-slow-store");
      // Media stay the relative path Core sent: the content origin is a
      // loopback address here and must not be written into the page.
      for (const { html } of [a, b]) {
        expect(html).toContain(`data-sdk="image" src="${SDK_IMAGE}"`);
        expect(html).not.toContain("127.0.0.1");
        expect(html).not.toContain(".invalid");
      }

      // No source named: the read fails rather than rendering defaults.
      const missing = await read({});
      expect(missing.status).toBeGreaterThanOrEqual(500);
      expect(missing.html).not.toContain('data-sdk="home">');
    } finally {
      slow.close();
      fast.close();
    }
  });

  it("keeps the thin entry's request access out of the browser bundle", () => {
    const client = walk(join(artifactDir, "runtime/client"))
      .filter((path) => path.endsWith(".js"))
      .map((path) =>
        readFileSync(join(artifactDir, "runtime/client", path), "utf8"),
      )
      .join("\n");
    expect(client.length).toBeGreaterThan(0);
    expect(client).not.toContain("x-morph-content-origin");
    expect(workerSource).toContain("x-morph-content-origin");
  });

  it("leaves Starter 32's Live Preview branch out of every bundle it ships", () => {
    // __MORPH_START_LIVE_PREVIEW__ is false in a native build, so the loader
    // never asks a live content accessor here: neither the accessor's name
    // nor the flag survives in what is published.
    const client = walk(join(artifactDir, "runtime/client"))
      .filter((path) => path.endsWith(".js"))
      .map((path) =>
        readFileSync(join(artifactDir, "runtime/client", path), "utf8"),
      )
      .join("\n");
    expect(client).toContain("_serverFn");
    for (const shipped of [client, workerSource]) {
      expect(shipped).not.toContain("__morphLivePreviewContent");
      expect(shipped).not.toContain("__MORPH_START_LIVE_PREVIEW__");
    }
  });

  it("serves the static assets beside the Worker", async () => {
    const assets = walk(join(artifactDir, "runtime/client")).filter((path) =>
      path.endsWith(".css"),
    );
    expect(assets.length).toBeGreaterThan(0);
    expect((await request(`/${assets[0]}`)).status).toBe(200);
  });
});

/**
 * A route whose component uses the bare `@morph/sdk` (the one entry every
 * framework imports, owner decision 2026-11-27), so the browser graph has an
 * SDK edge too, not only the Worker's.
 */
const BARE_SDK_ROUTE = {
  path: "src/routes/bare-sdk.tsx",
  content: `import { createFileRoute } from "@tanstack/react-router";
import { isMorphError } from "@morph/sdk";

export const Route = createFileRoute("/bare-sdk")({
  component: function BareSdk() {
    return <p data-bare-sdk>{String(isMorphError(new Error("x")))}</p>;
  },
});
`,
};

/** The guide's config with `extra` plugin entries and top-level settings. */
const tamperedConfig = (options: {
  head?: string;
  plugins?: string;
  cloudflare?: string;
  settings?: string;
}) => `import path from "node:path";
import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
${options.head ?? ""}
export default defineConfig({
  plugins: [
    ${options.plugins ?? ""}
    cloudflare(${options.cloudflare ?? '{ viteEnvironment: { name: "ssr" } }'}),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
  ${options.settings ?? ""}
});
`;

/** What a plugin could serve in place of the SDK: none of Morph's code. */
const IMPOSTOR_SDK =
  "export const isMorphError = () => false; export const createMorph = () => null; export class MorphError extends Error {}";

/**
 * Builds the Starter plus `BARE_SDK_ROUTE` under `viteConfig`, as a runner
 * would, and collects it. A build that fails or is refused reports why.
 */
function buildTampered(
  viteConfig: string,
  extraFiles: ReadonlyArray<{ path: string; content: string }> = [],
):
  | {
      ok: true;
      artifact: ReturnType<ReturnType<typeof themeFramework>["build"]["native"]["collect"]>;
    }
  | { ok: false; stage: "build" | "collect"; message: string } {
  const framework = themeFramework();
  const inputs = [
    ...STARTER_THEME_FILES,
    BARE_SDK_ROUTE,
    ...extraFiles,
    { path: "vite.config.ts", content: viteConfig },
    { path: "wrangler.jsonc", content: WRANGLER },
  ];
  const plan = framework.build.native.plan(inputs, { nonce: NONCE });
  if (!plan.ok) return { ok: false, stage: "build", message: plan.message };
  const root = mkdtempSync(join(tmpdir(), "native-start-tampered-"));
  try {
    for (const file of plan.workspaceFiles) {
      mkdirSync(dirname(join(root, file.path)), { recursive: true });
      writeFileSync(join(root, file.path), file.content);
    }
    symlinkSync(join(process.cwd(), "node_modules"), join(root, "node_modules"));
    const [, ...args] = plan.command;
    let failure: string | null = null;
    try {
      execFileSync(process.execPath, ["node_modules/vite/bin/vite.js", ...args], {
        cwd: root,
        env: { ...process.env, ...plan.env },
        stdio: "pipe",
        timeout: BUILD_BUDGET_MS,
      });
    } catch (error) {
      const detail = error as { stderr?: Buffer; stdout?: Buffer };
      failure = `${detail.stderr?.toString() ?? ""}\n${detail.stdout?.toString() ?? ""}`;
    }
    const outputs = new Map(
      walk(root).map((path) => [path, new Uint8Array(readFileSync(join(root, path)))]),
    );
    if (failure !== null) {
      const cause = framework.build.native.failedBuildCause?.(outputs, NONCE);
      return { ok: false, stage: "build", message: cause?.message ?? failure };
    }
    try {
      return {
        ok: true,
        artifact: framework.build.native.collect(outputs, NONCE, inputs),
      };
    } catch (error) {
      return {
        ok: false,
        stage: "collect",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** A canonical manifest for a collected native artifact, as the store keeps it. */
function manifestFor(
  artifact: Extract<ReturnType<typeof buildTampered>, { ok: true }>["artifact"],
): CanonicalThemeBuildManifest {
  return {
    buildId: "bld_native_proof",
    storefrontId: "sf_native_proof",
    themeId: "th_native_proof",
    sourceRevisionId: "rev",
    revisionNumber: 1,
    inputHash: "0".repeat(64),
    compilerId: NATIVE_START_COMPILER_ID,
    compilerVersion: themeFramework().build.native.compilerIdentity().version,
    sourceEntry: "src/router.tsx",
    artifactEntry: artifact.workerEntry,
    runtime: {
      kind: "cloudflare-worker",
      workerEntry: artifact.workerEntry,
      clientAssetsDirectory: artifact.clientAssetsDirectory,
      nativeProof: readNativeBuildProof(artifact.metadata?.nativeProof)!,
    },
    filesCount: artifact.files.size,
    totalSizeBytes: 0,
    files: [...artifact.files.keys()].map((path) => ({
      path,
      contentType: path.endsWith(".js")
        ? "application/javascript"
        : "application/octet-stream",
      sizeBytes: 1,
      sha256: "0".repeat(64),
    })),
    cssChunks: [],
    jsChunks: [],
    createdAt: "2026-11-27T00:00:00.000Z",
  };
}

const workerConfigOf = (
  artifact: Extract<ReturnType<typeof buildTampered>, { ok: true }>["artifact"],
) => {
  const config = artifact.files.get("runtime/server/wrangler.json")!;
  return JSON.parse(
    typeof config === "string" ? config : new TextDecoder().decode(config),
  );
};

describe("a native Start build's SDK resolution proof, against what a Vite config can do", () => {
  it(
    "proves the bare @morph/sdk in both the browser and the Worker, and a production deployment refuses the build's static HTML",
    () => {
      const built = buildTampered(tamperedConfig({}), [
        { path: "public/landing.html", content: "<!doctype html><p>static</p>" },
        // A type-only re-export of the SDK in a module both graphs load:
        // TypeScript erases it, and no edge is required for it.
        {
          path: "src/morph/sdk-types.ts",
          content:
            'export { type MorphPage } from "@morph/sdk";\nexport type { Morph } from "@morph/sdk";\nexport const SDK_TYPES_LOADED = true;\n',
        },
        {
          path: "src/routes/sdk-types.tsx",
          content: `import { createFileRoute } from "@tanstack/react-router";
import { SDK_TYPES_LOADED, type MorphPage } from "../morph/sdk-types";

export const Route = createFileRoute("/sdk-types")({
  loader: () => ({ loaded: SDK_TYPES_LOADED, page: null as MorphPage | null }),
  component: function SdkTypes() {
    return <p>{String(Route.useLoaderData().loaded)}</p>;
  },
});
`,
        },
        // A Vite Web Worker (a ?worker import) that itself imports the SDK:
        // Vite builds it as its own bundle and emits it as an asset.
        {
          path: "src/workers/echo.ts",
          content: `import { isMorphError } from "@morph/sdk";
self.onmessage = (event: MessageEvent) => {
  self.postMessage({ echo: event.data, morphError: isMorphError(event.data) });
};
`,
        },
        {
          path: "src/routes/worker-echo.tsx",
          content: `import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import EchoWorker from "../workers/echo?worker";

export const Route = createFileRoute("/worker-echo")({
  component: function WorkerEcho() {
    const [reply, setReply] = useState("");
    useEffect(() => {
      const worker = new EchoWorker();
      worker.onmessage = (event) => setReply(JSON.stringify(event.data));
      worker.postMessage("ping");
      return () => worker.terminate();
    }, []);
    return <p data-worker-echo>{reply}</p>;
  },
});
`,
        },
        // A classic script served from public/: valid only outside strict
        // mode (duplicate parameters).
        {
          path: "public/legacy.js",
          content: "function pick(a, a) { return a; }\nwindow.pick = pick;\n",
        },
        // ?worker&inline: Vite embeds the worker bundle's code as a string
        // in the parent chunk, with no file of its own. It imports the SDK.
        {
          path: "src/workers/inline-echo.ts",
          content: `import { isMorphError } from "@morph/sdk";
self.onmessage = (event: MessageEvent) => {
  self.postMessage({ inline: true, morphError: isMorphError(event.data) });
};
`,
        },
        // A worker whose dynamic SDK import is dead code: Rollup drops it, so
        // this worker's bundle holds no SDK, while the echo worker's does.
        {
          path: "src/workers/dead-sdk.ts",
          content: `if (false) {
  void import("@morph/sdk");
}
self.onmessage = (event: MessageEvent) => self.postMessage(event.data);
`,
        },
        {
          path: "src/routes/worker-more.tsx",
          content: `import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import InlineEcho from "../workers/inline-echo?worker&inline";
import DeadSdk from "../workers/dead-sdk?worker";

export const Route = createFileRoute("/worker-more")({
  component: function WorkerMore() {
    const [reply, setReply] = useState("");
    useEffect(() => {
      const inline = new InlineEcho();
      const dead = new DeadSdk();
      inline.onmessage = (event) => setReply(JSON.stringify(event.data));
      inline.postMessage("ping");
      dead.postMessage("ping");
      return () => {
        inline.terminate();
        dead.terminate();
      };
    }, []);
    return <p data-worker-more>{reply}</p>;
  },
});
`,
        },
      ]);
      if (!built.ok) throw new Error(`${built.stage}: ${built.message}`);
      const proof = readNativeBuildProof(built.artifact.metadata?.nativeProof)!;
      const client = proof.sdk.environments.find((entry) => entry.output === "client")!;
      const ssr = proof.sdk.environments.find((entry) => entry.output === "server")!;
      expect(client.specifiers).toContain("@morph/sdk");
      expect(ssr.specifiers).toContain("@morph/sdk");
      // The worker's own bundle was recorded, verified and proven: it is one
      // of the files carrying the bare SDK's sentinel in the browser output.
      expect(
        client.sentinelFiles.some((path) => /\/echo-[^/]*\.js$/.test(path)),
        JSON.stringify(client.sentinelFiles),
      ).toBe(true);
      expect(built.artifact.files.has("runtime/client/legacy.js")).toBe(true);
      for (const environment of [client, ssr]) {
        const carrying = environment.sentinelFiles.map((path) => {
          const content = built.artifact.files.get(path)!;
          return typeof content === "string"
            ? content
            : new TextDecoder().decode(content);
        });
        expect(
          carrying.some((code) =>
            code.includes(nativeSdkSentinel(NONCE, "@morph/sdk")),
          ),
          environment.name,
        ).toBe(true);
      }
      // The public/ file is static HTML the asset layer would answer.
      expect(proof.html).toEqual([
        { path: "runtime/client/landing.html", source: "public" },
      ]);
      const manifest = manifestFor(built.artifact);
      const workerConfig = workerConfigOf(built.artifact);
      expect(
        planThemeWorkerDeployment({
          target: "production",
          storefrontId: "sf_native_proof",
          manifest,
          workerConfig,
        }),
      ).toMatchObject({
        success: false,
        reason: "NATIVE_HTML_ASSET_UNAVAILABLE",
        message: expect.stringContaining(
          "NATIVE_HTML_ASSET_UNAVAILABLE: The build would serve runtime/client/landing.html (copied from the public directory) as /landing.html.",
        ),
      });
      // Build Preview is not production: it serves what the build wrote.
      expect(
        planThemeWorkerDeployment({
          target: "build-preview",
          storefrontId: "sf_native_proof",
          manifest,
          workerConfig,
        }),
      ).toMatchObject({ success: true });
    },
    BUILD_BUDGET_MS,
  );

  it(
    "refuses a plugin that redirects @morph/sdk with an alias of its own",
    () => {
      const built = buildTampered(
        tamperedConfig({
          plugins: `{ name: "author-redirect", config: () => ({ resolve: { alias: [{ find: /^@morph\\/sdk$/, replacement: path.resolve("src/impostor-sdk.ts") }] } }) },`,
        }),
        [{ path: "src/impostor-sdk.ts", content: IMPOSTOR_SDK }],
      );
      expect(built).toMatchObject({ ok: false, stage: "collect" });
      expect((built as { message: string }).message).toMatch(
        /^NATIVE_PROOF_SDK_RESOLUTION: vite\.config\.ts changes where @morph\/sdk resolves \(src\/routes\/bare-sdk\.tsx, (client|ssr) environment: resolved to src\/impostor-sdk\.ts\)\. Remove the alias or plugin\.$/,
      );
    },
    BUILD_BUDGET_MS,
  );

  it(
    "refuses an SDK left external in the browser build",
    () => {
      const built = buildTampered(
        tamperedConfig({
          settings: `environments: { client: { build: { rollupOptions: { external: ["@morph/sdk"] } } } },`,
        }),
      );
      expect(built).toMatchObject({ ok: false, stage: "collect" });
      expect((built as { message: string }).message).toMatch(
        /^NATIVE_PROOF_SDK_RESOLUTION: vite\.config\.ts leaves "@morph\/sdk" external \(src\/routes\/bare-sdk\.tsx, client environment\)/,
      );
    },
    BUILD_BUDGET_MS,
  );

  it(
    "refuses a plugin that serves other code for Morph's copy: its sentinel is missing",
    () => {
      const built = buildTampered(
        tamperedConfig({
          plugins: `{ name: "author-impostor", enforce: "pre", load(id) { if (id.split("?")[0].replace(/\\\\/g, "/").endsWith(".morph/sdk/src/index.ts")) return ${JSON.stringify(IMPOSTOR_SDK)}; } },`,
        }),
      );
      expect(built).toMatchObject({ ok: false, stage: "collect" });
      expect((built as { message: string }).message).toMatch(
        /^NATIVE_PROOF_SDK_RESOLUTION: the (client|ssr) environment imports @morph\/sdk \(src\/routes\/bare-sdk\.tsx\), but the code the build wrote for it does not reach Morph's copy of it\./,
      );
    },
    BUILD_BUDGET_MS,
  );

  it(
    "refuses a transform that rewrites a Theme source's SDK import away before the graph is recorded",
    () => {
      // Relative to the module, so the final code names no reserved name.
      const built = buildTampered(
        tamperedConfig({
          plugins: `{ name: "author-rewrite", enforce: "pre", transform(code, id) { if (id.split("?")[0].replace(/\\\\/g, "/").endsWith("/src/morph/content.ts")) return code.replace(/["']@morph\\/sdk\\/start["']/g, '"../impostor-start.ts"'); } },`,
        }),
        [
          {
            path: "src/impostor-start.ts",
            content:
              "export const morph = { pages: { get: async () => ({}) } }; export const getContentOrigin = () => null;",
          },
        ],
      );
      expect(built).toMatchObject({ ok: false, stage: "collect" });
      expect((built as { message: string }).message).toBe(
        "NATIVE_PROOF_SDK_RESOLUTION: src/morph/content.ts imports @morph/sdk/start, but the code the ssr environment built from it does not. A Vite plugin rewrites that import; remove it.",
      );
    },
    BUILD_BUDGET_MS,
  );

  it(
    "refuses an expression-free template-literal dynamic import that an alias redirects",
    () => {
      const built = buildTampered(
        tamperedConfig({
          plugins: `{ name: "author-redirect", config: () => ({ resolve: { alias: [{ find: /^@morph\\/sdk$/, replacement: path.resolve("src/impostor-sdk.ts") }] } }) },`,
        }),
        [
          { path: "src/impostor-sdk.ts", content: IMPOSTOR_SDK },
          {
            path: "src/lazy-sdk.js",
            content: "export const loadSdk = () => import(`@morph/sdk`);\n",
          },
          {
            path: "src/routes/lazy-sdk.tsx",
            content: `import { createFileRoute } from "@tanstack/react-router";
import { loadSdk } from "../lazy-sdk.js";

export const Route = createFileRoute("/lazy-sdk")({
  component: function LazySdk() {
    return <button onClick={() => void loadSdk()}>load</button>;
  },
});
`,
          },
        ],
      );
      expect(built).toMatchObject({ ok: false, stage: "collect" });
      expect((built as { message: string }).message).toMatch(
        /^NATIVE_PROOF_SDK_RESOLUTION: vite\.config\.ts changes where @morph\/sdk resolves \(src\/(lazy-sdk\.js|routes\/bare-sdk\.tsx), (client|ssr) environment(, dynamic import)?: resolved to src\/impostor-sdk\.ts\)/,
      );
    },
    BUILD_BUDGET_MS,
  );

  it(
    "refuses a dynamic import a resolveDynamicImport hook redirects beside a static import of the same name",
    () => {
      const built = buildTampered(
        tamperedConfig({
          plugins: `{ name: "author-dynamic-redirect", enforce: "pre", resolveDynamicImport(specifier) { if (specifier === "@morph/sdk") return path.resolve("src/impostor-sdk.ts"); } },`,
        }),
        [
          { path: "src/impostor-sdk.ts", content: IMPOSTOR_SDK },
          {
            path: "src/routes/both-sdk.tsx",
            content: `import { createFileRoute } from "@tanstack/react-router";
import { isMorphError } from "@morph/sdk";

export const Route = createFileRoute("/both-sdk")({
  component: function BothSdk() {
    return (
      <button onClick={() => void import("@morph/sdk").then((sdk) => sdk.isMorphError(null))}>
        {String(isMorphError(null))}
      </button>
    );
  },
});
`,
          },
        ],
      );
      expect(built).toMatchObject({ ok: false, stage: "collect" });
      expect((built as { message: string }).message).toMatch(
        /^NATIVE_PROOF_SDK_RESOLUTION: vite\.config\.ts changes where @morph\/sdk resolves \(src\/routes\/both-sdk\.tsx, (client|ssr) environment, dynamic import: resolved to \.morph\/sdk\/src\/index\.ts, which is not the module the build bundled\)/,
      );
    },
    BUILD_BUDGET_MS,
  );

  it(
    "refuses output rewritten after the bundle was generated (writeBundle)",
    () => {
      const built = buildTampered(
        tamperedConfig({
          plugins: `{ name: "author-rewrite-output", writeBundle(options, bundle) { for (const file of Object.keys(bundle)) { if (file.endsWith(".js")) fs.appendFileSync(path.join(options.dir, file), "\\n// rewritten\\n"); } } },`,
          head: `import fs from "node:fs";`,
        }),
      );
      expect(built).toMatchObject({ ok: false, stage: "collect" });
      expect((built as { message: string }).message).toMatch(
        /^NATIVE_PROOF_SDK_RESOLUTION: .+\.js in the (client|ssr) output is not the code the bundler emitted\. A Vite plugin rewrites the output after it is generated; remove it\.$/,
      );
    },
    BUILD_BUDGET_MS,
  );

  it(
    "refuses a Web Worker that imports a package the Theme may not use",
    () => {
      // Installed beside the toolchain here, but not an approved dependency:
      // the worker bundle is held to the same guard as the main graphs.
      const built = buildTampered(tamperedConfig({}), [
        {
          path: "src/workers/unapproved.ts",
          content: `import { z } from "zod";
self.onmessage = (event: MessageEvent) => self.postMessage(z.string().safeParse(event.data).success);
`,
        },
        {
          path: "src/routes/worker-unapproved.tsx",
          content: `import { createFileRoute } from "@tanstack/react-router";
import UnapprovedWorker from "../workers/unapproved?worker";

export const Route = createFileRoute("/worker-unapproved")({
  component: function WorkerUnapproved() {
    return <button onClick={() => new UnapprovedWorker()}>start</button>;
  },
});
`,
        },
      ]);
      expect(built).toMatchObject({ ok: false, stage: "build" });
      expect((built as { message: string }).message).toContain(
        'UNAPPROVED_DEPENDENCY: Theme imports "zod" from package "zod", which is not an approved dependency.',
      );
    },
    BUILD_BUDGET_MS,
  );

  it.each([
    [
      "a plugin in Vite's pre group",
      `{ name: "author-worker-resolver", enforce: "pre", resolveId(source) { if (source === "author-zod") return requireFromConfig.resolve("zod"); } }`,
    ],
    [
      "a resolveId hook at Rollup's order pre",
      `{ name: "author-worker-resolver", resolveId: { order: "pre", handler(source) { if (source === "author-zod") return requireFromConfig.resolve("zod"); } } }`,
    ],
  ])(
    "refuses a Web Worker import of an unapproved package that the project's worker plugin resolves itself (%s)",
    (_name, plugin) => {
      const built = buildTampered(
        tamperedConfig({
          head: `import { createRequire } from "node:module";\nconst requireFromConfig = createRequire(path.resolve("package.json"));`,
          settings: `worker: { plugins: () => [${plugin}] },`,
        }),
        [
          {
            path: "src/workers/aliased.ts",
            content: `import { z } from "author-zod";
self.onmessage = (event: MessageEvent) => self.postMessage(z.string().safeParse(event.data).success);
`,
          },
          {
            path: "src/routes/worker-aliased.tsx",
            content: `import { createFileRoute } from "@tanstack/react-router";
import AliasedWorker from "../workers/aliased?worker";

export const Route = createFileRoute("/worker-aliased")({
  component: function WorkerAliased() {
    return <button onClick={() => new AliasedWorker()}>start</button>;
  },
});
`,
          },
        ],
      );
      expect(built).toMatchObject({ ok: false, stage: "build" });
      expect((built as { message: string }).message).toMatch(
        /UNAPPROVED_DEPENDENCY: Theme (imports "author-zod" from package "zod"|Web Worker imports package "zod"), which is not an approved dependency\./,
      );
    },
    BUILD_BUDGET_MS,
  );

  it(
    "refuses a script written into the output that the bundler never emitted",
    () => {
      // Recorded chunks untouched; one more module beside them, which the
      // Worker could import at run time.
      const built = buildTampered(
        tamperedConfig({
          plugins: `{ name: "author-extra-module", writeBundle(options) { fs.mkdirSync(path.join(options.dir, "assets"), { recursive: true }); fs.writeFileSync(path.join(options.dir, "assets", "extra.js"), 'export * from "@morph/sdk";'); } },`,
          head: `import fs from "node:fs";`,
        }),
      );
      expect(built).toMatchObject({ ok: false, stage: "collect" });
      expect((built as { message: string }).message).toMatch(
        /^NATIVE_PROOF_SDK_RESOLUTION: runtime\/(client|server)\/assets\/extra\.js is not code the bundler emitted for this output, so Morph cannot vouch for it\./,
      );
    },
    BUILD_BUDGET_MS,
  );

  it(
    "refuses an option given through a getter, so the value checked is the value used",
    () => {
      const built = buildTampered(
        tamperedConfig({
          cloudflare: `{ viteEnvironment: { name: "ssr" }, get persistState() { return false; } }`,
        }),
      );
      expect(built).toEqual({
        ok: false,
        stage: "build",
        message:
          'NATIVE_ADAPTER_OPTION: vite.config.ts passes persistState as a getter to cloudflare(). Morph reads each plugin option once, as a value. Remove "persistState as a getter"; keep wrangler.jsonc at the project root.',
      });
    },
    BUILD_BUDGET_MS,
  );

  it(
    "refuses a Cloudflare plugin the config builds without the checked call",
    () => {
      // Loaded from a data: module, which the shim leaves alone, and given an
      // option the check refuses.
      const built = buildTampered(
        tamperedConfig({
          head: `import { pathToFileURL } from "node:url";
const pluginUrl = pathToFileURL(path.resolve("node_modules/@cloudflare/vite-plugin/dist/index.mjs")).href;
const unchecked = await import("data:text/javascript," + encodeURIComponent("export * from " + JSON.stringify(pluginUrl) + ";"));`,
          plugins: `unchecked.cloudflare({ viteEnvironment: { name: "ssr" }, configPath: "./wrangler.jsonc" }),`,
        }),
      );
      expect(built).toEqual({
        ok: false,
        stage: "build",
        message:
          'NATIVE_ADAPTER_OPTION: vite.config.ts builds the Cloudflare plugin without calling cloudflare() from an import of @cloudflare/vite-plugin, so Morph cannot check its options. Import cloudflare from "@cloudflare/vite-plugin" and call it in the config.',
      });
    },
    BUILD_BUDGET_MS,
  );

  it(
    "refuses a Cloudflare plugin option at the call, computed or not",
    () => {
      // Not a literal `configPath:` a text check would find.
      const built = buildTampered(
        tamperedConfig({
          head: `const option = ["config", "Path"].join("");`,
          cloudflare: `{ viteEnvironment: { name: "ssr" }, [option]: "./wrangler.jsonc" }`,
        }),
      );
      expect(built).toEqual({
        ok: false,
        stage: "build",
        message:
          'NATIVE_ADAPTER_OPTION: vite.config.ts passes configPath to cloudflare(). Morph supplies the Wrangler config the plugin reads, from wrangler.jsonc at the project root; a config path would replace it. Remove "configPath"; keep wrangler.jsonc at the project root.',
      });
    },
    BUILD_BUDGET_MS,
  );
});
