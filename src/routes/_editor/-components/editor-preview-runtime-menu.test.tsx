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

vi.mock("@/server/storefront/storefront-theme-preview-server.serverFn", () => ({
  setThemePreviewRuntime: (args: unknown) => setThemePreviewRuntime(args),
}));
vi.mock("sonner", () => ({
  toast: {
    success: (message: string) => toastSuccess(message),
    error: (message: string) => toastError(message),
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
  return { queryClient, detailKey, onRuntimeChanged };
}

function openMenu() {
  fireEvent.pointerDown(
    screen.getByRole("button", { name: /Live Preview runtime/ }),
    { button: 0, ctrlKey: false },
  );
}

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
    expect(
      screen
        .getByRole("menuitemradio", { name: "Full Start" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("shows the client-only default when the deployment says nothing", () => {
    renderMenu(editorContext({}));
    openMenu();
    expect(screen.getByTestId("preview-runtime-source").textContent).toBe(
      "Client-only, the deployment default. Not recorded for this Theme.",
    );
  });

  it("shows a runtime the Theme records as recorded, over the deployment's", () => {
    renderMenu(editorContext({ previewRuntime: "client" }, "start"));
    openMenu();
    expect(screen.getByTestId("preview-runtime-source").textContent).toBe(
      "Client-only, recorded for this Theme.",
    );
    expect(
      screen
        .getByRole("menuitemradio", { name: "Client-only" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("records the choice, updates the editor context, then restarts the preview", async () => {
    setThemePreviewRuntime.mockResolvedValue({
      success: true,
      message: "ok",
      data: { previewRuntime: "start" },
    });
    const { queryClient, detailKey, onRuntimeChanged } = renderMenu(
      editorContext({}),
    );
    openMenu();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Full Start" }));

    await waitFor(() => expect(onRuntimeChanged).toHaveBeenCalledTimes(1));
    expect(setThemePreviewRuntime).toHaveBeenCalledWith({
      data: {
        storefrontId: "storefront-1",
        themeId: "theme-1",
        previewRuntime: "start",
      },
    });
    expect(
      (
        queryClient.getQueryData(detailKey) as {
          data: StorefrontThemeEditorDTO;
        }
      ).data.theme.previewRuntime,
    ).toBe("start");
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("does not restart the preview when the server refuses", async () => {
    setThemePreviewRuntime.mockResolvedValue({
      success: false,
      message: "Only a TanStack Start Theme can use the full Start preview.",
      error: "PREVIEW_RUNTIME_UNSUPPORTED",
    });
    const { queryClient, detailKey, onRuntimeChanged } = renderMenu(
      editorContext({}),
    );
    openMenu();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Full Start" }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Only a TanStack Start Theme can use the full Start preview.",
      ),
    );
    expect(onRuntimeChanged).not.toHaveBeenCalled();
    expect(
      (
        queryClient.getQueryData(detailKey) as {
          data: StorefrontThemeEditorDTO;
        }
      ).data.theme.previewRuntime,
    ).toBeNull();
  });

  it("sends nothing for the runtime already in use", () => {
    const { onRuntimeChanged } = renderMenu(editorContext({}));
    openMenu();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Client-only" }));
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
