import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { StorefrontPageDocument } from "@/db/storefront.schema";
import type { EditorSelectionDescriptor } from "@/lib/storefront/editor/selection-taxonomy";
import {
  EditorStyleInspector,
  resolveInternalLinkPages,
} from "./editor-style-inspector";

type TestSection = StorefrontPageDocument["sections"][number];

/** Selecting the container that holds the action, as clicking it in the canvas does. */
const actionSelection = (): EditorSelectionDescriptor => ({
  sectionId: "section-1",
  kind: "container",
  componentType: "hero",
  tagName: "div",
  role: null,
  inputType: null,
  nodeId: "hero-action",
  sourceFilePath: null,
  elementKey: "action",
  fieldKey: null,
  fieldPath: null,
  className: "",
  isSection: false,
  computed: null,
  parentComputed: null,
  sectionComputed: null,
  inspectorOverride: null,
  descendantFields: [
    { fieldKey: "actionLabel", fieldPath: "actionLabel", sectionId: null },
    { fieldKey: "actionHref", fieldPath: "actionHref", sectionId: null },
  ],
});

const heroSection = (props: TestSection["props"]): TestSection => ({
  id: "section-1",
  type: "hero",
  componentRef: "hero.default",
  enabled: true,
  props,
});

/**
 * A tiny Theme whose routes are what the page picker should offer. The picker
 * reads the same source route registry the Pages panel uses, so these files are
 * the input that decides the list.
 */
const routeSource = (path: string) =>
  `import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("${path}")({
  component: RouteComponent,
});

function RouteComponent() {
  return <main />;
}
`;

const routeFiles = [
  {
    path: "src/routes/__root.tsx",
    content: `import { createRootRoute, Outlet } from "@tanstack/react-router";

export const Route = createRootRoute({
  component: () => <Outlet />,
});
`,
    mimeType: "text/typescript",
  },
  {
    path: "src/routes/index.tsx",
    content: routeSource("/"),
    mimeType: "text/typescript",
  },
  {
    path: "src/routes/about.tsx",
    content: routeSource("/about"),
    mimeType: "text/typescript",
  },
  {
    path: "src/routes/products/$id.tsx",
    content: routeSource("/products/$id"),
    mimeType: "text/typescript",
  },
] as never;

const anchorHeroSource = `export default function Hero({ actionHref }) {
  return <a href={actionHref}>Go</a>;
}`;

const routerHeroSource = `import { Link } from "@tanstack/react-router";

export default function Hero({ actionHref }) {
  return <Link to={actionHref}>Go</Link>;
}`;

const hardcodedRouterHeroSource = `import { Link } from "@tanstack/react-router";

export default function Hero({ actionHref }) {
  return <Link to="/aboutus">Go</Link>;
}`;

function renderInspector(
  props: Record<string, unknown>,
  componentSource?: string,
  onRepairThemeLinkBinding?: (
    filePath: string,
    fieldKey: string,
  ) => Promise<boolean> | boolean,
  /** Extra workspace files, and the file the selected element came from. */
  extra?: {
    files?: { path: string; content: string; mimeType: string }[];
    selectionSourceFilePath?: string;
    selection?: Partial<EditorSelectionDescriptor>;
  },
) {
  const onPropsChange = vi.fn();
  const onPreviewSelectionField = vi.fn();
  const themeFiles = componentSource
    ? ([
        ...routeFiles,
        {
          path: "src/components/Hero.tsx",
          content: componentSource,
          mimeType: "text/typescript",
        },
      ] as never)
    : routeFiles;
  render(
    <EditorStyleInspector
      view="content"
      section={heroSection(props as TestSection["props"])}
      themeFiles={
        [...(themeFiles as never[]), ...(extra?.files ?? [])] as never
      }
      selection={{
        ...actionSelection(),
        sourceFilePath: extra?.selectionSourceFilePath ?? null,
        ...extra?.selection,
      }}
      onPropsChange={onPropsChange}
      onPreviewSelectionField={onPreviewSelectionField}
      onRepairThemeLinkBinding={onRepairThemeLinkBinding}
    />,
  );
  return { onPropsChange, onPreviewSelectionField };
}

