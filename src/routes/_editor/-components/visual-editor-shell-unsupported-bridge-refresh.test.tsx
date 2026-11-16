import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import { postEditorToPreviewMessage } from "@/lib/storefront/editor/preview-protocol";
import { useEditorWriteGateStore } from "@/lib/storefront/store/editor-write-gate-store";
import { useThemeWorkspaceStore } from "@/lib/storefront/store/theme-workspace-store";
import type { StorefrontThemeEditorSearch } from "@/lib/validations/storefront-theme";
import { listStorefrontThemeFiles } from "@/server/storefront/storefront-theme-files.serverFn";
import {
  applyThemePreviewFiles,
  confirmThemePreviewContent,
  probeThemePreviewAddress,
  startThemePreviewServer,
  syncThemePreviewContent,
  touchThemePreviewServer,
} from "@/server/storefront/storefront-theme-preview-server.serverFn";
import { storefrontThemeFileQueries } from "../-queries/storefront-theme-files.queries";
import { themePreviewServerQueries } from "../-queries/theme-preview-server.queries";
import {
  PREVIEW_PRESENTATION_UNCONFIRMABLE_AFTER_MS,
  PREVIEW_PRESENTATION_UNCONFIRMABLE_MESSAGE,
  VisualEditorShell,
} from "./visual-editor-shell";
import {
  answerFramePings,
  answerLatestRouteRequest,
  disablePresentationAcks,
  frameEnvelope,
  modelCurrentBridge,
  reloadFrameDocument,
  sendFrameReady,
} from "@/lib/test-utils/preview-frame-handshake";

const EDITOR_ORIGIN = "http://localhost:3000";
const PREVIEW_ORIGIN = "https://preview.morph.test";
const PREVIEW_SESSION = "5f0f0f6e-6c2e-4f1c-9a3e-0f9a2b7c1d4e";

const updateSectionProps = vi.hoisted(() => vi.fn());
const getThemeEditor = vi.hoisted(() => vi.fn());

vi.mock(
  "@/server/storefront/storefront-themes.serverFn",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    updateStorefrontThemeSectionProps: updateSectionProps,
    getStorefrontThemeEditor: getThemeEditor,
  }),
);
vi.mock(
  "@/server/storefront/storefront-theme-files.serverFn",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    listStorefrontThemeFiles: vi.fn(),
  }),
);
vi.mock(
  "@/server/storefront/storefront-theme-preview-server.serverFn",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    startThemePreviewServer: vi.fn(),
    applyThemePreviewFiles: vi.fn(),
    touchThemePreviewServer: vi.fn(),
    probeThemePreviewAddress: vi.fn(),
    syncThemePreviewContent: vi.fn(),
    confirmThemePreviewContent: vi.fn(),
  }),
);
vi.mock(
  "@/server/storefront/storefront-preview-media.serverFn",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    signThemePreviewMedia: vi.fn(),
  }),
);
vi.mock("./editor-media-picker-popover", () => ({
  EditorMediaPickerPopover: () => null,
}));
vi.mock("@/lib/storefront/editor/preview-protocol", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  postEditorToPreviewMessage: vi.fn(),
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Link: ({
    to,
    children,
    ...rest
  }: {
    to?: string;
    children?: React.ReactNode;
  }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@monaco-editor/react", () => ({
  default: () => <textarea aria-label="Code editor" />,
}));
vi.mock("./editor-code-language-support", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./editor-code-language-support")>()),
  configureThemeTypeScript: vi.fn(),
  disposeThemeWorkspaceModels: vi.fn(),
  ensureThemeWorkspaceModels: vi.fn(),
  registerTailwindCompletionProvider: vi.fn(() => ({ dispose: vi.fn() })),
}));

const context = {
  previewChannel: { editorOrigin: EDITOR_ORIGIN, sessionId: PREVIEW_SESSION },
  storefront: {
    id: "storefront-1",
    name: "Store",
    domain: null,
    status: "active",
  },
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

const homeSearch = {
  template: "index",
  templateId: "template-1",
  viewport: "desktop",
} as StorefrontThemeEditorSearch;

const routeSource = `import { createFileRoute } from "@tanstack/react-router";\nexport const Route = createFileRoute("/")({ component: () => <main /> });\n`;
const tree = () => ({
  files: [
    {
      id: "file-index",
      storefrontId: "storefront-1",
      themeId: "theme-1",
      path: "src/routes/index.tsx",
      content: routeSource,
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
          name: "routes",
          path: "src/routes",
          isDirectory: true,
          children: [
            {
              name: "index.tsx",
              path: "src/routes/index.tsx",
              isDirectory: false,
            },
          ],
        },
      ],
    },
  ],
  sourceGeneration: 1,
  latestPublishedRevision: null,
});

