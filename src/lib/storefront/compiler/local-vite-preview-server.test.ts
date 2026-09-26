// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  LOCAL_PREVIEW_HOST,
  LocalVitePreviewServer,
  isLoopbackPreviewHostname,
} from "./local-vite-preview-server";
import { DEFAULT_APPROVED_DEPENDENCIES } from "./sandbox-vite-theme-build-runner.types";
import { THEME_PREVIEW_SERVER_BASE_PATH } from "./theme-preview-dev-server";

/**
 * The local transport, against a real Vite dev server.
 *
 * Nothing here is mocked. The point of a second implementation is that the
 * editor can be exercised against something that really serves a Theme, so a
 * test that stubbed Vite would only prove the bookkeeping around a stub.
 *
 * The workspace has to sit inside this checkout: the generated config imports
 * the pinned toolchain, and Node resolves that by walking up from the workspace
 * root. A workspace in `/tmp` resolves nothing, which the transport refuses
 * with `LOCAL_PREVIEW_TOOLCHAIN_MISSING` rather than failing later.
 */

const PAGE = `export default function Page() {
  return (
    <section data-morph-preview-probe="hero">
      <h1>Hello from the local preview</h1>
    </section>
  );
}
`;

/** One workspace directory for the file, not one per test. */
const WORKSPACES_ROOT = path.join(process.cwd(), ".morph-previews-test");
let workspacesRoot = "";
const servers: LocalVitePreviewServer[] = [];
/** Roots outside the checkout, which the transport is supposed to refuse. */
const outsideRoots: string[] = [];

/**
 * Removes a tree, patiently.
 *
 * A preview that has been stopped can still have Vite's dependency optimizer
 * finishing a write into its cache directory, and a removal that loses that
 * race fails with the directory no longer empty — repeatedly, for as long as
 * the writer keeps recreating what was just deleted. Giving up after one
 * attempt leaves a workspace behind on every run, so the retries are linear
 * and bounded by a few seconds rather than by a fixed count.
 */
