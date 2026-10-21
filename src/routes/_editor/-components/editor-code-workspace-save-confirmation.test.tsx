/**
 * A save's answer confirms the write it belongs to, and nothing the author
 * did after that write was sent.
 *
 * Every case holds a save's answer open by hand, edits the buffer the way the
 * author would (typing, Ctrl+Z, Ctrl+Y all reach the workspace as a content
 * change), and only then lets the answer through. Only `setTimeout` and
 * `clearTimeout` are faked, so the 700 ms autosave runs exactly when a test
 * advances the clock and never on its own.
 *
 * Each case runs twice, once for each order in which the answer reaches the
 * workspace:
 *
 * - "shell": as in the editor shell, the answer is recorded in the workspace
 *   store first and the editor re-renders on it, and only afterwards does the
 *   save call return to the Code workspace.
 * - "workspace": standalone, the Code workspace records the answer itself.
 *
 * The Monaco mock keeps one model per path, as Monaco does, and counts the
 * programmatic `setValue` calls: those are the ones that wipe Monaco's undo
 * stack.
 */
import { useEffect, useRef, useState } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StorefrontThemeFileDTO } from "@/lib/storefront/dto/storefront-theme-file.dto";
import { useThemeWorkspaceStore } from "@/lib/storefront/store/theme-workspace-store";
import { saveStorefrontThemeFile } from "@/server/storefront/storefront-theme-files.serverFn";
import {
  EditorCodeWorkspace,
  type EditorCodeWorkspaceHandle,
} from "./editor-code-workspace";

type MockModel = {
  uri: { path: string; toString(): string };
  getValue: () => string;
  setValue: (next: string) => void;
  onDidChangeContent: () => { dispose: () => void };
  getFullModelRange: () => unknown;
  pushEditOperations: (
    selections: unknown[],
    edits: Array<{ range: unknown; text: string }>,
    cursor: () => null,
  ) => null;
};

const monacoState = vi.hoisted(() => ({
  models: new Map<string, unknown>(),
  /** Programmatic replacements of a model's whole text, by model URI. */
  setValueCalls: [] as Array<{ uri: string; value: string }>,
}));

vi.mock(
  "@/server/storefront/storefront-theme-files.serverFn",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/server/storefront/storefront-theme-files.serverFn")
    >()),
    saveStorefrontThemeFile: vi.fn(),
    getStorefrontThemeFile: vi.fn(),
  }),
);

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