describe("resolveInternalLinkPages", () => {
  it("lists the Theme's static routes and labels the index as Home", () => {
    expect(resolveInternalLinkPages(routeFiles)).toEqual([
      { path: "/", label: "Home" },
      { path: "/about", label: "/about" },
    ]);
  });

  it("omits dynamic routes that need params the panel cannot supply", () => {
    const paths = resolveInternalLinkPages(routeFiles).map((page) => page.path);
    expect(paths).not.toContain("/products/$id");
  });

  it("returns nothing when the workspace has no files yet", () => {
    expect(resolveInternalLinkPages(undefined)).toEqual([]);
    expect(resolveInternalLinkPages([])).toEqual([]);
  });
});

describe("Action Button link controls", () => {
  it("uses the shared label-to-control spacing for every action field", () => {
    renderInspector(
      { actionLabel: "Go", actionHref: "/collections/all" },
      routerHeroSource,
    );

    for (const label of ["Label", "Open in"]) {
      const labelElement = screen.getByText(label);
      expect(labelElement.tagName).toBe("LABEL");
      expect(labelElement.parentElement?.className).toContain("space-y-1");
    }
  });

  it("accepts an external URL in the link field", () => {
    const { onPropsChange } = renderInspector(
      {
        actionLabel: "Go",
        actionHref: "/collections/all",
      },
      anchorHeroSource,
    );

    const input = screen.getByPlaceholderText("/about or https://example.com");
    fireEvent.blur(input, {
      target: { value: "https://example.com/lookbook" },
    });

    expect(onPropsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ actionHref: "https://example.com/lookbook" }),
    );
  });

  it("offers a page chooser when the Theme has routes", () => {
    renderInspector(
      { actionLabel: "Go", actionHref: "/collections/all" },
      routerHeroSource,
    );

    expect(screen.getByText("Choose a page")).toBeTruthy();
  });

  it("keeps an anchor destination editable when it leaves the store", () => {
    renderInspector(
      {
        actionLabel: "Go",
        actionHref: "https://example.com",
      },
      anchorHeroSource,
    );

    expect(
      screen.getByPlaceholderText("/about or https://example.com"),
    ).toBeTruthy();
    expect(screen.queryByText("Choose a page")).toBeNull();
  });

  it("switches the link to a new tab", () => {
    const { onPropsChange } = renderInspector(
      {
        actionLabel: "Go",
        actionHref: "/collections/all",
      },
      anchorHeroSource,
    );

    fireEvent.click(screen.getByText("Same tab"));
    fireEvent.click(screen.getByText("New tab"));

    expect(onPropsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ actionTarget: "_blank" }),
    );
  });

  it("reflects a stored new-tab choice", () => {
    renderInspector(
      {
        actionLabel: "Go",
        actionHref: "/collections/all",
        actionTarget: "_blank",
      },
      anchorHeroSource,
    );

    expect(screen.getByText("New tab")).toBeTruthy();
  });

  it("does not render a destination control when the source field is unbound", () => {
    renderInspector({ actionLabel: "Go", actionHref: "/collections/all" });

    expect(
      screen.getByText(
        "Link destination is not connected to the editable field.",
      ),
    ).toBeTruthy();
    expect(
      screen.queryByPlaceholderText("/about or https://example.com"),
    ).toBeNull();
    expect(screen.queryByText("Choose a page")).toBeNull();
  });

  it("reports a hardcoded Link destination instead of offering a fake input", () => {
    renderInspector(
      { actionLabel: "Go", actionHref: "/collections/all" },
      hardcodedRouterHeroSource,
    );

    expect(
      screen.getByText(
        "Link destination is not connected to the editable field.",
      ),
    ).toBeTruthy();
    expect(
      screen.queryByPlaceholderText("/about or https://example.com"),
    ).toBeNull();
    expect(screen.queryByText("Choose a page")).toBeNull();
  });

  it("offers a safe one-click repair for one hard-coded Link", () => {
    const onRepairThemeLinkBinding = vi.fn().mockResolvedValue(true);

    renderInspector(
      { actionLabel: "Go", actionHref: "/collections/all" },
      hardcodedRouterHeroSource,
      onRepairThemeLinkBinding,
    );

    fireEvent.click(screen.getByRole("button", { name: "Connect actionHref" }));

    expect(onRepairThemeLinkBinding).toHaveBeenCalledWith(
      "src/components/Hero.tsx",
      "actionHref",
    );
  });

  it("uses a free-form path input for a plain anchor", () => {
    renderInspector(
      { actionLabel: "Go", actionHref: "/about" },
      anchorHeroSource,
    );

    expect(
      screen.getByPlaceholderText("/about or https://example.com"),
    ).toBeTruthy();
    expect(screen.queryByText("Choose a page")).toBeNull();
  });

  it("uses the internal page chooser for a router Link", () => {
    renderInspector(
      { actionLabel: "Go", actionHref: "/collections/all" },
      routerHeroSource,
    );

    expect(screen.getByText("Choose a page")).toBeTruthy();
    expect(
      screen.queryByPlaceholderText("/about or https://example.com"),
    ).toBeNull();
  });
});

