import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listThemeDependencies = vi.fn();
const requestThemeDependency = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("@/server/storefront/storefront-theme-builds.serverFn", () => ({
  listThemeDependencies: (args: unknown) => listThemeDependencies(args),
  requestThemeDependency: (args: unknown) => requestThemeDependency(args),
}));

vi.mock("sonner", () => ({
  toast: {
    success: (message: string) => toastSuccess(message),
    error: (message: string) => toastError(message),
  },
}));

import { EditorThemeDependenciesDialog } from "./editor-theme-dependencies";

const catalog = [
  { name: "lucide-react", root: "lucide-react", version: "0.468.0" },
  { name: "three", root: "three", version: "0.179.0" },
];

const readyDependency = {
  id: "dependency-1",
  storefrontId: "store-1",
  themeId: "theme-1",
  packageName: "lucide-react",
  packageVersion: "0.468.0",
  status: "ready",
  buildId: "build-1",
  requestedBy: "user-1",
  errorMessage: null,
  createdAt: "2026-08-31T10:00:00.000Z",
  updatedAt: "2026-08-31T10:00:00.000Z",
} as const;

function renderDialog(sourceRevisionId?: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <EditorThemeDependenciesDialog
        open
        onOpenChange={vi.fn()}
        storefrontId="store-1"
        themeId="theme-1"
        sourceRevisionId={sourceRevisionId}
      />
    </QueryClientProvider>,
  );
}

describe("EditorThemeDependenciesDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listThemeDependencies.mockResolvedValue({
      success: true,
      data: { catalog, dependencies: [readyDependency] },
    });
    requestThemeDependency.mockResolvedValue({
      success: true,
      data: {
        ...readyDependency,
        packageName: "three",
        packageVersion: "0.179.0",
        status: "requested",
      },
    });
  });

  it("shows the approved catalog and the persisted package status", async () => {
    renderDialog("revision-1");

    expect(await screen.findByText("Theme packages")).toBeTruthy();
    expect(await screen.findByText("lucide-react")).toBeTruthy();
    expect(await screen.findByText("three")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Enabled" })).toBeTruthy();
  });

  it("requires a current successful build before enabling a package", async () => {
    renderDialog();

    expect(
      await screen.findByText(/Save your files and run Build Preview/),
    ).toBeTruthy();
    expect(
      (await screen.findByRole("button", { name: "Enable" })).hasAttribute(
        "disabled",
      ),
    ).toBe(true);
  });

  it("requests a package against the exact source revision", async () => {
    renderDialog("revision-42");

    fireEvent.click(await screen.findByRole("button", { name: "Enable" }));

    await waitFor(() =>
      expect(requestThemeDependency).toHaveBeenCalledWith({
        data: {
          storefrontId: "store-1",
          themeId: "theme-1",
          sourceRevisionId: "revision-42",
          packageName: "three",
        },
      }),
    );
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("offers retry for a failed package and reports the failure message", async () => {
    listThemeDependencies.mockResolvedValue({
      success: true,
      data: {
        catalog,
        dependencies: [
          {
            ...readyDependency,
            packageName: "three",
            packageVersion: "0.179.0",
            status: "failed",
            errorMessage: "Build failed",
          },
        ],
      },
    });
    renderDialog("revision-1");

    expect(await screen.findByText("Build failed")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(requestThemeDependency).toHaveBeenCalled());
  });
});
