// @vitest-environment node
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { STARTER_THEME_FILES } from "@/lib/storefront/starter-theme-files";
import { astroThemeFiles } from "../theme-framework/astro-native-prerender.fixtures";
import { planAstroPreviewWorkspace } from "../theme-framework/astro-preview-workspace";
import {
  LocalVitePreviewServer,
  localPreviewReuseKey,
} from "./local-vite-preview-server";
import { DEFAULT_APPROVED_DEPENDENCIES } from "./sandbox-vite-theme-build-runner.types";
import {
  THEME_PREVIEW_CONTENT_DATA_RELATIVE_PATH,
  THEME_PREVIEW_CONTENT_SNAPSHOT_MODULE_PATH,
  previewContentDigest,
  type ThemePreviewContentSnapshot,
} from "./theme-preview-content";
import {
  planThemeSandboxWorkspace,
  type PrepareThemeWorkspaceResult,
} from "./theme-sandbox-workspace";

/**
 * Multi-tab Full Start preview: every tab of one author shares a preview id,
 * and every start carries a fresh content ticket. Reuse of the running dev
 * server is decided without the draft content snapshot, so a start whose
 * content alone differs keeps the child (and its address) instead of
 * restarting it for ~6 s, during which the other tabs' renewal saw
 * "not serving".
 *
 * No dev server is started here: the child fork is replaced by a stand-in
 * that only counts, so these tests bind no port. What a real child serves
 * from the files written here is the Start tests' and E2E's to show.
 */

/** A snapshot as the server function hands one over: content, ticket, hash. */
async function content(
  headline: string,
  contentTicket: number,
): Promise<ThemePreviewContentSnapshot> {
  const body = {
    templates: { index: { slots: { hero: { headline } }, hiddenSlots: [] } },
    pages: {},
  };
  return {
    ...body,
    contentTicket,
    contentHash: await previewContentDigest(JSON.stringify(body)),
    contentVersions: "[1]",
  };
}

describe("the local reuse key", () => {
  const plan = (
    previewContent: ThemePreviewContentSnapshot,
    extra: readonly { path: string; content: string }[] = [],
  ) => {
    const prepared = planThemeSandboxWorkspace({
      files: [...STARTER_THEME_FILES, ...extra] as never,
      entry: "src/routes/index.tsx",
      buildId: "reuse-key-preview",
      approvedDependencies: new Set(DEFAULT_APPROVED_DEPENDENCIES),
      mode: "preview-server",
      previewContent,
      previewRuntime: "start",
      hostWorkspaceRoot: "/tmp/reuse-key-workspace",
      toolchainRoot: "/tmp/reuse-key-toolchain",
    });
    return ready(prepared);
  };

  it("is the same for two Start plans whose snapshots differ only in their ticket", async () => {
    const first = plan(await content("A", 1));
    const second = plan(await content("A", 2));
    // The full fingerprint (the on-disk marker the sandbox reads) still
    // differs: the snapshot module carries the ticket. It is left as it is.
    expect(first.workspaceFingerprint).not.toBe(second.workspaceFingerprint);
    expect(localPreviewReuseKey(first.workspaceFiles)).toBe(
      localPreviewReuseKey(second.workspaceFiles),
    );
  });

  it("is the same when only the content differs, and differs when the source does", async () => {
    const a = plan(await content("A", 1));
    const b = plan(await content("B", 2));
    expect(localPreviewReuseKey(a.workspaceFiles)).toBe(
      localPreviewReuseKey(b.workspaceFiles),
    );
    const edited = plan(await content("A", 1), [
      {
        path: "src/components/reuse-key-extra.tsx",
        content: "export const x = 1;\n",
      },
    ]);
    expect(localPreviewReuseKey(edited.workspaceFiles)).not.toBe(
      localPreviewReuseKey(a.workspaceFiles),
    );
  });

  it("leaves out only the two preview-content files", async () => {
    const a = plan(await content("A", 1));
    const paths = a.workspaceFiles.map((file) => file.path);
    expect(paths).toContain(
      `/workspace/${THEME_PREVIEW_CONTENT_DATA_RELATIVE_PATH}`,
    );
    expect(paths).toContain(
      `/workspace/${THEME_PREVIEW_CONTENT_SNAPSHOT_MODULE_PATH}`,
    );
    const others = a.workspaceFiles.filter(
      (file) =>
        file.path !==
          `/workspace/${THEME_PREVIEW_CONTENT_DATA_RELATIVE_PATH}` &&
        file.path !==
          `/workspace/${THEME_PREVIEW_CONTENT_SNAPSHOT_MODULE_PATH}`,
    );
    expect(localPreviewReuseKey(a.workspaceFiles)).toBe(
      localPreviewReuseKey(others),
    );
  });

  it("is the same for two Astro plans whose content differs, and not for other source", async () => {
    const astro = async (headline: string, ticket: number, marker = "v1") =>
      ready(
        planAstroPreviewWorkspace({
          files: astroThemeFiles({
            extra: [
              { path: "src/pages/live.astro", content: `<p>${marker}</p>\n` },
            ],
          }) as never,
          entry: "",
          buildId: "reuse-key-astro",
          approvedDependencies: new Set(DEFAULT_APPROVED_DEPENDENCIES),
          mode: "preview-server",
          previewContent: await content(headline, ticket),
          hostWorkspaceRoot: "/tmp/reuse-key-astro",
          toolchainRoot: "/tmp/reuse-key-astro-toolchain",
        }),
      );
    const a = await astro("A", 1);
    const b = await astro("B", 2);
    expect(a.workspaceFingerprint).not.toBe(b.workspaceFingerprint);
    expect(localPreviewReuseKey(a.workspaceFiles)).toBe(
      localPreviewReuseKey(b.workspaceFiles),
    );
    const v2 = await astro("A", 1, "v2");
    expect(localPreviewReuseKey(v2.workspaceFiles)).not.toBe(
      localPreviewReuseKey(a.workspaceFiles),
    );
  });
});