async function removeTree(target: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    try {
      await fs.rm(target, { recursive: true, force: true });
      return;
    } catch {
      if (Date.now() > deadline) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

beforeAll(async () => {
  // A fixed path rather than a fresh mkdtemp: the directory is reused between
  // runs and reconciled by the materializer, so a run that loses the cleanup
  // race leaves one directory behind instead of a new one each time.
  workspacesRoot = WORKSPACES_ROOT;
  await fs.mkdir(workspacesRoot, { recursive: true });
});

function newServer(options: { workspacesRoot: string; port?: number }) {
  const server = new LocalVitePreviewServer({
    workspacesRoot: options.workspacesRoot,
    toolchainRoot: process.cwd(),
    approvedDependencies: DEFAULT_APPROVED_DEPENDENCIES,
    readyTimeoutMs: 60_000,
    ...(options.port === undefined ? {} : { port: options.port }),
  });
  servers.push(server);
  return server;
}

const start = (
  server: LocalVitePreviewServer,
  overrides: Partial<Parameters<LocalVitePreviewServer["start"]>[0]> = {},
) =>
  server.start({
    previewId: "theme-a-user-1",
    files: [{ path: "src/pages/index.tsx", content: PAGE }],
    entry: "src/pages/index.tsx",
    previewHostname: "127.0.0.1",
    env: {},
    ...overrides,
  });

afterEach(async () => {
  for (const server of servers.splice(0)) {
    for (const previewId of server.servingPreviewIds()) {
      await server.stop(previewId).catch(() => undefined);
    }
  }
  for (const root of outsideRoots.splice(0)) await removeTree(root);
});

afterAll(async () => {
  await removeTree(workspacesRoot);
});

/**
 * Asserts a start succeeded, and says why when it did not.
 *
 * `expect(started.ok).toBe(true)` fails with "expected false to be true",
 * which is the one thing the reader already knew. The transport puts the
 * reason in `errorMessage`, so this reads it: removing the watcher override,
 * for instance, fails here naming `LOCAL_PREVIEW_POLLING_WATCHER` rather than
 * sending someone to a debugger to find out what went wrong.
 *
 * It narrows too, which retires the `if (!started.ok) return;` that followed
 * every one of these. That line was harmless only because the assertion above
 * it had already failed — on its own it is the shape that lets the rest of a
 * test quietly not run.
 */
function expectStarted(
  result: Awaited<ReturnType<LocalVitePreviewServer["start"]>>,
): asserts result is Extract<
  Awaited<ReturnType<LocalVitePreviewServer["start"]>>,
  { ok: true }
> {
  if (!result.ok)
    expect.fail(`the preview failed to start: ${result.errorMessage}`);
}

/** The base the editor would frame, and one path under it. */
const under = (url: string, suffix: string) =>
  new URL(suffix, url.endsWith("/") ? url : `${url}/`).toString();

describe("the local Live Preview transport", () => {
  it("serves a real Theme on loopback, off the editor's own origin", async () => {
    const server = newServer({ workspacesRoot });
    const started = await start(server);

    expectStarted(started);
    const url = new URL(started.url);
    expect(url.hostname).toBe(LOCAL_PREVIEW_HOST);
    expect(url.pathname).toBe(THEME_PREVIEW_SERVER_BASE_PATH);
    // The whole reason the editor refuses a user-code preview on its own
    // origin: this one has to be a different one.
    expect(url.origin).not.toBe("http://localhost:3000");

    // The preview document is the generated one, not something Vite invented.
    const document = await fetch(started.url);
    expect(document.status).toBe(200);
    const html = await document.text();
    expect(html).toContain('data-storefront-preview-root="true"');

    // And the Theme's own source is compiled and served, with the editor
    // identity the preview workspace adds to it.
    const module = await fetch(under(started.url, "src/pages/index.tsx"));
    expect(module.status).toBe(200);
    const source = await module.text();
    expect(source).toContain("Hello from the local preview");
    expect(source).toContain("data-morph-loc");

    // The preview content plugin answered on the same origin, which is how a
    // draft slot reaches the page without a Morph credential in the preview.
    // The endpoint is at the origin root, not under the preview's base path:
    // that is the address the Theme's own bridge asks.
    const content = await fetch(new URL("/_morph/content?path=/", started.url));
    expect(content.status).toBe(200);
    expect(await content.json()).toMatchObject({ slots: {} });

    expect(started.hoistedContentFields).toEqual([]);
    expect(started.processId).toBeUndefined();
  }, 120_000);

  it("refuses a preview host that is not this machine", async () => {
    const server = newServer({ workspacesRoot });
    const started = await start(server, {
      previewHostname: "preview.example.com",
    });

    expect(started.ok).toBe(false);
    if (started.ok) return;
    expect(started.stage).toBe("preview-origin");
    expect(started.errorMessage).toContain("LOCAL_PREVIEW_NOT_LOOPBACK");
    expect(server.servingPreviewIds()).toEqual([]);
  });

  it("keeps the dependency enforcer the build uses, over the real filesystem", async () => {
    const server = newServer({ workspacesRoot });
    const started = await start(server, {
      files: [
        {
          path: "src/pages/index.tsx",
          content: `import unapproved from "left-pad";\nexport default () => <p>{unapproved}</p>;\n`,
        },
      ],
    });
    expectStarted(started);

    // The generated config's containment and allowlist are what answer, not a
    // second copy written for the local transport.
    const module = await fetch(under(started.url, "src/pages/index.tsx"));
    expect(module.status).toBeGreaterThanOrEqual(500);
    expect(await module.text()).toContain("UNAPPROVED_DEPENDENCY");
  }, 120_000);

  it("reuses a matching server and replaces a changed one", async () => {
    const server = newServer({ workspacesRoot });
    const first = await start(server);
    expectStarted(first);
    expect(first.timings.reusedProcess).toBe(false);

    const again = await start(server);
    expect(again.ok && again.url).toBe(first.url);
    expect(again.ok && again.timings.reusedProcess).toBe(true);
    expect(again.ok && again.readyMs).toBe(0);

    const changed = await start(server, {
      files: [
        {
          path: "src/pages/index.tsx",
          content: PAGE.replace("Hello", "Goodbye"),
        },
      ],
    });
    expectStarted(changed);
    expect(changed.timings.reusedProcess).toBe(false);
    const source = await (
      await fetch(under(changed.url, "src/pages/index.tsx"))
    ).text();
    expect(source).toContain("Goodbye from the local preview");
  }, 180_000);

  it("applies an edit to the files a running server is watching", async () => {
    const server = newServer({ workspacesRoot });
    const started = await start(server);
    expectStarted(started);

    const source = await (
      await fetch(under(started.url, "src/pages/index.tsx"))
    ).text();
    expect(source).toContain("Hello from the local preview");

    const edited = PAGE.replace("Hello", "Edited");
    const applied = await server.writeFiles("theme-a-user-1", [
      { path: "src/pages/index.tsx", content: edited },
    ]);
    expect(applied.changed).toEqual(["src/pages/index.tsx"]);
    expect(applied.unchanged).toEqual([]);

    // Written, and then *served* — two different facts. The workspace watcher
    // polls, so an edit arrives a moment after the write returns; asserting it
    // immediately would be asserting the poll interval rather than the
    // behaviour. What is asserted is what the editor depends on: the served
    // module updates.
    await expect
      .poll(
        async () =>
          await (await fetch(under(started.url, "src/pages/index.tsx"))).text(),
        { timeout: 10_000, interval: 200 },
      )
      .toContain("Edited from the local preview");

    // Vite rebuilds on every write, even one that changes nothing, and a
    // rebuild the author did not ask for costs them the state on screen.
    const nothing = await server.writeFiles("theme-a-user-1", [
      { path: "src/pages/index.tsx", content: edited },
    ]);
    expect(nothing.changed).toEqual([]);
    expect(nothing.unchanged).toEqual(["src/pages/index.tsx"]);

    // An editor may write Theme source. The generated config, the platform's
    // own marker and anything inside node_modules are not that, and the rule
    // that refuses them is the one already used on the sandbox path.
    for (const path of [
      "vite.config.ts",
      "package.json",
      ".morph-preview-workspace.sha256",
      "node_modules/react/index.js",
      "../../etc/passwd",
    ]) {
      await expect(
        server.writeFiles("theme-a-user-1", [{ path, content: "x" }]),
      ).rejects.toThrow();
    }
  }, 180_000);

  it("tells an already-loaded page about an edit, over the channel the preview uses", async () => {
    // The requirement a Live Preview actually has to meet is not "a later fetch
    // returns new bytes" — that is Vite reading the disk. It is "the page that is
    // already on screen is told to update". The preview moves that payload over
    // HTTP rather than a WebSocket, because the isolated preview origin cannot
    // carry Vite's HMR socket; `morph-preview-http-hmr` in the generated config
    // records every payload Vite computes and serves them from `/_morph/hmr`.
    //
    // So this asks that endpoint, which is exactly what the loaded page asks.
    // Without it the update path could break — the plugin's `hot.send` patch, the
    // endpoint, the payload shape — and every other test in this file would still
    // pass. Removing the write is the mutation that proves it is not vacuous.
    //
    // What it does *not* do is protect the file watcher, and that is worth
    // recording rather than implying. Disabling the watcher outright
    // (`server.watch: null`, which Vite treats as "no chokidar") leaves this test
    // and the fetch-based one above both green: no shape tried here — new fetch,
    // cached fetch, or this payload channel — could be made to depend on it. So
    // the watcher is a serving decision this transport takes from the generated
    // config and shares with the sandbox, and no test in this repo discriminates
    // it. If it ever needs protecting, that measurement has to come first.
    const server = newServer({ workspacesRoot });
    const started = await start(server);
    expectStarted(started);

    // Load what a page loads: the document, the generated entry, and the Theme
    // module itself. An update can only be computed for a module the graph has
    // seen — asking about a file nobody imported is asking about nothing.
    await (await fetch(started.url)).text();
    await (await fetch(under(started.url, "__entry.tsx"))).text();
    await (await fetch(under(started.url, "src/pages/index.tsx"))).text();

    const hmrUrl = new URL("/_morph/hmr?after=0&cursor=1", started.url);
    await server.writeFiles("theme-a-user-1", [
      {
        path: "src/pages/index.tsx",
        content: PAGE.replace("Hello", "Updated"),
      },
    ]);

    await expect
      .poll(
        async () => {
          const payloads = (await (await fetch(hmrUrl)).json()) as {
            entries: { payload?: { updates?: { path?: string }[] } }[];
          };
          return payloads.entries
            .flatMap((entry) => entry.payload?.updates ?? [])
            .map((update) => update.path ?? "")
            .join(",");
        },
        { timeout: 10_000, interval: 200 },
      )
      .toContain("index.tsx");
  }, 120_000);

  it("answers whether the address the editor framed is still served", async () => {
    const server = newServer({ workspacesRoot });
    const started = await start(server);
    expectStarted(started);
    const origin = new URL(started.url).origin;

    await expect(
      server.isServing({
        previewId: "theme-a-user-1",
        previewHostname: "127.0.0.1",
        expectedOrigin: origin,
      }),
    ).resolves.toBe(true);
    // A different address is a different question, and the answer is no.
    await expect(
      server.isServing({
        previewId: "theme-a-user-1",
        previewHostname: "127.0.0.1",
        expectedOrigin: "http://127.0.0.1:1",
      }),
    ).resolves.toBe(false);
    await expect(
      server.isServing({
        previewId: "another-theme",
        previewHostname: "127.0.0.1",
        expectedOrigin: origin,
      }),
    ).resolves.toBe(false);

    await server.stop("theme-a-user-1");
    await expect(
      server.isServing({
        previewId: "theme-a-user-1",
        previewHostname: "127.0.0.1",
        expectedOrigin: origin,
      }),
    ).resolves.toBe(false);
    // Stopping something that is not running is the outcome asked for.
    await expect(server.stop("theme-a-user-1")).resolves.toBeUndefined();

    // The port is really released, which is what lets the next start bind it.
    const restarted = await start(server, { previewId: "theme-a-user-1" });
    expectStarted(restarted);
  }, 180_000);

  it("keeps its workspace where a toolchain can be resolved from it", async () => {
    const server = newServer({ workspacesRoot });
    const started = await start(server);
    expectStarted(started);

    const workspace = server.workspaceRootFor("theme-a-user-1");
    expect(workspace.startsWith(workspacesRoot)).toBe(true);
    const config = await fs.readFile(
      path.join(workspace, "vite.config.ts"),
      "utf8",
    );
    // The config names the real root, because the toolchain that reads it
    // resolves paths against the real filesystem.
    const configWorkspace = workspace.split(path.sep).join("/");
    expect(config).toContain(`root: ${JSON.stringify(configWorkspace)}`);
    expect(config).toContain(`allow: [${JSON.stringify(configWorkspace)}`);
    expect(config).not.toContain('root: "/workspace"');
    // The platform marker the materializer reconciles around, in the same
    // place the sandbox keeps it.
    await expect(
      fs.readFile(
        path.join(workspace, ".morph-preview-workspace.sha256"),
        "utf8",
      ),
    ).resolves.toMatch(/^[0-9a-f]{64}$/);
  }, 120_000);

  it("refuses to serve out of a directory no toolchain resolves from", async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "morph-preview-"));
    outsideRoots.push(outside);
    const server = newServer({ workspacesRoot: outside });
    const started = await start(server);

    expect(started.ok).toBe(false);
    if (started.ok) return;
    expect(started.stage).toBe("preview-toolchain");
    expect(started.errorMessage).toContain("LOCAL_PREVIEW_TOOLCHAIN");
  });
});

