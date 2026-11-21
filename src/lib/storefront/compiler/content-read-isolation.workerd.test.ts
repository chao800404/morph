// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unstable_startWorker } from "wrangler";
import type { StorefrontThemeBuildDTO } from "../dto/storefront-theme-build.dto";
import type { StorefrontThemeRevisionDTO } from "../dto/storefront-theme-file.dto";
import { astroToolchainInstalled } from "../theme-framework/astro-native-prerender.test-support";
import {
  astroWorkspaceFiles,
  renderedHero,
  startWorkspaceFiles,
} from "../theme-framework/content-read-fixtures.test-support";
import { themeToolchainForFramework } from "../theme-framework/theme-toolchains";
import { LocalViteThemeBuildRunner } from "./local-vite-theme-build-runner";
import { START_TOOLCHAIN } from "./sandbox-toolchain.test-support";
import { materializeThemeBuildInput } from "./theme-build-materializer";
import type { ThemeBuildRunnerInput, ThemeBuildRunnerResult } from "./theme-build-runner.types";

/**
 * VALIDATION LEVEL: real framework runs, built, in workerd. TEST PROTOTYPE.
 *
 * Two concurrent requests to one running Theme Worker, each naming its own
 * content source in `x-morph-content-origin` as Morph's published runtime
 * sets it per request (`theme-runtimes.ts`), must each read their own — in
 * the built Astro Worker (the AsyncLocalStorage middleware the platform's
 * integration adds) and the built Start Worker (Start's `getRequest()`).
 * The Live Preview Worker gives every request the same origin, so it cannot
 * show this; the published shape can.
 *
 * The order is forced: request A is held inside its first read until request
 * B has been rendered from start to finish, and only then is A's first read
 * answered and its second read made. A wiring that kept the request anywhere
 * shared — a module variable, a cached source, a cached client — would send
 * A's second read to B's store. Each store records every read it was asked
 * for, so a read that went to the wrong store is seen there too, not only in
 * the page.
 *
 * The isolation page is a test page (an author's page that reads twice), not
 * a change to the case A fixtures. Not production Cloudflare: workerd through
 * Wrangler's local runtime. Not preview revocation (#214), not Design.
 */

const BUILD_BUDGET_MS = 240_000;

/** An author's page that reads twice: another page first, then its own. */
const ASTRO_ISOLATION_PAGE = {
  path: "src/pages/isolation.astro",
  content: `---
import Hero from "../components/Hero.astro";
import { morph } from "../morph/content";

const about = await morph.pages.get("/about");
const home = await morph.pages.get("/");
---
<html lang="en">
  <body>
    <main data-about-title={about.hero?.title}>
      <Hero {...home.hero} />
    </main>
  </body>
</html>
`,
};

const START_ISOLATION_ROUTE = {
  path: "src/routes/isolation.tsx",
  content: `import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import Hero from "../components/Hero";
import { morph } from "../morph/content";

const getPages = createServerFn().handler(async () => {
  const about = await morph.pages.get("/about");
  const home = await morph.pages.get("/");
  return { aboutTitle: about.hero?.title ?? null, hero: home.hero };
});

export const Route = createFileRoute("/isolation")({
  loader: () => getPages(),
  component: Isolation,
});

function Isolation() {
  const { aboutTitle, hero } = Route.useLoaderData();
  return (
    <main data-about-title={aboutTitle ?? ""}>
      <Hero {...hero} />
    </main>
  );
}
`,
};

type Read = { store: string; path: string };

/**
 * A content store standing in for Core's `/_morph/content`, answering for one
 * label. `hold` decides whether a read waits before it is answered.
 */
class ContentStore {
  readonly label: string;
  readonly reads: Read[] = [];
  origin = "";
  hold: ((path: string) => Promise<void> | undefined) | null = null;
  onAnswered: ((path: string) => void) | null = null;
  private server: Server | null = null;

  constructor(label: string) {
    this.label = label;
  }

  hero(path: string) {
    const page = path === "/about" ? "ABOUT" : "HOME";
    return {
      title: `ISOLATION-${this.label}-${page}-TITLE`,
      subtitle: `ISOLATION-${this.label}-${page}-SUBTITLE`,
    };
  }

  async start() {
    this.server = createServer((request, response) => void this.answer(request, response));
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
    this.origin = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  private async answer(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(request.url ?? "/", this.origin);
    const path = url.searchParams.get("path") ?? "";
    this.reads.push({ store: this.label, path });
    if (url.pathname !== "/_morph/content") {
      response.writeHead(404).end();
      return;
    }
    await this.hold?.(path);
    response.on("finish", () => this.onAnswered?.(path));
    response
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify({ slots: { hero: this.hero(path) }, hiddenSlots: [] }));
  }