const heroNode = {
  id: "hero:node:heading",
  parentId: null,
  sectionId: "hero",
  label: "Heading",
  kind: "heading",
  tagName: "h1",
  target: {
    sectionId: "hero",
    nodeId: "hero:node:heading",
    elementKey: "heading",
    fieldKey: "heading",
    fieldPath: "heading",
    isSection: false,
  },
};

async function renderShell(
  initialFp = "fp-old-build",
  customContext: StorefrontThemeEditorDTO = context,
  customTree = tree(),
  contentRefresh?: "invalidate" | "reload",
) {
  const initialServer = {
    success: true,
    message: "Live Preview server ready",
    data: {
      url: `${PREVIEW_ORIGIN}/store/1/themes/1/preview`,
      workspaceFingerprint: initialFp,
      bridgeCapabilities: ["selection-field-section", "code-default-selection", "astro-identity-v2"],
      ...(contentRefresh ? { contentRefresh } : {}),
    },
  } as never;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(
    themePreviewServerQueries.forTheme("storefront-1", "theme-1").queryKey,
    initialServer,
  );
  client.setQueryData(
    storefrontThemeFileQueries.tree("storefront-1", "theme-1").queryKey,
    customTree as never,
  );
  render(
    <QueryClientProvider client={client}>
      <VisualEditorShell
        context={customContext}
        search={homeSearch}
        onSearchChange={vi.fn()}
      />
    </QueryClientProvider>,
  );
  await waitFor(() => {
    expect(currentIframe()).toBeTruthy();
  });
  return client;
}

const currentIframe = () => document.querySelector("iframe");
const currentWindow = () => currentIframe()?.contentWindow ?? null;
function fromPreview(data: Record<string, unknown>) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: frameEnvelope({ ...data, previewSession: PREVIEW_SESSION }),
        origin: PREVIEW_ORIGIN,
        source: currentWindow(),
      }),
    );
  });
  answerFramePings({ origin: PREVIEW_ORIGIN, session: PREVIEW_SESSION });
}

function sendReady(capabilities: string[]) {
  sendFrameReady(
    { origin: PREVIEW_ORIGIN, session: PREVIEW_SESSION },
    capabilities,
  );
}

