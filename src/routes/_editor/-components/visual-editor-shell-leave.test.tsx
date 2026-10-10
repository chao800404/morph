import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import type { EditorLeaveKind } from "@/lib/storefront/editor/editor-leave-guard";
import { useEditorWriteGateStore } from "@/lib/storefront/store/editor-write-gate-store";
import { useThemeWorkspaceStore } from "@/lib/storefront/store/theme-workspace-store";
import type { StorefrontThemeEditorSearch } from "@/lib/validations/storefront-theme";
import { postEditorToPreviewMessage } from "@/lib/storefront/editor/preview-protocol";
import { storefrontThemeQueries } from "../-queries/storefront-theme.queries";
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

function renderShell(
  shellContext: StorefrontThemeEditorDTO = context,
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  client.setQueryData(
    themePreviewServerQueries.forTheme("storefront-1", "theme-1").queryKey,
    {
      success: true,
      message: "Live Preview server ready",
      data: { url: `${PREVIEW_ORIGIN}/store/1/themes/1/preview` },
    } as never,
  );
  const guardRef: { current: EditorNavigationGuard | null } = { current: null };
  const shellAt = (search: StorefrontThemeEditorSearch) => (
    <QueryClientProvider client={client}>
      <VisualEditorShell
        context={shellContext}
        search={search}
        onSearchChange={vi.fn()}
        navigationGuardRef={guardRef}
      />
    </QueryClientProvider>
  );
  const { rerender } = render(shellAt(baseSearch));
  /** The router having moved to `search`, as it does once a navigation goes. */
  const moveTo = (search: StorefrontThemeEditorSearch) =>
    act(() => rerender(shellAt(search)));
  /** Asks the shell, as the router does, and records the answer. */
  const navigate = (kind: EditorLeaveKind) => {
    const outcome: { blocked?: boolean } = {};
    void guardRef.current!(kind).then((blocked) => {
      outcome.blocked = blocked;
    });
    return outcome;
  };
  return { navigate, moveTo, client };
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
      screen.getByRole("button", { name: "Switch, keep draft unsaved" }).click();
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
      screen.getByRole("button", { name: "Leave without waiting" }).click();
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

describe("a held draft when nothing is waiting to be sent", () => {
  /**
   * The write gate's answers keep the draft and stop the navigation, page
   * switches included; leaving never sends it again to get away.
   */
  it("stops a page switch on a conflicted edit, without resending it", async () => {
    updateSectionProps.mockResolvedValue({
      success: false,
      message: "Template draft was modified concurrently.",
      error: "TEMPLATE_DRAFT_CONFLICT",
    });
    const { navigate } = await editBeforeDebounce();
    await tick(300);
    await tick();
    expect(saveStatus()).toBe("Out of date");
    expect(updateSectionProps).toHaveBeenCalledTimes(1);

    const outcome = navigate("switch-page");
    await tick();

    expect(outcome.blocked).toBeUndefined();
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alertdialog").textContent).toContain(
      "out of date with the document",
    );

    act(() => {
      screen.getByRole("button", { name: "Switch, keep draft unsaved" }).click();
    });
    await tick(1_000);
    // Switched, and still not resent: the draft waits for the rebase.
    expect(outcome.blocked).toBe(false);
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
    expect(saveStatus()).toBe("Out of date");
    expect(screen.getByRole("button", { name: "Load latest, keep mine" })).toBeTruthy();
  });

  it("stops a page switch on a write whose outcome is unknown, without resending it", async () => {
    updateSectionProps.mockRejectedValue(new Error("offline"));
    const { navigate } = await editBeforeDebounce();
    await tick(300);
    await tick();
    expect(updateSectionProps).toHaveBeenCalledTimes(1);

    const outcome = navigate("switch-page");
    await tick();

    expect(outcome.blocked).toBeUndefined();
    expect(screen.getByRole("alertdialog").textContent).toContain(
      "It could not be confirmed whether an earlier save was stored.",
    );
    act(() => {
      screen.getByRole("button", { name: "Stay here" }).click();
    });
    await tick(1_000);
    expect(outcome.blocked).toBe(true);
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
  });

  it("does not send while the account has lost permission, and leaves only when told", async () => {
    updateSectionProps.mockResolvedValue(SAVED);
    const { navigate } = await editBeforeDebounce();
    act(() => {
      useEditorWriteGateStore
        .getState()
        .pause(
          { storefrontId: "storefront-1", themeId: "theme-1" },
          "ACCESS_DENIED",
          "theme",
        );
    });

    const outcome = navigate("leave-editor");
    await tick();

    expect(outcome.blocked).toBeUndefined();
    expect(screen.getByRole("alertdialog").textContent).toContain(
      "Your account is not allowed to make this change.",
    );
    act(() => {
      screen.getByRole("button", { name: "Leave and discard" }).click();
    });
    await tick(1_000);
    expect(outcome.blocked).toBe(false);
    expect(updateSectionProps).not.toHaveBeenCalled();
  });
});

