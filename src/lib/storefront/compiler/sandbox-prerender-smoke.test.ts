// @vitest-environment node
/**
 * The platform Start runtime build, in the real Sandbox image, prerenders an
 * SSG page from a frozen content snapshot read through the real content
 * source.
 *
 * What it runs is `CloudflareSandboxViteThemeBuildRunner` itself, on a build
 * input made by `materializeThemeBuildInput`, with every session call answered
 * by `docker exec` in a container of the image built from `Dockerfile.sandbox`
 * (docker-sandbox-session.test-support.ts). So the toolchain manifest check,
 * the workspace plan, the platform-generated Vite config, the prerender server
 * and its sealed content endpoint, and the Theme's own `@morph/sdk/start` read
 * all run in that image, as in a publish. The Worker, the Durable Object and
 * the SDK transport in front of the container are not part of it; the
 * container acceptance job covers those.
 *
 * A read of a path the snapshot has not sealed fails the build: in the
 * platform build as the page's failed prerender, in a native build (the
 * Theme's own vite.config.ts, through the native wrapper) with
 * NATIVE_PRERENDER_CONTENT_UNAVAILABLE naming the path.
 *
 * It exists because a regression of this class (PR #461: the prerender server
 * on `localhost`, which the image binds to one loopback family while Start's
 * fetch connects to the other, ECONNREFUSED) first showed about 20 minutes into
 * that job. This finds it in a few minutes.
 *
 * Off unless an image is named:
 *
 *   pnpm test:sandbox-prerender   (builds the image, then runs this file)
 *
 * or, with an image already built from Dockerfile.sandbox:
 *
 *   MORPH_SANDBOX_SMOKE_IMAGE=<tag> pnpm exec vitest run src/lib/storefront/compiler/sandbox-prerender-smoke.test.ts
 */
import { describe, expect, it } from "vitest";
import type { StorefrontThemeBuildDTO } from "../dto/storefront-theme-build.dto";
import type { StorefrontThemeRevisionDTO } from "../dto/storefront-theme-file.dto";
import type { ThemeBuildContentSnapshot } from "../dto/storefront-theme-build.dto";
import { STARTER_THEME_FILES } from "../starter-theme-files";
import { themeToolchainForFramework } from "../theme-framework/theme-toolchains";
import { CloudflareSandboxViteThemeBuildRunner } from "./cloudflare-sandbox-vite-theme-build-runner";
import { dockerSandboxProvider } from "./docker-sandbox-session.test-support";
import { materializeThemeBuildInput } from "./theme-build-materializer";
import type { ThemeBuildRunnerResult } from "./theme-build-runner.types";

const IMAGE = process.env.MORPH_SANDBOX_SMOKE_IMAGE ?? "";
const NAME_PREFIX =
  process.env.MORPH_SANDBOX_SMOKE_PREFIX ?? `morph-sbx-smoke-${process.pid}`;

const STORE = "00000000-0000-4000-8000-0000000000a1";
const THEME = "00000000-0000-4000-8000-0000000000a2";
const PUBLICATION = "00000000-0000-4000-8000-0000000000a3";
const SSG_PATH = "/landing";
const MARKER = "sandbox-prerender-smoke-sentinel";

/** The SSG page: its loader reads the page through the SDK's Start entry. */
function landingRoute(readPath: string): string {
  return `import { createFileRoute } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { morph } from '@morph/sdk/start';

const readLanding = createServerFn().handler(async () => {
  const page = await morph.pages.get(${JSON.stringify(readPath)});
  return String(page.hero?.title ?? 'WRONG_DEFAULT');
});

export const Route = createFileRoute(${JSON.stringify(SSG_PATH)})({
  loader: () => readLanding(),
  component: () => <h1 data-smoke="">{Route.useLoaderData()}</h1>,
});
`;
}

/** The frozen snapshot: one SSG document at the landing route. */
const SNAPSHOT: ThemeBuildContentSnapshot = {
  publicationId: PUBLICATION,
  storefrontId: STORE,
  themeId: THEME,
  documents: [
    {
      item: {
        id: "item-landing",
        publicationId: PUBLICATION,
        itemType: "template",
        contentId: "page-landing",
        revisionId: "revision-landing",
        metadata: { routePath: SSG_PATH },
      },
      document: {
        version: 1,
        sections: [
          {
            id: "hero",
            type: "hero",
            enabled: true,
            props: { title: MARKER },
          },
        ],
        renderPolicy: { mode: "ssg" },
      },
    },
  ],
} as ThemeBuildContentSnapshot;

/**
 * A native Start Theme's own build configuration: it prerenders the landing
 * page itself (native-start-runner.test.ts uses the same).
 */
const OWN_VITE_CONFIG = `import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    tanstackStart({
      prerender: { enabled: true, crawlLinks: false, autoStaticPathsDiscovery: false },
      pages: [{ path: ${JSON.stringify(SSG_PATH)} }],
    }),
    viteReact(),
  ],
});
`;
const OWN_WRANGLER = `{
  "name": "sandbox-prerender-smoke",
  "compatibility_date": "2025-09-02",
  "compatibility_flags": ["nodejs_compat"],
  "main": "@tanstack/react-start/server-entry",
}`;

type BuildKind = "platform" | "native";

