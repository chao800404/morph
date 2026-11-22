import { useEffect, useMemo, useRef, useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  StorefrontThemeBinaryFileDTO,
  StorefrontThemeFileDTO,
} from "@/lib/storefront/dto/storefront-theme-file.dto";
import { useThemeWorkspaceStore } from "@/lib/storefront/store/theme-workspace-store";
import { isThemePublicPath } from "@/lib/storefront/theme-public-files";
import { getStorefrontThemeFile } from "@/server/storefront/storefront-theme-files.serverFn";
import { EditorCodeWorkspace } from "./editor-code-workspace";

/**
 * Reproduction (no fix), component level: see
 * src/lib/storefront/store/theme-workspace-shell-draft-hydrate.test.ts.
 *
 * `ShellLikeWorkspace` passes `files` the way visual-editor-shell.tsx does
 * (`effectiveThemeFiles`: server files with `content` replaced by the
 * workspace's `localContent`). Opening an editable public text file then runs
 * the Code workspace's public-text effect, which hydrates the store with that
 * list as if it were the server's copy.
 *
 * Marked `it.fails` while the bug stands; flip to `it` with the fix.
 */

const monacoTestState = vi.hoisted(() => ({
  formatter: null as null | ((content: string) => string | Promise<string>),
  formatError: false,
  editorOptions: null as Record<string, unknown> | null,
  editorOpener: null as {
    openCodeEditor: (
      source: unknown,
      resource: { toString(): string },
      selectionOrPosition?: unknown,
    ) => boolean | Promise<boolean>;
  } | null,
  lastPosition: null as { lineNumber: number; column: number } | null,
}));

vi.mock(
  "@/server/storefront/storefront-theme-files.serverFn",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/server/storefront/storefront-theme-files.serverFn")
    >()),
    applyThemeManifestMigrationServerFn: vi.fn(),
    deleteStorefrontThemeFile: vi.fn(),
    previewThemeManifestMigration: vi.fn(),
    saveStorefrontThemeFile: vi.fn(),
    saveStorefrontThemeFilesBatch: vi.fn(),
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
  formatEditorCode: vi.fn(async (content: string) => {
    if (monacoTestState.formatter) {
      const formatted = await monacoTestState.formatter(content);
      if (monacoTestState.formatError) throw new Error("format failed");
      return formatted;
    }
    if (monacoTestState.formatError) throw new Error("format failed");
    return content;
  }),
}));

vi.mock("@monaco-editor/react", () => ({
  default: ({
    defaultValue,
    onChange,
    onMount,
    beforeMount,
    theme,
    options,
  }: {
    defaultValue?: string;
    onChange?: (value?: string) => void;
    beforeMount?: (monaco: unknown) => void;
    onMount?: (editor: unknown, monaco: unknown) => void;
    theme?: string;
    options?: Record<string, unknown>;
  }) => {
    const [value, setValue] = useState(defaultValue ?? "");
    const valueRef = useRef(value);
    valueRef.current = value;

    useEffect(() => {
      const model = {
        uri: { path: "src/components/Hero.tsx" },
        getValue: () => valueRef.current,
        onDidChangeContent: () => ({ dispose: vi.fn() }),
        setValue: (next: string) => {
          valueRef.current = next;
          setValue(next);
          onChange?.(next);
        },
      };
      const monaco = {
        editor: {
          getModels: () => [model],
          registerEditorOpener: (
            opener: NonNullable<typeof monacoTestState.editorOpener>,
          ) => {
            monacoTestState.editorOpener = opener;
            return {
              dispose: () => {
                if (monacoTestState.editorOpener === opener) {
                  monacoTestState.editorOpener = null;
                }
              },
            };
          },
          deltaDecorations: vi.fn((_oldIds: string[], next: unknown[]) =>
            next.map((_decoration, index) => String(index)),
          ),
        },
      };
      const formatAction = {
        run: async () => {
          if (monacoTestState.formatter) {
            model.setValue(await monacoTestState.formatter(model.getValue()));
          }
          if (monacoTestState.formatError) throw new Error("format failed");
        },
      };
      beforeMount?.(monaco);
      (onMount as unknown as (editor: unknown, monaco: unknown) => void)?.(
        {
          getModel: () => model,
          getAction: (id: string) =>
            id === "editor.action.formatDocument" ? formatAction : undefined,
          onDidChangeModel: () => ({ dispose: vi.fn() }),
          deltaDecorations: monaco.editor.deltaDecorations,
          revealPositionInCenter: vi.fn(),
          setPosition: (position: { lineNumber: number; column: number }) => {
            monacoTestState.lastPosition = position;
          },
          focus: vi.fn(),
        },
        monaco,
      );
      monacoTestState.editorOptions = options ?? null;
    }, [onMount]);

    return (
      <textarea
        aria-label="Code editor"
        data-theme={theme}
        value={value}
        onChange={(event) => {
          const next = event.currentTarget.value;
          setValue(next);
          onChange?.(next);
        }}
      />
    );
  },
}));

