import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import type { EditorLeaveKind } from "@/lib/storefront/editor/editor-leave-guard";
import { useEditorWriteGateStore } from "@/lib/storefront/store/editor-write-gate-store";
import { useThemeWorkspaceStore } from "@/lib/storefront/store/theme-workspace-store";
import type { StorefrontThemeEditorSearch } from "@/lib/validations/storefront-theme";
import { themePreviewServerQueries } from "../-queries/theme-preview-server.queries";
import {
  VisualEditorShell,
  type EditorNavigationGuard,
} from "./visual-editor-shell";

/**
 * Leaving, or switching pages, before a content edit's debounce has fired.
 *
 * The edit is made the way the canvas makes one (an inline-text commit), so
 * it waits out the real 300ms debounce in the real shell. The router is played
 * by calling the guard the shell hands it, which is what `useBlocker` does.
 *
 * Timing is never raced. Only `setTimeout` is faked, from the moment the edit
 * is made, and the clock is moved in steps far shorter than the debounce: a
 * write that arrives did so because the navigation sent it, not because the
 * timer happened to fire. Every server answer is a promise the test resolves.
 */

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

const context = {
  previewChannel: { editorOrigin: EDITOR_ORIGIN, sessionId: PREVIEW_SESSION },
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const SAVED = { success: true, data: { draftGeneration: 2, droppedProps: [] } };

function editorHolding(props: Record<string, unknown>) {
  return {
    success: true,
    message: "ok",
    data: {
      ...context,
      templates: [
        {
          ...context.templates[0],
          document: { version: 1, sections: [{ id: "hero", type: "hero", props }] },
        },
      ],
    },
  };
}

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
  const guardRef: { current: EditorNavigationGuard | null } = { current: null };
  render(
    <QueryClientProvider client={client}>
      <VisualEditorShell
        context={context}
        search={baseSearch}
        onSearchChange={vi.fn()}
        navigationGuardRef={guardRef}
      />
    </QueryClientProvider>,
  );
  /** Asks the shell, as the router does, and records the answer. */
  const navigate = (kind: EditorLeaveKind) => {
    const outcome: { blocked?: boolean } = {};
    void guardRef.current!(kind).then((blocked) => {
      outcome.blocked = blocked;
    });
    return outcome;
  };
  return { navigate };
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

async function selectHeading() {
  fromPreview({ type: "morph:storefront-preview-structure", nodes: [heroNode] });
  const row = await screen.findByText("h1");
  act(() => {
    row.closest("button")?.click();
  });
}

function typeHeading(value: string, originalValue: string) {
  fromPreview({
    type: "morph:storefront-preview-commit-inline-text",
    sectionId: "hero",
    fieldKey: "heading",
    fieldPath: "heading",
    value,
    originalValue,
  });
}

/** Moves the clock, well short of the 300ms debounce, and lets work settle. */
const tick = (ms = 20) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

const saveStatus = () =>
  document.querySelector("[data-editor-save-status]")?.getAttribute("aria-label");

const sentHeadings = () =>
  updateSectionProps.mock.calls.map(
    ([request]) => (request as { data: { props: { heading?: string } } }).data.props.heading,
  );

/** Renders, selects the heading, and types into it with the clock frozen. */
async function editBeforeDebounce(value = "Hello") {
  const shell = renderShell();
  await selectHeading();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  typeHeading(value, "Welcome");
  await tick(0);
  return shell;
}

beforeEach(() => {
  useThemeWorkspaceStore.setState({ workspaces: {} });
  useEditorWriteGateStore.setState({ gates: {} });
  getThemeEditor.mockResolvedValue(editorHolding({ heading: "Hello" }));
  vi.spyOn(toast, "error").mockImplementation(() => "");
  vi.spyOn(toast, "info").mockImplementation(() => "");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the save state while an edit waits out its debounce", () => {
  it("says Unsaved, not the publish state, until the write is sent", async () => {
    const write = deferred<unknown>();
    updateSectionProps.mockReturnValue(write.promise);
    await editBeforeDebounce();

    // Nothing has been sent; the old toolbar said "Unpublished" here.
    expect(updateSectionProps).not.toHaveBeenCalled();
    expect(saveStatus()).toBe("Unsaved");

    await tick(300);
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
    expect(saveStatus()).toBe("Saving…");

    write.resolve(SAVED);
    await tick();
    expect(saveStatus()).toMatch(/^(Unpublished|Published)$/);
  });

  it("does not take an older write's answer as saving a newer edit", async () => {
    const first = deferred<unknown>();
    updateSectionProps.mockReturnValueOnce(first.promise).mockResolvedValue(SAVED);
    await editBeforeDebounce();
    await tick(300);
    expect(sentHeadings()).toEqual(["Hello"]);

    // Typed again while the first write is out.
    typeHeading("Hello again", "Hello");
    first.resolve(SAVED);
    await tick();

    // The answer was for "Hello"; "Hello again" has not been sent.
    expect(sentHeadings()).toEqual(["Hello"]);
    expect(saveStatus()).toBe("Unsaved");

    await tick(300);
    expect(sentHeadings()).toEqual(["Hello", "Hello again"]);
    expect(saveStatus()).toMatch(/^(Unpublished|Published)$/);
  });
});

describe("navigating before the debounce fired", () => {
  it("sends the edit at once, and navigates only once it is stored", async () => {
    const write = deferred<unknown>();
    updateSectionProps.mockReturnValue(write.promise);
    const { navigate } = await editBeforeDebounce();

    const outcome = navigate("leave-editor");
    await tick();

    // Sent by the navigation, 20ms in: the debounce has not fired.
    expect(sentHeadings()).toEqual(["Hello"]);
    expect(outcome.blocked).toBeUndefined();

    write.resolve(SAVED);
    await tick();
    expect(outcome.blocked).toBe(false);

    // The cancelled debounce does not send it a second time.
    await tick(1_000);
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
  });

  it("stays, keeps the edit and says so when the save fails", async () => {
    updateSectionProps.mockResolvedValue({
      success: false,
      message: "The heading is too long.",
    });
    const { navigate } = await editBeforeDebounce();

    const outcome = navigate("leave-editor");
    await tick();

    expect(outcome.blocked).toBeUndefined();
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("Your changes were not saved");
    expect(dialog.textContent).toContain("The heading is too long.");

    act(() => {
      screen.getByRole("button", { name: "Stay here" }).click();
    });
    await tick();
    expect(outcome.blocked).toBe(true);
    // Kept, and shown as not saved.
    expect(saveStatus()).toBe("Save failed");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("does not send again, or navigate, when an earlier save got no answer", async () => {
    updateSectionProps.mockRejectedValue(new Error("offline"));
    const { navigate } = await editBeforeDebounce();
    await tick(300);
    expect(updateSectionProps).toHaveBeenCalledTimes(1);

    // A newer edit, then a navigation: the unanswered write may have landed,
    // so nothing goes until the author checks.
    typeHeading("Hello again", "Hello");
    const outcome = navigate("leave-editor");
    await tick();

    expect(updateSectionProps).toHaveBeenCalledTimes(1);
    expect(outcome.blocked).toBeUndefined();
    expect(screen.getByRole("alertdialog").textContent).toContain(
      "It could not be confirmed whether an earlier save was stored.",
    );

    act(() => {
      screen.getByRole("button", { name: "Leave and discard" }).click();
    });
    await tick(1_000);
    expect(outcome.blocked).toBe(false);
    // Discarded means not sent after the author left, either.
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
  });

  it("sends nothing while writes are paused", async () => {
    updateSectionProps.mockResolvedValue(SAVED);
    const { navigate } = await editBeforeDebounce();
    act(() => {
      useEditorWriteGateStore
        .getState()
        .pause(
          { storefrontId: "storefront-1", themeId: "theme-1" },
          "AUTH_REQUIRED",
          "theme",
        );
    });

    const outcome = navigate("switch-page");
    await tick();

    expect(updateSectionProps).not.toHaveBeenCalled();
    expect(outcome.blocked).toBeUndefined();
    expect(screen.getByRole("alertdialog").textContent).toContain(
      "Your sign-in has expired.",
    );

    act(() => {
      screen.getByRole("button", { name: "Switch anyway" }).click();
    });
    await tick(1_000);
    expect(outcome.blocked).toBe(false);
    // Paused writes stay paused: the debounce that was cancelled is not
    // replaced by a send of its own.
    expect(updateSectionProps).not.toHaveBeenCalled();
  });

  it("cancels the navigation when the author types again while it waits", async () => {
    const write = deferred<unknown>();
    updateSectionProps.mockReturnValueOnce(write.promise).mockResolvedValue(SAVED);
    const { navigate } = await editBeforeDebounce();

    const outcome = navigate("switch-page");
    await tick();
    expect(sentHeadings()).toEqual(["Hello"]);

    typeHeading("Hello again", "Hello");
    await tick();
    expect(outcome.blocked).toBe(true);
    expect(toast.info).toHaveBeenCalledWith(
      "Stayed on this page because you kept editing.",
      expect.anything(),
    );

    // The first save landing does not revive the navigation, and the newer
    // edit is saved on its own schedule.
    write.resolve(SAVED);
    await tick(300);
    expect(sentHeadings()).toEqual(["Hello", "Hello again"]);
    expect(outcome.blocked).toBe(true);
  });

  it("offers a way out of a save that does not answer", async () => {
    updateSectionProps.mockReturnValue(new Promise(() => {}));
    const { navigate } = await editBeforeDebounce();

    const outcome = navigate("leave-editor");
    await tick(399);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await tick(1);
    expect(screen.getByRole("alertdialog").textContent).toContain(
      "Saving your changes…",
    );

    act(() => {
      screen.getByRole("button", { name: "Leave without saving" }).click();
    });
    await tick();
    expect(outcome.blocked).toBe(false);
  });

  it("goes at once when nothing is waiting", async () => {
    updateSectionProps.mockResolvedValue(SAVED);
    const { navigate } = await editBeforeDebounce();
    await tick(300);
    await tick();
    expect(updateSectionProps).toHaveBeenCalledTimes(1);

    const outcome = navigate("leave-editor");
    await tick(0);
    expect(outcome.blocked).toBe(false);
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
  });
});

describe("reloading or closing the tab", () => {
  const unload = () => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };

  it("warns only while an edit is not stored", async () => {
    updateSectionProps.mockResolvedValue(SAVED);
    await editBeforeDebounce();

    expect(unload()).toBe(true);

    await tick(300);
    await tick();
    expect(saveStatus()).toMatch(/^(Unpublished|Published)$/);
    expect(unload()).toBe(false);
  });
});
