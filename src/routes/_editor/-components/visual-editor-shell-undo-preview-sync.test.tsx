import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import { useEditorWriteGateStore } from "@/lib/storefront/store/editor-write-gate-store";
import { useThemeWorkspaceStore } from "@/lib/storefront/store/theme-workspace-store";
import type { StorefrontThemeEditorSearch } from "@/lib/validations/storefront-theme";
import { saveStorefrontThemeFile } from "@/server/storefront/storefront-theme-files.serverFn";
import { applyThemePreviewFiles } from "@/server/storefront/storefront-theme-preview-server.serverFn";
import { waitForOwnSaves } from "@/lib/storefront/editor/preview-sync-plan";
import { storefrontThemeFileQueries } from "../-queries/storefront-theme-files.queries";
import { themePreviewServerQueries } from "../-queries/theme-preview-server.queries";
import { VisualEditorShell } from "./visual-editor-shell";

/**
 * An undo during a refused Live Preview write's retry (#266 CI, shard 5).
 *
 * e2e/editor.spec.ts:407 failed with the canvas at B after undoing B: the
 * undo's source (A) was saved but never written to the Live Preview, and the
 * one write after the undo was the retry of B's refused write. The trace
 * order was: preview A ok, save A, preview B refused as stale (this tab's own
 * save had not come back), save B, undo, retry of B written, undo's save of
 * A. Nothing here depends on how long anything takes: every server answer
 * and the wait for this tab's own save are held and released by the test.
 *
 * The real shell, style path, history, save queue and preview sync. Mocked:
 * the server functions (an in-memory saved file and a preview that holds
 * what it was last written), the transport to the frame, and
 * `waitForOwnSaves` — only its timing: the test says when the own save is
 * over, instead of a 100 ms poll.
 */

vi.mock("@/server/storefront/storefront-theme-files.serverFn", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  saveStorefrontThemeFile: vi.fn(),
}));

vi.mock(
  "@/server/storefront/storefront-theme-preview-server.serverFn",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
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

vi.mock("@/lib/storefront/editor/preview-sync-plan", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  waitForOwnSaves: vi.fn(),
}));

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

/** The class the next style write gives the hero; the Inspector's controls are Radix. */
const nextClass = vi.hoisted(() => ({ value: "" }));
vi.mock("./editor-assistant-panel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./editor-assistant-panel")>();
  const RealPanel = actual.EditorAssistantPanel;
  return {
    ...actual,
    EditorAssistantPanel: (props: ComponentProps<typeof RealPanel>) => (
      <>
        <RealPanel {...props} />
        <button
          type="button"
          onClick={() =>
            props.onUpdateThemeFileStyle?.(
              "src/components/Hero.tsx",
              "section",
              () => `p-4 ${nextClass.value}`,
            )
          }
        >
          Write the style
        </button>
      </>
    ),
  };
});

const HERO = "src/components/Hero.tsx";
const PREVIEW_ORIGIN = "https://preview.morph.test";
const heroWith = (className: string) =>
  `export function Hero() { return <section data-morph-node="section" className="${className}">x</section>; }`;
const ORIGINAL = heroWith("p-4");
const A = heroWith("p-4 text-a");
const B = heroWith("p-4 text-b");
const scope = { storefrontId: "storefront-1", themeId: "theme-1" };

const context = {
  previewChannel: {
    editorOrigin: "http://localhost:3000",
    sessionId: "5f0f0f6e-6c2e-4f1c-9a3e-0f9a2b7c1d4e",
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** The saved file, as the database holds it. */
let saved: { content: string; version: number; generation: number };
/** Every save request, answered only when the test says so. */
let saves: Array<{ content: string; answer: () => Promise<void> }>;
/** What the Live Preview holds, by path: the canvas renders it. */
let canvas: Map<string, string>;
/** Every Live Preview write, processed and answered only when the test says so. */
let applies: Array<{
  content: string | undefined;
  /** The preview takes the write (or refuses it as stale) now. */
  process: (outcome: "ok" | "stale") => void;
  /** Its answer reaches the editor now. */
  deliver: () => Promise<void>;
  /** Both at once. */
  answer: (outcome: "ok" | "stale") => Promise<void>;
}>;
/** The wait for this tab's own save, held until the test ends it. */
let ownSaveWait: ReturnType<typeof deferred<void>>;

const flush = () =>
  act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });

