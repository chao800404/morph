// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type Server,
} from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unstable_startWorker } from "wrangler";

import { STARTER_THEME_FILES } from "@/lib/storefront/starter-theme-files";
import { StorefrontProductionService } from "../service/storefront-production.service";
import type { StorefrontHostResolverDeps } from "../service/storefront-host-resolver";
import { LocalDirectThemeRuntime } from "../service/theme-runtimes";
import { LocalVitePreviewServer } from "./local-vite-preview-server";
import { LocalViteThemeBuildRunner } from "./local-vite-theme-build-runner";
import { START_TOOLCHAIN } from "./sandbox-toolchain.test-support";
import { DEFAULT_APPROVED_DEPENDENCIES } from "./sandbox-vite-theme-build-runner.types";
import { TAILWIND_VERSION } from "./tailwind-builtin-stylesheets";
import { withThemeMorphSdkIdentity } from "./theme-morph-sdk";

/**
 * M1 source isolation, G1 (handoff/2026-10-27/m1-item4-source-isolation-
 * audit.md §3): a public storefront request and a full-Start Live Preview
 * request in flight at the same time never read each other's source, in the
 * real runtimes rather than with a stand-in for Start's `getRequest()`.
 *
 * - Public: the same Theme's built Worker under workerd, reached through
 *   Morph Core's own `StorefrontProductionService`. Its content callback is
 *   answered by Core from a stub publication carrying `P-<run>`, slowly, so
 *   every public render is still waiting on content while preview requests
 *   come and go.
 * - Preview: the full-Start Live Preview on the local transport, with a
 *   draft snapshot carrying `D-<run>`.
 *
 * Both read through the SDK's Start thin entry (loader → createServerFn →
 * `@morph/sdk/start`), so the source is the header each platform side sets.
 * Half the requests also name the other side's source in that header, as a
 * caller could; it must have no effect. Every assertion is on rendered
 * content: a refusal or an error never counts as isolation.
 */
const ISOLATION_ROUTE = {
  path: "src/routes/isolation.tsx",
  content: `import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { morph } from "@morph/sdk/start";

const readHome = createServerFn().handler(async () => {
  const home = await morph.pages.get("/");
  return String((home["isolation"] ?? {}).marker ?? "");
});

export const Route = createFileRoute("/isolation")({
  loader: () => readHome(),
  component: function Isolation() {
    return <p data-marker>{Route.useLoaderData()}</p>;
  },
});
`,
};
const THEME_FILES = [...STARTER_THEME_FILES, ISOLATION_ROUTE];

const BUILD_BUDGET_MS = 240_000;
/** How long Core holds each published content answer. */
const CONTENT_DELAY_MS = 400;

const RUN = randomUUID();
const D = `D-${RUN}`;
const P = `P-${RUN}`;
const PREVIEW_ID = `public-isolation-${RUN.slice(0, 8)}`;
const WORKSPACES_ROOT = path.join(
  process.cwd(),
  ".morph-previews-public-isolation-test",
  `run-${RUN}`,
);

let preview: LocalVitePreviewServer;
let previewOrigin = "";
let artifactDir = "";
let worker: Awaited<ReturnType<typeof unstable_startWorker>> | null = null;
let core: Server;
let coreOrigin = "";
/** Published content answers Core is holding right now, and the most at once. */
const publicReads = { pending: 0, peak: 0, total: 0 };

/** The host chain resolves every hostname to one storefront and release. */
function resolverDeps(): StorefrontHostResolverDeps {
  return {
    domainDal: {
      findByHostname: async (hostname: string) => ({
        id: "dom_1",
        storefrontId: "sf_1",
        hostname,
        status: "active",
      }),
    },
    storefrontDalRef: {
      findActive: async () => ({ id: "sf_1", status: "published" }),
    },
    releaseDal: {
      getActive: async () => ({
        id: "rel_1",
        themeId: "th_1",
        sourceRevisionId: "rev_1",
        themeBuildId: "bld_1",
        contentPublicationId: "pub_1",
      }),
    },
    buildDal: {
      getBuildById: async () => ({
        id: "bld_1",
        storefrontId: "sf_1",
        themeId: "th_1",
        status: "succeeded",
        artifactPrefix: "themes/th_1/builds/bld_1",
        manifestJson: {
          artifactEntry: "preview/index.html",
          files: [],
          runtime: {
            kind: "cloudflare-worker",
            workerEntry: "runtime/server/index.js",
            clientAssetsDirectory: "runtime/client",
          },
        },
      }),
    },
  } as unknown as StorefrontHostResolverDeps;
}

