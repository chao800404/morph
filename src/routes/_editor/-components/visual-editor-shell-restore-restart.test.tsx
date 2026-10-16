import {
  notifyManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Profiler, useState } from "react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RESTORE_THEME_CONTENT_MODULE_COMMAND } from "@/lib/storefront/ast/theme-content-module";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import type { StorefrontThemeFileDTO } from "@/lib/storefront/dto/storefront-theme-file.dto";
import { useEditorWriteGateStore } from "@/lib/storefront/store/editor-write-gate-store";
import { useThemeWorkspaceStore } from "@/lib/storefront/store/theme-workspace-store";
import { STARTER_THEME_CONTENT_MODULE_SOURCE } from "@/lib/storefront/starter-theme-v3-files";
import { THEME_CONTENT_MODULE_PATH } from "@/lib/storefront/theme-content-slots";
import type { StorefrontThemeEditorSearch } from "@/lib/validations/storefront-theme";
import {
  listStorefrontThemeFiles,
  saveStorefrontThemeFile,
} from "@/server/storefront/storefront-theme-files.serverFn";
import {
  applyThemePreviewFiles,
  startThemePreviewServer,
} from "@/server/storefront/storefront-theme-preview-server.serverFn";
import { storefrontThemeFileQueries } from "../-queries/storefront-theme-files.queries";
import { themePreviewServerQueries } from "../-queries/theme-preview-server.queries";
import { VisualEditorShell } from "./visual-editor-shell";

/**
 * Regression: restoring the content module restarts the Live Preview.
 *
 * e2e/content-module-restore.spec.ts:188 sometimes saw no
 * startThemePreviewServer / applyThemePreviewFiles after the restore command,
 * although the "Created" toast showed; the #214 CI trace has no
 * `[preview-lifecycle] reconnecting` line after the restore either.
 *
 * Cause: `retryLivePreview` dispatches `manual-recovery`. When that lands
 * between a shell commit and its passive effects, the server-state effect
 * still runs for that commit, with the phase it rendered, and dispatches
 * `server-ready` for the frame the restart replaces. The reducer used to take
 * it — [manual-recovery, server-ready(K)]: reconnecting -> loading-frame — so
 * "reconnecting" was never committed and the recovery effect, the only path
 * that issues the start request, never ran. A reconnect now ignores server
 * answers until its own request finishes.
 *
 * Everything here is the real shell, the real Code workspace and the real
 * lifecycle reducer. Test-only: Monaco is a textarea and the server functions
 * are mocks, and the reducer is wrapped only to record what it processed. The
 * race is set up with jsdom and a busy wait inside the Profiler's onRender,
 * not with CI's real timing.
 */

vi.mock("@monaco-editor/react", () => ({
  default: ({
    defaultValue,
    onChange,
  }: {
    defaultValue?: string;
    onChange?: (value?: string) => void;
  }) => {
    const [value, setValue] = useState(defaultValue ?? "");
    return (
      <textarea
        aria-label="Code editor"
        value={value}
        onChange={(event) => {
          setValue(event.currentTarget.value);
          onChange?.(event.currentTarget.value);
        }}
      />
    );
  },
}));

vi.mock("./editor-code-language-support", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./editor-code-language-support")>()),
  configureThemeTypeScript: vi.fn(),
  disposeThemeWorkspaceModels: vi.fn(),
  ensureThemeWorkspaceModels: vi.fn(),
  registerTailwindCompletionProvider: vi.fn(() => ({ dispose: vi.fn() })),
}));

vi.mock("./editor-code-formatter", () => ({
  formatEditorCode: vi.fn(async (content: string) => content),
}));

vi.mock(
  "@/server/storefront/storefront-theme-files.serverFn",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    saveStorefrontThemeFile: vi.fn(),
    getStorefrontThemeFile: vi.fn(async () => ({
      success: false,
      message: "not used",
    })),
    listStorefrontThemeFiles: vi.fn(),
    auditStorefrontThemeContent: vi.fn(async () => ({
      success: false,
      message: "not used",
    })),
    previewThemeManifestMigration: vi.fn(async () => ({
      success: false,
      message: "not used",
    })),
  }),
);