describe("which hosts a local preview may claim", () => {
  it("accepts the names that are this machine by definition", () => {
    for (const hostname of [
      "127.0.0.1",
      "localhost",
      "LOCALHOST",
      "::1",
      "preview.localhost",
      "a.b.localhost.",
    ]) {
      expect(isLoopbackPreviewHostname(hostname)).toBe(true);
    }
  });

  it("refuses every name that is not", () => {
    for (const hostname of [
      "",
      "0.0.0.0",
      "example.com",
      "morph.yuho0298.workers.dev",
      "notreally.localhost.example.com",
      "127.0.0.1.example.com",
    ]) {
      expect(isLoopbackPreviewHostname(hostname)).toBe(false);
    }
  });
});

/**
 * The sidecar orders its starts by the same source generation as the
 * container: a start read before a save that a sync has laid out is refused,
 * and only a start that has laid its files out raises the ledger.
 */
describe("the local preview's generation watermark", () => {
  const PREVIEW = "theme-a-user-1";
  const NEW = "src/components/New.tsx";
  const onDisk = (server: LocalVitePreviewServer, file: string) =>
    fs.readFile(path.join(server.workspaceRootFor(PREVIEW), file), "utf8");

  it("refuses an older start that would remove a file a newer save created", async () => {
    const server = newServer({ workspacesRoot });
    expectStarted(
      await start(server, {
        fileVersions: { "src/pages/index.tsx": 1 },
        sourceGeneration: 4,
      }),
    );
    // A newer save (generation 5) created a file; its sync laid it out.
    await server.writeFiles(
      PREVIEW,
      [{ path: NEW, content: "export default () => null;\n", fence: 1 }],
      5,
    );

    // Read before that save, with a changed page so it would lay out again.
    const older = await start(server, {
      files: [{ path: "src/pages/index.tsx", content: `// older\n${PAGE}` }],
      fileVersions: { "src/pages/index.tsx": 1 },
      sourceGeneration: 4,
    });

    expect(older).toMatchObject({
      ok: false,
      stage: "preview-start-stale",
      errorMessage: expect.stringContaining("source generation 5"),
    });
    await expect(onDisk(server, NEW)).resolves.toBe(
      "export default () => null;\n",
    );
  });

  it("raises nothing for a start that fails to lay its files out", async () => {
    const server = newServer({ workspacesRoot });
    expectStarted(await start(server, { sourceGeneration: 4 }));

    // A directory where the page must be written: the next lay-out fails.
    const blocked = path.join(
      server.workspaceRootFor(PREVIEW),
      "src/pages/other.tsx",
    );
    await fs.mkdir(blocked, { recursive: true });
    const failed = await start(server, {
      files: [
        { path: "src/pages/index.tsx", content: PAGE },
        { path: "src/pages/other.tsx", content: PAGE },
      ],
      sourceGeneration: 9,
    });
    expect(failed).toMatchObject({ ok: false, stage: "preview-workspace" });
    await removeTree(blocked);

    // Had the failed start raised the ledger to 9, this would be refused.
    expectStarted(
      await start(server, {
        files: [{ path: "src/pages/index.tsx", content: `// again\n${PAGE}` }],
        sourceGeneration: 5,
      }),
    );
  });
});