describe("a draft kept across a page switch", () => {
  /** Home (A) and a product template (B), each with its own section. */
  const twoPages = {
    ...context,
    templates: [
      context.templates[0],
      {
        id: "template-2",
        type: "product",
        name: "Product",
        document: {
          version: 1,
          sections: [{ id: "banner", type: "banner", props: { title: "B" } }],
        },
        draftGeneration: 1,
        version: 1,
      },
    ],
  } as unknown as StorefrontThemeEditorDTO;
  const pageB = {
    template: "product",
    templateId: "template-2",
    viewport: "desktop",
  } as StorefrontThemeEditorSearch;

  it("stays A's: B is not written, and back on A the rebase sends A's draft to A", async () => {
    updateSectionProps.mockResolvedValue({
      success: false,
      message: "Template draft was modified concurrently.",
      error: "TEMPLATE_DRAFT_CONFLICT",
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // A as another writer left it, for the rebase to read.
    client.setQueryData(storefrontThemeQueries.detail("storefront-1", "theme-1").queryKey, {
      success: true,
      data: {
        ...twoPages,
        templates: [
          {
            ...twoPages.templates[0],
            draftGeneration: 5,
            document: {
              version: 1,
              sections: [{ id: "hero", type: "hero", props: { heading: "Theirs", cta: "New" } }],
            },
          },
          twoPages.templates[1],
        ],
      },
    } as never);
    const { navigate, moveTo } = renderShell(twoPages, client);
    await selectHeading();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    typeHeading("Hello", "Welcome");
    await tick(300);
    await tick();
    expect(saveStatus()).toBe("Out of date");

    // A to B, keeping the draft.
    const toB = navigate("switch-page");
    await tick();
    act(() => {
      screen.getByRole("button", { name: "Switch, keep draft unsaved" }).click();
    });
    await tick();
    expect(toB.blocked).toBe(false);
    moveTo(pageB);
    await tick(1_000);

    // Nothing was written for B, and A's conflict is still A's.
    const requests = () =>
      updateSectionProps.mock.calls.map(
        ([request]) =>
          (request as { data: { templateId: string; sectionId: string; props: Record<string, unknown> } }).data,
      );
    expect(requests().map((request) => request.templateId)).toEqual(["template-1"]);
    expect(saveStatus()).toBe("Out of date");

    // Back to A, and the update resends A's draft, rebased, to A.
    moveTo(baseSearch);
    await tick();
    updateSectionProps.mockResolvedValue(SAVED);
    act(() => {
      screen.getByRole("button", { name: "Load latest, keep mine" }).click();
    });
    await tick();
    await tick();

    expect(requests()).toHaveLength(2);
    expect(requests()[1]).toMatchObject({
      templateId: "template-1",
      sectionId: "hero",
      props: { heading: "Hello", cta: "New" },
    });
    expect(requests().some((request) => request.templateId === "template-2")).toBe(false);
  });
});

describe("text still open for typing on the canvas", () => {
  const finishRequests = () =>
    vi
      .mocked(postEditorToPreviewMessage)
      .mock.calls.map(([, message]) => message as { type: string; commit?: boolean })
      .filter((message) => message.type === "morph:storefront-preview-finish-inline-text");

  /** Opens an inline edit on the heading, as the preview reports one. */
  async function openInlineEdit() {
    const shell = renderShell();
    await selectHeading();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fromPreview({ type: "morph:storefront-preview-inline-text-editing", editing: true });
    await tick(0);
    return shell;
  }

  it("counts as unsaved, and is warned about on reload", async () => {
    await openInlineEdit();

    expect(saveStatus()).toBe("Unsaved");
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("is finished on the author's say-so, saved, and only then navigated from", async () => {
    const write = deferred<unknown>();
    updateSectionProps.mockReturnValue(write.promise);
    const { navigate } = await openInlineEdit();

    const outcome = navigate("leave-editor");
    await tick();
    // Asked, not decided: nothing ended, nothing sent.
    expect(screen.getByRole("alertdialog").textContent).toContain(
      "You are still editing text on the page",
    );
    expect(finishRequests()).toEqual([]);

    act(() => {
      screen.getByRole("button", { name: "Finish editing and continue" }).click();
    });
    await tick(0);
    expect(finishRequests()).toEqual([
      { type: "morph:storefront-preview-finish-inline-text", commit: true },
    ]);

    // The preview answers as it does: the commit, then the close.
    typeHeading("Typed on the canvas", "Welcome");
    fromPreview({ type: "morph:storefront-preview-inline-text-editing", editing: false });
    await tick();

    // Not cancelled by its own commit, and sent at once.
    expect(sentHeadings()).toEqual(["Typed on the canvas"]);
    expect(outcome.blocked).toBeUndefined();

    write.resolve(SAVED);
    await tick();
    expect(outcome.blocked).toBe(false);
  });

  it("is put back, not sent, when the author discards it", async () => {
    updateSectionProps.mockResolvedValue(SAVED);
    const { navigate } = await openInlineEdit();

    const outcome = navigate("leave-editor");
    await tick();
    act(() => {
      screen.getByRole("button", { name: "Discard text and leave" }).click();
    });
    await tick(1_000);

    expect(finishRequests()).toEqual([
      { type: "morph:storefront-preview-finish-inline-text", commit: false },
    ]);
    expect(outcome.blocked).toBe(false);
    expect(updateSectionProps).not.toHaveBeenCalled();
  });

  it("is not taken as finished when the frame is replaced while finishing it", async () => {
    updateSectionProps.mockResolvedValue(SAVED);
    const { navigate, client } = await openInlineEdit();

    const outcome = navigate("leave-editor");
    await tick();
    act(() => {
      screen.getByRole("button", { name: "Finish editing and continue" }).click();
    });
    await tick(0);
    // The preview reloads (a new address) before it answers: the typed text
    // went with the old document.
    act(() => {
      client.setQueryData(
        themePreviewServerQueries.forTheme("storefront-1", "theme-1").queryKey,
        {
          success: true,
          message: "Live Preview server ready",
          data: { url: `${PREVIEW_ORIGIN}/store/1/themes/1/preview?again` },
        } as never,
      );
    });
    await tick();

    expect(outcome.blocked).toBeUndefined();
    expect(screen.getByRole("alertdialog").textContent).toContain(
      "could not be finished, so it was not saved",
    );
    expect(updateSectionProps).not.toHaveBeenCalled();
  });

  it("stays when the page does not finish the edit", async () => {
    const { navigate } = await openInlineEdit();

    const outcome = navigate("switch-page");
    await tick();
    act(() => {
      screen.getByRole("button", { name: "Finish editing and continue" }).click();
    });
    // The preview never answers.
    await tick(2_000);

    expect(outcome.blocked).toBeUndefined();
    expect(screen.getByRole("alertdialog").textContent).toContain(
      "could not be finished, so it was not saved",
    );
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
