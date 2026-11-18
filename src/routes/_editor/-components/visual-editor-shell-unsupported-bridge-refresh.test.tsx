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
  PREVIEW_OTHER_PAGE_PAUSED_MESSAGE,
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
  initialAnswer?: unknown,
) {
  const initialServer = (initialAnswer ?? {
    success: true,
    message: "Live Preview server ready",
    data: {
      url: `${PREVIEW_ORIGIN}/store/1/themes/1/preview`,
      workspaceFingerprint: initialFp,
      bridgeCapabilities: ["selection-field-section", "code-default-selection", "astro-identity-v2"],
      ...(contentRefresh ? { contentRefresh } : {}),
    },
  }) as never;
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

/**
 * A start answer's serving report, as the server function passes it on: a
 * build the editor has no record of, served by an instance it cannot name.
 */
function servingOf(capabilities: string[]) {
  return {
    bridge: { buildId: "d".repeat(64), capabilities },
    instance: null,
  };
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
        servingBridge: servingOf([
          "selection-field-section",
          "code-default-selection",
          "astro-identity-v2",
          "section-presentation-ack-v1",
        ]),
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
        servingBridge: servingOf(["selection-field-section"]),
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
        servingBridge: servingOf([
          "selection-field-section",
          "section-presentation-ack-v1",
        ]),
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
        servingBridge: servingOf([
          "selection-field-section",
          "section-presentation-ack-v1",
        ]),
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

  describe("a refresh held during composition belongs to the frame round it was decided for", () => {
    const ACK_SERVING = {
      success: true,
      message: "Live Preview server ready",
      data: {
        url: `${PREVIEW_ORIGIN}/store/1/themes/1/preview`,
        workspaceFingerprint: "fp-new-build",
        servingBridge: servingOf([
          "selection-field-section",
          "section-presentation-ack-v1",
        ]),
        bridgeCapabilities: [
          "selection-field-section",
          "section-presentation-ack-v1",
        ],
      },
    };
    const cachedFingerprint = (client: QueryClient) =>
      (
        client.getQueryData(
          themePreviewServerQueries.forTheme("storefront-1", "theme-1").queryKey,
        ) as { data?: { workspaceFingerprint?: string } } | undefined
      )?.data?.workspaceFingerprint;

    async function composingOnOldFrame() {
      vi.mocked(startThemePreviewServer).mockResolvedValue(ACK_SERVING as never);
      const client = await renderShell("fp-old-build");
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
      sendReady(["selection-field-section"]);
      // The answer arrives while composing: the refresh is held.
      await waitFor(() => {
        expect(startThemePreviewServer).toHaveBeenCalledTimes(1);
      });
      expect(currentIframe()).toBe(firstIframe);
      return { client, input, firstIframe };
    }

    it("is dropped when a newer round of the frame replaced the one it was decided for", async () => {
      const info = vi.spyOn(console, "info");
      const { client, input, firstIframe } = await composingOnOldFrame();
      // The frame reloads by itself and comes up again, still unable to
      // acknowledge: a newer round than the one the answer was for.
      reloadFrameDocument();
      sendReady(["selection-field-section"]);
      fireEvent.compositionEnd(input, { data: "中文" });
      // Long enough for the held refresh to have run if it were going to:
      // it runs in the effect that composition ending triggers.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
      });
      // No reload, and the older answer did not replace the cached one.
      expect(currentIframe()).toBe(firstIframe);
      expect(cachedFingerprint(client)).toBe("fp-old-build");
      expect(updateSectionProps).not.toHaveBeenCalled();
      expect(
        info.mock.calls.filter((call) =>
          String(call[0]).startsWith("[preview-bridge] held refresh dropped"),
        ),
      ).toHaveLength(1);
      // The frame on screen is offered the manual reload instead.
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Reload preview" })).toBeTruthy();
      });
    });

    it("refreshes exactly once when the frame it was decided for is still on screen", async () => {
      const info = vi.spyOn(console, "info");
      const { client, input, firstIframe } = await composingOnOldFrame();
      fireEvent.compositionEnd(input, { data: "中文" });
      await waitFor(() => {
        expect(currentIframe()).not.toBe(firstIframe);
      });
      const refreshed = currentIframe();
      expect(cachedFingerprint(client)).toBe("fp-new-build");
      await act(async () => {});
      expect(currentIframe()).toBe(refreshed);
      expect(startThemePreviewServer).toHaveBeenCalledTimes(1);
      expect(
        info.mock.calls.filter((call) =>
          String(call[0]).startsWith("[preview-bridge] held refresh dropped"),
        ),
      ).toEqual([]);
      expect(updateSectionProps).not.toHaveBeenCalled();
    });
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

  it("replaces still-pending pre-sync Show token when Start content sync finishes before pre-sync not-applied arrives", async () => {
    let releaseSync!: () => void;
    const syncGate = new Promise<void>((resolve) => {
      releaseSync = resolve;
    });
    vi.mocked(syncThemePreviewContent).mockImplementation(async () => {
      await syncGate;
      return {
        success: true,
        message: "ok",
        data: { ticket: 17 },
      } as never;
    });
    vi.mocked(confirmThemePreviewContent).mockResolvedValue({
      success: true,
      message: "ok",
      data: { applied: true },
    } as never);

    let syncedOnce = false;
    let holdPreSyncShowToken: {
      operationId: string;
      token: Record<string, unknown>;
    } | null = null;
    let postCount = 0;
    vi.mocked(postEditorToPreviewMessage).mockImplementation((_target, message) => {
      if (message.type === "morph:storefront-preview-refresh-content") {
        syncedOnce = true;
      }
      if (
        message.type === "morph:storefront-preview-update-section-props" &&
        message.presentationToken
      ) {
        if (++postCount > 20) {
          throw new Error(
            `LOOP detected on ${message.sectionId} enabled=${String(message.enabled)}`,
          );
        }
        const token = message.presentationToken as Record<string, unknown> & {
          operationId: string;
        };
        if (message.enabled === true && !syncedOnce && !holdPreSyncShowToken) {
          // Hold the initial Show token while still pending until after refresh-content runs.
          holdPreSyncShowToken = { operationId: token.operationId, token };
          return;
        }
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

    const showBtn = await screen.findByRole("button", { name: /^Show section / });
    fireEvent.click(showBtn);

    await waitFor(() => {
      expect(holdPreSyncShowToken).not.toBeNull();
    });

    // Sync completes and sends refresh-content BEFORE the held pre-sync Show token gets its not-applied ack.
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
      const reverifyUpdates = vi
        .mocked(postEditorToPreviewMessage)
        .mock.calls.slice(refreshIdx + 1)
        .map(([, msg]) => msg)
        .filter(
          (msg) =>
            msg.type === "morph:storefront-preview-update-section-props" &&
            msg.sectionId === "hero" &&
            Boolean(msg.presentationToken),
        );
      expect(reverifyUpdates.length).toBeGreaterThan(0);
    });

    // Late pre-sync not-applied arrives after refresh-content; must be ignored and not lock the editor.
    fromPreview({
      type: "morph:storefront-preview-section-presentation-ack",
      operationId: holdPreSyncShowToken!.operationId,
      token: holdPreSyncShowToken!.token,
      status: "not-applied",
      reason: "section-missing",
    });

    await waitFor(() => {
      expect(
        screen.queryByText(/Preview syncing\. Content writes are paused/),
      ).toBeNull();
    });
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
  });

  /**
   * Start content sync, "replace-pending": the section tokens still waiting
   * are dropped before the section is posted again. Controlled cases for the
   * window that opens there: the re-post may carry no token, and the frame
   * may move meanwhile. Nothing may unlock writes falsely, nothing the
   * author did is dropped, and the author has a way out.
   */
  describe("Start content sync replacing pending section tokens", () => {
    type TokenPost = {
      presentationToken: Record<string, unknown> & { operationId: string };
    };
    const syncingBanner = () =>
      screen.queryAllByText(/Preview syncing\. Content writes are paused/);
    const tokenPostsSince = (from: number) =>
      vi
        .mocked(postEditorToPreviewMessage)
        .mock.calls.slice(from)
        .map(([, message]) => message)
        .filter(
          (message) =>
            message.type === "morph:storefront-preview-update-section-props" &&
            Boolean(message.presentationToken),
        ) as unknown as TokenPost[];
    const callCount = () =>
      vi.mocked(postEditorToPreviewMessage).mock.calls.length;
    const ack = (
      posted: TokenPost,
      answer: Record<string, unknown> = { status: "applied" },
    ) =>
      fromPreview({
        type: "morph:storefront-preview-section-presentation-ack",
        operationId: posted.presentationToken.operationId,
        token: posted.presentationToken,
        ...answer,
      });
    function gatedSync(ticket: number) {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      vi.mocked(syncThemePreviewContent).mockImplementation(async () => {
        await gate;
        return { success: true, message: "ok", data: { ticket } } as never;
      });
      vi.mocked(confirmThemePreviewContent).mockResolvedValue({
        success: true,
        message: "ok",
        data: { applied: true },
      } as never);
      return async () => {
        await act(async () => {
          release();
          await gate;
        });
      };
    }
    const hiddenContext = () =>
      ({
        ...context,
        templates: [
          {
            ...context.templates[0],
            document: {
              version: 1,
              sections: [
                {
                  id: "hero",
                  type: "hero",
                  enabled: false,
                  props: { heading: "Welcome" },
                },
              ],
            },
          },
        ],
      }) as unknown as StorefrontThemeEditorDTO;
    const refreshPosted = () =>
      waitFor(() =>
        expect(
          vi
            .mocked(postEditorToPreviewMessage)
            .mock.calls.some(
              ([, message]) =>
                message.type === "morph:storefront-preview-refresh-content",
            ),
        ).toBe(true),
      );
    /** The frame comes up on the editor's page; it acknowledges nothing by itself. */
    async function openWithSilentFrame(capabilities: string[]) {
      vi.mocked(postEditorToPreviewMessage).mockImplementation(() => {});
      await renderShell("fp-current-build", hiddenContext(), tree(), "invalidate");
      sendReady(capabilities);
      disablePresentationAcks();
      answerLatestRouteRequest({
        origin: PREVIEW_ORIGIN,
        session: PREVIEW_SESSION,
      });
      fromPreview({
        type: "morph:storefront-preview-structure",
        nodes: [heroNode],
        routePath: "/",
      });
    }

    it("the frame moves to another page before the re-posted token is acknowledged: writes stay paused, and returning with a fresh acknowledgement unlocks them", async () => {
      const releaseSync = gatedSync(21);
      await openWithSilentFrame([
        "selection-field-section",
        "section-presentation-ack-v1",
      ]);
      // The page's first presentation is acknowledged: writes open.
      await waitFor(() => expect(tokenPostsSince(0).length).toBeGreaterThan(0));
      for (const posted of tokenPostsSince(0)) ack(posted);
      await waitFor(() => expect(syncingBanner()).toHaveLength(0));

      // Show: one write, and a presentation of it that is not acknowledged.
      const beforeShow = callCount();
      fireEvent.click(
        await screen.findByRole("button", { name: /^Show section / }),
      );
      await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(1));
      await waitFor(() =>
        expect(tokenPostsSince(beforeShow).length).toBeGreaterThan(0),
      );
      await waitFor(() => expect(syncingBanner().length).toBeGreaterThan(0));
      const replaced = tokenPostsSince(beforeShow);

      // The sync finishes: the pending tokens are replaced by a re-post.
      const beforeRefresh = callCount();
      await releaseSync();
      await refreshPosted();
      await waitFor(() =>
        expect(tokenPostsSince(beforeRefresh).length).toBeGreaterThan(0),
      );
      const reposted = tokenPostsSince(beforeRefresh).at(-1)!;

      // The frame moves away before acknowledging it; the bridge on the
      // other page answers that the section is not there.
      fromPreview({
        type: "morph:storefront-preview-structure",
        nodes: [],
        routePath: "/unfollowed/elsewhere",
        frameNavigationEpoch: 1,
      });
      ack(reposted, { status: "not-applied", reason: "section-missing" });
      // A late "applied" for a token the re-post replaced changes nothing.
      for (const stale of replaced) ack(stale);
      await act(async () => {
        await Promise.resolve();
      });
      // No false unlock: paused, and (Option A notice) the notice says the
      // frame is on another page, the draft is kept, and to return.
      expect(
        screen.queryAllByText(PREVIEW_OTHER_PAGE_PAUSED_MESSAGE).length,
        "no false unlock",
      ).toBeGreaterThan(0);
      expect(updateSectionProps).toHaveBeenCalledTimes(1);

      // The way out: the frame returns to the editor's page, the section is
      // presented again, and that presentation's acknowledgement unlocks.
      const beforeReturn = callCount();
      fromPreview({
        type: "morph:storefront-preview-structure",
        nodes: [heroNode],
        routePath: "/",
        frameNavigationEpoch: 2,
      });
      await waitFor(() =>
        expect(tokenPostsSince(beforeReturn).length).toBeGreaterThan(0),
      );
      const fresh = tokenPostsSince(beforeReturn).at(-1)!;
      expect(fresh.presentationToken.operationId).not.toBe(
        reposted.presentationToken.operationId,
      );
      ack(fresh);
      await waitFor(() => expect(syncingBanner()).toHaveLength(0));
      expect(screen.queryAllByText(PREVIEW_OTHER_PAGE_PAUSED_MESSAGE)).toHaveLength(0);
      expect(updateSectionProps).toHaveBeenCalledTimes(1);
    });

    it("a frame that cannot acknowledge: nothing is written, so no sync runs and no token is dropped; the manual reload stays offered", async () => {
      // The service still serves a bridge without the capability.
      vi.mocked(startThemePreviewServer).mockResolvedValue({
        success: true,
        message: "Live Preview server ready",
        data: {
          url: `${PREVIEW_ORIGIN}/store/1/themes/1/preview`,
          workspaceFingerprint: "fp-current-build",
          servingBridge: servingOf(["selection-field-section"]),
          bridgeCapabilities: ["selection-field-section"],
        },
      } as never);
      gatedSync(22);
      await openWithSilentFrame(["selection-field-section"]);
      await waitFor(() =>
        expect(screen.getByTestId("preview-presentation-unconfirmable")).toBeTruthy(),
      );
      const before = callCount();
      fireEvent.click(
        await screen.findByRole("button", { name: /^Show section / }),
      );
      await act(async () => {
        await Promise.resolve();
      });
      expect(updateSectionProps, "no false unlock").not.toHaveBeenCalled();
      expect(syncThemePreviewContent).not.toHaveBeenCalled();
      expect(tokenPostsSince(before)).toHaveLength(0);
      expect(
        vi
          .mocked(postEditorToPreviewMessage)
          .mock.calls.slice(before)
          .some(
            ([, message]) =>
              message.type === "morph:storefront-preview-refresh-content",
          ),
      ).toBe(false);
      expect(
        screen.getByTestId("preview-presentation-unconfirmable").textContent,
      ).toContain(PREVIEW_PRESENTATION_UNCONFIRMABLE_MESSAGE);
      // The way out stays: the author can reload the preview.
      expect(screen.getByRole("button", { name: "Reload preview" })).toBeTruthy();
    });
  });

  /**
   * What the start answers say is serving, against what served the frame on
   * screen. Only "the service confirms the acknowledging bridge, and the
   * frame's version is unknown" refreshes, once per serving build.
   */
  describe("the serving decision", () => {
    const ACK_CAPABILITY = "section-presentation-ack-v1";
    const BUILD_OLD = "a".repeat(64);
    const BUILD_NEW = "b".repeat(64);
    const OLD_INSTANCE = { session: "sidecar-old-0001", serial: 1 };
    const NEW_INSTANCE = { session: "sidecar-new-0002", serial: 1 };
    type Instance = typeof OLD_INSTANCE;
    type Serving = Readonly<{
      buildId: string;
      ack: boolean;
      instance: Instance | null;
    }>;
    const capabilitiesOf = (ack: boolean) => [
      "selection-field-section",
      "code-default-selection",
      ...(ack ? [ACK_CAPABILITY] : []),
    ];
    /** A start answer in the shape the server function returns it. */
    const startAnswer = (serving: Serving | null, fingerprint = "fp-check") =>
      ({
        success: true,
        message: "Live Preview server ready",
        data: {
          url: `${PREVIEW_ORIGIN}/store/1/themes/1/preview`,
          workspaceFingerprint: fingerprint,
          servingBridge: serving
            ? {
                bridge: {
                  buildId: serving.buildId,
                  capabilities: capabilitiesOf(serving.ack),
                },
                instance: serving.instance,
              }
            : null,
          ...(serving ? { bridgeCapabilities: capabilitiesOf(serving.ack) } : {}),
        },
      }) as never;
    async function renderServedBy(
      initial: Serving | null,
      fingerprint = "fp-initial",
    ) {
      return renderShell(
        fingerprint,
        context,
        tree(),
        undefined,
        startAnswer(initial, fingerprint),
      );
    }
    /** The frame's ready, naming the instance its responses came from. */
    const readyServedBy = (capabilities: string[], instance: Instance | null) =>
      sendFrameReady(
        { origin: PREVIEW_ORIGIN, session: PREVIEW_SESSION },
        capabilities,
        instance ? { servedInstance: { kind: "known", instance } } : {},
      );
    async function expectRefreshed(firstIframe: Element | null) {
      await waitFor(() => {
        expect(currentIframe()).not.toBe(firstIframe);
      });
      expect(startThemePreviewServer).toHaveBeenCalledTimes(1);
    }
    async function expectStopped(firstIframe: Element | null) {
      await waitFor(() => {
        expect(startThemePreviewServer).toHaveBeenCalledTimes(1);
      });
      await waitFor(() => {
        expect(
          screen.getByTestId("preview-presentation-unconfirmable").textContent,
        ).toContain("Could not update the preview.");
      });
      expect(currentIframe()).toBe(firstIframe);
      expect(firstIframe?.isConnected).toBe(true);
      expect(screen.getByRole("button", { name: "Reload preview" })).toBeTruthy();
    }

    type Row = "supports" | "does not" | "unknown";
    type Column = "changed" | "same" | "unknown";
    const answerFor = (row: Row, column: Column): Serving | null => {
      if (row === "unknown") return null;
      return {
        buildId: BUILD_NEW,
        ack: row === "supports",
        instance: column === "same" ? OLD_INSTANCE : NEW_INSTANCE,
      };
    };
    const cells: Array<[Row, Column, boolean]> = [];
    for (const row of ["supports", "does not", "unknown"] as const) {
      for (const column of ["changed", "same", "unknown"] as const) {
        cells.push([row, column, row === "supports" && column === "unknown"]);
      }
    }

    it.each(cells)(
      "serving %s, previous version %s: refreshes = %s",
      async (row, column, refreshes) => {
        vi.mocked(startThemePreviewServer).mockResolvedValue(
          startAnswer(answerFor(row, column)),
        );
        // changed: this tab was told the frame's instance served an older
        // build. same: the answer names the frame's own instance. unknown:
        // the frame names no instance this tab was told anything about.
        await renderServedBy(
          column === "changed"
            ? { buildId: BUILD_OLD, ack: false, instance: OLD_INSTANCE }
            : null,
        );
        const firstIframe = currentIframe();
        readyServedBy(
          ["selection-field-section"],
          column === "unknown" ? null : OLD_INSTANCE,
        );
        if (refreshes) {
          await expectRefreshed(firstIframe);
        } else {
          await expectStopped(firstIframe);
        }
      },
    );

    it("unknown: a start that fails stops without a refresh", async () => {
      vi.mocked(startThemePreviewServer).mockResolvedValue({
        success: false,
        message: "The Live Preview server could not start.",
      } as never);
      await renderServedBy(null);
      const firstIframe = currentIframe();
      readyServedBy(["selection-field-section"], null);
      await expectStopped(firstIframe);
    });

    it("a frame naming an instance this tab has no record of is unknown, and the confirmed service refreshes it once", async () => {
      vi.mocked(startThemePreviewServer).mockResolvedValue(
        startAnswer({ buildId: BUILD_NEW, ack: true, instance: NEW_INSTANCE }),
      );
      await renderServedBy(null);
      const firstIframe = currentIframe();
      readyServedBy(["selection-field-section"], OLD_INSTANCE);
      await expectRefreshed(firstIframe);
    });

    it("container: a service that names no instance is never the frame's; it refreshes once, and the new ready with the capability unlocks nothing until the frame acknowledges", async () => {
      vi.mocked(startThemePreviewServer).mockResolvedValue(
        startAnswer({ buildId: BUILD_NEW, ack: true, instance: null }),
      );
      vi.mocked(postEditorToPreviewMessage).mockImplementation(() => {});
      await renderServedBy({ buildId: BUILD_NEW, ack: true, instance: null });
      fromPreview({
        type: "morph:storefront-preview-structure",
        nodes: [heroNode],
        routePath: "/",
      });
      const firstIframe = currentIframe();
      readyServedBy(["selection-field-section"], null);
      await expectRefreshed(firstIframe);

      reloadFrameDocument();
      readyServedBy(["selection-field-section", ACK_CAPABILITY], null);
      // The new frame says it can acknowledge; it has acknowledged nothing.
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
      fireEvent.input(input, { target: { value: "Not yet acknowledged" } });
      fireEvent.blur(input);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 600));
      });
      expect(updateSectionProps, "no write before the frame's own ack").not.toHaveBeenCalled();
      expect(screen.getByDisplayValue("Not yet acknowledged")).toBeTruthy();
      expect(startThemePreviewServer).toHaveBeenCalledTimes(1);
    });

    it("a Theme save moves the fingerprint, not the bridge: after the one refresh for a build, a later frame without the capability is not refreshed again", async () => {
      vi.mocked(startThemePreviewServer).mockResolvedValue(
        startAnswer(
          { buildId: BUILD_NEW, ack: true, instance: NEW_INSTANCE },
          "fp-check-1",
        ),
      );
      const client = await renderServedBy(null);
      const firstIframe = currentIframe();
      readyServedBy(["selection-field-section"], null);
      await expectRefreshed(firstIframe);
      const secondIframe = currentIframe();

      // The refreshed frame still cannot acknowledge: stopped, manual.
      reloadFrameDocument();
      readyServedBy(["selection-field-section"], null);
      await waitFor(() => {
        expect(screen.getByTestId("preview-presentation-unconfirmable")).toBeTruthy();
      });

      // A Theme save: the next answers carry a new fingerprint (the source
      // generation is in it) and the same serving build.
      client.setQueryData(
        themePreviewServerQueries.forTheme("storefront-1", "theme-1").queryKey,
        startAnswer(
          { buildId: BUILD_NEW, ack: true, instance: NEW_INSTANCE },
          "fp-after-save-1",
        ),
      );
      vi.mocked(startThemePreviewServer).mockResolvedValue(
        startAnswer(
          { buildId: BUILD_NEW, ack: true, instance: NEW_INSTANCE },
          "fp-after-save-2",
        ),
      );
      reloadFrameDocument();
      readyServedBy(["selection-field-section"], null);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      await waitFor(() => {
        expect(
          screen.getByTestId("preview-presentation-unconfirmable").textContent,
        ).toContain("Could not update the preview.");
      });
      expect(currentIframe()).toBe(secondIframe);
      expect(screen.getByRole("button", { name: "Reload preview" })).toBeTruthy();
    });

    it("a refreshed frame naming another instance than the one that answered is logged, not refreshed again, and unlocks nothing by itself", async () => {
      const info = vi.spyOn(console, "info").mockImplementation(() => {});
      vi.mocked(startThemePreviewServer).mockResolvedValue(
        startAnswer({ buildId: BUILD_NEW, ack: true, instance: NEW_INSTANCE }),
      );
      await renderServedBy(null);
      const firstIframe = currentIframe();
      readyServedBy(["selection-field-section"], null);
      await expectRefreshed(firstIframe);
      const secondIframe = currentIframe();

      reloadFrameDocument();
      readyServedBy(["selection-field-section", ACK_CAPABILITY], OLD_INSTANCE);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      expect(currentIframe()).toBe(secondIframe);
      expect(startThemePreviewServer).toHaveBeenCalledTimes(1);
      expect(
        info.mock.calls.some(([line]) =>
          String(line).includes("[preview-bridge] refreshed frame"),
        ),
      ).toBe(true);
      info.mockRestore();
    });
  });

  /** The Inspector's content field across the one refresh. */
  describe("drafts across the bounded refresh", () => {
    const ACK_CAPABILITY = "section-presentation-ack-v1";
    const supportedAnswer = {
      success: true,
      message: "Live Preview server ready",
      data: {
        url: `${PREVIEW_ORIGIN}/store/1/themes/1/preview`,
        workspaceFingerprint: "fp-check",
        servingBridge: {
          bridge: {
            buildId: "c".repeat(64),
            capabilities: ["selection-field-section", ACK_CAPABILITY],
          },
          instance: { session: "sidecar-new-0002", serial: 1 },
        },
        bridgeCapabilities: ["selection-field-section", ACK_CAPABILITY],
      },
    } as never;
    const writes = () =>
      updateSectionProps.mock.calls.map(
        ([call]) =>
          (call as { data: Record<string, unknown> }).data as {
            templateId: string;
            props: Record<string, unknown>;
            expectedDraftGeneration?: number;
          },
      );

    /**
     * The old frame is up without the capability; the check is held until
     * `answer` is called, so the author can work in the meantime.
     */
    async function oldFrameWithHeldCheck() {
      let answer!: () => Promise<void>;
      const gate = new Promise<void>((resolve) => {
        answer = async () => {
          await act(async () => {
            resolve();
            await gate;
          });
        };
      });
      vi.mocked(startThemePreviewServer).mockImplementation(async () => {
        await gate;
        return supportedAnswer;
      });
      await renderShell("fp-initial");
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
      sendReady(["selection-field-section"]);
      await waitFor(() => {
        expect(startThemePreviewServer).toHaveBeenCalledTimes(1);
      });
      return { input, firstIframe, answer };
    }
    /** The new frame comes up, can acknowledge, and acknowledges. */
    async function newFrameAcknowledges(firstIframe: Element | null) {
      await waitFor(() => {
        expect(currentIframe()).not.toBe(firstIframe);
      });
      reloadFrameDocument();
      sendReady(["selection-field-section", ACK_CAPABILITY]);
      answerLatestRouteRequest({ origin: PREVIEW_ORIGIN, session: PREVIEW_SESSION });
      fromPreview({
        type: "morph:storefront-preview-structure",
        nodes: [heroNode],
        routePath: "/",
      });
      await waitFor(() => {
        expect(screen.queryByTestId("preview-presentation-unconfirmable")).toBeNull();
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 800));
      });
    }

    // The old frame cannot acknowledge, so the Inspector's content field is
    // disabled on it from its ready to the refresh: nothing is typed or
    // left there through the Inspector. A commit left before the refresh,
    // on a frame that could acknowledge, is the route-document file's case.
    it("the old frame keeps the content field disabled, so nothing is typed or left there; the refresh writes nothing, and the new frame's acknowledgement opens the field", async () => {
      const { input, firstIframe, answer } = await oldFrameWithHeldCheck();
      expect((input as HTMLTextAreaElement).disabled).toBe(true);

      await answer();
      await newFrameAcknowledges(firstIframe);
      expect(updateSectionProps).not.toHaveBeenCalled();
      expect(
        (screen.getByDisplayValue("Welcome") as HTMLTextAreaElement).disabled,
      ).toBe(false);
    });

    // An inline edit open on the old frame's canvas holds the one refresh,
    // so the page under it is not replaced while it is unfinished. What it
    // ends with on the old frame is not written there, and the new frame's
    // acknowledgement does not send it either: it stays a draft.
    it("an inline edit open on the old frame holds the refresh until it ends; its text stays a draft, written neither on the old frame nor after the new frame acknowledges", async () => {
      const { firstIframe, answer } = await oldFrameWithHeldCheck();
      // The old page says it is on the editor's page, as a page an author
      // can edit on does.
      answerLatestRouteRequest({ origin: PREVIEW_ORIGIN, session: PREVIEW_SESSION });
      fromPreview({
        type: "morph:storefront-preview-structure",
        nodes: [heroNode],
        routePath: "/",
      });
      fromPreview({
        type: "morph:storefront-preview-inline-text-editing",
        editing: true,
      });
      await answer();
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 800));
      });
      // Unfinished: the frame is still the old one, and nothing is written.
      expect(currentIframe()).toBe(firstIframe);
      expect(updateSectionProps).not.toHaveBeenCalled();

      fromPreview({
        type: "morph:storefront-preview-commit-inline-text",
        sectionId: "hero",
        fieldKey: "heading",
        fieldPath: "heading",
        value: "Typed on the old frame",
        originalValue: "Welcome",
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 800));
      });
      // Taken as the author's input, and held: nothing is written.
      expect(screen.getByDisplayValue("Typed on the old frame")).toBeTruthy();
      expect(updateSectionProps).not.toHaveBeenCalled();
      fromPreview({
        type: "morph:storefront-preview-inline-text-editing",
        editing: false,
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 800));
      });
      expect(screen.getByDisplayValue("Typed on the old frame")).toBeTruthy();
      await newFrameAcknowledges(firstIframe);
      expect(startThemePreviewServer).toHaveBeenCalledTimes(1);
      expect(updateSectionProps).not.toHaveBeenCalled();
      expect(screen.getByDisplayValue("Typed on the old frame")).toBeTruthy();
    });

    it("control: with nothing left before the refresh, the new frame's acknowledgement opens writes for new input", async () => {
      const { firstIframe, answer } = await oldFrameWithHeldCheck();
      await answer();
      await newFrameAcknowledges(firstIframe);
      expect(updateSectionProps).not.toHaveBeenCalled();
      const field = screen.getByDisplayValue("Welcome");
      fireEvent.input(field, { target: { value: "Typed after the ack" } });
      fireEvent.blur(field);
      await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(1));
      expect(writes()[0]).toEqual(
        expect.objectContaining({
          props: expect.objectContaining({ heading: "Typed after the ack" }),
          expectedDraftGeneration: 1,
        }),
      );
    });
  });
});
