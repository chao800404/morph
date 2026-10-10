import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accountChanged, authRequired } from "@/lib/auth/auth-failure";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import type { ThemeReadFailure } from "@/lib/storefront/editor/editor-read-lock";
import { useEditorWriteGateStore } from "@/lib/storefront/store/editor-write-gate-store";
import { useThemeWorkspaceStore } from "@/lib/storefront/store/theme-workspace-store";
import type { StorefrontThemeEditorSearch } from "@/lib/validations/storefront-theme";
import { themePreviewServerQueries } from "../-queries/theme-preview-server.queries";
import { VisualEditorShell } from "./visual-editor-shell";

/**
 * The editor when the account, or its access to the Theme, changes under it.
 *
 * Another account signed in, or the Theme refused or gone: the editor closes
 * — hidden and out of reach — and keeps the unsaved work, sending none of it.
 * A sign-in that merely expired leaves it open with writes paused, as before.
 * Only a check that finds the first account back, allowed to edit, opens it
 * again, and even then nothing is sent until the author says so.
 *
 * The edit is made the way the canvas makes one, and waits out the real
 * debounce; only `setTimeout` is faked.
 */

const EDITOR_ORIGIN = "http://localhost:3000";
const PREVIEW_ORIGIN = "https://preview.morph.test";
const PREVIEW_SESSION = "5f0f0f6e-6c2e-4f1c-9a3e-0f9a2b7c1d4e";
const OWNER = { id: "user-1", name: "Owner", email: "owner@morph.test" };

const updateSectionProps = vi.hoisted(() => vi.fn());
const getThemeEditor = vi.hoisted(() => vi.fn());
const getSession = vi.hoisted(() => vi.fn());

vi.mock(
  "@/server/storefront/storefront-themes.serverFn",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    updateStorefrontThemeSectionProps: updateSectionProps,
    getStorefrontThemeEditor: getThemeEditor,
  }),
);

vi.mock("@/server/auth/getSession", () => ({ getSession }));

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

const baseSearch = {
  template: "index",
  templateId: "template-1",
  viewport: "desktop",
} as StorefrontThemeEditorSearch;

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

const SAVED = { success: true, data: { draftGeneration: 2, droppedProps: [] } };
const THEME = { success: true, message: "ok", data: context };

function renderShell() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(
    themePreviewServerQueries.forTheme("storefront-1", "theme-1").queryKey,
    {
      success: true,
      message: "Live Preview server ready",
      data: { url: `${PREVIEW_ORIGIN}/store/1/themes/1/preview` },
    } as never,
  );
  const retryRead = vi.fn();
  const shellWith = (
    themeRead: ThemeReadFailure | null,
    sentUnder?: number,
  ) => (
    <QueryClientProvider client={client}>
      <VisualEditorShell
        context={context}
        search={baseSearch}
        onSearchChange={vi.fn()}
        currentUser={OWNER}
        themeRead={themeRead}
        themeReadSentUnder={sentUnder}
        onRetryThemeRead={retryRead}
      />
    </QueryClientProvider>
  );
  const { rerender } = render(shellWith(null));
  /** The route having read the Theme again, with this outcome. */
  const readAgain = (themeRead: ThemeReadFailure | null, sentUnder?: number) =>
    act(() => rerender(shellWith(themeRead, sentUnder)));
  return { readAgain, retryRead };
}

function fromPreview(data: Record<string, unknown>) {
  const frame = document.querySelector("iframe");
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { ...data, previewSession: PREVIEW_SESSION },
        origin: PREVIEW_ORIGIN,
        source: frame?.contentWindow ?? null,
      }),
    );
  });
}

const tick = (ms = 20) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

/** Renders, selects the heading and types into it, the clock frozen. */
async function editHeading(value = "Hello") {
  const shell = renderShell();
  fromPreview({
    type: "morph:storefront-preview-structure",
    nodes: [heroNode],
  });
  const row = await screen.findByText("h1");
  act(() => {
    row.closest("button")?.click();
  });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  fromPreview({
    type: "morph:storefront-preview-commit-inline-text",
    sectionId: "hero",
    fieldKey: "heading",
    fieldPath: "heading",
    value,
    originalValue: "Welcome",
  });
  await tick(0);
  return shell;
}

const locked = () =>
  document
    .querySelector("[data-editor-locked]")
    ?.getAttribute("data-editor-locked") ?? null;
const paused = () =>
  document
    .querySelector("[data-editor-writes-paused]")
    ?.getAttribute("data-editor-writes-paused") ?? null;
const designSurface = () =>
  document.querySelector<HTMLElement>("[data-editor-mode-surface]")!;
const header = () =>
  document.querySelector<HTMLElement>("[data-morph-editor] > header")!;
const sentHeadings = () =>
  updateSectionProps.mock.calls.map(
    ([request]) =>
      (request as { data: { props: { heading?: string } } }).data.props.heading,
  );

async function press(name: string) {
  await act(async () => {
    screen.getByRole("button", { name }).click();
  });
  await tick();
}

beforeEach(() => {
  useThemeWorkspaceStore.setState({ workspaces: {} });
  useEditorWriteGateStore.setState({ gates: {} });
  getThemeEditor.mockResolvedValue(THEME);
  getSession.mockResolvedValue({ user: { id: OWNER.id } });
  vi.spyOn(toast, "error").mockImplementation(() => "");
  vi.spyOn(toast, "info").mockImplementation(() => "");
});

afterEach(() => {
  vi.useRealTimers();
  updateSectionProps.mockReset();
  getSession.mockReset();
});