async function toWebRequest(incoming: IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const chunk of incoming) chunks.push(chunk as Buffer);
  const headers = new Headers();
  for (let i = 0; i < incoming.rawHeaders.length; i += 2) {
    headers.append(
      incoming.rawHeaders[i] as string,
      incoming.rawHeaders[i + 1] as string,
    );
  }
  const method = incoming.method ?? "GET";
  return new Request(`http://${incoming.headers.host}${incoming.url}`, {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? null : Buffer.concat(chunks),
  });
}

async function buildWorker(): Promise<string> {
  const result = await new LocalViteThemeBuildRunner({
    maxDurationMs: BUILD_BUDGET_MS,
  }).run({
    buildId: "public-isolation",
    storefrontId: "sf_1",
    themeId: "th_1",
    sourceRevisionId: "rev_1",
    revisionNumber: 1,
    entry: "src/routes/index.tsx",
    inputHash: "c".repeat(64),
    compilerId: "tailwind-v4-build",
    compilerVersion: withThemeMorphSdkIdentity(TAILWIND_VERSION),
    toolchainId: START_TOOLCHAIN.id,
    files: THEME_FILES as never,
  });
  if (!result.success) throw new Error(result.errorMessage);
  const dir = await fs.mkdtemp(path.join(tmpdir(), "public-isolation-"));
  for (const artifact of result.artifacts) {
    const file = path.join(dir, artifact.path);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, artifact.content as Uint8Array | string);
  }
  return dir;
}

async function startPreview(): Promise<string> {
  const started = await preview.start({
    previewId: PREVIEW_ID,
    files: THEME_FILES as never,
    entry: "src/routes/index.tsx",
    previewHostname: "127.0.0.1",
    platformHostEnv: {},
    previewRuntime: "start",
    previewContent: {
      templates: {
        index: { slots: { isolation: { marker: D } }, hiddenSlots: [] },
      },
      pages: {},
    } as never,
  });
  if (!started.ok) {
    throw new Error(
      [
        `${started.stage}: ${started.errorMessage}`,
        ...(started.logs ?? []).slice(-40),
      ].join("\n"),
    );
  }
  return new URL(started.url).origin;
}

beforeAll(async () => {
  await fs.mkdir(WORKSPACES_ROOT, { recursive: true });
  preview = new LocalVitePreviewServer({
    workspacesRoot: WORKSPACES_ROOT,
    toolchainRoot: process.cwd(),
    approvedDependencies: DEFAULT_APPROVED_DEPENDENCIES,
    readyTimeoutMs: 120_000,
  });
  const [origin, dir] = await Promise.all([startPreview(), buildWorker()]);
  previewOrigin = origin;
  artifactDir = dir;
  // The build writes the Worker's own config beside its entry; that is what
  // a deployment starts from.
  worker = await unstable_startWorker({
    config: path.join(artifactDir, "runtime/server/wrangler.json"),
    dev: { server: { port: 0 }, inspector: false, logLevel: "error" },
  });
  await worker.ready;
  const workerUrl = (await worker.url).origin;

  // Morph Core in front of the built Worker, as it serves a merchant host:
  // page requests go to the Theme Worker with Core's storefront context, and
  // the Worker's content callback comes back here, to the release's
  // publication. Nothing in it reads a draft.
  const service = new StorefrontProductionService({
    runtime: new LocalDirectThemeRuntime(workerUrl),
    r2Bucket: { get: async () => null } as never,
    resolverDeps: resolverDeps(),
    contentPorts: {
      getPublishedDocument: async ({ publicationId }) => {
        publicReads.pending += 1;
        publicReads.total += 1;
        publicReads.peak = Math.max(publicReads.peak, publicReads.pending);
        try {
          await new Promise((resolve) => setTimeout(resolve, CONTENT_DELAY_MS));
          return publicationId === "pub_1"
            ? {
                sections: [
                  { id: "isolation", enabled: true, props: { marker: P } },
                ],
              }
            : null;
        } finally {
          publicReads.pending -= 1;
        }
      },
    },
  });
  core = createServer((incoming, outgoing) => {
    void (async () => {
      const response = await service.handleRequest(
        await toWebRequest(incoming),
      );
      const headers: string[] = [];
      response.headers.forEach((value, name) => headers.push(name, value));
      outgoing.writeHead(response.status, headers);
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    })().catch((error: unknown) => {
      outgoing.writeHead(500).end(String(error));
    });
  });
  await new Promise<void>((resolve) => core.listen(0, "127.0.0.1", resolve));
  coreOrigin = `http://127.0.0.1:${(core.address() as AddressInfo).port}`;
}, BUILD_BUDGET_MS + 120_000);

