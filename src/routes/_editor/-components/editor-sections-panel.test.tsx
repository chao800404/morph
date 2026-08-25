import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import type { StorefrontThemeEditorSearch } from "@/lib/validations/storefront-theme";
import type { EditorSelectionDescriptor } from "@/lib/storefront/editor/selection-taxonomy";
import type { PreviewEditableNode } from "@/lib/storefront/editor/preview-protocol";
import {
  EditorSectionsPanel,
  type EditorSectionsPanelProps,
} from "./editor-sections-panel";

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

beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

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
  extraProps: Partial<EditorSectionsPanelProps> = {},
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
          {...extraProps}
        />
      </QueryClientProvider>,
    ),
  };
}

describe("EditorSectionsPanel visibility controls", () => {
  it("shows source-authored Theme pages and opens their route module", () => {
    const onOpenThemeRoute = vi.fn();
    const route = {
      id: "/about",
      path: "/about",
      sourcePath: "src/routes/about.tsx",
      kind: "route" as const,
      dynamic: false,
      componentName: "AboutRoute",
    };
    renderPanel(vi.fn(), vi.fn(), {
      themeRoutes: [route],
      onOpenThemeRoute,
    });

    fireEvent.click(screen.getByRole("button", { name: "/about" }));
    expect(onOpenThemeRoute).toHaveBeenCalledWith(route);
  });

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
    ).toContain("group-hover/menu-item:opacity-100");
    expect(
      screen.getByRole("button", { name: "Hide section hero" }).className,
    ).toContain("group-focus-within/menu-item:opacity-100");
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

const editableNodes: readonly PreviewEditableNode[] = [
  {
    id: "section-1:node:content",
    parentId: null,
    sectionId: "section-1",
    label: "Content",
    kind: "container",
    tagName: "div",
    target: {
      sectionId: "section-1",
      nodeId: "content",
      isSection: false,
    },
  },
  {
    id: "section-1:node:heading",
    parentId: "section-1:node:content",
    sectionId: "section-1",
    label: "Heading",
    kind: "heading",
    tagName: "h1",
    target: {
      sectionId: "section-1",
      nodeId: "heading",
      fieldPath: "heading",
      fieldKey: "heading",
      isSection: false,
    },
  },
  {
    id: "section-1:node:subheading",
    parentId: "section-1:node:content",
    sectionId: "section-1",
    label: "Subheading",
    kind: "heading",
    tagName: "h2",
    target: {
      sectionId: "section-1",
      nodeId: "subheading",
      isSection: false,
    },
  },
  {
    id: "section-1:node:image",
    parentId: "section-1:node:content",
    sectionId: "section-1",
    label: "Image",
    kind: "image",
    tagName: "img",
    target: {
      sectionId: "section-1",
      nodeId: "image",
      isSection: false,
    },
  },
  {
    id: "section-1:node:description",
    parentId: "section-1:node:content",
    sectionId: "section-1",
    label: "Description",
    kind: "text",
    tagName: "p",
    target: {
      sectionId: "section-1",
      nodeId: "description",
      isSection: false,
    },
  },
  {
    id: "section-2:node:title",
    parentId: null,
    sectionId: "section-2",
    label: "Newsletter title",
    kind: "heading",
    tagName: "h2",
    target: {
      sectionId: "section-2",
      nodeId: "newsletter-title",
      isSection: false,
    },
  },
];

describe("EditorSectionsPanel editable node tree", () => {
  it("uses the shared shadcn sidebar menu and submenu presentation", () => {
    const { container } = renderPanel(vi.fn(), vi.fn(), { editableNodes });

    expect(container.querySelector('[data-slot="sidebar"]')).toBeTruthy();
    expect(container.querySelector('[data-sidebar="menu"]')).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "hero" }).getAttribute("data-sidebar"),
    ).toBe("menu-button");
    expect(container.querySelector('[data-sidebar="menu-sub"]')).toBeTruthy();
    expect(
      container.querySelector('[data-sidebar="menu-sub"]')?.className,
    ).toContain("ml-3");
    expect(
      container.querySelector('[data-sidebar="menu-sub"]')?.className,
    ).toContain("border-l");
    expect(
      container.querySelector('[data-sidebar="menu-sub"]')?.className,
    ).toContain("border-sidebar-border/60");
    expect(
      screen
        .getByRole("button", { name: "Content" })
        .getAttribute("data-sidebar"),
    ).toBe("menu-sub-button");
    expect(
      screen
        .getByRole("button", { name: "Content" })
        .closest('[data-sidebar="menu-sub-item"]')?.className,
    ).toContain("[&>div:first-child]:hidden");
    expect(
      screen
        .getByRole("button", { name: "Content" })
        .closest('[data-sidebar="menu-sub-item"]')?.className,
    ).toContain("data-[active=false]:hover:bg-transparent!");
    expect(screen.getByRole("button", { name: "Content" }).className).toContain(
      "cursor-pointer",
    );
    expect(
      screen.getByRole("button", { name: "Content" }).parentElement?.className,
    ).toContain("w-full");
  });

  it("uses the section item itself as the drag surface without numbering or a grip icon", () => {
    renderPanel(vi.fn(), vi.fn(), { editableNodes });

    const sectionButton = screen.getByRole("button", { name: "hero" });
    expect(sectionButton.getAttribute("title")).toContain("drag to reorder");
    expect(sectionButton.className.split(" ")).toContain("cursor-pointer");
    expect(sectionButton.className.split(" ")).not.toContain("cursor-grab");
    expect(sectionButton.className.split(" ")).not.toContain("cursor-grabbing");
    expect(
      screen.queryByRole("button", { name: "Reorder section hero" }),
    ).toBeNull();
    expect(screen.queryByText("1")).toBeNull();
    expect(
      sectionButton.parentElement
        ?.querySelector("button")
        ?.getAttribute("aria-label"),
    ).toBe("Collapse section hero");
  });

  it("shows semantic icons before section and editable node labels", () => {
    const { container } = renderPanel(vi.fn(), vi.fn(), { editableNodes });

    const sectionButton = screen.getByRole("button", { name: "hero" });
    expect(
      sectionButton.querySelector('[data-editor-tree-icon="section"]'),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Content" })
        .querySelector('[data-editor-tree-icon="block"]'),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Expand Content" }));

    expect(
      screen
        .getByRole("button", { name: "Heading" })
        .querySelector('[data-editor-tree-icon="h1"]'),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Subheading" })
        .querySelector('[data-editor-tree-icon="h2"]'),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Image" })
        .querySelector('[data-editor-tree-icon="image"]'),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Description" })
        .querySelector('[data-editor-tree-icon="text"]'),
    ).toBeTruthy();
    expect(
      container.querySelectorAll('[data-editor-tree-icon][aria-hidden="true"]'),
    ).toHaveLength(7);
  });

  it("expands nested nodes and selects a target without selecting the section row", () => {
    const onSearchChange = vi.fn();
    const onSelectEditableNode = vi.fn();
    renderPanel(vi.fn(), onSearchChange, {
      editableNodes,
      onSelectEditableNode,
    });

    expect(screen.getByRole("button", { name: "Content" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Heading" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Expand Content" }));
    fireEvent.click(screen.getByRole("button", { name: "Heading" }));

    expect(
      screen
        .getByRole("button", { name: "Heading" })
        .getAttribute("aria-current"),
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: "hero" }).getAttribute("data-active"),
    ).not.toBe("true");
    expect(onSelectEditableNode).toHaveBeenCalledWith(editableNodes[1].target);
    expect(onSearchChange).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "Collapse section hero" }),
    );
    expect(onSearchChange).not.toHaveBeenCalled();
  });

  it("reveals the selected canvas node and highlights only that tree row", () => {
    const activeSelection = {
      sectionId: "section-1",
      isSection: false,
      nodeId: "heading",
      fieldPath: "heading",
      fieldKey: "heading",
      elementKey: "heading",
    } as EditorSelectionDescriptor;
    renderPanel(vi.fn(), vi.fn(), { editableNodes, activeSelection });

    const headingButton = screen.getByRole("button", { name: "Heading" });
    expect(headingButton.getAttribute("aria-current")).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "Content" })
        .getAttribute("aria-current"),
    ).toBeNull();
  });

  it("keeps a cross-section canvas selection active while the URL section catches up", () => {
    const activeSelection = {
      sectionId: "section-2",
      isSection: false,
      nodeId: "newsletter-title",
      fieldPath: null,
      fieldKey: null,
      elementKey: null,
    } as EditorSelectionDescriptor;

    renderPanel(vi.fn(), vi.fn(), { editableNodes, activeSelection });

    const selectedNode = screen.getByRole("button", {
      name: "Newsletter title",
    });
    expect(selectedNode.getAttribute("aria-current")).toBe("true");
    expect(
      screen.getByRole("button", { name: "hero" }).getAttribute("data-active"),
    ).not.toBe("true");
  });
});
