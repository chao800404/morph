import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { StorefrontPageDocument } from "@/db/storefront.schema";
import type { EditorSelectionDescriptor } from "@/lib/storefront/editor/selection-taxonomy";
import { EditorStyleInspector } from "./editor-style-inspector";

type TestSection = StorefrontPageDocument["sections"][number];

/** Selecting the section itself, which is what lists its declared fields. */
const sectionSelection = (): EditorSelectionDescriptor => ({
  sectionId: "section-1",
  kind: "section",
  componentType: "hero",
  tagName: "section",
  role: null,
  inputType: null,
  nodeId: null,
  sourceFilePath: "src/components/Hero.tsx",
  elementKey: null,
  fieldKey: null,
  fieldPath: null,
  className: "",
  isSection: true,
  computed: null,
  parentComputed: null,
  sectionComputed: null,
  inspectorOverride: null,
});

/**
 * A component declaring a link the way a Theme author is meant to.
 *
 * The Inspector reads `contentFields` from the component's own source, so this
 * declaration is what makes the link control appear at all.
 */
const heroSource = `export const contentFields = {
  action: { type: "link", label: "Action Button" },
} as const;

export default function Hero({ action = {} }) {
  return <a href={action.href} rel={action.rel}>Shop</a>;
}`;

/** The same field, but handed to the router instead of an anchor. */
const routerHeroSource = `import { Link } from "@tanstack/react-router";

export const contentFields = {
  action: { type: "link", label: "Action Button" },
} as const;

export default function Hero({ action = {} }) {
  return <Link to={action.href}>Shop</Link>;
}`;

const themeFiles = [
  {
    path: "src/components/Hero.tsx",
    content: heroSource,
    mimeType: "text/typescript",
  },
  {
    path: "src/routes/__root.tsx",
    content: `import { createRootRoute, Outlet } from "@tanstack/react-router";

export const Route = createRootRoute({ component: () => <Outlet /> });
`,
    mimeType: "text/typescript",
  },
  {
    path: "src/routes/index.tsx",
    content: `import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({ component: RouteComponent });

function RouteComponent() {
  return <main />;
}
`,
    mimeType: "text/typescript",
  },
  {
    path: "src/routes/about.tsx",
    content: `import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/about")({ component: RouteComponent });

function RouteComponent() {
  return <main />;
}
`,
    mimeType: "text/typescript",
  },
] as never;

function renderInspector(action: unknown, componentSource = heroSource) {
  const onPropsChange = vi.fn();
  const files = (
    themeFiles as unknown as { path: string; content: string }[]
  ).map((file) =>
    file.path === "src/components/Hero.tsx"
      ? { ...file, content: componentSource }
      : file,
  ) as never;
  render(
    <EditorStyleInspector
      section={
        {
          id: "section-1",
          type: "hero",
          componentRef: "hero.default",
          enabled: true,
          props: { action },
        } as TestSection
      }
      themeFiles={files}
      selection={sectionSelection()}
      onPropsChange={onPropsChange}
    />,
  );
  return { onPropsChange };
}

describe("a declared link field in the Inspector", () => {
  it("renders the link control instead of a plain text box", () => {
    renderInspector({ href: "/about" });

    expect(screen.getByText("Action Button")).toBeTruthy();
    expect(screen.getByLabelText("Action Button path or URL")).toBeTruthy();
    expect(
      screen.getByPlaceholderText("/about or https://example.com"),
    ).toBeTruthy();
    expect(screen.queryByText("This store")).toBeNull();
    expect(screen.queryByText("External URL")).toBeNull();
    expect(screen.getByText("Open in")).toBeTruthy();
    expect(screen.getByText(/nofollow/)).toBeTruthy();
  });

  it("writes a plain anchor path verbatim", () => {
    const { onPropsChange } = renderInspector({ href: "/about" });
    fireEvent.blur(screen.getByLabelText("Action Button path or URL"), {
      target: { value: "/collections/all" },
    });

    expect(onPropsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: expect.objectContaining({ href: "/collections/all" }),
      }),
    );
  });

  it("writes the whole link object when the target changes", () => {
    const { onPropsChange } = renderInspector({ href: "/about" });

    fireEvent.click(screen.getByText("Same tab"));
    fireEvent.click(screen.getByText("New tab"));

    expect(onPropsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: expect.objectContaining({ href: "/about", target: "_blank" }),
      }),
    );
  });

  it("keeps the rest of the link when one part is edited", () => {
    const { onPropsChange } = renderInspector({
      href: "/about",
      title: "Our story",
    });

    fireEvent.click(screen.getByText("Same tab"));
    fireEvent.click(screen.getByText("New tab"));

    expect(onPropsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: expect.objectContaining({ title: "Our story" }),
      }),
    );
  });

  it("keeps the path input when the stored anchor URL leaves the store", () => {
    renderInspector({ href: "https://example.com" });

    expect(
      screen.getByPlaceholderText("/about or https://example.com"),
    ).toBeTruthy();
  });

  it("offers download only for a destination inside the store", () => {
    renderInspector({ href: "/lookbook.pdf" });
    expect(screen.getByText("Download instead of opening")).toBeTruthy();
  });

  it("hides download for another origin, which browsers ignore", () => {
    renderInspector({ href: "https://example.com/a.pdf" });
    expect(screen.queryByText("Download instead of opening")).toBeNull();
  });
});

describe("a link the router renders", () => {
  it("does not offer an external destination", () => {
    // `<Link to>` resolves against this Theme's routes. An external address
    // would render fine in the preview, where the interpreter emits a plain
    // anchor, and fail on the built site where the real router must match it.
    renderInspector({ href: "/about" }, routerHeroSource);

    expect(screen.queryByText("External URL")).toBeNull();
    expect(screen.getByText(/only point at a page of this store/)).toBeTruthy();
  });

  it("still offers the page chooser", () => {
    renderInspector({ href: "/about" }, routerHeroSource);
    expect(screen.getByText("Open in")).toBeTruthy();
  });

  it("uses the path input for a plain anchor regardless of the stored URL", () => {
    renderInspector({ href: "/about" }, heroSource);
    expect(
      screen.getByPlaceholderText("/about or https://example.com"),
    ).toBeTruthy();
    expect(screen.queryByText("Choose a page")).toBeNull();
  });
});

describe("Content & Fields conforms to the Inspector field rules", () => {
  /**
   * Rule 19.3: field names in one Inspector module share a typography token.
   * Hand-writing a size per control is what previously produced neighbouring
   * labels at different sizes, so this asserts the rendered result rather than
   * trusting the class string at each call site.
   */
  it("renders every field label at the same size", () => {
    renderInspector({ href: "/about" });

    const labels = Array.from(
      document.querySelectorAll<HTMLElement>("label"),
    ).filter((label) => (label.textContent ?? "").trim().length > 0);
    expect(labels.length).toBeGreaterThan(2);

    const sizes = new Set(
      labels.map(
        (label) =>
          Array.from(label.classList).find((token) =>
            token.startsWith("text-["),
          ) ?? "unsized",
      ),
    );
    expect(sizes).toEqual(new Set(["text-[11px]"]));
  });

  /**
   * Rule 19: field controls take their visuals from the shared primitives. A
   * bare `<input type="checkbox">` skips the project's focus ring, disabled
   * and dark-mode treatment.
   */
  it("uses the shared Checkbox primitive for boolean fields", () => {
    renderInspector({ href: "/lookbook.pdf" });

    expect(document.querySelector('input[type="checkbox"]')).toBeNull();
    expect(
      document.querySelectorAll('[data-slot="checkbox"]').length,
    ).toBeGreaterThan(0);
  });
});