  reset() {
    this.reads.length = 0;
    this.hold = null;
    this.onAnswered = null;
  }

  async stop() {
    // A read still held by a failed run must not keep the server open.
    this.server?.closeAllConnections();
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

type Worker = Awaited<ReturnType<typeof unstable_startWorker>>;

/** Writes a build's artifacts out and starts its Worker as a deployment would. */
async function startBuiltWorker(result: ThemeBuildRunnerResult, prefix: string) {
  if (!result.success) throw new Error(result.errorMessage);
  const dir = mkdtempSync(join(tmpdir(), prefix));
  for (const artifact of result.artifacts) {
    const target = join(dir, artifact.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, artifact.content as Uint8Array | string);
  }
  const worker = await unstable_startWorker({
    config: join(dir, "runtime/server/wrangler.json"),
    dev: { server: { hostname: "127.0.0.1", port: 0 }, inspector: false, logLevel: "error" },
  });
  await worker.ready;
  return { worker, dir };
}

const page = async (worker: Worker, path: string, origin: string | null) => {
  const response = await fetch(new URL(path, await worker.url), {
    headers: origin ? { "x-morph-content-origin": origin } : {},
  });
  return { status: response.status, html: await response.text() };
};

const aboutTitle = (html: string) => /data-about-title="([^"]*)"/.exec(html)?.[1] ?? null;

/** Sealed content for the Astro build's prerendered /about. */
function sealedContent() {
  const hero = {
    id: "hero",
    type: "hero",
    enabled: true,
    props: { title: "CASE-A-SEALED-TITLE", subtitle: "CASE-A-SEALED-SUBTITLE" },
  };
  return {
    publicationId: "pub",
    storefrontId: "store",
    themeId: "theme",
    documents: [
      {
        item: {
          id: "item-index",
          publicationId: "pub",
          itemType: "template",
          contentId: "index",
          revisionId: "revision",
          metadata: { templateType: "index" },
        },
        document: { version: 1, sections: [hero] },
      },
      {
        item: {
          id: "item-about",
          publicationId: "pub",
          itemType: "template",
          contentId: "page-about",
          revisionId: "revision",
          metadata: { routePath: "/about" },
        },
        document: { version: 1, sections: [hero] },
      },
    ],
  };
}

function astroInput(files: readonly { path: string; content: string }[]) {
  const contentSnapshot = sealedContent();
  return materializeThemeBuildInput({
    build: {
      id: "isolation-astro",
      storefrontId: "store",
      themeId: "theme",
      sourceRevisionId: "rev",
      status: "queued",
      inputHash: null,
      compilerId: null,
      compilerVersion: null,
      contentPublicationId: contentSnapshot.publicationId,
      framework: "astro",
      inputHashFormat: 2,
      toolchainId: themeToolchainForFramework("astro").id,
    } as StorefrontThemeBuildDTO,
    revision: {
      id: "rev",
      storefrontId: "store",
      themeId: "theme",
      revisionNumber: 1,
      snapshot: files.map((file) => ({ path: file.path, content: file.content })),
    } as unknown as StorefrontThemeRevisionDTO,
    contentSnapshot: contentSnapshot as never,
    astroThemes: true,
  });
}

const startInput = (files: ThemeBuildRunnerInput["files"]): ThemeBuildRunnerInput => ({
  buildId: "isolation-start",
  storefrontId: "storefront-isolation",
  themeId: "theme-isolation",
  sourceRevisionId: "rev-isolation-start",
  revisionNumber: 1,
  entry: "src/routes/index.tsx",
  inputHash: "d".repeat(64),
  // The Start runner's own compiler identity; a build names it as
  // native-compat.test.ts does.
  compilerId: "tailwind-v4-build",
  compilerVersion: "4.1.17",
  toolchainId: START_TOOLCHAIN.id,
  files,
});

const storeA = new ContentStore("A");
const storeB = new ContentStore("B");

/**
 * Every wait in the forced order is bounded, well inside the core's own
 * 15 s fetch timeout. A read routed to the wrong store leaves a wait that
 * never ends; it fails here, naming what each store was asked for, instead
 * of surfacing later as a timeout or a 500.
 */
const STEP_MS = 10_000;
async function within<T>(promise: Promise<T>, step: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `${step} did not happen within ${STEP_MS} ms; reads so far: ${JSON.stringify([
              ...storeA.reads,
              ...storeB.reads,
            ])}`,
          ),
        ),
      STEP_MS,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One forced interleaving: `first` is held inside its first read until
 * `second` has rendered completely; then `first` finishes.
 */
