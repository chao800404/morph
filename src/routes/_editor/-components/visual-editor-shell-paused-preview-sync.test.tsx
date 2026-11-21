import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import type { StorefrontThemeFileDTO } from "@/lib/storefront/dto/storefront-theme-file.dto";
import { useEditorWriteGateStore } from "@/lib/storefront/store/editor-write-gate-store";
import { useThemeWorkspaceStore } from "@/lib/storefront/store/theme-workspace-store";
import type { StorefrontThemeEditorSearch } from "@/lib/validations/storefront-theme";
import { storefrontThemeFileQueries } from "../-queries/storefront-theme-files.queries";
import { themePreviewServerQueries } from "../-queries/theme-preview-server.queries";
import { VisualEditorShell } from "./visual-editor-shell";

/**
 * The preview's file sync after a sign-in that expired and was checked again.
 *
 * e2e/editor-writes-auth.spec.ts: the author's sign-in expired with a Code
 * draft unsaved; Check again found the same account back ("Signed in
 * again"), and the editor waited for Save my changes. The shell read
 * everything again, the preview frame came up again, and its first file sync
 * was never sent: the lifecycle sat in syncing-source until it gave up with
 * "Live Preview server could not be started".
 *
 * The sync writes into the preview's sandbox, not the saved Theme. Verified
 * means the account the drafts belong to is proven signed in, so the preview
 * may have them; only saving them waits for the author. While nobody is
 * proven signed in — still signed out, or another account — nothing goes.
 */

const PREVIEW_ORIGIN = "https://preview.morph.test";
const PREVIEW_SESSION = "5f0f0f6e-6c2e-4f1c-9a3e-0f9a2b7c1d4e";
const HERO_PATH = "src/components/Hero.tsx";
const SCOPE = { storefrontId: "storefront-1", themeId: "theme-1" };
const OWNER = { id: "user-1", name: "Owner", email: "owner@morph.test" };
const SAVED_SOURCE =
  "export default function Hero() { return <section>x</section>; }\n";
const DRAFT = `${SAVED_SOURCE}// typed while signed out\n`;

const getThemeEditor = vi.hoisted(() => vi.fn());
const getSession = vi.hoisted(() => vi.fn());
const listThemeFiles = vi.hoisted(() => vi.fn());
const startPreviewServer = vi.hoisted(() => vi.fn());
const applyPreviewFiles = vi.hoisted(() => vi.fn());

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
    listStorefrontThemeFiles: listThemeFiles,
    saveStorefrontThemeFile: vi.fn(),
  }),
);

vi.mock(
  "@/server/storefront/storefront-theme-preview-server.serverFn",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    startThemePreviewServer: startPreviewServer,
    applyThemePreviewFiles: applyPreviewFiles,
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

vi.mock("@/server/auth/getSession", () => ({ getSession }));

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
  path: HERO_PATH,
  content: SAVED_SOURCE,
  mimeType: "text/typescript",
  isEntry: false,
  version: 1,
  createdAt: "2026-11-20T00:00:00.000Z",
  updatedAt: "2026-11-20T00:00:00.000Z",
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

const TREE = {
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
          children: [{ name: "Hero.tsx", path: HERO_PATH, isDirectory: false }],
        },
      ],
    },
  ],
  sourceGeneration: 1,
  latestPublishedRevision: null,
};

let lifecycleLog: string[] = [];

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
    TREE as never,
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
        currentUser={OWNER}
      />
    </QueryClientProvider>,
  );
  return client;
}

/**
 * The preview server answers again with another address, as the refetch after
 * Check again did in the E2E: the frame is replaced, and comes up again.
 */
async function previewServerAnswersAgain(client: QueryClient) {
  act(() => {
    client.setQueryData(
      themePreviewServerQueries.forTheme("storefront-1", "theme-1").queryKey,
      {
        success: true,
        message: "Live Preview server ready",
        data: { url: `${PREVIEW_ORIGIN}/store/1/themes/1/preview?serving=2` },
      } as never,
    );
  });
  await waitFor(() => {
    expect(lifecycleLog.at(-1)).toMatch(/loading-frame/);
  });
  frameReady();
}

/** The frame on screen saying it is ready, as a page that (re)loaded does. */
function frameReady() {
  const current = document.querySelector("iframe");
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "morph:storefront-preview-ready",
          previewSession: PREVIEW_SESSION,
          capabilities: ["selection-field-section", "section-presentation-ack-v1"],
        },
        origin: PREVIEW_ORIGIN,
        source: current?.contentWindow ?? null,
      }),
    );
  });
}

const paused = () =>
  document
    .querySelector("[data-editor-writes-paused]")
    ?.getAttribute("data-editor-writes-paused") ?? null;

/** The contents of every preview write of the hero, in order. */
const heroSyncs = () =>
  applyPreviewFiles.mock.calls.flatMap(([request]) =>
    (request as { data: { files: { path: string; content: string }[] } }).data.files
      .filter((file) => file.path === HERO_PATH)
      .map((file) => file.content),
  );