vi.mock(
  "@/server/storefront/storefront-theme-preview-server.serverFn",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    startThemePreviewServer: vi.fn(),
    applyThemePreviewFiles: vi.fn(),
    touchThemePreviewServer: vi.fn(async () => ({
      success: false,
      message: "not used",
    })),
    probeThemePreviewAddress: vi.fn(async () => ({
      success: true,
      message: "ok",
      data: { state: "unknown" },
    })),
  }),
);

/**
 * Every event React's reducer processed, with the phase before and after.
 * A test-side wrapper only; the reducer itself is the real one. React may
 * re-run a reducer when it rebases skipped updates, so a line can repeat.
 */
const reducerLog = vi.hoisted(() => [] as string[]);
vi.mock("./live-preview-lifecycle", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./live-preview-lifecycle")>();
  return {
    ...actual,
    reduceLivePreviewLifecycle: (
      state: Parameters<typeof actual.reduceLivePreviewLifecycle>[0],
      event: Parameters<typeof actual.reduceLivePreviewLifecycle>[1],
    ) => {
      const next = actual.reduceLivePreviewLifecycle(state, event);
      const key = "key" in event && event.key ? `(${event.key.slice(-12)})` : "";
      reducerLog.push(
        `${event.type}${key} ${state.phase}->${next.phase} rid=${next.recoveryId}`,
      );
      return next;
    },
  };
});

vi.mock("@/lib/storefront/editor/preview-protocol", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  postEditorToPreviewMessage: vi.fn(),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Link: ({ to, children, ...rest }: { to?: string; children?: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

const PREVIEW_ORIGIN = "https://preview.morph.test";
const PREVIEW_SESSION = "5f0f0f6e-6c2e-4f1c-9a3e-0f9a2b7c1d4e";
const HERO_PATH = "src/components/Hero.tsx";

const heroFile = {
  id: "file-hero",
  storefrontId: "storefront-1",
  themeId: "theme-1",
  path: HERO_PATH,
  content: "export default function Hero() { return <section>x</section>; }\n",
  mimeType: "text/typescript",
  isEntry: false,
  version: 1,
  createdAt: "2026-10-17T00:00:00.000Z",
  updatedAt: "2026-10-17T00:00:00.000Z",
} as StorefrontThemeFileDTO;

const contentFile = {
  ...heroFile,
  id: "file-content",
  path: THEME_CONTENT_MODULE_PATH,
  content: STARTER_THEME_CONTENT_MODULE_SOURCE,
} as StorefrontThemeFileDTO;

const context = {
  previewChannel: {
    editorOrigin: "http://localhost:3000",
    sessionId: PREVIEW_SESSION,
  },
  storefront: { id: "storefront-1", name: "Store", domain: null, status: "active" },
  theme: { id: "theme-1", name: "Theme", sourceGeneration: 1 },
  templates: [
    {
      id: "template-1",
      type: "index",
      name: "Home",
      document: { version: 1, sections: [] },
      draftGeneration: 1,
      version: 1,
    },
  ],
} as unknown as StorefrontThemeEditorDTO;

const tree = (files: StorefrontThemeFileDTO[], sourceGeneration: number) => ({
  files,
  tree: [
    {
      name: "src",
      path: "src",
      isDirectory: true,
      children: [
        {
          name: "components",
          path: "src/components",
          isDirectory: true,
          children: [{ name: "Hero.tsx", path: HERO_PATH, isDirectory: false }],
        },
        ...(files.some((file) => file.path === THEME_CONTENT_MODULE_PATH)
          ? [
              {
                name: "morph",
                path: "src/morph",
                isDirectory: true,
                children: [
                  {
                    name: "content.ts",
                    path: THEME_CONTENT_MODULE_PATH,
                    isDirectory: false,
                  },
                ],
              },
            ]
          : []),
      ],
    },
  ],
  sourceGeneration,
  latestPublishedRevision: null,
});

/** Every `[preview-lifecycle]` line the shell logs, in order. */
let lifecycleLog: string[] = [];
/** Ordered record of the calls that matter, with the lifecycle beside them. */
let events: string[] = [];

/**
 * Query observer notifications are normally delivered with setTimeout(0).
 * While `held`, they queue here instead, so the test decides whether they
 * reach React before or after React renders the restart's dispatch.
 */
let held = false;
let heldNotifications: Array<() => void> = [];
function releaseNotifications() {
  held = false;
  const queued = heldNotifications;
  heldNotifications = [];
  for (const run of queued) run();
}

/** Called on every commit of the shell's tree (React Profiler). */
let onShellCommit: ((phase: string) => void) | null = null;

function renderShell() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(
    themePreviewServerQueries.forTheme("storefront-1", "theme-1").queryKey,
    {
      success: true,
      message: "Live Preview server ready",
      data: { url: `${PREVIEW_ORIGIN}/store/1/themes/1/preview` },
    } as never,
  );
  client.setQueryData(
    storefrontThemeFileQueries.tree("storefront-1", "theme-1").queryKey,
    tree([heroFile], 1) as never,
  );
  render(
    <QueryClientProvider client={client}>
      <Profiler id="shell" onRender={(_id, phase) => onShellCommit?.(phase)}>
        <VisualEditorShell
          context={context}
          search={
            {
              template: "index",
              templateId: "template-1",
              viewport: "desktop",
            } as StorefrontThemeEditorSearch
          }
          onSearchChange={vi.fn()}
        />
      </Profiler>
    </QueryClientProvider>,
  );
  return client;
}

function frameReady() {
  const current = document.querySelector("iframe");
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "morph:storefront-preview-ready",
          previewSession: PREVIEW_SESSION,
        },
        origin: PREVIEW_ORIGIN,
        source: current?.contentWindow ?? null,
      }),
    );
  });
}

