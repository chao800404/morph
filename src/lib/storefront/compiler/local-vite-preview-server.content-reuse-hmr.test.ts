// @vitest-environment node
import { randomUUID } from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { STARTER_THEME_FILES } from "@/lib/storefront/starter-theme-files";
import { astroThemeFiles } from "../theme-framework/astro-native-prerender.fixtures";
import { LocalVitePreviewServer } from "./local-vite-preview-server";
import type { StartPreviewServerInput } from "./theme-preview-server.types";
import { DEFAULT_APPROVED_DEPENDENCIES } from "./sandbox-vite-theme-build-runner.types";
import {
  THEME_PREVIEW_CONTENT_MODULE_PATH,
  THEME_PREVIEW_CONTENT_SNAPSHOT_MODULE_PATH,
  previewContentDigest,
  type ThemePreviewContentSnapshot,
} from "./theme-preview-content";

/**
 * A start whose plan differs from the running server's only in its draft
 * content snapshot reuses the dev server and rewrites the snapshot module
 * under it (multi-tab PR 1). Against a real dev server for each runtime that
 * can be reused this way — client-only, Start, Astro — this records what that
 * rewrite makes Vite tell an open page, through the HTTP relay every preview
 * page reads its HMR payloads from (`/_morph/hmr`), and checks that what the
 * server then serves is the newest snapshot.
 *
 * What the module rewrite must not add is a `full-reload`: the snapshot
 * module is accepted, and ignored, by `preview-content.ts`, so a page keeps
 * the content it loaded with (and the author's live edits on it). A page
 * loaded after the start must get the new snapshot, from the module and from
 * the server. Astro's dev server relays one `full-reload` for the content
 * data file, as it does for every content sync; that one is the content
 * path's own, and is shown apart from the module below.
 *
 * The relay is read by a page's bridge only when the editor writes Theme
 * files (`applyWrittenThemeRevision`), so a payload here reaches an open page
 * then, not when it is relayed.
 */

const RUN = randomUUID().slice(0, 8);
const WORKSPACES_ROOT = path.join(
  process.cwd(),
  ".morph-previews-content-reuse-hmr-test",
  `run-${RUN}`,
);

type Payload = Readonly<{
  type: string;
  updates?: ReadonlyArray<{ type: string; path: string; acceptedPath: string }>;
  path?: string;
}>;

/** A ticketed snapshot as the server function hands one over. */
async function snapshot(
  marker: string,
  contentTicket: number,
): Promise<ThemePreviewContentSnapshot> {
  const body = {
    templates: {
      index: {
        slots: { hero: { headline: marker }, isolation: { marker } },
        hiddenSlots: [],
      },
    },
    pages: {},
  };
  return {
    ...body,
    contentTicket,
    contentHash: await previewContentDigest(JSON.stringify(body)),
  } as ThemePreviewContentSnapshot;
}

const under = (url: string, suffix: string) =>
  new URL(suffix, url.endsWith("/") ? url : `${url}/`).toString();