vi.mock("@monaco-editor/react", () => ({
  default: ({
    path,
    defaultValue,
    onChange,
    onMount,
    beforeMount,
  }: {
    path: string;
    defaultValue?: string;
    onChange?: (value?: string) => void;
    beforeMount?: (monaco: unknown) => void;
    onMount?: (editor: unknown, monaco: unknown) => void;
  }) => {
    const [, rerender] = useState(0);
    const pathRef = useRef(path);
    pathRef.current = path;
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;

    const modelFor = (uri: string, initial: string): MockModel => {
      const existing = monacoState.models.get(uri) as MockModel | undefined;
      if (existing) return existing;
      let value = initial;
      const model: MockModel = {
        uri: { path: uri.replace(/^file:\/\//, ""), toString: () => uri },
        getValue: () => value,
        onDidChangeContent: () => ({ dispose: () => {} }),
        // An edit that keeps Monaco's undo stack, unlike `setValue`; not
        // counted as a replacement.
        getFullModelRange: () => ({}),
        pushEditOperations: (_selections, edits) => {
          value = edits[edits.length - 1]?.text ?? value;
          rerender((count) => count + 1);
          if (pathRef.current === uri) onChangeRef.current?.(value);
          return null;
        },
        setValue: (next: string) => {
          monacoState.setValueCalls.push({ uri, value: next });
          value = next;
          rerender((count) => count + 1);
          // Monaco reports its own setValue as a content change too.
          if (pathRef.current === uri) onChangeRef.current?.(next);
        },
      };
      // Typing goes through this, so it is not counted as a replacement.
      (model as MockModel & { type: (next: string) => void }).type = (
        next: string,
      ) => {
        value = next;
        rerender((count) => count + 1);
        onChangeRef.current?.(next);
      };
      monacoState.models.set(uri, model);
      return model;
    };

    // Monaco keeps a model per path: switching back shows that model's text.
    const model = modelFor(path, defaultValue ?? "");

    useEffect(() => {
      const monaco = {
        Uri: { parse: (value: string) => ({ toString: () => value }) },
        editor: {
          getModel: (uri: { toString(): string }) =>
            (monacoState.models.get(uri.toString()) as MockModel) ?? null,
          getModels: () => [...monacoState.models.values()],
          deltaDecorations: vi.fn((_old: string[], next: unknown[]) =>
            next.map((_d, index) => String(index)),
          ),
        },
      };
      beforeMount?.(monaco);
      onMount?.(
        {
          getModel: () =>
            monacoState.models.get(pathRef.current) as MockModel | undefined,
          getAction: () => undefined,
          onDidChangeModel: () => ({ dispose: vi.fn() }),
          deltaDecorations: monaco.editor.deltaDecorations,
          revealPositionInCenter: vi.fn(),
          setPosition: vi.fn(),
          focus: vi.fn(),
        },
        monaco,
      );
      // Mounted once, as the real editor is; a path change swaps the model.
    }, []);

    return (
      <textarea
        aria-label="Code editor"
        value={model.getValue()}
        onChange={(event) =>
          (model as MockModel & { type: (next: string) => void }).type(
            event.currentTarget.value,
          )
        }
      />
    );
  },
}));

const HERO = "src/components/Hero.tsx";
const FOOTER = "src/components/Footer.tsx";
const BASELINE = "original";

const heroFile: StorefrontThemeFileDTO = {
  id: "file-1",
  storefrontId: "store-1",
  themeId: "theme-1",
  path: HERO,
  content: BASELINE,
  mimeType: "text/typescript",
  isEntry: true,
  version: 1,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};
const footerFile: StorefrontThemeFileDTO = {
  ...heroFile,
  id: "file-2",
  path: FOOTER,
  content: "footer",
  isEntry: false,
};

const scope = { storefrontId: "store-1", themeId: "theme-1" };

type Mode = "shell" | "workspace";

type HeldSave = {
  path: string;
  content: string;
  /** Lets the server's success through, in the order the mode describes. */
  succeed: () => Promise<void>;
  /** Answers with a source-generation conflict instead. */
  refuseWithSourceConflict: () => Promise<void>;
};

function serverFile(path: string) {
  return useThemeWorkspaceStore.getState().getWorkspaceFiles("store-1", "theme-1")[
    path
  ];
}

function treeRow(name: string) {
  return within(screen.getByRole("tree", { name: "Theme files" })).getByText(name);
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function setup(mode: Mode, files: StorefrontThemeFileDTO[] = [heroFile]) {
  const held: HeldSave[] = [];
  const versions = new Map(files.map((file) => [file.path, file.version]));
  const base = (path: string) => files.find((file) => file.path === path)!;
  const nextSaved = (path: string, content: string): StorefrontThemeFileDTO => {
    const version = (versions.get(path) ?? 0) + 1;
    versions.set(path, version);
    return { ...base(path), content, version };
  };

  const onSaveFile =
    mode === "shell"
      ? vi.fn(
          (path: string, content: string) =>
            new Promise<StorefrontThemeFileDTO | null>((resolve) => {
              held.push({
                path,
                content,
                succeed: async () => {
                  const saved = nextSaved(path, content);
                  // The shell records the answer, and the editor renders on
                  // it, before the save call returns to the workspace.
                  await act(async () => {
                    useThemeWorkspaceStore.getState().markSaved(saved, scope);
                  });
                  await act(async () => {
                    resolve(saved);
                    await vi.advanceTimersByTimeAsync(0);
                  });
                },
                refuseWithSourceConflict: async () => {
                  await act(async () => {
                    useThemeWorkspaceStore
                      .getState()
                      .markSourceConflict(path, scope);
                  });
                  await act(async () => {
                    resolve(null);
                    await vi.advanceTimersByTimeAsync(0);
                  });
                },
              });
            }),
        )
      : undefined;

  vi.mocked(saveStorefrontThemeFile).mockImplementation(((args: {
    data: { path: string; content: string };
  }) =>
    new Promise((resolve) => {
      const { path, content } = args.data;
      held.push({
        path,
        content,
        succeed: async () => {
          await act(async () => {
            resolve({
              success: true,
              message: "saved",
              data: nextSaved(path, content),
            });
            await vi.advanceTimersByTimeAsync(0);
          });
        },
        refuseWithSourceConflict: async () => {
          await act(async () => {
            resolve({
              success: false,
              error: "SOURCE_GENERATION_CONFLICT",
              message: "conflict",
            });
            await vi.advanceTimersByTimeAsync(0);
          });
        },
      });
    })) as never);

  const workspaceRef = createRef<EditorCodeWorkspaceHandle>();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <EditorCodeWorkspace
        ref={workspaceRef}
        storefrontId="store-1"
        themeId="theme-1"
        files={files}
        tree={files.map((file) => ({
          name: file.path.slice(file.path.lastIndexOf("/") + 1),
          path: file.path,
          isDirectory: false,
        }))}
        onSaveFile={onSaveFile}
      />
    </QueryClientProvider>,
  );

  const editor = () =>
    screen.getByRole("textbox", { name: "Code editor" }) as HTMLTextAreaElement;
  /** Typing, Ctrl+Z and Ctrl+Y all reach the workspace as a content change. */
  const edit = (value: string) =>
    fireEvent.change(editor(), { target: { value } });
  const sent = () => held.map((save) => save.content);
  const replacements = () => monacoState.setValueCalls.length;
  return { held, sent, edit, editor, workspaceRef, replacements };
}

beforeEach(() => {
  useThemeWorkspaceStore.setState({
    activeWorkspaceKey: null,
    workspaces: {},
    files: {},
    acceptedGenerations: {},
    observedGenerations: {},
    generations: {},
  });
  const store = useThemeWorkspaceStore.getState();
  store.hydrateFromQuery("store-1", "theme-1", [heroFile, footerFile]);
  store.setActiveWorkspace("store-1", "theme-1");
  store.acceptRemoteGeneration(7, scope);
  monacoState.models.clear();
  monacoState.setValueCalls = [];
  vi.mocked(saveStorefrontThemeFile).mockReset();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe.each<Mode>(["shell", "workspace"])(
  "a Code save's answer, recorded by the %s",
  (mode) => {
    it("keeps an undo made after the save was sent (the core case)", async () => {
      const t = setup(mode);
      t.edit(`${BASELINE}\n`);
      await advance(700);
      expect(t.sent()).toEqual([`${BASELINE}\n`]);

      t.edit(`${BASELINE}\nword`);
      t.edit(BASELINE); // Ctrl+Z back to the baseline
      await t.held[0]!.succeed();

      // The editor still shows the author's undo, and was never replaced.
      expect(t.editor().value).toBe(BASELINE);
      expect(t.replacements()).toBe(0);
      // The server now holds the undone text, so the draft is not clean.
      expect(serverFile(HERO)?.serverContent).toBe(`${BASELINE}\n`);
      expect(t.workspaceRef.current!.hasUnsavedDrafts()).toBe(true);

      // The next autosave carries the author's current text to the server.
      await advance(700);
      expect(t.sent()).toEqual([`${BASELINE}\n`, BASELINE]);
      await t.held[1]!.succeed();
      expect(serverFile(HERO)?.serverContent).toBe(BASELINE);
      expect(t.editor().value).toBe(BASELINE);
      expect(t.workspaceRef.current!.hasUnsavedDrafts()).toBe(false);
      expect(t.replacements()).toBe(0);
    });

    it("keeps an undo straight back to the baseline", async () => {
      const t = setup(mode);
      t.edit(`${BASELINE}X`);
      await advance(700);
      expect(t.sent()).toEqual([`${BASELINE}X`]);

      t.edit(BASELINE);
      await t.held[0]!.succeed();

      expect(t.editor().value).toBe(BASELINE);
      expect(t.replacements()).toBe(0);
      expect(t.workspaceRef.current!.hasUnsavedDrafts()).toBe(true);
      await advance(700);
      expect(t.sent()).toEqual([`${BASELINE}X`, BASELINE]);
      await t.held[1]!.succeed();
      expect(serverFile(HERO)?.serverContent).toBe(BASELINE);
      expect(t.workspaceRef.current!.hasUnsavedDrafts()).toBe(false);
    });

    it("keeps an undo that stops partway", async () => {
      const t = setup(mode);
      t.edit(`${BASELINE}\nword`);
      await advance(700);
      t.edit(`${BASELINE}\n`);
      await t.held[0]!.succeed();

      expect(t.editor().value).toBe(`${BASELINE}\n`);
      expect(t.replacements()).toBe(0);
      await advance(700);
      expect(t.sent()).toEqual([`${BASELINE}\nword`, `${BASELINE}\n`]);
      await t.held[1]!.succeed();
      expect(serverFile(HERO)?.serverContent).toBe(`${BASELINE}\n`);
      expect(t.workspaceRef.current!.hasUnsavedDrafts()).toBe(false);
    });

    it("keeps a redo made after the save was sent", async () => {
      const t = setup(mode);
      // A first edit lands, so the baseline becomes the edited text.
      t.edit(`${BASELINE}X`);
      await advance(700);
      await t.held[0]!.succeed();
      expect(serverFile(HERO)?.serverContent).toBe(`${BASELINE}X`);

      // Ctrl+Z is saved; Ctrl+Y comes back before that save is answered.
      t.edit(BASELINE);
      await advance(700);
      expect(t.sent()).toEqual([`${BASELINE}X`, BASELINE]);
      t.edit(`${BASELINE}X`);
      await t.held[1]!.succeed();

      expect(t.editor().value).toBe(`${BASELINE}X`);
      expect(t.replacements()).toBe(0);
      expect(serverFile(HERO)?.serverContent).toBe(BASELINE);
      expect(t.workspaceRef.current!.hasUnsavedDrafts()).toBe(true);
      await advance(700);
      expect(t.sent()).toEqual([`${BASELINE}X`, BASELINE, `${BASELINE}X`]);
      await t.held[2]!.succeed();
      expect(serverFile(HERO)?.serverContent).toBe(`${BASELINE}X`);
      expect(t.workspaceRef.current!.hasUnsavedDrafts()).toBe(false);
    });

    it("keeps typing that followed the save", async () => {
      const t = setup(mode);
      t.edit(`${BASELINE}\n`);
      await advance(700);
      t.edit(`${BASELINE}\nmore`);
      await t.held[0]!.succeed();

      expect(t.editor().value).toBe(`${BASELINE}\nmore`);
      expect(t.replacements()).toBe(0);
      expect(t.workspaceRef.current!.hasUnsavedDrafts()).toBe(true);
      await advance(700);
      expect(t.sent()).toEqual([`${BASELINE}\n`, `${BASELINE}\nmore`]);
      await t.held[1]!.succeed();
      expect(serverFile(HERO)?.serverContent).toBe(`${BASELINE}\nmore`);
      expect(t.workspaceRef.current!.hasUnsavedDrafts()).toBe(false);
    });

    it("treats a redo back to the sent text as confirmed by that save", async () => {
      const t = setup(mode);
      t.edit(`${BASELINE}X`);
      await advance(700);
      t.edit(BASELINE); // Ctrl+Z
      t.edit(`${BASELINE}X`); // Ctrl+Y, back to exactly what was sent
      await t.held[0]!.succeed();

      expect(t.editor().value).toBe(`${BASELINE}X`);
      expect(t.replacements()).toBe(0);
      expect(serverFile(HERO)?.serverContent).toBe(`${BASELINE}X`);
      // What is shown is what the server holds: nothing is left to send.
      expect(t.workspaceRef.current!.hasUnsavedDrafts()).toBe(false);
      await advance(2_000);
      expect(t.sent()).toEqual([`${BASELINE}X`]);
    });

    it("sends a second save only after the first is answered, and each answer confirms only its own write", async () => {
      const t = setup(mode);
      t.edit(`${BASELINE}A`);
      await advance(700);
      t.edit(`${BASELINE}AB`);
      // The second autosave comes due while the first is out: it waits.
      await advance(2_000);
      expect(t.sent()).toEqual([`${BASELINE}A`]);

      await t.held[0]!.succeed();
      expect(t.editor().value).toBe(`${BASELINE}AB`);
      await advance(700);
      expect(t.sent()).toEqual([`${BASELINE}A`, `${BASELINE}AB`]);

      // Undo while the second save is out; its answer must not take it back.
      t.edit(`${BASELINE}A`);
      await t.held[1]!.succeed();
      expect(t.editor().value).toBe(`${BASELINE}A`);
      expect(t.replacements()).toBe(0);
      expect(serverFile(HERO)?.serverContent).toBe(`${BASELINE}AB`);
      expect(t.workspaceRef.current!.hasUnsavedDrafts()).toBe(true);

      await advance(700);
      expect(t.sent()).toEqual([
        `${BASELINE}A`,
        `${BASELINE}AB`,
        `${BASELINE}A`,
      ]);
      await t.held[2]!.succeed();
      expect(serverFile(HERO)?.serverContent).toBe(`${BASELINE}A`);
      expect(t.workspaceRef.current!.hasUnsavedDrafts()).toBe(false);
    });

    it("still marks the draft clean when the save is of exactly what is shown", async () => {
      const t = setup(mode);
      t.edit(`${BASELINE}X`);
      await advance(700);
      await t.held[0]!.succeed();

      expect(t.editor().value).toBe(`${BASELINE}X`);
      expect(serverFile(HERO)?.serverContent).toBe(`${BASELINE}X`);
      expect(serverFile(HERO)?.dirty).toBe(false);
      expect(t.workspaceRef.current!.hasUnsavedDrafts()).toBe(false);
      await advance(2_000);
      expect(t.sent()).toEqual([`${BASELINE}X`]);
    });

    it("still shows a server-side change made while nothing was edited", async () => {
      const t = setup(mode);
      expect(t.editor().value).toBe(BASELINE);

      await act(async () => {
        useThemeWorkspaceStore.getState().hydrateFromQuery("store-1", "theme-1", [
          { ...heroFile, content: "from elsewhere", version: 2 },
          footerFile,
        ]);
      });
      expect(t.editor().value).toBe("from elsewhere");
      expect(t.workspaceRef.current!.hasUnsavedDrafts()).toBe(false);
    });

    it("still shows a server-side change after the author's own save has been answered", async () => {
      const t = setup(mode);
      t.edit(`${BASELINE}X`);
      await advance(700);
      await t.held[0]!.succeed();

      await act(async () => {
        useThemeWorkspaceStore.getState().hydrateFromQuery("store-1", "theme-1", [
          { ...heroFile, content: "from elsewhere", version: 9 },
          footerFile,
        ]);
      });
      expect(t.editor().value).toBe("from elsewhere");
      expect(t.workspaceRef.current!.hasUnsavedDrafts()).toBe(false);
    });

    it("still surfaces a source conflict, keeping the author's later edits", async () => {
      const t = setup(mode);
      t.edit(`${BASELINE}X`);
      await advance(700);
      t.edit(`${BASELINE}XY`);
      await t.held[0]!.refuseWithSourceConflict();

      expect(serverFile(HERO)?.sourceConflict).toBe(true);
      expect(serverFile(HERO)?.serverContent).toBe(BASELINE);
      expect(t.editor().value).toBe(`${BASELINE}XY`);
      expect(t.replacements()).toBe(0);
      expect(t.workspaceRef.current!.hasUnsavedDrafts()).toBe(true);
    });

    it("still keeps each file's draft across a file switch", async () => {
      const t = setup(mode, [heroFile, footerFile]);
      t.edit("hero draft");
      fireEvent.click(treeRow("Footer.tsx"));
      expect(t.editor().value).toBe("footer");
      t.edit("footer draft");
      fireEvent.click(treeRow("Hero.tsx"));
      expect(t.editor().value).toBe("hero draft");
      fireEvent.click(treeRow("Footer.tsx"));
      expect(t.editor().value).toBe("footer draft");
      expect(t.replacements()).toBe(0);
      expect(t.workspaceRef.current!.hasUnsavedDrafts()).toBe(true);
    });

    it("keeps each file's draft across a file switch while a save is out", async () => {
      const t = setup(mode, [heroFile, footerFile]);
      t.edit(`${BASELINE}X`);
      await advance(700);
      t.edit(BASELINE); // Ctrl+Z while Hero's save is out

      fireEvent.click(treeRow("Footer.tsx"));
      expect(t.editor().value).toBe("footer");
      t.edit("footer draft");

      await t.held[0]!.succeed();
      expect(t.editor().value).toBe("footer draft");

      fireEvent.click(treeRow("Hero.tsx"));
      expect(t.editor().value).toBe(BASELINE);
      expect(t.replacements()).toBe(0);
      expect(t.workspaceRef.current!.hasUnsavedDrafts()).toBe(true);
    });
  },
);
