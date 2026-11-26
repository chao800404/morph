import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import { useEditorWriteGateStore } from "@/lib/storefront/store/editor-write-gate-store";

const setThemePreviewRuntime = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();
const toastInfo = vi.fn();

vi.mock("@/server/storefront/storefront-theme-preview-server.serverFn", () => ({
  setThemePreviewRuntime: (args: unknown) => setThemePreviewRuntime(args),
}));
vi.mock("sonner", () => ({
  toast: {
    success: (message: string) => toastSuccess(message),
    error: (message: string) => toastError(message),
    info: (message: string) => toastInfo(message),
  },
}));

import {
  EditorStarterInitNextStep,
  StarterInitError,
} from "./editor-starter-init-next-step";

/**
 * An empty Theme that does not record `start`: since Starter 32 the editor's
 * Starter init is refused (STARTER_START_PREVIEW_REQUIRED) and nothing is
 * written. The editor still opens, says what to do next, and offers the
 * switch through the same runtime write the runtime menu uses; once the
 * Theme records `start` it initialises again.
 */

function editorContext(
  theme: Partial<StorefrontThemeEditorDTO["theme"]> = {},
): StorefrontThemeEditorDTO {
  return {
    storefront: {
      id: "storefront-1",
      name: "Store",
      domain: null,
      status: "published",
      activeReleaseId: null,
    },
    theme: {
      id: "theme-1",
      name: "Default",
      status: "draft",
      releaseGeneration: 1,
      framework: null,
      previewRuntime: null,
      activeRelease: null,
      ...theme,
    },
    templates: [],
  };
}

const START_REQUIRED = new StarterInitError(
  "These Starter files read their content on the server, which only the full Start preview can show. Switch this Theme's preview to Start first; until then nothing is written.",
  "STARTER_START_PREVIEW_REQUIRED",
);

function renderNextStep(
  error: unknown,
  context: StorefrontThemeEditorDTO = editorContext(),
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onInitialise = vi.fn();
  const onRuntimeChanged = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <EditorStarterInitNextStep
        context={context}
        error={error}
        onInitialise={onInitialise}
        onRuntimeChanged={onRuntimeChanged}
      />
    </QueryClientProvider>,
  );
  return { onInitialise, onRuntimeChanged };
}

const switchButton = () =>
  screen.getByRole("button", { name: "Switch to Full Start and initialise" });

beforeEach(() => {
  vi.clearAllMocks();
  useEditorWriteGateStore.setState({ gates: {} });
});
afterEach(cleanup);

describe("EditorStarterInitNextStep", () => {
  it("says what to do next for an empty Theme the Starter init refused", () => {
    renderNextStep(START_REQUIRED);

    const notice = screen.getByRole("status");
    expect(notice.textContent).toContain("This Theme has no files yet.");
    expect(notice.textContent).toContain(
      "Switch this Theme to Full Start, then initialise it again.",
    );
    expect(switchButton()).toBeTruthy();
    // Nothing is sent until the author chooses.
    expect(setThemePreviewRuntime).not.toHaveBeenCalled();
  });

  it.each([
    ["no error", null],
    ["another refusal", new StarterInitError("Theme not found", "NOT_FOUND")],
    ["a plain error", new Error("network down")],
  ])("shows nothing for %s", (_label, error) => {
    renderNextStep(error);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("switches through the runtime write against what the Theme records, then initialises again", async () => {
    setThemePreviewRuntime.mockResolvedValue({
      success: true,
      message: "Live Preview runtime saved",
      data: { previewRuntime: "start" },
    });
    const { onInitialise, onRuntimeChanged } = renderNextStep(
      START_REQUIRED,
      editorContext({ previewRuntime: "client" }),
    );

    fireEvent.click(switchButton());

    await waitFor(() => expect(onInitialise).toHaveBeenCalledTimes(1));
    expect(setThemePreviewRuntime).toHaveBeenCalledWith({
      data: {
        storefrontId: "storefront-1",
        themeId: "theme-1",
        previewRuntime: "start",
        expectedPreviewRuntime: "client",
      },
    });
    // Client to Start changes the preview's runtime: it is restarted.
    expect(onRuntimeChanged).toHaveBeenCalledTimes(1);
  });

  it("does not initialise when the switch was refused", async () => {
    setThemePreviewRuntime.mockResolvedValue({
      success: false,
      message: "The Live Preview runtime was changed elsewhere.",
      error: "PREVIEW_RUNTIME_CONFLICT",
      previewRuntime: "client",
    });
    const { onInitialise } = renderNextStep(START_REQUIRED);

    fireEvent.click(switchButton());

    await waitFor(() => expect(toastInfo).toHaveBeenCalledTimes(1));
    expect(onInitialise).not.toHaveBeenCalled();
    expect(setThemePreviewRuntime).toHaveBeenCalledTimes(1);
  });

  it("is not offered for a Theme of another framework", () => {
    renderNextStep(START_REQUIRED, editorContext({ framework: "astro" }));
    expect(screen.queryByRole("status")).toBeNull();
  });
});