describe("switching a link between in-store and external", () => {
  function renderWithSwitch(componentSource: string) {
    const onSwitchThemeLinkElement = vi.fn();
    render(
      <EditorStyleInspector
        view="content"
        section={heroSection({
          actionLabel: "Go",
          actionHref: "/about",
        } as TestSection["props"])}
        themeFiles={
          [
            ...routeFiles,
            {
              path: "src/components/Hero.tsx",
              content: componentSource,
              mimeType: "text/typescript",
            },
          ] as never
        }
        selection={actionSelection()}
        onPropsChange={vi.fn()}
        onSwitchThemeLinkElement={onSwitchThemeLinkElement}
      />,
    );
    return { onSwitchThemeLinkElement };
  }

  it("offers both sides for a router Link", () => {
    renderWithSwitch(routerHeroSource);

    expect(screen.getByText("In store")).toBeTruthy();
    expect(screen.getByText("External")).toBeTruthy();
  });

  it("rewrites a router Link into an anchor when External is chosen", () => {
    // The element is what decides where the link may point, so the switch has
    // to change the source rather than only the stored value.
    const { onSwitchThemeLinkElement } = renderWithSwitch(routerHeroSource);

    fireEvent.click(screen.getByText("External"));

    expect(onSwitchThemeLinkElement).toHaveBeenCalledWith(
      "src/components/Hero.tsx",
      "actionHref",
      "anchor",
    );
  });

  it("rewrites an anchor into a router Link when This store is chosen", () => {
    const { onSwitchThemeLinkElement } = renderWithSwitch(anchorHeroSource);

    fireEvent.click(screen.getByText("In store"));

    expect(onSwitchThemeLinkElement).toHaveBeenCalledWith(
      "src/components/Hero.tsx",
      "actionHref",
      "router",
    );
  });

  it("does not offer to switch to the side it is already on", () => {
    renderWithSwitch(anchorHeroSource);

    expect(
      screen.getByText("External").closest("button")?.hasAttribute("disabled"),
    ).toBe(true);
    expect(
      screen.getByText("In store").closest("button")?.hasAttribute("disabled"),
    ).toBe(false);
  });
});