describe("bounded auto-refresh when preview bridge lacks section-presentation-ack-v1", () => {
  beforeEach(() => {
    modelCurrentBridge();
    useEditorWriteGateStore.setState({ gates: {} });
    useThemeWorkspaceStore.setState({
      acceptedGenerations: {},
      observedGenerations: {},
      generations: {},
      workspaces: {},
      files: {},
      activeWorkspaceKey: null,
    });
    vi.mocked(postEditorToPreviewMessage).mockReset();
    vi.mocked(startThemePreviewServer).mockReset();
    vi.mocked(applyThemePreviewFiles).mockResolvedValue({
      success: true,
      message: "ok",
      data: { changedPaths: [] },
    } as never);
    vi.mocked(touchThemePreviewServer).mockResolvedValue({
      success: true,
      message: "ok",
      data: { previewId: "p1", serving: true },
    } as never);
    vi.mocked(probeThemePreviewAddress).mockResolvedValue({
      success: true,
      message: "ok",
      data: { reachable: true, status: 200 },
    } as never);
    vi.mocked(listStorefrontThemeFiles).mockResolvedValue({
      success: true,
      data: tree(),
    } as never);
    vi.mocked(getThemeEditor).mockResolvedValue({
      success: true,
      data: context,
    } as never);
    updateSectionProps.mockResolvedValue({
      success: true,
      data: {
        templateId: "template-1",
        draftGeneration: 2,
        version: 2,
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("confirms the service is updated, rebuilds the iframe once, and clears refusal on new ready with ack capability", async () => {
    vi.mocked(startThemePreviewServer).mockResolvedValue({
      success: true,
      message: "Live Preview server ready",
      data: {
        url: `${PREVIEW_ORIGIN}/store/1/themes/1/preview`,
        workspaceFingerprint: "fp-new-build",
        bridgeCapabilities: [
          "selection-field-section",
          "code-default-selection",
          "astro-identity-v2",
          "section-presentation-ack-v1",
        ],
      },
    } as never);

    await renderShell("fp-old-build");
    const firstIframe = currentIframe();

    sendReady(["selection-field-section"]);

    await waitFor(() => {
      expect(startThemePreviewServer).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(currentIframe()).not.toBe(firstIframe);
    });

    reloadFrameDocument();
    sendReady(["selection-field-section", "section-presentation-ack-v1"]);
    fromPreview({
      type: "morph:storefront-preview-structure",
      nodes: [heroNode],
      routePath: "/",
    });

    expect(screen.queryByTestId("preview-presentation-unconfirmable")).toBeNull();
  });

  it("stops without reloading when the service is still unsupported and shows manual Reload preview", async () => {
    vi.mocked(startThemePreviewServer).mockResolvedValue({
      success: true,
      message: "Live Preview server ready",
      data: {
        url: `${PREVIEW_ORIGIN}/store/1/themes/1/preview`,
        workspaceFingerprint: "fp-old-build",
        bridgeCapabilities: ["selection-field-section"],
      },
    } as never);

    await renderShell("fp-old-build");
    const firstIframe = currentIframe();

    sendReady(["selection-field-section"]);

    await waitFor(() => {
      expect(startThemePreviewServer).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.getByTestId("preview-presentation-unconfirmable")).toBeTruthy();
    });

    expect(firstIframe?.isConnected).toBe(true);
    expect(currentIframe()).toBe(firstIframe);
    const alert = screen.getByTestId("preview-presentation-unconfirmable");
    expect(alert.textContent).toContain(PREVIEW_PRESENTATION_UNCONFIRMABLE_MESSAGE);
    expect(alert.textContent).toContain("Could not update the preview.");
    expect(screen.getByRole("button", { name: "Reload preview" })).toBeTruthy();
  });

  it("rebuilds at most once per editor tab per serving build even if the new frame is still unsupported", async () => {
    vi.mocked(startThemePreviewServer).mockResolvedValue({
      success: true,
      message: "Live Preview server ready",
      data: {
        url: `${PREVIEW_ORIGIN}/store/1/themes/1/preview`,
        workspaceFingerprint: "fp-new-build",
        bridgeCapabilities: [
          "selection-field-section",
          "section-presentation-ack-v1",
        ],
      },
    } as never);

    await renderShell("fp-old-build");
    const firstIframe = currentIframe();

    sendReady(["selection-field-section"]);

    await waitFor(() => {
      expect(currentIframe()).not.toBe(firstIframe);
    });
    const secondIframe = currentIframe();

    reloadFrameDocument();
    sendReady(["selection-field-section"]);

    await waitFor(() => {
      expect(screen.getByTestId("preview-presentation-unconfirmable")).toBeTruthy();
    });
    expect(currentIframe()).toBe(secondIframe);
    expect(startThemePreviewServer).toHaveBeenCalledTimes(1);
    expect(
      screen.getByTestId("preview-presentation-unconfirmable").textContent,
    ).toContain("Could not update the preview.");
    expect(screen.getByRole("button", { name: "Reload preview" })).toBeTruthy();
  });

  it("does not auto-refresh when no ready arrives (slow cold start or auth failure)", async () => {
    await renderShell("fp-old-build");
    vi.useFakeTimers();

    await act(async () => {
      vi.advanceTimersByTime(PREVIEW_PRESENTATION_UNCONFIRMABLE_AFTER_MS + 1_000);
    });

    expect(startThemePreviewServer).not.toHaveBeenCalled();
    expect(screen.queryByTestId("preview-presentation-unconfirmable")).toBeNull();
  });

  it("defers auto-refresh while Inspector IME is composing and runs once composition ends without resending drafts", async () => {
    vi.mocked(startThemePreviewServer).mockResolvedValue({
      success: true,
      message: "Live Preview server ready",
      data: {
        url: `${PREVIEW_ORIGIN}/store/1/themes/1/preview`,
        workspaceFingerprint: "fp-new-build",
        bridgeCapabilities: [
          "selection-field-section",
          "section-presentation-ack-v1",
        ],
      },
    } as never);

    await renderShell("fp-old-build");
    fromPreview({
      type: "morph:storefront-preview-structure",
      nodes: [heroNode],
      routePath: "/",
    });
    const row = await screen.findByText("h1");
    act(() => {
      row.closest("button")?.click();
    });
    fireEvent.click(screen.getByRole("button", { name: /^Content$/ }));

    const input = await screen.findByDisplayValue("Welcome");
    const firstIframe = currentIframe();

    fireEvent.compositionStart(input);
    // While composing, an unsupported ready defers its reload until composition ends.
    sendReady(["selection-field-section"]);
    await waitFor(() => {
      expect(startThemePreviewServer).toHaveBeenCalledTimes(1);
    });
    expect(currentIframe()).toBe(firstIframe);

    fireEvent.compositionEnd(input, { data: "中文" });
    await waitFor(() => {
      expect(currentIframe()).not.toBe(firstIframe);
    });
    expect(updateSectionProps).not.toHaveBeenCalled();
  });

  it("re-sends presentation tokens and re-enables content editing after manual Refresh preview reloads the frame", async () => {
    vi.mocked(startThemePreviewServer).mockResolvedValue({
      success: true,
      message: "Live Preview server ready",
      data: {
        url: `${PREVIEW_ORIGIN}/store/1/themes/1/preview`,
        workspaceFingerprint: "fp-current-build",
        bridgeCapabilities: [
          "selection-field-section",
          "section-presentation-ack-v1",
        ],
      },
    } as never);

    let postCount = 0;
    vi.mocked(postEditorToPreviewMessage).mockImplementation((_target, message) => {
      if (
        message.type === "morph:storefront-preview-update-section-props" &&
        message.presentationToken
      ) {
        if (++postCount > 20) {
          throw new Error(`LOOP detected on ${message.sectionId} enabled=${String(message.enabled)}`);
        }
        const token = message.presentationToken;
        queueMicrotask(() => {
          fromPreview({
            type: "morph:storefront-preview-section-presentation-ack",
            operationId: token.operationId,
            token,
            status: "applied",
          });
        });
      }
    });

    await renderShell("fp-current-build");
    sendReady(["selection-field-section", "section-presentation-ack-v1"]);
    disablePresentationAcks();
    answerLatestRouteRequest({ origin: PREVIEW_ORIGIN, session: PREVIEW_SESSION });
    fromPreview({
      type: "morph:storefront-preview-structure",
      nodes: [heroNode],
      routePath: "/",
    });
    const row = await screen.findByText("h1");
    act(() => {
      row.closest("button")?.click();
    });
    fireEvent.click(screen.getByRole("button", { name: /^Content$/ }));

    const input = await screen.findByDisplayValue("Welcome");
    await waitFor(() => {
      expect((input as HTMLInputElement).disabled).toBe(false);
    });

    const firstIframe = currentIframe();
    const sentBeforeRefresh = vi.mocked(postEditorToPreviewMessage).mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "Refresh preview" }));
    await waitFor(() => {
      expect(currentIframe()).not.toBe(firstIframe);
    });

    // The reloaded frame becomes ready with a new document id and ack capability.
    reloadFrameDocument();
    sendReady([
      "selection-field-section",
      "section-presentation-ack-v1",
    ]);
    answerLatestRouteRequest({ origin: PREVIEW_ORIGIN, session: PREVIEW_SESSION });

    await waitFor(() => {
      const recentTokens = vi
        .mocked(postEditorToPreviewMessage)
        .mock.calls.slice(sentBeforeRefresh)
        .map(([, message]) => message)
        .filter(
          (
            message,
          ): message is Extract<
            typeof message,
            { type: "morph:storefront-preview-update-section-props" }
          > =>
            message.type === "morph:storefront-preview-update-section-props" &&
            Boolean(message.presentationToken),
        );
      expect(recentTokens.length).toBeGreaterThan(0);
    });

    await waitFor(() => {
      expect((input as HTMLInputElement).disabled).toBe(false);
    });
  });

  it("does not write defaults into Document when a bound section has no saved props on Refresh preview", async () => {
    vi.mocked(startThemePreviewServer).mockResolvedValue({
      success: true,
      message: "Live Preview server ready",
      data: {
        url: `${PREVIEW_ORIGIN}/store/1/themes/1/preview`,
        workspaceFingerprint: "fp-current-build",
        bridgeCapabilities: [
          "selection-field-section",
          "section-presentation-ack-v1",
        ],
      },
    } as never);

    let postCount = 0;
    vi.mocked(postEditorToPreviewMessage).mockImplementation((_target, message) => {
      if (
        message.type === "morph:storefront-preview-update-section-props" &&
        message.presentationToken
      ) {
        if (++postCount > 20) {
          throw new Error(`LOOP detected on ${message.sectionId} enabled=${String(message.enabled)}`);
        }
        const token = message.presentationToken;
        queueMicrotask(() => {
          fromPreview({
            type: "morph:storefront-preview-section-presentation-ack",
            operationId: token.operationId,
            token,
            status: "applied",
          });
        });
      }
    });

    const noPropsContext = {
      ...context,
      templates: [
        {
          ...context.templates[0],
          document: {
            version: 1,
            sections: [],
          },
        },
      ],
    } as unknown as StorefrontThemeEditorDTO;
    vi.mocked(getThemeEditor).mockResolvedValue({
      success: true,
      data: noPropsContext,
    } as never);

    const boundTree = {
      ...tree(),
      files: [
        {
          id: "file-morph-content",
          storefrontId: "storefront-1",
          themeId: "theme-1",
          path: "src/morph/content.ts",
          content: 'export { content, morph, isSectionHidden } from "@morph/sdk";\n',
          mimeType: "text/typescript",
          isEntry: false,
          version: 1,
          createdAt: "2026-10-17T00:00:00.000Z",
          updatedAt: "2026-10-17T00:00:00.000Z",
        },
        {
          id: "file-hero",
          storefrontId: "storefront-1",
          themeId: "theme-1",
          path: "src/components/Hero.tsx",
          content: [
            'export const schema = { heading: { type: "text", label: "Heading" } } as const;',
            'export default function Hero({ heading = "Default heading" }: { heading?: string }) { return <h1>{heading}</h1>; }',
          ].join("\n"),
          mimeType: "text/typescript",
          isEntry: false,
          version: 1,
          createdAt: "2026-10-17T00:00:00.000Z",
          updatedAt: "2026-10-17T00:00:00.000Z",
        },
        {
          ...tree().files[0]!,
          content: [
            'import { createFileRoute } from "@tanstack/react-router";',
            'import { content } from "../morph/content";',
            'import Hero from "../components/Hero";',
            'export const Route = createFileRoute("/")({ component: Home });',
            'function Home() { return <main><Hero {...content("hero")} /></main>; }',
          ].join("\n"),
        },
      ],
    };
    vi.mocked(listStorefrontThemeFiles).mockResolvedValue({
      success: true,
      data: boundTree,
    } as never);

    await renderShell("fp-current-build", noPropsContext, boundTree);
    sendReady(["selection-field-section", "section-presentation-ack-v1"]);
    disablePresentationAcks();
    answerLatestRouteRequest({ origin: PREVIEW_ORIGIN, session: PREVIEW_SESSION });
    fromPreview({
      type: "morph:storefront-preview-structure",
      nodes: [heroNode],
      routePath: "/",
    });

    const firstIframe = currentIframe();
    const sentBeforeRefresh = vi.mocked(postEditorToPreviewMessage).mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "Refresh preview" }));
    await waitFor(() => {
      expect(currentIframe()).not.toBe(firstIframe);
    });

    reloadFrameDocument();
    sendReady([
      "selection-field-section",
      "section-presentation-ack-v1",
    ]);
    answerLatestRouteRequest({ origin: PREVIEW_ORIGIN, session: PREVIEW_SESSION });
    fromPreview({
      type: "morph:storefront-preview-structure",
      nodes: [heroNode],
      routePath: "/",
    });

    await waitFor(() => {
      const heroUpdates = vi
        .mocked(postEditorToPreviewMessage)
        .mock.calls.slice(sentBeforeRefresh)
        .map(([, message]) => message)
        .filter(
          (
            message,
          ): message is Extract<
            typeof message,
            { type: "morph:storefront-preview-update-section-props" }
          > =>
            message.type === "morph:storefront-preview-update-section-props" &&
            message.sectionId === "hero" &&
            Boolean(message.presentationToken),
        );
      expect(heroUpdates.length).toBeGreaterThan(0);
      expect(heroUpdates.at(-1)).toMatchObject({
        sectionId: "hero",
        props: undefined,
        enabled: true,
      });
    });

    expect(updateSectionProps).not.toHaveBeenCalled();
  });

  it("keeps hidden sections disabled (enabled: false) when replaying bound sections on Refresh preview", async () => {
    vi.mocked(startThemePreviewServer).mockResolvedValue({
      success: true,
      message: "Live Preview server ready",
      data: {
        url: `${PREVIEW_ORIGIN}/store/1/themes/1/preview`,
        workspaceFingerprint: "fp-current-build",
        bridgeCapabilities: [
          "selection-field-section",
          "section-presentation-ack-v1",
        ],
      },
    } as never);

    let postCount = 0;
    vi.mocked(postEditorToPreviewMessage).mockImplementation((_target, message) => {
      if (
        message.type === "morph:storefront-preview-update-section-props" &&
        message.presentationToken
      ) {
        if (++postCount > 20) {
          throw new Error(`LOOP detected on ${message.sectionId} enabled=${String(message.enabled)}`);
        }
        const token = message.presentationToken;
        queueMicrotask(() => {
          fromPreview({
            type: "morph:storefront-preview-section-presentation-ack",
            operationId: token.operationId,
            token,
            status: "applied",
          });
        });
      }
    });

    const hiddenContext = {
      ...context,
      templates: [
        {
          ...context.templates[0],
          document: {
            version: 1,
            sections: [
              { id: "hero", type: "hero", enabled: false, props: { heading: "Welcome" } },
            ],
          },
        },
      ],
    } as unknown as StorefrontThemeEditorDTO;
    vi.mocked(getThemeEditor).mockResolvedValue({
      success: true,
      data: hiddenContext,
    } as never);

    await renderShell("fp-current-build", hiddenContext);
    sendReady(["selection-field-section", "section-presentation-ack-v1"]);
    disablePresentationAcks();
    answerLatestRouteRequest({ origin: PREVIEW_ORIGIN, session: PREVIEW_SESSION });
    fromPreview({
      type: "morph:storefront-preview-structure",
      nodes: [heroNode],
      routePath: "/",
    });

    const firstIframe = currentIframe();
    const sentBeforeRefresh = vi.mocked(postEditorToPreviewMessage).mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "Refresh preview" }));
    await waitFor(() => {
      expect(currentIframe()).not.toBe(firstIframe);
    });

    reloadFrameDocument();
    sendReady([
      "selection-field-section",
      "section-presentation-ack-v1",
    ]);
    answerLatestRouteRequest({ origin: PREVIEW_ORIGIN, session: PREVIEW_SESSION });

    await waitFor(() => {
      const heroUpdates = vi
        .mocked(postEditorToPreviewMessage)
        .mock.calls.slice(sentBeforeRefresh)
        .map(([, message]) => message)
        .filter(
          (
            message,
          ): message is Extract<
            typeof message,
            { type: "morph:storefront-preview-update-section-props" }
          > =>
            message.type === "morph:storefront-preview-update-section-props" &&
            message.sectionId === "hero" &&
            Boolean(message.presentationToken),
        );
      expect(heroUpdates.length).toBeGreaterThan(0);
      expect(heroUpdates.at(-1)).toMatchObject({
        sectionId: "hero",
        enabled: false,
      });
    });

    expect(updateSectionProps).not.toHaveBeenCalled();
  });

  it("re-verifies unacknowledged section presentation after Start content sync refresh when initial Show token was rejected as section-missing", async () => {
    let releaseSync!: () => void;
    const syncGate = new Promise<void>((resolve) => {
      releaseSync = resolve;
    });
    vi.mocked(syncThemePreviewContent).mockImplementation(async () => {
      await syncGate;
      return {
        success: true,
        message: "ok",
        data: { ticket: 12 },
      } as never;
    });
    vi.mocked(confirmThemePreviewContent).mockResolvedValue({
      success: true,
      message: "ok",
      data: { applied: true },
    } as never);

    let syncedOnce = false;
    let blockShowAck = false;
    vi.mocked(postEditorToPreviewMessage).mockImplementation((_target, message) => {
      if (message.type === "morph:storefront-preview-refresh-content") {
        syncedOnce = true;
      }
      if (
        message.type === "morph:storefront-preview-update-section-props" &&
        message.presentationToken
      ) {
        const token = message.presentationToken;
        const status =
          blockShowAck && message.enabled === true && !syncedOnce
            ? "not-applied"
            : "applied";
        queueMicrotask(() => {
          fromPreview({
            type: "morph:storefront-preview-section-presentation-ack",
            operationId: token.operationId,
            token,
            status,
            ...(status === "not-applied" ? { reason: "section-missing" } : {}),
          });
        });
      }
    });

    let currentEnabled = false;
    let currentGen = 1;
    vi.mocked(getThemeEditor).mockImplementation(async () => ({
      success: true,
      data: {
        ...context,
        templates: [
          {
            ...context.templates[0],
            draftGeneration: currentGen,
            version: currentGen,
            document: {
              version: 1,
              sections: [
                {
                  id: "hero",
                  type: "hero",
                  enabled: currentEnabled,
                  props: { heading: "Welcome" },
                },
              ],
            },
          },
        ],
      },
    }) as never);
    updateSectionProps.mockImplementation(
      async ({ data }: { data: { enabled?: boolean; props?: { enabled?: boolean } } }) => {
        if (typeof data?.enabled === "boolean") {
          currentEnabled = data.enabled;
        } else if (typeof data?.props?.enabled === "boolean") {
          currentEnabled = data.props.enabled;
        }
        currentGen += 1;
        return {
          success: true,
          data: {
            templateId: "template-1",
            draftGeneration: currentGen,
            version: currentGen,
          },
        };
      },
    );

    const hiddenContext = {
      ...context,
      templates: [
        {
          ...context.templates[0],
          document: {
            version: 1,
            sections: [
              { id: "hero", type: "hero", enabled: false, props: { heading: "Welcome" } },
            ],
          },
        },
      ],
    } as unknown as StorefrontThemeEditorDTO;

    await renderShell("fp-current-build", hiddenContext, tree(), "invalidate");
    sendReady(["selection-field-section", "section-presentation-ack-v1"]);
    disablePresentationAcks();
    answerLatestRouteRequest({ origin: PREVIEW_ORIGIN, session: PREVIEW_SESSION });
    fromPreview({
      type: "morph:storefront-preview-structure",
      nodes: [heroNode],
      routePath: "/",
    });

    // Click Show section while Start content sync is still in flight; initial Show token is rejected as section-missing.
    const showBtn = await screen.findByRole("button", { name: /^Show section / });
    blockShowAck = true;
    fireEvent.click(showBtn);

    // Wait for the initial Show presentationToken to be posted and rejected as section-missing.
    await waitFor(() => {
      expect(
        screen.queryAllByText(/Preview syncing\. Content writes are paused/).length,
      ).toBeGreaterThan(0);
    });

    // Release Start content sync -> refresh-content is sent -> must re-verify presentation token.
    await act(async () => {
      releaseSync();
      await syncGate;
    });

    await waitFor(() => {
      const calls = vi.mocked(postEditorToPreviewMessage).mock.calls;
      const refreshIdx = calls.findIndex(
        ([, msg]) => msg.type === "morph:storefront-preview-refresh-content",
      );
      expect(refreshIdx).toBeGreaterThan(-1);
      const reverifyUpdates = calls
        .slice(refreshIdx + 1)
        .map(([, msg]) => msg)
        .filter(
          (
            msg,
          ): msg is Extract<
            typeof msg,
            { type: "morph:storefront-preview-update-section-props" }
          > =>
            msg.type === "morph:storefront-preview-update-section-props" &&
            msg.sectionId === "hero" &&
            Boolean(msg.presentationToken),
        );
      expect(reverifyUpdates.length).toBeGreaterThan(0);
    });

    await waitFor(() => {
      expect(
        screen.queryByText(/Preview syncing\. Content writes are paused/),
      ).toBeNull();
    });
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
  });

  it("does not re-verify or affect the new page when Start content sync finishes after frame navigated away, and does not loop if re-verification fails", async () => {
    let releaseSync!: () => void;
    const syncGate = new Promise<void>((resolve) => {
      releaseSync = resolve;
    });
    vi.mocked(syncThemePreviewContent).mockImplementation(async () => {
      await syncGate;
      return {
        success: true,
        message: "ok",
        data: { ticket: 15 },
      } as never;
    });
    vi.mocked(confirmThemePreviewContent).mockResolvedValue({
      success: true,
      message: "ok",
      data: { applied: true },
    } as never);

    let blockShowAck = false;
    let postCount = 0;
    vi.mocked(postEditorToPreviewMessage).mockImplementation((_target, message) => {
      if (
        message.type === "morph:storefront-preview-update-section-props" &&
        message.presentationToken
      ) {
        if (++postCount > 20) {
          throw new Error(`LOOP detected on ${message.sectionId} enabled=${String(message.enabled)}`);
        }
        const token = message.presentationToken;
        const status =
          blockShowAck && message.enabled === true ? "not-applied" : "applied";
        queueMicrotask(() => {
          fromPreview({
            type: "morph:storefront-preview-section-presentation-ack",
            operationId: token.operationId,
            token,
            status,
            ...(status === "not-applied" ? { reason: "section-missing" } : {}),
          });
        });
      }
    });

    updateSectionProps.mockResolvedValue({
      success: true,
      data: {
        templateId: "template-1",
        draftGeneration: 2,
        version: 2,
      },
    });

    const hiddenContext = {
      ...context,
      templates: [
        {
          ...context.templates[0],
          document: {
            version: 1,
            sections: [
              { id: "hero", type: "hero", enabled: false, props: { heading: "Welcome" } },
            ],
          },
        },
      ],
    } as unknown as StorefrontThemeEditorDTO;

    await renderShell("fp-current-build", hiddenContext, tree(), "invalidate");
    sendReady(["selection-field-section", "section-presentation-ack-v1"]);
    disablePresentationAcks();
    answerLatestRouteRequest({ origin: PREVIEW_ORIGIN, session: PREVIEW_SESSION });
    fromPreview({
      type: "morph:storefront-preview-structure",
      nodes: [heroNode],
      routePath: "/",
    });

    const showBtn = await screen.findByRole("button", { name: /^Show section / });
    blockShowAck = true;
    fireEvent.click(showBtn);

    await waitFor(() => {
      expect(
        screen.queryAllByText(/Preview syncing\. Content writes are paused/).length,
      ).toBeGreaterThan(0);
    });

    // Frame navigates to another route while syncThemePreviewContent is still in flight.
    fromPreview({
      type: "morph:storefront-preview-structure",
      nodes: [],
      routePath: "/unfollowed/elsewhere",
      frameNavigationEpoch: 1,
    });

    const callsBeforeRelease = vi.mocked(postEditorToPreviewMessage).mock.calls.length;
    await act(async () => {
      releaseSync();
      await syncGate;
    });

    await waitFor(() => {
      const postCalls = vi
        .mocked(postEditorToPreviewMessage)
        .mock.calls.slice(callsBeforeRelease)
        .map(([, msg]) => msg);
      expect(
        postCalls.some((msg) => msg.type === "morph:storefront-preview-refresh-content"),
      ).toBe(true);
    });

    const postReleaseSectionUpdates = vi
      .mocked(postEditorToPreviewMessage)
      .mock.calls.slice(callsBeforeRelease)
      .map(([, msg]) => msg)
      .filter((msg) => msg.type === "morph:storefront-preview-update-section-props");
    expect(postReleaseSectionUpdates).toHaveLength(0);
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
    expect(vi.mocked(syncThemePreviewContent)).toHaveBeenCalledTimes(1);
  });

  it("does not loop when re-verification after Start content sync refresh still receives not-applied", async () => {
    let releaseSync!: () => void;
    const syncGate = new Promise<void>((resolve) => {
      releaseSync = resolve;
    });
    vi.mocked(syncThemePreviewContent).mockImplementation(async () => {
      await syncGate;
      return {
        success: true,
        message: "ok",
        data: { ticket: 16 },
      } as never;
    });
    vi.mocked(confirmThemePreviewContent).mockResolvedValue({
      success: true,
      message: "ok",
      data: { applied: true },
    } as never);

    let blockShowAck = false;
    let postCount = 0;
    vi.mocked(postEditorToPreviewMessage).mockImplementation((_target, message) => {
      if (
        message.type === "morph:storefront-preview-update-section-props" &&
        message.presentationToken
      ) {
        if (++postCount > 20) {
          throw new Error(`LOOP detected on ${message.sectionId} enabled=${String(message.enabled)}`);
        }
        const token = message.presentationToken;
        const status =
          blockShowAck && message.enabled === true ? "not-applied" : "applied";
        // Always reject with section-missing even on re-verification.
        queueMicrotask(() => {
          fromPreview({
            type: "morph:storefront-preview-section-presentation-ack",
            operationId: token.operationId,
            token,
            status,
            ...(status === "not-applied" ? { reason: "section-missing" } : {}),
          });
        });
      }
    });

    updateSectionProps.mockResolvedValue({
      success: true,
      data: {
        templateId: "template-1",
        draftGeneration: 2,
        version: 2,
      },
    });

    const hiddenContext = {
      ...context,
      templates: [
        {
          ...context.templates[0],
          document: {
            version: 1,
            sections: [
              { id: "hero", type: "hero", enabled: false, props: { heading: "Welcome" } },
            ],
          },
        },
      ],
    } as unknown as StorefrontThemeEditorDTO;

    await renderShell("fp-current-build", hiddenContext, tree(), "invalidate");
    sendReady(["selection-field-section", "section-presentation-ack-v1"]);
    disablePresentationAcks();
    answerLatestRouteRequest({ origin: PREVIEW_ORIGIN, session: PREVIEW_SESSION });
    fromPreview({
      type: "morph:storefront-preview-structure",
      nodes: [heroNode],
      routePath: "/",
    });

    const showBtn = await screen.findByRole("button", { name: /^Show section / });
    blockShowAck = true;
    fireEvent.click(showBtn);

    await waitFor(() => {
      expect(
        screen.queryAllByText(/Preview syncing\. Content writes are paused/).length,
      ).toBeGreaterThan(0);
    });

    await act(async () => {
      releaseSync();
      await syncGate;
    });

    await waitFor(() => {
      const refreshIdx = vi
        .mocked(postEditorToPreviewMessage)
        .mock.calls.findIndex(
          ([, msg]) => msg.type === "morph:storefront-preview-refresh-content",
        );
      expect(refreshIdx).toBeGreaterThan(-1);
    });

    // Give microtasks a chance to settle; only 1 re-verification update is sent (no loop).
    await new Promise((r) => setTimeout(r, 30));
    const refreshIdx = vi
      .mocked(postEditorToPreviewMessage)
      .mock.calls.findIndex(
        ([, msg]) => msg.type === "morph:storefront-preview-refresh-content",
      );
    const reverifyUpdates = vi
      .mocked(postEditorToPreviewMessage)
      .mock.calls.slice(refreshIdx + 1)
      .map(([, msg]) => msg)
      .filter((msg) => msg.type === "morph:storefront-preview-update-section-props");
    expect(reverifyUpdates).toHaveLength(1);
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
    expect(vi.mocked(syncThemePreviewContent)).toHaveBeenCalledTimes(1);
    expect(
      screen.queryAllByText(/Preview syncing\. Content writes are paused/).length,
    ).toBeGreaterThan(0);
  });
});