beforeEach(() => {
  nextClass.value = "";
  saved = { content: ORIGINAL, version: 1, generation: 1 };
  saves = [];
  canvas = new Map([[HERO, ORIGINAL]]);
  applies = [];
  ownSaveWait = deferred<void>();
  useThemeWorkspaceStore.setState({
    acceptedGenerations: {},
    observedGenerations: {},
    generations: {},
    workspaces: {},
    files: {},
    activeWorkspaceKey: null,
  });
  useThemeWorkspaceStore.getState().setBaseSourceGeneration(1, scope);
  useEditorWriteGateStore.setState({ gates: {} });
  vi.spyOn(toast, "error").mockImplementation(() => "");
  vi.spyOn(toast, "info").mockImplementation(() => "");
  vi.spyOn(toast, "success").mockImplementation(() => "");
  vi.spyOn(toast, "warning").mockImplementation(() => "");
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.mocked(waitForOwnSaves).mockImplementation(() => ownSaveWait.promise);
  vi.mocked(saveStorefrontThemeFile).mockImplementation(((request: {
    data: { content: string };
  }) => {
    const reply = deferred<unknown>();
    const content = request.data.content;
    saves.push({
      content,
      answer: async () => {
        saved = {
          content,
          version: saved.version + 1,
          generation: saved.generation + 1,
        };
        await act(async () => {
          reply.resolve({
            success: true,
            message: "Theme file saved",
            data: {
              id: "file-hero",
              storefrontId: "storefront-1",
              themeId: "theme-1",
              path: HERO,
              content,
              mimeType: "text/typescript",
              isEntry: false,
              version: saved.version,
              sourceGeneration: saved.generation,
              createdAt: "2026-10-17T00:00:00.000Z",
              updatedAt: "2026-10-17T00:00:00.000Z",
            },
          });
          await Promise.resolve();
        });
        await flush();
      },
    });
    return reply.promise;
  }) as never);
  vi.mocked(applyThemePreviewFiles).mockImplementation(((request: {
    data: { files: { path: string; content: string }[] };
  }) => {
    const reply = deferred<unknown>();
    const file = request.data.files.find((entry) => entry.path === HERO);
    let result: unknown = null;
    const entry = {
      content: file?.content,
      process: (outcome: "ok" | "stale") => {
        if (outcome === "ok" && file) canvas.set(HERO, file.content);
        result =
          outcome === "ok"
            ? {
                success: true,
                message: "Live Preview files written",
                data: {
                  previewId: "preview-1",
                  changed: file ? [HERO] : [],
                  unchanged: [],
                  skipped: [],
                },
              }
            : {
                success: false,
                message: "Newer versions of these files were saved elsewhere.",
                error: "PREVIEW_SOURCE_STALE",
                stalePaths: [HERO],
              };
      },
      deliver: async () => {
        await act(async () => {
          reply.resolve(result);
          await Promise.resolve();
        });
        await flush();
      },
      answer: async (outcome: "ok" | "stale") => {
        entry.process(outcome);
        await entry.deliver();
      },
    };
    applies.push(entry);
    return reply.promise;
  }) as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

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
  client.setQueryData(storefrontThemeFileQueries.tree("storefront-1", "theme-1").queryKey, {
    files: [
      {
        id: "file-hero",
        storefrontId: "storefront-1",
        themeId: "theme-1",
        path: HERO,
        content: ORIGINAL,
        mimeType: "text/typescript",
        isEntry: false,
        version: 1,
        createdAt: "2026-10-17T00:00:00.000Z",
        updatedAt: "2026-10-17T00:00:00.000Z",
      },
    ],
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
            children: [{ name: "Hero.tsx", path: HERO, isDirectory: false }],
          },
        ],
      },
    ],
    sourceGeneration: 1,
    latestPublishedRevision: null,
  } as never);
  render(
    <QueryClientProvider client={client}>
      <VisualEditorShell
        context={context}
        search={
          { template: "index", templateId: "template-1", viewport: "desktop" } as StorefrontThemeEditorSearch
        }
        onSearchChange={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

function writeStyle(className: string) {
  nextClass.value = className;
  act(() => {
    screen.getByRole("button", { name: "Write the style" }).click();
  });
}

const heroState = () =>
  useThemeWorkspaceStore.getState().getWorkspaceFiles("storefront-1", "theme-1")[HERO];

/** Write A, written to the preview and saved; then B, written and its save in flight. */
async function writeAThenB(bPreview: "refused" | "in-flight") {
  renderShell();
  writeStyle("text-a");
  await waitFor(() => expect(applies).toHaveLength(1));
  expect(applies[0]!.content).toBe(A);
  await applies[0]!.answer("ok");
  // The 300 ms debounce of the style path is the shell's own; the order does
  // not depend on it, only on the save being asked for.
  await waitFor(() => expect(saves).toHaveLength(1), { timeout: 5_000 });
  await saves[0]!.answer();
  await waitFor(() => expect(heroState()?.serverContent).toBe(A));

  writeStyle("text-b");
  await waitFor(() => expect(applies).toHaveLength(2));
  expect(applies[1]!.content).toBe(B);
  await waitFor(() => expect(saves).toHaveLength(2), { timeout: 5_000 });
  expect(saves[1]!.content).toBe(B);
  expect(heroState()?.saveState).toBe("saving");
  if (bPreview === "refused") {
    // Refused while this tab's own save of B is out: retried once it is back.
    await applies[1]!.answer("stale");
    await waitFor(() => expect(waitForOwnSaves).toHaveBeenCalledTimes(1));
  } else {
    // Taken by the preview; its answer is late.
    applies[1]!.process("ok");
  }
}

async function undo() {
  const button = screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement;
  expect(button.disabled).toBe(false);
  act(() => {
    button.click();
  });
  await flush();
}

/** Answers every Live Preview write sent after `from` as the preview would. */
async function answerLaterWrites(from: number) {
  for (const entry of applies.slice(from)) await entry.answer("ok");
}

describe("an undo while a refused preview write waits for its retry", () => {
  it("leaves the saved file and the Live Preview both at A", async () => {
    await writeAThenB("refused");
    await undo();
    const afterUndo = applies.length;
    await answerLaterWrites(2);

    // B's save comes back; the undo's save of A goes next and is held.
    await saves[1]!.answer();
    await waitFor(() => expect(saves).toHaveLength(3));
    expect(saves[2]!.content).toBe(A);

    // Now the refused write's retry: its wait for the own save ends.
    await act(async () => {
      ownSaveWait.resolve();
      await Promise.resolve();
    });
    await flush();
    await answerLaterWrites(afterUndo);

    await saves[2]!.answer();
    await answerLaterWrites(afterUndo);

    expect(saved.content).toBe(A);
    const lastWrite = applies.filter((entry) => entry.content !== undefined).at(-1);
    expect(lastWrite?.content).toBe(A);
    expect(canvas.get(HERO)).toBe(A);
    // The retry's wait ended after the undo: it sent nothing of B's.
    expect(applies.slice(2).map((entry) => entry.content)).not.toContain(B);
  }, 30_000);
});

describe("an undo while B's preview write is still unanswered", () => {
  it("writes A to the preview, and B's late answer does not take the canvas from A", async () => {
    await writeAThenB("in-flight");
    expect(canvas.get(HERO)).toBe(B);
    await undo();
    const afterUndo = applies.length;
    // The undo's write reaches the preview after B's did.
    for (const entry of applies.slice(2)) entry.process("ok");
    expect(canvas.get(HERO)).toBe(A);

    // B's answer arrives only now, then the undo's.
    await applies[1]!.deliver();
    for (const entry of applies.slice(2, afterUndo)) await entry.deliver();
    await saves[1]!.answer();
    await waitFor(() => expect(saves).toHaveLength(3));
    await saves[2]!.answer();
    await answerLaterWrites(afterUndo);

    expect(saved.content).toBe(A);
    expect(canvas.get(HERO)).toBe(A);
    expect(applies.slice(2).map((entry) => entry.content)).not.toContain(B);
  }, 30_000);
});

describe("a preview write refused because another tab saved newer", () => {
  it("is reported and not retried, as before", async () => {
    renderShell();
    writeStyle("text-a");
    await waitFor(() => expect(applies).toHaveLength(1));
    // No save of this tab's is out: the refusal is the real answer.
    expect(heroState()?.saveState).not.toBe("saving");
    await applies[0]!.answer("stale");

    expect(waitForOwnSaves).not.toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalledWith(
      expect.stringContaining(`Newer versions of ${HERO}`),
      expect.anything(),
    );
    await flush();
    expect(applies).toHaveLength(1);
  }, 30_000);
});