afterAll(async () => {
  await new Promise<void>((resolve) =>
    core ? core.close(() => resolve()) : resolve(),
  );
  await worker?.dispose();
  await preview?.stop(PREVIEW_ID).catch(() => {});
  if (artifactDir) await fs.rm(artifactDir, { recursive: true, force: true });
  await fs
    .rm(WORKSPACES_ROOT, { recursive: true, force: true })
    .catch(() => {});
}, 60_000);

type Side = "public" | "preview";

/** One page render: its status, the marker it shows, and its whole HTML. */
async function render(origin: string, forgedSource?: string) {
  const response = await fetch(`${origin}/isolation`, {
    headers: forgedSource ? { "x-morph-content-origin": forgedSource } : {},
  });
  const html = (await response.text()).replace(/<!-- -->/g, "");
  return {
    status: response.status,
    html,
    marker: /data-marker="?[^>]*>([^<]*)</.exec(html)?.[1] ?? "",
  };
}

describe(
  "a public request and a Live Preview request at once (M1 source isolation, G1)",
  { timeout: 180_000 },
  () => {
    it("each renders only its own source under interleaved requests, even when one names the other's", async () => {
      // Each side answers alone first, so a failure below is about the
      // overlap and not about a page that never rendered.
      expect((await render(coreOrigin)).marker).toBe(P);
      expect((await render(previewOrigin)).marker).toBe(D);
      publicReads.peak = 0;
      publicReads.total = 0;

      /** Preview renders that finished while a public render was mid-read. */
      let previewDuringPublic = 0;
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, index) => {
          const side: Side = index % 2 === 0 ? "public" : "preview";
          // Every other request of each side names the other side's source.
          const forged =
            index % 4 < 2
              ? undefined
              : side === "public"
                ? previewOrigin
                : coreOrigin;
          return render(
            side === "public" ? coreOrigin : previewOrigin,
            forged,
          ).then((result) => {
            if (side === "preview" && publicReads.pending > 0)
              previewDuringPublic += 1;
            return { side, forged: Boolean(forged), ...result };
          });
        }),
      );

      for (const { side, forged, status, html, marker } of results) {
        const label = `${side}${forged ? " (forged source)" : ""}`;
        expect(status, `${label}: ${html.slice(0, 300)}`).toBe(200);
        expect(marker, label).toBe(side === "public" ? P : D);
        expect(html, label).toContain(side === "public" ? P : D);
        expect(html, label).not.toContain(side === "public" ? D : P);
      }
      // The requests really were in flight together: public renders held
      // their content reads open at once, and preview renders completed
      // while they did.
      // (One content answer may read more than one document.)
      expect(publicReads.total).toBeGreaterThanOrEqual(10);
      expect(publicReads.peak).toBeGreaterThan(1);
      expect(previewDuringPublic).toBeGreaterThan(0);
    });
  },
);
