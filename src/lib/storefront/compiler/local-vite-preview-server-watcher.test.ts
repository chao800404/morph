// @vitest-environment node
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, type ViteDevServer } from "vite";
import {
  LOCAL_PREVIEW_POLLING_WATCHER,
  LocalVitePreviewServer,
} from "./local-vite-preview-server";
import { DEFAULT_APPROVED_DEPENDENCIES } from "./sandbox-vite-theme-build-runner.types";

/**
 * The guard that keeps the file watcher off polling.
 *
 * Its sibling file says nothing there is mocked, and means it. This one mocks
 * `createServer` for a reason that does not apply there: what is under test is
 * a decision made about the configuration Vite resolved, and the only way to
 * present this transport with a polling configuration — without editing the
 * source it is meant to protect — is to hand it one.
 *
 * The guard's main effect is not here. `watch: { usePolling: false }` is
 * load-bearing, and deleting it now makes every real start in the sibling file
 * fail immediately, on any machine, under any load. Before the guard, the only
 * thing that noticed was one integration test that had to run alone: the defect
 * is a race with the watcher's first scan, so anything that keeps the watcher
 * busy first — a prior request, a full suite, a loaded CI runner — hid it, and
 * a green `pnpm test` said nothing at all about the option.
 *
 * So these two tests exist to protect the guard itself, which is the one thing
 * removing the override no longer breaks.
 */

vi.mock("vite", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createServer: vi.fn(),
}));

const PAGE = `export default function Page() {
  return <h1>Hello</h1>;
}
`;

const WORKSPACES_ROOT = path.join(process.cwd(), ".morph-previews-watcher-test");

/**
 * Remove this test's workspace without asking a sandbox to approve one large
 * recursive delete. Some Windows runners protect bulk cleanup even though
 * the test only owns this directory. Walking the known tree keeps cleanup
 * bounded to the files this test created and uses non-recursive deletes.
 */
async function removeTree(target: string): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(target, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }

  for (const entry of entries) {
    const child = path.join(target, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      await removeTree(child);
    } else {
      await fs.rm(child, { force: true });
    }
  }

  await fs.rmdir(target);
}

/** A Vite server that reports the watch mode a test wants to present. */
function serverReporting(usePolling: boolean) {
  return {
    config: { server: { watch: { usePolling, interval: 100 } } },
    listen: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    waitForRequestsIdle: vi.fn(async () => {}),
    httpServer: { address: () => ({ port: 4321 }) },
  };
}

function newServer() {
  return new LocalVitePreviewServer({
    workspacesRoot: WORKSPACES_ROOT,
    toolchainRoot: process.cwd(),
    approvedDependencies: DEFAULT_APPROVED_DEPENDENCIES,
    readyTimeoutMs: 60_000,
  });
}

const start = (server: LocalVitePreviewServer) =>
  server.start({
    previewId: "watcher-guard",
    files: [{ path: "src/pages/index.tsx", content: PAGE }],
    entry: "src/pages/index.tsx",
    previewHostname: "127.0.0.1",
    env: {},
  });

beforeAll(async () => {
  await fs.mkdir(WORKSPACES_ROOT, { recursive: true });
});

afterEach(() => {
  vi.mocked(createServer).mockReset();
});

afterAll(async () => {
  await removeTree(WORKSPACES_ROOT);
});

describe("the local preview's watcher guard", () => {
  it("refuses to serve from a configuration that polls, and closes it", async () => {
    const vite = serverReporting(true);
    vi.mocked(createServer).mockResolvedValue(vite as unknown as ViteDevServer);

    const result = await start(newServer());

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errorMessage).toContain(
      LOCAL_PREVIEW_POLLING_WATCHER,
    );
    // Refused before listening, rather than served and then withdrawn: a
    // polling server answers requests perfectly well, so a preview that
    // reached the editor would look correct and silently drop the writes that
    // arrived during the watcher's first scan.
    expect(vite.listen).not.toHaveBeenCalled();
    expect(vite.close).toHaveBeenCalled();
  });

  it("serves one that does not", async () => {
    const vite = serverReporting(false);
    vi.mocked(createServer).mockResolvedValue(vite as unknown as ViteDevServer);

    const result = await start(newServer());

    expect(result.ok).toBe(true);
    expect(vite.listen).toHaveBeenCalled();
    expect(vite.close).not.toHaveBeenCalled();
  });
});
