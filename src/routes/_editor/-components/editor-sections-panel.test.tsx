import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import type { StorefrontThemeEditorSearch } from "@/lib/validations/storefront-theme";
import { EditorSectionsPanel } from "./editor-sections-panel";

vi.mock("@dnd-kit/dom", () => ({
  PointerActivationConstraints: { Distance: class {} },
  PointerSensor: { configure: () => ({}) },
}));
vi.mock("@dnd-kit/react", () => ({
  DragDropProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  isSortable: () => false,
  useSortable: () => ({ ref: vi.fn(), handleRef: vi.fn(), isDragging: false }),
}));
vi.mock("@/server/storefront/storefront-themes.serverFn", () => ({
  reorderStorefrontThemeSections: vi.fn(),
}));

const context = {
  storefront: {
    id: "store-1",
    name: "Store",
    domain: null,
    status: "active",
    activeReleaseId: null,
  },
  theme: {
    id: "theme-1",
    name: "Theme",
    status: "draft",
    releaseGeneration: 1,
    activeRelease: null,
  },
  templates: [
    {
      id: "template-1",
      type: "index",
      name: "Home",
      draftRevisionId: null,
      publishedRevisionId: null,
      draftGeneration: 1,
      document: {
        sections: [
          { id: "section-1", type: "hero", enabled: true, props: {} },
          { id: "section-2", type: "newsletter", enabled: false, props: {} },
        ],
      },
    },
  ],
} as unknown as StorefrontThemeEditorDTO;

const search = {
  template: "index",
  templateId: "template-1",
  section: "section-1",
  viewport: "desktop",
} as StorefrontThemeEditorSearch;

function renderPanel(
  onToggleSectionEnabled = vi.fn(),
  onSearchChange = vi.fn(),
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    onToggleSectionEnabled,
    onSearchChange,
    ...render(
      <QueryClientProvider client={client}>
        <EditorSectionsPanel
          context={context}
          search={search}
          onSearchChange={onSearchChange}
          onSectionOrderChange={vi.fn()}
          onSaveStateChange={vi.fn()}
          onToggleSectionEnabled={onToggleSectionEnabled}
        />
      </QueryClientProvider>,
    ),
  };
}

describe("EditorSectionsPanel visibility controls", () => {
  it("shows accessible hide/show labels and sends the exact section id and next state", () => {
    const { onToggleSectionEnabled } = renderPanel();

    expect(
      screen.getByRole("button", { name: "Hide section hero" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Show section newsletter" }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Hide section hero" }));
    expect(onToggleSectionEnabled).toHaveBeenCalledWith("section-1", false);
    fireEvent.click(
      screen.getByRole("button", { name: "Show section newsletter" }),
    );
    expect(
      screen.getByRole("button", { name: "Hide section hero" }).className,
    ).toContain("opacity-0");
    expect(
      screen.getByRole("button", { name: "Hide section hero" }).className,
    ).toContain("group-hover:opacity-100");
    expect(
      screen.getByRole("button", { name: "Hide section hero" }).className,
    ).toContain("focus-visible:opacity-100");
    expect(
      screen.getByRole("button", { name: "Show section newsletter" }).className,
    ).toContain("opacity-100");
    expect(onToggleSectionEnabled).toHaveBeenCalledWith("section-2", true);
  });

  it("stops visibility-button clicks from selecting rows", () => {
    const onSearchChange = vi.fn();
    const { onToggleSectionEnabled } = renderPanel(vi.fn(), onSearchChange);
    const button = screen.getByRole("button", { name: "Hide section hero" });

    fireEvent.pointerDown(button);
    fireEvent.click(button);

    expect(onSearchChange).not.toHaveBeenCalled();
    expect(onToggleSectionEnabled).toHaveBeenCalledWith("section-1", false);
  });
});