function ready(prepared: PrepareThemeWorkspaceResult) {
  if (!prepared.ok)
    throw new Error(`${prepared.stage}: ${prepared.errorMessage}`);
  return prepared;
}

const WORKSPACES_ROOT = path.join(process.cwd(), ".morph-previews-reuse-test");
const PREVIEW_ID = "start-reuse-test";
const ROOT = path.join(WORKSPACES_ROOT, PREVIEW_ID);
const DATA_FILE = path.join(ROOT, THEME_PREVIEW_CONTENT_DATA_RELATIVE_PATH);
const SNAPSHOT_MODULE = path.join(
  ROOT,
  THEME_PREVIEW_CONTENT_SNAPSHOT_MODULE_PATH,
);

/** A Theme source file of the starter, edited by a sync in one test. */
const SOURCE_FILE = STARTER_THEME_FILES.find(
  (file) => file.path === "src/routes/index.tsx",
)!;

describe("a Start start on the local transport, content against source", () => {
  let server: LocalVitePreviewServer;
  /** Children "forked" so far; none of them is a real process. */
  let forks = 0;
  /** Children closed so far. */
  let closed = 0;
  /** Makes the n-th stand-in child "die" without a close, as a crash does. */
  const kills: (() => void)[] = [];

  const start = async (
    previewContent: ThemePreviewContentSnapshot,
    extra: readonly { path: string; content: string }[] = [],
  ) => {
    const started = await server.start({
      previewId: PREVIEW_ID,
      files: [...STARTER_THEME_FILES, ...extra] as never,
      entry: "src/routes/index.tsx",
      previewHostname: "127.0.0.1",
      platformHostEnv: {},
      previewRuntime: "start",
      previewContent,
    });
    if (!started.ok)
      throw new Error(`${started.stage}: ${started.errorMessage}`);
    return started;
  };
  const dataOnDisk = async () =>
    JSON.parse(await fs.readFile(DATA_FILE, "utf8")) as {
      contentTicket?: number;
      previewInstance?: string;
      templates: { index: { slots: { hero: { headline: string } } } };
    };
  const moduleOnDisk = () => fs.readFile(SNAPSHOT_MODULE, "utf8");

  beforeEach(async () => {
    await server?.stop(PREVIEW_ID).catch(() => {});
    await fs.rm(WORKSPACES_ROOT, { recursive: true, force: true });
    await fs.mkdir(WORKSPACES_ROOT, { recursive: true });
    forks = 0;
    closed = 0;
    kills.length = 0;
    server = new LocalVitePreviewServer({
      workspacesRoot: WORKSPACES_ROOT,
      toolchainRoot: process.cwd(),
      approvedDependencies: DEFAULT_APPROVED_DEPENDENCIES,
    });
    // The fork of `local-vite-preview-child.mjs`, replaced: a child that
    // "listens" on a port number it never binds, distinct per fork so a
    // restart shows in the URL.
    vi.spyOn(
      server as unknown as {
        startChildServer: (...args: unknown[]) => Promise<unknown>;
      },
      "startChildServer",
    ).mockImplementation(async () => {
      forks += 1;
      let alive = true;
      kills.push(() => {
        alive = false;
      });
      return {
        port: 59_000 + forks,
        handle: {
          listening: () => alive,
          close: async () => {
            alive = false;
            closed += 1;
          },
        },
      };
    });
  });

  afterAll(async () => {
    await server?.stop(PREVIEW_ID).catch(() => {});
    await fs
      .rm(WORKSPACES_ROOT, { recursive: true, force: true })
      .catch(() => {});
  });

  it("keeps the child for a start whose snapshot differs only in its ticket", async () => {
    const first = await start(await content("A", 1));
    expect(first.timings?.reusedProcess).toBe(false);
    const instance = (await dataOnDisk()).previewInstance;
    expect(instance).toBeTruthy();

    const second = await start(await content("A", 2));
    expect(forks).toBe(1);
    expect(closed).toBe(0);
    expect(second.url).toBe(first.url);
    expect(second.readyMs).toBe(0);
    expect(second.timings?.reusedProcess).toBe(true);
    // The newer ticket is what the running Worker names on its probe.
    expect(await dataOnDisk()).toMatchObject({
      contentTicket: 2,
      previewInstance: instance,
    });
    expect(await moduleOnDisk()).toContain('"contentTicket":2');
  });

  it("keeps the child for other content, and the child reads the new snapshot from both files", async () => {
    const first = await start(await content("A", 1));
    const instance = (await dataOnDisk()).previewInstance;
    expect(await moduleOnDisk()).toContain('"headline":"A"');

    const second = await start(await content("B", 3));
    expect(forks).toBe(1);
    expect(second.url).toBe(first.url);
    expect(second.timings?.reusedProcess).toBe(true);
    // The Worker's SSR reads the data file, stamped for the running child.
    const data = await dataOnDisk();
    expect(data.templates.index.slots.hero.headline).toBe("B");
    expect(data.contentTicket).toBe(3);
    expect(data.previewInstance).toBe(instance);
    // The page in the browser loads the snapshot module.
    const snapshotModule = await moduleOnDisk();
    expect(snapshotModule).toContain('"headline":"B"');
    expect(snapshotModule).toContain('"contentTicket":3');
  });

  it("lays neither file back for an older start, nor over a ticket with other content", async () => {
    await start(await content("A", 1));
    await start(await content("B", 3));

    const older = await start(await content("A", 2));
    expect(forks).toBe(1);
    expect(older.timings?.reusedProcess).toBe(true);
    expect((await dataOnDisk()).templates.index.slots.hero.headline).toBe("B");
    expect((await dataOnDisk()).contentTicket).toBe(3);
    expect(await moduleOnDisk()).toContain('"headline":"B"');

    const conflicting = await start(await content("C", 3));
    expect(forks).toBe(1);
    expect(conflicting.timings?.reusedProcess).toBe(true);
    expect((await dataOnDisk()).templates.index.slots.hero.headline).toBe("B");
    expect(await moduleOnDisk()).toContain('"headline":"B"');
    expect(conflicting.logs.join("\n")).toContain(
      "PREVIEW_CONTENT_TICKET_CONFLICT",
    );
  });

  it("still restarts the child when the source differs", async () => {
    const first = await start(await content("A", 1));
    const second = await start(await content("A", 2), [
      {
        path: "src/components/reuse-extra.tsx",
        content: "export const extra = 1;\n",
      },
    ]);
    expect(forks).toBe(2);
    expect(closed).toBe(1);
    expect(second.timings?.reusedProcess).toBe(false);
    expect(second.url).not.toBe(first.url);
  });

  it("restarts after a source sync changed the workspace, and lays the start's own files out again", async () => {
    await start(await content("A", 1));
    const synced = await server.writeFiles(PREVIEW_ID, [
      {
        path: SOURCE_FILE.path,
        content: `${SOURCE_FILE.content}\n// synced\n`,
      },
    ]);
    expect(synced.changed).toEqual([SOURCE_FILE.path]);

    // The same files as the first start: they are not what the disk holds.
    const again = await start(await content("A", 2));
    expect(forks).toBe(2);
    expect(again.timings?.reusedProcess).toBe(false);
    const onDisk = await fs.readFile(path.join(ROOT, SOURCE_FILE.path), "utf8");
    expect(onDisk).not.toContain("// synced");
  });

  it("restarts after a source sync for a start with no content snapshot at all", async () => {
    const plain = async () => {
      const started = await server.start({
        previewId: PREVIEW_ID,
        files: [...STARTER_THEME_FILES] as never,
        entry: "src/routes/index.tsx",
        previewHostname: "127.0.0.1",
        platformHostEnv: {},
        previewRuntime: "start",
      });
      if (!started.ok)
        throw new Error(`${started.stage}: ${started.errorMessage}`);
      return started;
    };
    await plain();
    await server.writeFiles(PREVIEW_ID, [
      {
        path: SOURCE_FILE.path,
        content: `${SOURCE_FILE.content}\n// synced\n`,
      },
    ]);
    const again = await plain();
    expect(forks).toBe(2);
    expect(again.timings?.reusedProcess).toBe(false);
    const onDisk = await fs.readFile(path.join(ROOT, SOURCE_FILE.path), "utf8");
    expect(onDisk).not.toContain("// synced");
  });

  it("keeps the child after a sync that changed nothing", async () => {
    await start(await content("A", 1));
    const onDisk = await fs.readFile(path.join(ROOT, SOURCE_FILE.path), "utf8");
    const synced = await server.writeFiles(PREVIEW_ID, [
      { path: SOURCE_FILE.path, content: onDisk },
    ]);
    expect(synced.unchanged).toEqual([SOURCE_FILE.path]);

    const again = await start(await content("A", 2));
    expect(forks).toBe(1);
    expect(again.timings?.reusedProcess).toBe(true);
  });

  it("does not reuse a child that has died, and starts a new one", async () => {
    const first = await start(await content("A", 1));
    expect(forks).toBe(1);
    kills[0]();

    const again = await start(await content("A", 2));
    expect(forks).toBe(2);
    expect(again.timings?.reusedProcess).toBe(false);
    expect(again.url).not.toBe(first.url);
    expect(
      await server.isServing({
        previewId: PREVIEW_ID,
        previewHostname: "127.0.0.1",
      }),
    ).toBe(true);
  });

  it("does not bring a stopped preview back when a stop lands inside a source sync", async () => {
    await start(await content("A", 1));
    const realReadFile = fs.readFile.bind(fs);
    let stopped = false;
    const spy = vi.spyOn(fs, "readFile").mockImplementation(((
      ...args: Parameters<typeof fs.readFile>
    ) => {
      if (!stopped && String(args[0]).endsWith(SOURCE_FILE.path)) {
        stopped = true;
        return server.stop(PREVIEW_ID).then(() => realReadFile(...args));
      }
      return realReadFile(...args);
    }) as never);
    try {
      await server
        .writeFiles(PREVIEW_ID, [
          {
            path: SOURCE_FILE.path,
            content: `${SOURCE_FILE.content}
// synced
`,
          },
        ])
        .catch(() => {});
    } finally {
      spy.mockRestore();
    }
    expect(stopped).toBe(true);
    expect(server.servingPreviewIds()).toEqual([]);
    expect(
      await server.isServing({
        previewId: PREVIEW_ID,
        previewHostname: "127.0.0.1",
      }),
    ).toBe(false);
  });

  it("lays the snapshot module out by a rename, never by writing the live file", async () => {
    await start(await content("A", 1));
    const renames: string[] = [];
    const realRename = fs.rename.bind(fs);
    const spy = vi.spyOn(fs, "rename").mockImplementation(((
      from: string,
      to: string,
    ) => {
      renames.push(String(to));
      return realRename(from, to);
    }) as never);
    try {
      await start(await content("B", 2));
    } finally {
      spy.mockRestore();
    }
    expect(renames).toContain(SNAPSHOT_MODULE);
    expect(await moduleOnDisk()).toContain('"headline":"B"');
    const left = (await fs.readdir(path.dirname(SNAPSHOT_MODULE))).filter(
      (name) => name.includes(".next-"),
    );
    expect(left).toEqual([]);
  });
});
