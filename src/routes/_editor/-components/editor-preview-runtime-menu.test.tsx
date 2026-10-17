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

import { storefrontThemeQueries } from "../-queries/storefront-theme.queries";
import { EditorPreviewRuntimeMenu } from "./editor-preview-runtime-menu";

function editorContext(
  theme: Partial<StorefrontThemeEditorDTO["theme"]>,
  previewRuntimeDefault?: "client" | "start",
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
    ...(previewRuntimeDefault ? { previewRuntimeDefault } : {}),
  };
}

function renderMenu(context: StorefrontThemeEditorDTO) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const detailKey = storefrontThemeQueries.detail(
    context.storefront.id,
    context.theme.id,
  ).queryKey;
  queryClient.setQueryData(detailKey, {
    success: true,
    message: "Storefront theme editor fetched",
    data: context,
  } as never);
  const onRuntimeChanged = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <EditorPreviewRuntimeMenu
        context={context}
        onRuntimeChanged={onRuntimeChanged}
      />
    </QueryClientProvider>,
  );
  const cachedRecord = () =>
    (
      queryClient.getQueryData(detailKey) as {
        data: StorefrontThemeEditorDTO;
      }
    ).data.theme.previewRuntime;
  return { cachedRecord, onRuntimeChanged };
}

function openMenu() {
  fireEvent.pointerDown(
    screen.getByRole("button", { name: /Live Preview runtime/ }),
    { button: 0, ctrlKey: false },
  );
}

const choose = (name: string | RegExp) =>
  fireEvent.click(screen.getByRole("menuitemradio", { name }));

const checked = (name: string | RegExp) =>
  screen.getByRole("menuitemradio", { name }).getAttribute("aria-checked");

const saved = (previewRuntime: "client" | "start" | null) => ({
  success: true,
  message: "Live Preview runtime saved",
  data: { previewRuntime },
});

beforeEach(() => {
  vi.clearAllMocks();
  useEditorWriteGateStore.setState({ gates: {} });
});
afterEach(cleanup);

describe("EditorPreviewRuntimeMenu", () => {
  it("shows a runtime inherited from the deployment as not recorded", () => {
    renderMenu(editorContext({}, "start"));
    expect(
      screen.getByRole("button", { name: "Live Preview runtime: Full Start" }),
    ).toBeTruthy();
    openMenu();
    expect(screen.getByTestId("preview-runtime-source").textContent).toBe(
      "Full Start, the deployment default. Not recorded for this Theme.",
    );
    expect(checked("Deployment default (Full Start)")).toBe("true");
    expect(checked("Full Start")).toBe("false");
  });

  it("shows the client-only default when the deployment says nothing", () => {
    renderMenu(editorContext({}));
    openMenu();
    expect(screen.getByTestId("preview-runtime-source").textContent).toBe(
      "Client-only, the deployment default. Not recorded for this Theme.",
    );
    expect(checked("Deployment default (Client-only)")).toBe("true");
  });

  it("shows a runtime the Theme records as recorded, over the deployment's", () => {
    renderMenu(editorContext({ previewRuntime: "client" }, "start"));
    openMenu();
    expect(screen.getByTestId("preview-runtime-source").textContent).toBe(
      "Client-only, recorded for this Theme.",
    );
    expect(checked("Client-only")).toBe("true");
    // What clearing the record would fall back to.
    expect(
      screen.getByRole("menuitemradio", {
        name: "Deployment default (Full Start)",
      }),
    ).toBeTruthy();
  });

  it("records the choice against what it saw, updates the context, then restarts the preview", async () => {
    setThemePreviewRuntime.mockResolvedValue(saved("start"));
    const { cachedRecord, onRuntimeChanged } = renderMenu(editorContext({}));
    openMenu();
    choose("Full Start");

    await waitFor(() => expect(onRuntimeChanged).toHaveBeenCalledTimes(1));
    expect(setThemePreviewRuntime).toHaveBeenCalledWith({
      data: {
        storefrontId: "storefront-1",
        themeId: "theme-1",
        previewRuntime: "start",
        expectedPreviewRuntime: null,
      },
    });
    expect(cachedRecord()).toBe("start");
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("clears the record back to the deployment default, and restarts when that changes the runtime", async () => {
    setThemePreviewRuntime.mockResolvedValue(saved(null));
    const { cachedRecord, onRuntimeChanged } = renderMenu(
      editorContext({ previewRuntime: "client" }, "start"),
    );
    openMenu();
    choose("Deployment default (Full Start)");

    await waitFor(() => expect(onRuntimeChanged).toHaveBeenCalledTimes(1));
    expect(setThemePreviewRuntime).toHaveBeenCalledWith({
      data: {
        storefrontId: "storefront-1",
        themeId: "theme-1",
        previewRuntime: null,
        expectedPreviewRuntime: "client",
      },
    });
    expect(cachedRecord()).toBeNull();
  });

  it("does not restart a preview whose runtime the change leaves as it was", async () => {
    // Inherited client, recorded client: the same runtime either way.
    setThemePreviewRuntime.mockResolvedValue(saved("client"));
    const { cachedRecord, onRuntimeChanged } = renderMenu(editorContext({}));
    openMenu();
    choose("Client-only");

    await waitFor(() => expect(cachedRecord()).toBe("client"));
    expect(toastSuccess).toHaveBeenCalledWith(
      "Live Preview runtime saved. It still uses Client-only.",
    );
    expect(onRuntimeChanged).not.toHaveBeenCalled();
  });

  it("on a conflict shows what the Theme records now, restarts nothing and sends nothing again", async () => {
    setThemePreviewRuntime.mockResolvedValue({
      success: false,
      message: "The Live Preview runtime was changed elsewhere.",
      error: "PREVIEW_RUNTIME_CONFLICT",
      previewRuntime: "client",
    });
    const { cachedRecord, onRuntimeChanged } = renderMenu(editorContext({}));
    openMenu();
    choose("Full Start");

    await waitFor(() => expect(toastInfo).toHaveBeenCalledTimes(1));
    expect(cachedRecord()).toBe("client");
    expect(onRuntimeChanged).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
    expect(setThemePreviewRuntime).toHaveBeenCalledTimes(1);
  });

  it("does not restart the preview when the server refuses", async () => {
    setThemePreviewRuntime.mockResolvedValue({
      success: false,
      message: "Only a TanStack Start Theme can use the full Start preview.",
      error: "PREVIEW_RUNTIME_UNSUPPORTED",
    });
    const { cachedRecord, onRuntimeChanged } = renderMenu(editorContext({}));
    openMenu();
    choose("Full Start");

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Only a TanStack Start Theme can use the full Start preview.",
      ),
    );
    expect(onRuntimeChanged).not.toHaveBeenCalled();
    expect(cachedRecord()).toBeNull();
  });

  it("sends nothing for what the Theme already records", () => {
    const { onRuntimeChanged } = renderMenu(
      editorContext({ previewRuntime: "start" }),
    );
    openMenu();
    choose("Full Start");
    expect(setThemePreviewRuntime).not.toHaveBeenCalled();
    expect(onRuntimeChanged).not.toHaveBeenCalled();
  });

  it("is not offered for an Astro Theme", () => {
    renderMenu(editorContext({ framework: "astro" }, "start"));
    expect(
      screen.queryByRole("button", { name: /Live Preview runtime/ }),
    ).toBeNull();
  });
});
