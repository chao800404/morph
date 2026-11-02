// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { STARTER_THEME_FILES } from "@/lib/storefront/starter-theme-files";
import { LocalVitePreviewServer } from "./local-vite-preview-server";
import { DEFAULT_APPROVED_DEPENDENCIES } from "./sandbox-vite-theme-build-runner.types";
import { previewContentDigest } from "./theme-preview-content";

/**
 * M1 source isolation, G2 (handoff/2026-10-27/m1-item4-source-isolation-
 * audit.md §3): two Live Previews of different drafts, served at once by one
 * local preview server, never answer from each other's draft — not under
 * interleaved requests, and not while one of them takes a newer snapshot.
 *
 * Each page reads its content the way a hosted Start Theme does (loader →
 * createServerFn → `@morph/sdk/start`), so the source comes from the request
 * each preview's Worker forwards. Every assertion is on rendered content:
 * a refusal or an error never counts as isolation.
 */
const SDK_ROUTE = {
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

const WORKSPACES_ROOT = path.join(
  process.cwd(),
  ".morph-previews-two-test",
  `run-${randomUUID()}`,
);
const RUN = randomUUID().slice(0, 8);
const A = `A-${RUN}`;
const B = `B-${RUN}`;
const B2 = `B2-${RUN}`;
const content = (marker: string) => ({
  templates: {
    index: { slots: { isolation: { marker } }, hiddenSlots: [] },
  },
  pages: {},
});

let server: LocalVitePreviewServer;
const origins: Record<"a" | "b", string> = { a: "", b: "" };

async function start(previewId: string, marker: string) {
  const started = await server.start({
    previewId,
    files: [...STARTER_THEME_FILES, SDK_ROUTE] as never,
    entry: "src/routes/index.tsx",
    previewHostname: "127.0.0.1",
    platformHostEnv: {},
    previewRuntime: "start",
    previewContent: content(marker) as never,
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

/** The marker a preview's page renders now; the page must render. */
async function rendered(origin: string) {
  const response = await fetch(`${origin}/isolation`);
  const html = await response.text();
  expect(response.status, html.slice(0, 300)).toBe(200);
  return /data-marker="?[^>]*>([^<]*)</.exec(html)?.[1] ?? "";
}

beforeAll(async () => {
  await fs.mkdir(WORKSPACES_ROOT, { recursive: true });
  server = new LocalVitePreviewServer({
    workspacesRoot: WORKSPACES_ROOT,
    toolchainRoot: process.cwd(),
    approvedDependencies: DEFAULT_APPROVED_DEPENDENCIES,
    readyTimeoutMs: 120_000,
  });
  origins.a = await start(`two-a-${RUN}`, A);
  origins.b = await start(`two-b-${RUN}`, B);
}, 300_000);

afterAll(async () => {
  await server?.stop(`two-a-${RUN}`).catch(() => {});
  await server?.stop(`two-b-${RUN}`).catch(() => {});
  await fs
    .rm(WORKSPACES_ROOT, { recursive: true, force: true })
    .catch(() => {});
}, 60_000);

describe(
  "two Live Previews at once (M1 source isolation, G2)",
  { timeout: 180_000 },
  () => {
    it("each renders only its own draft under interleaved requests", async () => {
      expect(origins.a).not.toBe(origins.b);
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, index) => {
          const which = index % 2 === 0 ? "a" : "b";
          return rendered(origins[which]).then((marker) => ({ which, marker }));
        }),
      );
      for (const { which, marker } of results) {
        expect(marker, which).toBe(which === "a" ? A : B);
      }
    });

    it("while preview B takes a newer snapshot, A only ever renders A, and B renders B or B2, never A", async () => {
      const snapshot = {
        ...content(B2),
        contentTicket: 2,
        contentHash: await previewContentDigest(JSON.stringify(content(B2))),
      };
      const reads = Array.from({ length: 16 }, (_, index) => {
        const which = index % 2 === 0 ? "a" : "b";
        return rendered(origins[which]).then((marker) => ({ which, marker }));
      });
      const written = server.writeContent(
        `two-b-${RUN}`,
        JSON.stringify(snapshot),
      );
      const [results, write] = await Promise.all([Promise.all(reads), written]);

      expect(write).toMatchObject({ applied: true });
      for (const { which, marker } of results) {
        if (which === "a") expect(marker).toBe(A);
        else expect([B, B2]).toContain(marker);
      }
      // Once applied, B renders the newer draft; A is unchanged.
      await expect
        .poll(() => rendered(origins.b), { timeout: 20_000 })
        .toBe(B2);
      expect(await rendered(origins.a)).toBe(A);
    });
  },
);
