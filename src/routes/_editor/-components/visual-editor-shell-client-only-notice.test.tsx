import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ThemeClientOnlyPreviewLimit } from "@/lib/storefront/compiler/theme-client-only-preview-limits";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import type { StorefrontThemeFileDTO } from "@/lib/storefront/dto/storefront-theme-file.dto";
import { useEditorWriteGateStore } from "@/lib/storefront/store/editor-write-gate-store";
import { useThemeWorkspaceStore } from "@/lib/storefront/store/theme-workspace-store";
import type { StorefrontThemeEditorSearch } from "@/lib/validations/storefront-theme";
import { storefrontThemeFileQueries } from "../-queries/storefront-theme-files.queries";
import { themePreviewServerQueries } from "../-queries/theme-preview-server.queries";
import { VisualEditorShell } from "./visual-editor-shell";

/**
 * The client-only Live Preview notice, as the shell shows it from the start
 * answer it is serving: present for a client-only start that found server
 * function uses, absent for the full Start preview and for a Theme with none,
 * and replaced when a new start answers.
 */

const PREVIEW_ORIGIN = "https://preview.morph.test";
const PREVIEW_SESSION = "5f0f0f6e-6c2e-4f1c-9a3e-0f9a2b7c1d4e";
const FILE_PATH = "src/components/Hero.tsx";

const getThemeEditor = vi.hoisted(() => vi.fn());

vi.mock(
  "@/server/storefront/storefront-themes.serverFn",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    getStorefrontThemeEditor: getThemeEditor,
  }),
);

vi.mock(
  "@/server/storefront/storefront-theme-files.serverFn",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    saveStorefrontThemeFile: vi.fn(),
    getStorefrontThemeFile: vi.fn(),
  }),
);

vi.mock(
  "@/server/storefront/storefront-theme-preview-server.serverFn",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    startThemePreviewServer: vi.fn(),
    applyThemePreviewFiles: vi.fn(),
    touchThemePreviewServer: vi.fn(),
    probeThemePreviewAddress: vi.fn(async () => ({
      success: true,
      message: "ok",
      data: { state: "unknown" },
    })),
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

const heroFile = {
  id: "file-hero",
  storefrontId: "storefront-1",
  themeId: "theme-1",
  path: FILE_PATH,
  content: "export default function Hero() { return <section>x</section>; }\n",
  mimeType: "text/typescript",
  isEntry: false,
  version: 1,
  createdAt: "2026-10-17T00:00:00.000Z",
  updatedAt: "2026-10-17T00:00:00.000Z",
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
      document: {
        version: 1,
        sections: [{ id: "hero", type: "hero", props: { heading: "Welcome" } }],
      },
      draftGeneration: 1,
      version: 1,
    },
  ],
} as unknown as StorefrontThemeEditorDTO;

const LIMITS: ThemeClientOnlyPreviewLimit[] = [
  { file: "src/routes/index.tsx", line: 4, kind: "createServerFn" },
];

function startAnswer(data: Record<string, unknown>) {
  return {
    success: true,
    message: "Live Preview server ready",
    data: { url: `${PREVIEW_ORIGIN}/store/1/themes/1/preview`, ...data },
  } as never;
}

const previewServerKey = themePreviewServerQueries.forTheme(
  "storefront-1",
  "theme-1",
).queryKey;

function renderShell(start: Record<string, unknown>) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(previewServerKey, startAnswer(start));
  client.setQueryData(
    storefrontThemeFileQueries.tree("storefront-1", "theme-1").queryKey,
    {
      files: [heroFile],
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
              children: [{ name: "Hero.tsx", path: FILE_PATH, isDirectory: false }],
            },
          ],
        },
      ],
      sourceGeneration: 1,
      latestPublishedRevision: null,
    } as never,
  );
  render(
    <QueryClientProvider client={client}>
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
    </QueryClientProvider>,
  );
  return client;
}

const notice = () =>
  document.querySelector('[data-slot="preview-client-only-notice"]');

/** The shell is up when it frames the preview it was given. */
async function shellUp() {
  await waitFor(() => expect(document.querySelector("iframe")).not.toBeNull());
}

beforeEach(() => {
  useThemeWorkspaceStore.setState({ workspaces: {} });
  useEditorWriteGateStore.setState({ gates: {} });
  getThemeEditor.mockResolvedValue({ success: true, message: "ok", data: context });
  vi.spyOn(toast, "error").mockImplementation(() => "");
  vi.spyOn(toast, "info").mockImplementation(() => "");
  vi.spyOn(toast, "success").mockImplementation(() => "");
  vi.spyOn(toast, "warning").mockImplementation(() => "");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the client-only preview notice in the editor", () => {
  it("names the files for a client-only start that found uses", async () => {
    renderShell({ previewRuntime: "client", clientOnlyLimits: LIMITS });
    await shellUp();
    await waitFor(() => expect(notice()).not.toBeNull());
    expect(notice()?.textContent).toContain("src/routes/index.tsx");
    expect(notice()?.getAttribute("role")).toBe("status");
  });

  it("is not shown for the full Start preview", async () => {
    renderShell({ previewRuntime: "start", clientOnlyLimits: LIMITS });
    await shellUp();
    expect(notice()).toBeNull();
  });

  it("is not shown for a client-only start with no uses", async () => {
    renderShell({ previewRuntime: "client", clientOnlyLimits: [] });
    await shellUp();
    expect(notice()).toBeNull();
  });

  // An Astro start (and one whose framework did not resolve) carries neither
  // field; the shell must not read the missing runtime as client-only.
  it("is not shown for a start that names no runtime, as an Astro start does", async () => {
    renderShell({});
    await shellUp();
    expect(notice()).toBeNull();
  });

  it("is not shown when limits arrive without a runtime", async () => {
    renderShell({ clientOnlyLimits: LIMITS });
    await shellUp();
    expect(notice()).toBeNull();
  });

  it("is replaced by a new start's answer", async () => {
    const client = renderShell({
      previewRuntime: "client",
      clientOnlyLimits: LIMITS,
    });
    await shellUp();
    await waitFor(() => expect(notice()).not.toBeNull());
    act(() => {
      screen
        .getByRole("button", { name: "Dismiss the client-only preview notice" })
        .click();
    });
    expect(notice()).toBeNull();

    // A new start answers: its own files, and the notice is back.
    act(() => {
      client.setQueryData(
        previewServerKey,
        startAnswer({
          previewRuntime: "client",
          clientOnlyLimits: [
            { file: "src/lib/cookie.ts", line: 1, kind: "server-api", names: ["getCookie"] },
          ],
        }),
        { updatedAt: Date.now() + 1000 },
      );
    });
    await waitFor(() => expect(notice()).not.toBeNull());
    expect(notice()?.textContent).toContain("src/lib/cookie.ts");
    expect(notice()?.textContent).not.toContain("src/routes/index.tsx");

    // And a start served by the full Start preview takes it away.
    act(() => {
      client.setQueryData(
        previewServerKey,
        startAnswer({ previewRuntime: "start", clientOnlyLimits: [] }),
        { updatedAt: Date.now() + 2000 },
      );
    });
    await waitFor(() => expect(notice()).toBeNull());
  });
});