async function interleave(worker: Worker, path: string, first: ContentStore, second: ContentStore) {
  storeA.reset();
  storeB.reset();
  const firstArrived = deferred();
  const secondDone = deferred();
  first.hold = (readPath) => {
    if (readPath !== "/about") return undefined;
    firstArrived.resolve();
    return secondDone.promise;
  };
  second.onAnswered = (readPath) => {
    if (readPath === "/") secondDone.resolve();
  };
  const firstPage = page(worker, path, first.origin);
  await within(firstArrived.promise, `request ${first.label}'s first read at store ${first.label}`);
  const secondPage = await within(
    page(worker, path, second.origin),
    `request ${second.label}'s whole render from store ${second.label}`,
  );
  const firstResult = await within(firstPage, `request ${first.label}'s render after the release`);
  return { first: firstResult, second: secondPage };
}

function expectOwn(result: { status: number; html: string }, store: ContentStore, other: ContentStore) {
  expect(result.status).toBe(200);
  expect(renderedHero(result.html)).toEqual(store.hero("/"));
  expect(aboutTitle(result.html)).toBe(store.hero("/about").title);
  expect(result.html).not.toContain(`ISOLATION-${other.label}-`);
}

const frameworks: Array<{
  name: string;
  path: string;
  available: boolean;
  build: () => Promise<ThemeBuildRunnerResult>;
}> = [
  {
    name: "Astro",
    path: "/isolation",
    available: astroToolchainInstalled,
    build: () =>
      new LocalViteThemeBuildRunner({ maxDurationMs: BUILD_BUDGET_MS, astroThemes: true }).run(
        astroInput([...astroWorkspaceFiles(), ASTRO_ISOLATION_PAGE]),
      ),
  },
  {
    name: "Start",
    path: "/isolation",
    available: true,
    build: () =>
      new LocalViteThemeBuildRunner({ maxDurationMs: BUILD_BUDGET_MS }).run(
        startInput([...startWorkspaceFiles(), START_ISOLATION_ROUTE] as never),
      ),
  },
];

beforeAll(async () => {
  await storeA.start();
  await storeB.start();
});

afterAll(async () => {
  await storeA.stop();
  await storeB.stop();
});

for (const framework of frameworks) {
  describe.skipIf(!framework.available)(
    `the built ${framework.name} Theme Worker, two requests with different content sources`,
    { timeout: BUILD_BUDGET_MS + 120_000 },
    () => {
      let worker: Worker | null = null;
      let dir = "";

      beforeAll(async () => {
        const started = await startBuiltWorker(await framework.build(), `isolation-${framework.name}-`);
        worker = started.worker;
        dir = started.dir;
      }, BUILD_BUDGET_MS + 60_000);

      afterAll(async () => {
        await worker?.dispose();
        if (dir) rmSync(dir, { recursive: true, force: true });
      });

      it("each reads its own store when A is held across B's whole render", async () => {
        const { first, second } = await interleave(worker!, framework.path, storeA, storeB);
        expectOwn(first, storeA, storeB);
        expectOwn(second, storeB, storeA);
        // Each store saw exactly its own request's two reads.
        expect(storeA.reads).toEqual([
          { store: "A", path: "/about" },
          { store: "A", path: "/" },
        ]);
        expect(storeB.reads).toEqual([
          { store: "B", path: "/about" },
          { store: "B", path: "/" },
        ]);
      });

      it("and the other way round", async () => {
        const { first, second } = await interleave(worker!, framework.path, storeB, storeA);
        expectOwn(first, storeB, storeA);
        expectOwn(second, storeA, storeB);
        expect(storeA.reads.map((read) => read.path)).toEqual(["/about", "/"]);
        expect(storeB.reads.map((read) => read.path)).toEqual(["/about", "/"]);
      });

      it("a request without a source is refused, not answered from the one held beside it", async () => {
        storeA.reset();
        storeB.reset();
        const arrived = deferred();
        const release = deferred();
        storeA.hold = (readPath) => {
          if (readPath !== "/about") return undefined;
          arrived.resolve();
          return release.promise;
        };
        const held = page(worker!, framework.path, storeA.origin);
        await within(arrived.promise, "request A's first read at store A");
        const unsourced = await within(
          page(worker!, framework.path, null),
          "the unsourced request's answer",
        );
        release.resolve();
        const answered = await within(held, "request A's render after the release");
        expect(unsourced.status).toBe(500);
        expect(unsourced.html).not.toContain("ISOLATION-");
        expect(unsourced.html).not.toContain("CASE-A-DEFAULT-");
        expectOwn(answered, storeA, storeB);
        // The refused request read nothing from either store.
        expect(storeA.reads.map((read) => read.path)).toEqual(["/about", "/"]);
        expect(storeB.reads).toEqual([]);
      });
    },
  );
}