describe("a destination handed to a shared link component", () => {
  /**
   * The component decides the element from the address, so there is no
   * element here to switch and nothing to repair — but the field is bound,
   * and saying otherwise sends an author to fix working code.
   */
  const viaComponent = `import ThemeLink from "../morph/link";

export const contentFields = {
  actionLabel: { type: "text", label: "Action label" },
  actionHref: { type: "url", label: "Action link" },
} as const;

export default function Hero({ actionLabel = "Go", actionHref = "/products" }) {
  return <ThemeLink link={actionHref}>{actionLabel}</ThemeLink>;
}`;

  it("does not report the link as disconnected", () => {
    renderInspector({}, viaComponent);

    expect(
      screen.queryByText(/not connected to the editable field/),
    ).toBeNull();
  });

  it("does not offer to rewrite the component", () => {
    renderInspector({}, viaComponent);

    expect(
      screen.queryByRole("button", { name: /Connect actionHref/ }),
    ).toBeNull();
  });

  it("asks the section's component even when the element came from another file", () => {
    // Clicking the anchor selects the shared component's file, which has never
    // heard of `actionHref`. Asking it whether the section binds the field
    // gets "no" every time, for every section that uses a shared component.
    renderInspector({}, viaComponent, undefined, {
      files: [
        {
          path: "src/morph/link.tsx",
          content:
            "export default function ThemeLink({ link, ...rest }) {\n  return <a href={link} {...rest} />;\n}",
          mimeType: "text/typescript",
        },
      ],
      selectionSourceFilePath: "src/morph/link.tsx",
    });

    expect(
      screen.queryByText(/not connected to the editable field/),
    ).toBeNull();
  });
});

describe("unified action fields", () => {
  it("uses the shared destination mode control for a scalar shared-component link", () => {
    const { onPropsChange } = renderInspector(
      { actionLabel: "Go", actionHref: "/about" },
      `import ThemeLink from "../morph/link";
       export default function Hero({ actionLabel, actionHref }) {
         return <ThemeLink link={actionHref}>{actionLabel}</ThemeLink>;
       }`,
    );
    expect(screen.getByText("This store")).toBeTruthy();
    fireEvent.click(screen.getByText("External URL"));
    fireEvent.blur(
      screen.getByRole("textbox", { name: "Action Button path or URL" }),
      {
        target: { value: "https://example.com" },
      },
    );
    expect(onPropsChange).toHaveBeenLastCalledWith({
      actionLabel: "Go",
      actionHref: "https://example.com",
    });
    expect(screen.queryByText("Tooltip")).toBeNull();
  });

  it("shows the declared action beside its selected label while ignoring stale scalar destinations", () => {
    const { onPropsChange, onPreviewSelectionField } = renderInspector(
      {
        actionLabel: "Go",
        actionHref: "/obsolete",
        action: { href: "/about" },
      },
      `import ThemeLink from "../morph/link";
       export const contentFields = {
         actionLabel: { type: "text", label: "Action label" },
         action: { type: "link", label: "Action link" },
       };
       export default function Hero({ actionLabel, action }) {
         return <ThemeLink link={action}>{actionLabel}</ThemeLink>;
       }`,
      undefined,
      {
        selection: {
          kind: "text",
          tagName: "a",
          elementKey: "heading",
          fieldKey: "actionLabel",
          fieldPath: "actionLabel",
          descendantFields: [],
        },
        selectionSourceFilePath: "src/morph/link.tsx",
        files: [
          {
            path: "src/morph/link.tsx",
            content:
              "export default function ThemeLink({link, children}) { return <a href={link.href}>{children}</a>; }",
            mimeType: "text/typescript",
          },
        ],
      },
    );
    expect(screen.getByText("Action link")).toBeTruthy();
    expect(screen.queryByText("Action Button")).toBeNull();
    expect(screen.queryByDisplayValue("/obsolete")).toBeNull();
    const label = screen.getByDisplayValue("Go");
    expect(label.closest('[data-slot="inspector-content-field"]')).toBeTruthy();
    fireEvent.input(label, { target: { value: "Explore" } });
    expect(onPreviewSelectionField).toHaveBeenLastCalledWith(
      "actionLabel",
      null,
      "Explore",
    );
    expect(onPropsChange).not.toHaveBeenCalled();
    fireEvent.blur(label);
    expect(onPropsChange).toHaveBeenLastCalledWith({
      actionLabel: "Explore",
      actionHref: "/obsolete",
      action: { href: "/about" },
    });
    fireEvent.click(screen.getByText("External URL"));
    fireEvent.blur(
      screen.getByRole("textbox", { name: "Action link path or URL" }),
      { target: { value: "https://example.com" } },
    );
    expect(onPropsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        actionHref: "/obsolete",
        action: expect.objectContaining({ href: "https://example.com" }),
      }),
    );
  });
});