/** The build a publish would queue for this Theme, materialized as one is. */
function buildInput(buildId: string, readPath: string, kind: BuildKind) {
  const now = new Date().toISOString();
  const revision = {
    id: `revision-${buildId}`,
    storefrontId: STORE,
    themeId: THEME,
    revisionNumber: 1,
    message: null,
    source: "publish",
    snapshot: [
      ...STARTER_THEME_FILES.filter(
        (file) => file.path !== "src/routes/landing.tsx",
      ),
      { path: "src/routes/landing.tsx", content: landingRoute(readPath) },
      ...(kind === "native"
        ? [
            { path: "vite.config.ts", content: OWN_VITE_CONFIG },
            { path: "wrangler.jsonc", content: OWN_WRANGLER },
          ]
        : []),
    ],
    createdBy: null,
    createdAt: now,
  } as unknown as StorefrontThemeRevisionDTO;
  const build = {
    id: buildId,
    storefrontId: STORE,
    themeId: THEME,
    sourceRevisionId: revision.id,
    status: "queued",
    inputHash: null,
    compilerId: null,
    compilerVersion: null,
    framework: "tanstack-start",
    inputHashFormat: 2,
    toolchainId: themeToolchainForFramework("tanstack-start").id,
    contentPublicationId: PUBLICATION,
    artifactPrefix: null,
    manifestJson: null,
    diagnosticsJson: null,
    errorMessage: null,
    startedAt: null,
    completedAt: null,
    createdBy: null,
    createdAt: now,
    updatedAt: now,
  } as StorefrontThemeBuildDTO;
  return materializeThemeBuildInput({
    build,
    revision,
    contentSnapshot: SNAPSHOT,
    nativeStartBuild: kind === "native",
  });
}

async function runInImage(
  buildId: string,
  readPath: string,
  kind: BuildKind = "platform",
) {
  const runner = new CloudflareSandboxViteThemeBuildRunner({
    sandboxProvider: dockerSandboxProvider({
      image: IMAGE,
      namePrefix: NAME_PREFIX,
    }),
    // The runner's own per-command bound, as in a deployment.
    maxDurationMs: 120_000,
  });
  const started = Date.now();
  const input = buildInput(buildId, readPath, kind);
  expect(input.buildMode ?? "platform", "the build kind materialized").toBe(
    kind,
  );
  const result = await runner.run(input);
  console.log(
    `[sandbox-prerender-smoke] ${buildId}: ${result.success ? "built" : "failed"} in ${Date.now() - started} ms`,
  );
  return result;
}

function failure(result: ThemeBuildRunnerResult): string {
  if (result.success) return "";
  const stage = (result.diagnosticsJson as { stage?: string } | undefined)
    ?.stage;
  return `[${stage ?? "?"}] ${result.errorMessage}`;
}

function text(content: string | Uint8Array | undefined): string {
  if (content === undefined) return "";
  return typeof content === "string"
    ? content
    : new TextDecoder().decode(content);
}

describe.skipIf(!IMAGE)(
  "Start builds with sealed content in the Sandbox image",
  () => {
    it(
      "prerenders the SSG page with the frozen snapshot's content, read through the SDK's content source",
      { timeout: 360_000 },
      async () => {
        const result = await runInImage("sandbox-smoke-pass", SSG_PATH);
        if (!result.success) throw new Error(failure(result));
        expect(
          (result.logs ?? []).some((log) =>
            log.message.includes(
              "Executing platform-owned TanStack Start Cloudflare build inside Sandbox",
            ),
          ),
          "the runtime build ran in the container",
        ).toBe(true);
        const html = result.artifacts.find(
          (file) => file.path === "runtime/client/landing/index.html",
        );
        expect(html, "the SSG page was prerendered").toBeDefined();
        const page = text(html!.content);
        expect(page).toContain(`<h1 data-smoke="">${MARKER}</h1>`);
        expect(page).not.toContain("WRONG_DEFAULT");
        // The prerender server's loopback origin stays out of the page.
        expect(page).not.toContain("127.0.0.1");
        expect(page).not.toContain("[::1]");
        expect(result.contentDependency).toBe("dependent");
      },
    );

    it(
      "fails the build when the page reads a path the snapshot has not sealed",
      { timeout: 360_000 },
      async () => {
        const result = await runInImage(
          "sandbox-smoke-unsealed",
          "/never-sealed",
        );
        expect(result.success, "no artifact from an unsealed read").toBe(false);
        // The platform build's content endpoint answers an unsealed path with
        // a bare 404 (theme-prerender-content.ts), the SDK read throws, and
        // Start reports the page's 500. It records no refused read, so the
        // failure names the page, not the path; the native case below names
        // the path.
        const message = failure(result);
        expect(message).toContain("sandbox-start-compiler");
        expect(message).toContain(`Failed to fetch ${SSG_PATH}`);
        expect(message).not.toContain("ECONNREFUSED");
      },
    );

    it(
      "fails a native Start build that reads a path the snapshot has not sealed, naming the path",
      { timeout: 360_000 },
      async () => {
        // The native wrapper's prerender server records each read it refuses,
        // and the runner names them: the missing-content error.
        const result = await runInImage(
          "sandbox-smoke-native-unsealed",
          "/never-sealed",
          "native",
        );
        expect(result.success, "no artifact from an unsealed read").toBe(false);
        const message = failure(result);
        expect(message).toContain("NATIVE_PRERENDER_CONTENT_UNAVAILABLE");
        expect(message).toContain(
          "/never-sealed (NATIVE_PRERENDER_PATH_NOT_SEALED",
        );
        expect(message).not.toContain("ECONNREFUSED");
      },
    );
  },
);