const hero: StorefrontThemeFileDTO = {
  id: "hero-id",
  storefrontId: "store-1",
  themeId: "theme-1",
  path: "src/components/Hero.tsx",
  content: "export const Hero = () => <h1>Server</h1>;",
  mimeType: "text/typescript",
  isEntry: true,
  version: 4,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};
const DRAFT = "export const Hero = () => <h1>My unsaved draft</h1>;";

const robotsMeta: StorefrontThemeBinaryFileDTO = {
  ...hero,
  id: "robots-id",
  path: "public/robots.txt",
  encoding: "binary",
  blobDigest: "a".repeat(64),
  sizeBytes: 14,
  mimeType: "text/plain",
  isEntry: false,
  version: 2,
};
const robotsLoaded: StorefrontThemeFileDTO = {
  ...hero,
  id: "robots-id",
  path: robotsMeta.path,
  content: "User-agent: *\n",
  mimeType: "text/plain",
  isEntry: false,
  version: 2,
};

/** The shell's `effectiveThemeFiles` (visual-editor-shell.tsx), around the workspace. */
function ShellLikeWorkspace({ serverFiles }: { serverFiles: StorefrontThemeFileDTO[] }) {
  const workspaceFiles = useThemeWorkspaceStore((state) => state.files);
  const files = useMemo<StorefrontThemeFileDTO[]>(() => {
    const serverPaths = new Set(serverFiles.map((file) => file.path));
    return [
      ...serverFiles.map((file) => ({
        ...file,
        content: workspaceFiles[file.path]?.localContent ?? file.content,
      })),
      ...Object.values(workspaceFiles)
        .filter((file) => !serverPaths.has(file.path) && !isThemePublicPath(file.path))
        .map((file) => ({
          id: `local:${file.path}`,
          storefrontId: "store-1",
          themeId: "theme-1",
          path: file.path,
          content: file.localContent,
          mimeType: "text/plain",
          isEntry: false,
          version: 1,
          createdAt: "",
          updatedAt: "",
        })),
    ];
  }, [serverFiles, workspaceFiles]);
  return (
    <EditorCodeWorkspace
      storefrontId="store-1"
      themeId="theme-1"
      files={files}
      binaryFiles={[robotsMeta]}
      initialActiveFilePath={hero.path}
      tree={[
        { name: "Hero.tsx", path: hero.path, isDirectory: false },
        { name: "robots.txt", path: robotsMeta.path, isDirectory: false, encoding: "binary" },
      ]}
    />
  );
}

describe("EditorCodeWorkspace public text open with a source draft (shell-shaped files)", () => {
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
    store.hydrateFromQuery("store-1", "theme-1", [hero], 7, [robotsMeta.path]);
    store.setActiveWorkspace("store-1", "theme-1");
    vi.mocked(getStorefrontThemeFile).mockReset();
    vi.mocked(getStorefrontThemeFile).mockResolvedValue({ success: true, message: "loaded", data: robotsLoaded });
  });

  it.fails("opening robots.txt keeps Hero.tsx's unsaved draft out of conflict and keeps its server basis", async () => {
    // An unsaved edit to a source file (typed in Code, or written by the Inspector).
    useThemeWorkspaceStore.getState().updateLocalContent(hero.path, DRAFT, { storefrontId: "store-1", themeId: "theme-1" });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ShellLikeWorkspace serverFiles={[hero]} />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByText("robots.txt"));
    await waitFor(() =>
      expect((screen.getByRole("textbox", { name: "Code editor" }) as HTMLTextAreaElement).value).toBe(robotsLoaded.content),
    );
    // Let the public-text effect run its hydrate.
    await waitFor(() => expect(getStorefrontThemeFile).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));

    const heroState = useThemeWorkspaceStore.getState().files[hero.path]!;
    expect({ conflict: heroState.conflict, saveState: heroState.saveState, serverContent: heroState.serverContent }).toEqual({
      conflict: undefined,
      saveState: "dirty",
      serverContent: hero.content,
    });

    // Back on Hero.tsx, no conflict bar for a server copy nobody changed.
    fireEvent.click(screen.getByText("Hero.tsx"));
    await waitFor(() =>
      expect((screen.getByRole("textbox", { name: "Code editor" }) as HTMLTextAreaElement).value).toBe(DRAFT),
    );
    expect(screen.queryByText(/Server conflict \(v4\)/)).toBeNull();
  });
});