/**
 * Up and synced, then the sign-in expires, a Code draft is kept unsent, and
 * the author checks again with getSession answering `session`. Returns once
 * the check is answered.
 */
async function expireDraftAndCheckAgain(session: unknown) {
  const client = renderShell();
  await waitFor(() => {
    expect(lifecycleLog.at(-1)).toMatch(/loading-frame/);
  });
  frameReady();
  await waitFor(() => {
    expect(lifecycleLog.at(-1)).toMatch(/ready/);
  });
  await waitFor(() => {
    expect(
      useThemeWorkspaceStore
        .getState()
        .getWorkspaceFiles(SCOPE.storefrontId, SCOPE.themeId)[HERO_PATH],
    ).toBeDefined();
  });

  act(() => {
    useEditorWriteGateStore.getState().pause(SCOPE, "AUTH_REQUIRED", "theme");
    useThemeWorkspaceStore.getState().updateLocalContent(HERO_PATH, DRAFT, SCOPE);
  });
  expect(paused()).toBe("none");

  getSession.mockResolvedValue(session);
  await act(async () => {
    screen.getByRole("button", { name: "Check again" }).click();
  });
  await waitFor(() => {
    expect(paused()).not.toBe("verifying");
  });
  return client;
}

beforeEach(() => {
  lifecycleLog = [];
  useThemeWorkspaceStore.setState({ workspaces: {} });
  useEditorWriteGateStore.setState({ gates: {} });
  vi.spyOn(console, "info").mockImplementation((...args: unknown[]) => {
    const line = String(args[0] ?? "");
    if (line.startsWith("[preview-lifecycle]")) lifecycleLog.push(line);
  });
  getThemeEditor.mockResolvedValue({ success: true, message: "ok", data: context });
  listThemeFiles.mockResolvedValue({ success: true, message: "ok", data: TREE });
  startPreviewServer.mockResolvedValue({
    success: true,
    message: "Live Preview server ready",
    data: { url: `${PREVIEW_ORIGIN}/store/1/themes/1/preview` },
  });
  applyPreviewFiles.mockImplementation(
    async (request: { data: { files: { path: string }[] } }) => ({
      success: true,
      message: "Live Preview files written",
      data: {
        previewId: "preview-1",
        changed: [],
        unchanged: request.data.files.map((file) => file.path),
        skipped: [],
      },
    }),
  );
  vi.spyOn(toast, "error").mockImplementation(() => "");
  vi.spyOn(toast, "info").mockImplementation(() => "");
  vi.spyOn(toast, "success").mockImplementation(() => "");
  vi.spyOn(toast, "warning").mockImplementation(() => "");
});

afterEach(() => {
  applyPreviewFiles.mockReset();
  getSession.mockReset();
  vi.restoreAllMocks();
});

describe("the preview frame coming up again after Check again", () => {
  it("verified but not yet saved: the draft is synced into the preview and the source confirmed", async () => {
    const client = await expireDraftAndCheckAgain({ user: { id: OWNER.id } });
    expect(paused()).toBe("verified");
    const logBefore = lifecycleLog.length;

    await previewServerAnswersAgain(client);

    await waitFor(() => {
      expect(
        heroSyncs(),
        `lifecycle since: ${lifecycleLog.slice(logBefore).join(" / ")}`,
      ).toContain(DRAFT);
    });
    await waitFor(() => {
      expect(lifecycleLog.slice(logBefore).at(-1)).toMatch(/\bready\b/);
    });
    // Synced into the preview, still not saved: that waits for the author.
    expect(paused()).toBe("verified");
  });

  it("still signed out: nothing is synced", async () => {
    const client = await expireDraftAndCheckAgain(null);
    expect(paused()).toBe("still-signed-out");

    await previewServerAnswersAgain(client);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });

    expect(heroSyncs()).not.toContain(DRAFT);
  });

  it("another account signed in: nothing is synced", async () => {
    const client = await expireDraftAndCheckAgain({ user: { id: "user-2" } });
    expect(paused()).toBe("different-account");

    await previewServerAnswersAgain(client);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });

    expect(heroSyncs()).not.toContain(DRAFT);
  });
});

describe("the preview frame coming up again with writes open", () => {
  it("syncs the draft and confirms the source, as before", async () => {
    const client = renderShell();
    await waitFor(() => {
      expect(lifecycleLog.at(-1)).toMatch(/loading-frame/);
    });
    frameReady();
    await waitFor(() => {
      expect(lifecycleLog.at(-1)).toMatch(/ready/);
    });
    act(() => {
      useThemeWorkspaceStore.getState().updateLocalContent(HERO_PATH, DRAFT, SCOPE);
    });
    const logBefore = lifecycleLog.length;

    await previewServerAnswersAgain(client);

    await waitFor(() => {
      expect(heroSyncs()).toContain(DRAFT);
    });
    await waitFor(() => {
      expect(lifecycleLog.slice(logBefore).at(-1)).toMatch(/\bready\b/);
    });
  });
});