/** The relay's current sequence, read as the page's bridge reads it. */
async function relayCursor(url: string): Promise<number> {
  const response = await fetch(under(url, "_morph/hmr?cursor=1"), {
    cache: "no-store",
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { sequence: number }).sequence;
}

/**
 * Every payload relayed after `cursor` within `windowMs`. The relay holds an
 * empty read for up to 5 s, so an idle server costs one long poll per loop.
 */
async function relayedAfter(
  url: string,
  cursor: number,
  windowMs = 6_000,
): Promise<Payload[]> {
  const deadline = Date.now() + windowMs;
  let after = cursor;
  const payloads: Payload[] = [];
  while (Date.now() < deadline) {
    const response = await fetch(under(url, `_morph/hmr?after=${after}`), {
      cache: "no-store",
    });
    const value = (await response.json()) as {
      sequence: number;
      entries: Array<{ sequence: number; payload: Payload }>;
    };
    for (const entry of value.entries) {
      if (entry.sequence <= after) continue;
      after = entry.sequence;
      payloads.push(entry.payload);
    }
  }
  return payloads;
}

/** Load the two content modules as a page would, so the client graph has them. */
async function loadContentModules(url: string): Promise<string> {
  const content = await fetch(under(url, THEME_PREVIEW_CONTENT_MODULE_PATH));
  expect(content.status).toBe(200);
  await content.text();
  const snapshotModule = await fetch(
    under(url, THEME_PREVIEW_CONTENT_SNAPSHOT_MODULE_PATH),
  );
  expect(snapshotModule.status).toBe(200);
  return snapshotModule.text();
}

type Runtime = Readonly<{
  name: string;
  input: (
    previewContent: ThemePreviewContentSnapshot,
  ) => StartPreviewServerInput;
  /** What the server renders for a page loaded now, or null if not SSR. */
  rendered: ((origin: string) => Promise<string>) | null;
}>;

/** Runs the sequence for one runtime and records what Vite relayed. */
async function contentOnlyRestarts(runtime: Runtime) {
  const server = new LocalVitePreviewServer({
    workspacesRoot: path.join(WORKSPACES_ROOT, runtime.name),
    toolchainRoot: process.cwd(),
    approvedDependencies: DEFAULT_APPROVED_DEPENDENCIES,
    readyTimeoutMs: 120_000,
  });
  const previewId = `content-reuse-${runtime.name}-${RUN}`;
  const startWith = async (marker: string, ticket: number) => {
    const started = await server.start({
      ...runtime.input(await snapshot(marker, ticket)),
      previewId,
    });
    if (!started.ok) {
      throw new Error(
        [
          `${started.stage}: ${started.errorMessage}`,
          ...(started.logs ?? []).slice(-40),
        ].join("\n"),
      );
    }
    return started;
  };
  const markers = {
    first: `FIRST-${RUN}`,
    unloaded: `UNLOADED-${RUN}`,
    loaded: `LOADED-${RUN}`,
  };
  try {
    const first = await startWith(markers.first, 1);
    const url = first.url;
    // Lets the watcher's first scan and dependency optimisation settle, so
    // the window below sees only what the next start causes.
    if (runtime.rendered) await runtime.rendered(new URL(url).origin);
    await relayedAfter(url, await relayCursor(url), 2_000);

    // 1. No page has loaded the content modules yet.
    const cursorUnloaded = await relayCursor(url);
    const unloaded = await startWith(markers.unloaded, 2);
    const payloadsUnloaded = await relayedAfter(url, cursorUnloaded);

    // 2. A page has loaded them (they are in the client module graph).
    const moduleBefore = await loadContentModules(url);
    const cursorLoaded = await relayCursor(url);
    const loaded = await startWith(markers.loaded, 3);
    const payloadsLoaded = await relayedAfter(url, cursorLoaded);

    // What a page loaded now gets.
    const moduleAfter = await (
      await fetch(under(url, THEME_PREVIEW_CONTENT_SNAPSHOT_MODULE_PATH))
    ).text();
    const renderedAfter = runtime.rendered
      ? await runtime.rendered(new URL(url).origin)
      : null;
    const contentEndpoint = await fetch(
      new URL(`/_morph/content?path=/`, url),
    ).then(async (response) => ({
      status: response.status,
      body: await response.text(),
    }));

    const record = {
      runtime: runtime.name,
      reused: [unloaded, loaded].map((started) => ({
        sameUrl: started.url === url,
        readyMs: started.readyMs,
        reusedProcess: started.timings?.reusedProcess,
      })),
      payloadsUnloaded,
      payloadsLoaded,
      moduleBeforeHasUnloaded: moduleBefore.includes(markers.unloaded),
      moduleAfterHasLoaded: moduleAfter.includes(markers.loaded),
      renderedAfterHasLoaded: renderedAfter?.includes(markers.loaded) ?? null,
      contentEndpointStatus: contentEndpoint.status,
      contentEndpointHasLoaded: contentEndpoint.body.includes(markers.loaded),
    };
    console.log(`[content-reuse-hmr] ${JSON.stringify(record)}`);
    return record;
  } finally {
    await server.stop(previewId).catch(() => undefined);
  }
}

/**
 * `dataFileReload`: the runtime's dev server relays one `full-reload` for the
 * content data file itself, as it does for every content sync
 * (`writeContent`) — Astro's does, the others do not. That one is the
 * content path's own and not the reuse's; anything beyond it is.
 */
function expectReusedWithoutReload(
  record: Awaited<ReturnType<typeof contentOnlyRestarts>>,
  { dataFileReload }: { dataFileReload: boolean },
) {
  for (const reused of record.reused) {
    expect(reused).toEqual({ sameUrl: true, readyMs: 0, reusedProcess: true });
  }
  const reloads = dataFileReload ? [{ type: "full-reload" }] : [];
  // Unloaded: nothing in the client graph, nothing about the module.
  expect(record.payloadsUnloaded).toEqual(reloads);
  expect(
    record.payloadsLoaded.filter((payload) => payload.type === "full-reload"),
  ).toEqual(reloads);
  // Loaded: an update, accepted by preview-content.ts for its snapshot.
  const updates = record.payloadsLoaded.flatMap(
    (payload) => payload.updates ?? [],
  );
  expect(updates.length).toBeGreaterThan(0);
  for (const update of updates) {
    expect(update.path).toContain("preview-content.ts");
    expect(update.acceptedPath).toContain("preview-content-snapshot.ts");
  }
  // A page loaded now gets the newest snapshot.
  expect(record.moduleBeforeHasUnloaded).toBe(true);
  expect(record.moduleAfterHasLoaded).toBe(true);
}

beforeAll(async () => {
  await fs.mkdir(WORKSPACES_ROOT, { recursive: true });
});

afterAll(async () => {
  await fs
    .rm(WORKSPACES_ROOT, { recursive: true, force: true })
    .catch(() => {});
}, 60_000);

const CLIENT_PAGE = `export default function Page() {
  return <h1>Hello from the local preview</h1>;
}
`;

/** A Start route reading its marker the way a hosted Start Theme does. */
const START_ROUTE = {
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

const ASTRO_PAGE = `---
import Hero from "../components/Hero.astro";
import { heroHeadline } from "../morph/content";
export const prerender = false;
const headline = await heroHeadline(Astro.request, "/");
---
<html><head><title>live</title></head><body><Hero headline={headline} /></body></html>
`;

const ASTRO_TOOLCHAIN = path.join(
  process.cwd(),
  "sandbox/toolchains/astro-7.3/node_modules/astro/package.json",
);

describe(
  "a content-only start on a running local preview",
  { timeout: 300_000 },
  () => {
    it("client-only: reuses the server, tells an open page an accepted update, serves the new snapshot", async () => {
      const record = await contentOnlyRestarts({
        name: "client",
        input: (previewContent) => ({
          previewId: "",
          files: [{ path: "src/pages/index.tsx", content: CLIENT_PAGE }],
          entry: "src/pages/index.tsx",
          previewHostname: "127.0.0.1",
          platformHostEnv: {},
          previewContent,
        }),
        rendered: null,
      });
      expectReusedWithoutReload(record, { dataFileReload: false });
      expect(record.contentEndpointHasLoaded).toBe(true);
    });

    it("Start: reuses the child, tells an open page an accepted update, renders the new snapshot", async () => {
      const record = await contentOnlyRestarts({
        name: "start",
        input: (previewContent) => ({
          previewId: "",
          files: [...STARTER_THEME_FILES, START_ROUTE] as never,
          entry: "src/routes/index.tsx",
          previewHostname: "127.0.0.1",
          platformHostEnv: {},
          previewRuntime: "start",
          previewContent,
        }),
        rendered: async (origin) => {
          const response = await fetch(`${origin}/isolation`);
          return response.text();
        },
      });
      expectReusedWithoutReload(record, { dataFileReload: false });
      expect(record.renderedAfterHasLoaded).toBe(true);
    });

    // Where the one full reload an Astro dev server relays comes from: the
    // data file a content sync writes, which a content-only start writes
    // too — not the snapshot module the reuse now writes beside it.
    it.skipIf(!fsSync.existsSync(ASTRO_TOOLCHAIN))(
      "Astro: the full reload is the content data file's, which writeContent relays the same way; the module relays nothing unloaded",
      async () => {
        const server = new LocalVitePreviewServer({
          workspacesRoot: path.join(WORKSPACES_ROOT, "astro-source"),
          toolchainRoot: process.cwd(),
          approvedDependencies: DEFAULT_APPROVED_DEPENDENCIES,
          readyTimeoutMs: 120_000,
        });
        const previewId = `astro-source-${RUN}`;
        try {
          const started = await server.start({
            previewId,
            files: astroThemeFiles({
              extra: [{ path: "src/pages/live.astro", content: ASTRO_PAGE }],
            }),
            entry: "",
            previewHostname: "127.0.0.1",
            platformHostEnv: {},
            framework: "astro",
            astroThemes: true,
            previewContent: await snapshot(`S1-${RUN}`, 1),
          });
          if (!started.ok) throw new Error(started.errorMessage);
          const url = started.url;
          await (await fetch(`${new URL(url).origin}/live`)).text();
          await relayedAfter(url, await relayCursor(url), 2_000);

          // The data file alone, through the content sync path.
          let cursor = await relayCursor(url);
          expect(
            await server.writeContent(
              previewId,
              JSON.stringify(await snapshot(`S2-${RUN}`, 2)),
            ),
          ).toEqual({ applied: true, ticket: 2 });
          const afterData = await relayedAfter(url, cursor);

          // The snapshot module alone, as the reuse branch writes it.
          const modulePath = path.join(
            WORKSPACES_ROOT,
            "astro-source",
            previewId,
            THEME_PREVIEW_CONTENT_SNAPSHOT_MODULE_PATH,
          );
          expect(fsSync.existsSync(modulePath)).toBe(true);
          cursor = await relayCursor(url);
          await fs.writeFile(
            modulePath,
            `export default ${JSON.stringify(await snapshot(`S3-${RUN}`, 3))};\n`,
          );
          const afterModule = await relayedAfter(url, cursor);
          console.log(
            `[content-reuse-hmr] ${JSON.stringify({ runtime: "astro-source", afterData, afterModule })}`,
          );
          expect(afterData).toEqual([{ type: "full-reload" }]);
          expect(afterModule).toEqual([]);
        } finally {
          await server.stop(previewId).catch(() => undefined);
        }
      },
    );

    it.skipIf(!fsSync.existsSync(ASTRO_TOOLCHAIN))(
      "Astro: reuses the dev server, tells an open page an accepted update, renders the new snapshot",
      async () => {
        const record = await contentOnlyRestarts({
          name: "astro",
          input: (previewContent) => ({
            previewId: "",
            files: astroThemeFiles({
              extra: [{ path: "src/pages/live.astro", content: ASTRO_PAGE }],
            }),
            entry: "",
            previewHostname: "127.0.0.1",
            platformHostEnv: {},
            framework: "astro",
            astroThemes: true,
            previewContent,
          }),
          rendered: async (origin) => {
            const response = await fetch(`${origin}/live`);
            return response.text();
          },
        });
        expectReusedWithoutReload(record, { dataFileReload: true });
        expect(record.renderedAfterHasLoaded).toBe(true);
      },
    );
  },
);