describe("another account signed in", () => {
  /** An edit whose save the server refused: another account is signed in. */
  async function refusedForAnotherAccount() {
    updateSectionProps.mockRejectedValueOnce(accountChanged());
    const shell = await editHeading();
    await tick(300);
    await tick();
    return shell;
  }

  it("found when a save is refused: closes the editor, keeps the edit, and sends it nowhere", async () => {
    await refusedForAnotherAccount();

    expect(locked()).toBe("different-account");
    expect(paused()).toBe("different-account");
    // Out of reach and out of sight, and still mounted.
    expect(designSurface().hasAttribute("inert")).toBe(true);
    expect(designSurface().getAttribute("aria-hidden")).toBe("true");
    expect(header().hasAttribute("inert")).toBe(true);
    expect(document.querySelector("iframe")).not.toBeNull();
    expect(screen.getByRole("alert").textContent).toContain(
      "1 unsaved change is kept in this tab",
    );

    await tick(2_000);
    expect(sentHeadings()).toEqual(["Hello"]);
  });

  it("stays closed while it checks, and when the check gets no answer", async () => {
    await refusedForAnotherAccount();
    getSession.mockRejectedValueOnce(new Error("network"));

    await press("Check again");

    expect(toast.error).toHaveBeenCalledWith(
      "Could not check your sign-in. Try again.",
    );
    expect(locked()).toBe("different-account");
    expect(paused()).not.toBe("verified");
    expect(designSurface().hasAttribute("inert")).toBe(true);
    expect(sentHeadings()).toEqual(["Hello"]);
  });

  it("stays closed when the check finds the other account still there", async () => {
    await refusedForAnotherAccount();
    getSession.mockResolvedValueOnce({ user: { id: "user-2" } });

    await press("Check again");

    expect(locked()).toBe("different-account");
    expect(getThemeEditor).not.toHaveBeenCalled();
    expect(sentHeadings()).toEqual(["Hello"]);
  });

  it("opens again once the first account is back, and sends the edit only when the author says to", async () => {
    await refusedForAnotherAccount();

    await press("Check again");

    expect(locked()).toBeNull();
    expect(paused()).toBe("verified");
    expect(designSurface().hasAttribute("inert")).toBe(false);
    expect(header().hasAttribute("inert")).toBe(false);
    // Verified is not consent: nothing has gone out yet.
    await tick(2_000);
    expect(sentHeadings()).toEqual(["Hello"]);

    updateSectionProps.mockResolvedValue(SAVED);
    await press("Save my changes");
    await tick(500);
    expect(sentHeadings()).toEqual(["Hello", "Hello"]);
    expect(paused()).toBeNull();
  });
});

describe("a sign-in that merely expired", () => {
  it("leaves the editor open, with writes paused and the edit kept", async () => {
    updateSectionProps.mockRejectedValueOnce(authRequired());
    await editHeading();
    await tick(300);
    await tick();

    expect(paused()).toBe("none");
    expect(locked()).toBeNull();
    expect(designSurface().hasAttribute("inert")).toBe(false);
    await tick(2_000);
    expect(sentHeadings()).toEqual(["Hello"]);
  });
});

describe("the Theme refused or gone on a later read", () => {
  it("closes the editor and stops writes when access was taken away", async () => {
    updateSectionProps.mockResolvedValue(SAVED);
    const { readAgain } = await editHeading();
    readAgain("access-denied");
    await tick(300);
    await tick();

    expect(locked()).toBe("theme-access-denied");
    expect(designSurface().hasAttribute("inert")).toBe(true);
    // The edit waiting out its debounce is held, not sent.
    expect(sentHeadings()).toEqual([]);
    expect(screen.getByRole("alert").textContent).toContain("unsaved change");
  });

  it("opens again once access is back, and sends only when the author says to", async () => {
    updateSectionProps.mockResolvedValue(SAVED);
    const { readAgain } = await editHeading();
    // Sent before the check below begins.
    readAgain("access-denied", 0);
    await tick(300);

    await press("Check again");

    expect(locked()).toBeNull();
    expect(paused()).toBe("verified");
    expect(sentHeadings()).toEqual([]);
    await press("Save my changes");
    await tick(500);
    expect(sentHeadings()).toEqual(["Hello"]);
  });

  it("stays closed while the check still finds the Theme refused", async () => {
    const { readAgain } = await editHeading();
    readAgain("access-denied");
    getThemeEditor.mockResolvedValue({
      success: false,
      message: "Storefront theme not found",
      data: null,
      error: "NOT_FOUND",
    });

    await press("Check again");

    expect(locked()).toBe("theme-access-denied");
    expect(paused()).toBe("none");
    expect(sentHeadings()).toEqual([]);
  });

  it("closes the editor when the Theme is gone", async () => {
    const { readAgain } = await editHeading();
    readAgain("missing");
    await tick();

    expect(locked()).toBe("theme-missing");
    expect(designSurface().hasAttribute("inert")).toBe(true);
    expect(
      document.querySelector("[data-editor-locked]")?.textContent,
    ).toContain("This Theme is no longer available.");
  });
});

describe("a later read that merely failed", () => {
  it("keeps the editor open on what it read last, and stops nothing", async () => {
    updateSectionProps.mockResolvedValue(SAVED);
    const { readAgain, retryRead } = await editHeading();
    readAgain("unavailable");
    await tick(300);
    await tick();

    expect(locked()).toBeNull();
    expect(paused()).toBeNull();
    expect(sentHeadings()).toEqual(["Hello"]);
    expect(
      document.querySelector("[data-editor-theme-read]")?.textContent,
    ).toContain("Could not refresh this Theme");

    await press("Try again");
    expect(retryRead).toHaveBeenCalledTimes(1);
  });
});