async function openCodeMode() {
  act(() => {
    screen.getByRole("button", { name: /^Code$/ }).click();
  });
  await waitFor(
    () => {
      expect(screen.getByTitle("Command Palette (Ctrl+Shift+P)")).toBeTruthy();
    },
    { timeout: 15_000 },
  );
}

function restoreCommand() {
  fireEvent.click(screen.getByTitle("Command Palette (Ctrl+Shift+P)"));
  return screen.getByRole("option", { name: RESTORE_THEME_CONTENT_MODULE_COMMAND });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Release = "before-react-renders" | "after-react-renders";

/**
 * Restores the module and returns what followed, with the observer
 * notifications for the refetched tree delivered as `release` says.
 */
async function restore({
  release,
  refetchChangesData,
  frameIsReady,
}: {
  release: Release;
  refetchChangesData: boolean;
  frameIsReady: boolean;
}) {
  renderShell();
  // Let the shell settle into its first lifecycle phase.
  await waitFor(() => {
    expect(lifecycleLog.at(-1)).toMatch(/loading-frame/);
  });
  if (frameIsReady) {
    frameReady();
    await waitFor(() => {
      expect(lifecycleLog.at(-1)).toMatch(/syncing-source|ready/);
    });
  }
  await openCodeMode();
  await sleep(50);

  vi.mocked(listStorefrontThemeFiles).mockImplementation((async () => {
    events.push("listStorefrontThemeFiles");
    return {
      success: true,
      message: "ok",
      data: refetchChangesData ? tree([heroFile, contentFile], 2) : tree([heroFile], 1),
    };
  }) as never);
  vi.mocked(toast.success).mockImplementation(((message: string) => {
    events.push(`toast.success ${message}`);
    if (String(message).startsWith("Created ")) {
      // Runs right after this synchronous call returns, i.e. right after
      // onRestartPreview?.() — microtasks run before React's render task.
      if (release === "before-react-renders") {
        queueMicrotask(releaseNotifications);
      } else {
        setTimeout(releaseNotifications, 30);
      }
    }
    return "";
  }) as never);

  const startsBefore = vi.mocked(startThemePreviewServer).mock.calls.length;
  const appliesBefore = vi.mocked(applyThemePreviewFiles).mock.calls.length;
  const logBefore = lifecycleLog.length;
  const reducerBefore = reducerLog.length;

  const command = restoreCommand();
  expect(command.getAttribute("aria-disabled")).not.toBe("true");
  held = true;
  fireEvent.click(command);

  await waitFor(() => {
    expect(events.some((line) => line.startsWith("toast.success Created"))).toBe(true);
  });
  // Far longer than anything here takes; the E2E waits 30s on a real server.
  await sleep(500);
  releaseNotifications();
  await sleep(100);

  return {
    starts: vi.mocked(startThemePreviewServer).mock.calls.length - startsBefore,
    applies: vi.mocked(applyThemePreviewFiles).mock.calls.length - appliesBefore,
    lifecycleAfter: lifecycleLog.slice(logBefore),
    reducerAfter: reducerLog.slice(reducerBefore),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** A ready message from the current frame, sent outside act(), as a page sends it. */
function frameReadyOutsideAct() {
  const current = document.querySelector("iframe");
  window.dispatchEvent(
    new MessageEvent("message", {
      data: {
        type: "morph:storefront-preview-ready",
        previewSession: PREVIEW_SESSION,
      },
      origin: PREVIEW_ORIGIN,
      source: current?.contentWindow ?? null,
    }),
  );
}

function busyWait(ms: number) {
  const until = performance.now() + ms;
  while (performance.now() < until) {
    // A slow commit, as on a loaded CI runner: the Scheduler's 5ms slice is
    // spent, so it yields before running the commit's passive effects.
  }
}

type SaveLands = "inside-passive-window" | "after-passive-flush";

/**
 * The restore's save answer lands right after a Default-lane commit of the
 * shell, either before React has run that commit's passive effects or after.
 */
async function restoreAroundCommit(lands: SaveLands) {
  renderShell();
  await waitFor(() => {
    expect(lifecycleLog.at(-1)).toMatch(/loading-frame/);
  });
  await openCodeMode();
  await sleep(50);
  vi.mocked(listStorefrontThemeFiles).mockImplementation((async () => {
    events.push("listStorefrontThemeFiles");
    return {
      success: true,
      message: "ok",
      data: tree([heroFile, contentFile], 2),
    };
  }) as never);
  vi.mocked(toast.success).mockImplementation(((message: string) => {
    events.push(`toast.success ${message}`);
    return "";
  }) as never);
  const save = deferred<unknown>();
  vi.mocked(saveStorefrontThemeFile).mockImplementation((() => {
    events.push("saveStorefrontThemeFile");
    return save.promise;
  }) as never);

  const startsBefore = vi.mocked(startThemePreviewServer).mock.calls.length;
  const logBefore = lifecycleLog.length;
  const reducerBefore = reducerLog.length;
  fireEvent.click(restoreCommand());
  // The save is in flight; let everything it set off settle first.
  await sleep(100);
  expect(events).toContain("saveStorefrontThemeFile");

  const answer = {
    success: true,
    message: "Theme file saved",
    data: { ...contentFile, sourceGeneration: 2 },
  };
  let armed = true;
  onShellCommit = (phase) => {
    if (!armed || phase !== "update") return;
    armed = false;
    events.push(`shell commit (${phase})`);
    if (lands === "inside-passive-window") {
      busyWait(12);
      save.resolve(answer);
    }
  };
  // A Default-lane update of the shell, from outside React: the frame's ready
  // message moves loading-frame -> syncing-source.
  frameReadyOutsideAct();
  if (lands === "after-passive-flush") {
    // Run 2 resolved 50ms after the first commit and was swallowed too: the
    // frame's initial sync was still committing (syncing-source -> ready).
    // The control therefore waits until the lifecycle is ready and quiet.
    await waitFor(() => {
      expect(lifecycleLog.at(-1)).toMatch(/ready/);
    });
    await sleep(300);
    events.push("save answered (quiet shell)");
    save.resolve(answer);
  }

  await waitFor(() => {
    expect(events.some((line) => line.startsWith("toast.success Created"))).toBe(true);
  });
  await sleep(500);
  onShellCommit = null;
  return {
    starts: vi.mocked(startThemePreviewServer).mock.calls.length - startsBefore,
    lifecycleAfter: lifecycleLog.slice(logBefore),
    reducerAfter: reducerLog.slice(reducerBefore),
  };
}

beforeEach(() => {
  onShellCommit = null;
  lifecycleLog = [];
  reducerLog.length = 0;
  events = [];
  held = false;
  heldNotifications = [];
  notifyManager.setScheduler((run) => {
    if (held) heldNotifications.push(run);
    else setTimeout(run, 0);
  });
  useThemeWorkspaceStore.setState({ workspaces: {} });
  useEditorWriteGateStore.setState({ gates: {} });
  const realInfo = console.info.bind(console);
  vi.spyOn(console, "info").mockImplementation((...args: unknown[]) => {
    const line = String(args[0] ?? "");
    if (line.startsWith("[preview-lifecycle]")) {
      lifecycleLog.push(line);
      events.push(line);
      return;
    }
    void realInfo;
  });
  vi.mocked(startThemePreviewServer).mockImplementation((async () => {
    events.push("startThemePreviewServer");
    return {
      success: true,
      message: "Live Preview server ready",
      data: { url: `${PREVIEW_ORIGIN}/store/1/themes/1/preview` },
    };
  }) as never);
  vi.mocked(applyThemePreviewFiles).mockImplementation((async (request: {
    data: { files: { path: string }[] };
  }) => {
    events.push("applyThemePreviewFiles");
    return {
      success: true,
      message: "Live Preview files written",
      data: {
        previewId: "preview-1",
        changed: [],
        unchanged: request.data.files.map((file) => file.path),
        skipped: [],
      },
    };
  }) as never);
  vi.mocked(saveStorefrontThemeFile).mockImplementation((async () => {
    events.push("saveStorefrontThemeFile");
    return {
      success: true,
      message: "Theme file saved",
      data: { ...contentFile, sourceGeneration: 2 },
    };
  }) as never);
  vi.mocked(listStorefrontThemeFiles).mockImplementation((async () => ({
    success: true,
    message: "ok",
    data: tree([heroFile], 1),
  })) as never);
  vi.spyOn(toast, "error").mockImplementation(() => "");
  vi.spyOn(toast, "info").mockImplementation(() => "");
  vi.spyOn(toast, "success").mockImplementation(() => "");
  vi.spyOn(toast, "warning").mockImplementation(() => "");
});

afterEach(() => {
  releaseNotifications();
  notifyManager.setScheduler((run) => setTimeout(run, 0));
  vi.mocked(startThemePreviewServer).mockReset();
  vi.mocked(applyThemePreviewFiles).mockReset();
  vi.mocked(saveStorefrontThemeFile).mockReset();
  vi.mocked(listStorefrontThemeFiles).mockReset();
  vi.restoreAllMocks();
});

const committedReconnecting = (lines: string[]) =>
  lines.some((line) => line.startsWith("[preview-lifecycle] reconnecting"));
const finishedRecovery = (lines: string[]) =>
  lines.filter((line) => line.startsWith("recovery-request-finished"));

/**
 * The restart was dispatched, and the next event the reducer processed was
 * the stale server-ready the race produces: proof the race actually happened
 * in this run, whatever the reducer then did with it.
 */
function staleServerReadyAfterRestart(reducerAfter: string[]) {
  const recovery = reducerAfter.findIndex((line) =>
    line.startsWith("manual-recovery "),
  );
  expect(recovery).toBeGreaterThanOrEqual(0);
  expect(reducerAfter[recovery]).toMatch(/->reconnecting /);
  expect(reducerAfter[recovery + 1]).toMatch(/^server-ready\(.+\) reconnecting->/);
  return reducerAfter[recovery + 1];
}

describe("shell: restore -> onRestartPreview -> retryLivePreview -> start request", () => {
  it("control: notifications after React renders the restart -> one start request", async () => {
    const result = await restore({
      release: "after-react-renders",
      refetchChangesData: true,
      frameIsReady: false,
    });
    expect(committedReconnecting(result.lifecycleAfter)).toBe(true);
    expect(result.starts).toBe(1);
  }, 40_000);

  // Controls from the diagnosis. Its first hypothesis was that a SyncLane
  // render triggered by the tree notification would skip the DefaultLane
  // manual-recovery; that was refuted (React 19.2.1 renders DefaultLane
  // together with SyncLane), and these assert what was observed then and
  // still holds: the restart is sent.
  it("tree notification reaches React before the restart renders -> start still sent", async () => {
    const result = await restore({
      release: "before-react-renders",
      refetchChangesData: true,
      frameIsReady: false,
    });
    expect(committedReconnecting(result.lifecycleAfter)).toBe(true);
    expect(result.starts).toBe(1);
  }, 40_000);

  it("the same with the frame ready first: start still sent", async () => {
    const result = await restore({
      release: "before-react-renders",
      refetchChangesData: true,
      frameIsReady: true,
    });
    expect(committedReconnecting(result.lifecycleAfter)).toBe(true);
    expect(result.starts).toBe(1);
  }, 40_000);

  it("the same when the refetch returns equal data: start is sent", async () => {
    const result = await restore({
      release: "before-react-renders",
      refetchChangesData: false,
      frameIsReady: false,
    });
    expect(committedReconnecting(result.lifecycleAfter)).toBe(true);
    expect(result.starts).toBe(1);
  }, 40_000);
});

describe("the restore lands while a shell commit's passive effects are pending", () => {
  it("control: the save answer lands after the passive flush -> reconnecting and one start", async () => {
    const result = await restoreAroundCommit("after-passive-flush");
    expect(committedReconnecting(result.lifecycleAfter)).toBe(true);
    expect(result.starts).toBe(1);
    expect(finishedRecovery(result.reducerAfter)).not.toEqual([]);
  }, 40_000);

  it("race: the stale server-ready does not swallow the restart", async () => {
    const result = await restoreAroundCommit("inside-passive-window");
    // The race happened: the stale answer reached the reducer right after the
    // restart, before React rendered it. It no longer moves the phase.
    expect(staleServerReadyAfterRestart(result.reducerAfter)).toMatch(
      / reconnecting->reconnecting /,
    );
    expect(committedReconnecting(result.lifecycleAfter)).toBe(true);
    expect(result.starts).toBe(1);
    expect(finishedRecovery(result.reducerAfter)).toEqual([
      expect.stringMatching(/ reconnecting->starting-server /),
    ]);
  }, 40_000);
});

describe("a restart whose request fails still leaves reconnecting", () => {
  // The recovery effect ends a reconnect by dispatching
  // recovery-request-finished when refetchPreviewServer settles, either way.
  // These pin that a failed restart ends in an honest failure the author can
  // retry, not in a reconnect that never ends.
  const failures = {
    "answers success: false": () =>
      vi.mocked(startThemePreviewServer).mockImplementation((async () => {
        events.push("startThemePreviewServer");
        return { success: false, message: "Container did not start" };
      }) as never),
    throws: () =>
      vi.mocked(startThemePreviewServer).mockImplementation((async () => {
        events.push("startThemePreviewServer");
        throw new Error("network down");
      }) as never),
  };
  const expectedMessage = {
    "answers success: false": "Container did not start",
    throws: "Live Preview server could not be started. Retry Preview.",
  };

  for (const lands of ["after-passive-flush", "inside-passive-window"] as const) {
    for (const how of Object.keys(failures) as (keyof typeof failures)[]) {
      it(`${lands}: start ${how} -> failed, with the reason`, async () => {
        failures[how]();
        const result = await restoreAroundCommit(lands);
        if (lands === "inside-passive-window") {
          staleServerReadyAfterRestart(result.reducerAfter);
        }
        expect(committedReconnecting(result.lifecycleAfter)).toBe(true);
        expect(result.starts).toBe(1);
        expect(finishedRecovery(result.reducerAfter)).toEqual([
          expect.stringMatching(/ reconnecting->starting-server /),
        ]);
        expect(result.lifecycleAfter.at(-1)).toBe(
          `[preview-lifecycle] failed recoveries=0 | ${expectedMessage[how]}`,
        );
      }, 40_000);
    }
  }
});
