import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { StorefrontPageDocument } from "@/db/storefront.schema";
import type { EditorSelectionDescriptor } from "@/lib/storefront/editor/selection-taxonomy";
import { EditorStyleInspector } from "./editor-style-inspector";

type TestSection = StorefrontPageDocument["sections"][number];

/**
 * A Hero with a labelled button whose destination is a declared link field.
 *
 * This is the shape every starter component now uses: the label is its own
 * text field, and the destination is one `link` field carrying href, target
 * and rel together. Crucially there is no `actionHref` — the flat key the
 * panel's Action Button card was written against.
 */
const heroSource =
  'import type { ThemeContentFields } from "../morph/content-fields";\nimport ThemeLink, { type ThemeLinkDestination } from "../morph/link";\nexport type HeroProps = {\n  eyebrow?: string;\n  heading?: string;\n  description?: string;\n  actionLabel?: string;\n  action?: ThemeLinkDestination | string;\n  imageSrc?: string;\n  imageAlt?: string;\n};\n\nexport const contentFields = {\n  eyebrow: { type: "text", label: "Eyebrow", maxLength: 100 },\n  heading: { type: "text", label: "Heading", maxLength: 200 },\n  description: { type: "textarea", label: "Description", maxLength: 500 },\n  actionLabel: { type: "text", label: "Action label", maxLength: 100 },\n  action: { type: "link", label: "Action link" },\n  imageSrc: { type: "image", label: "Image" },\n  imageAlt: { type: "text", label: "Image alt text", maxLength: 200 },\n} as const satisfies ThemeContentFields;\n\nexport default function Hero({\n  eyebrow = "New collection",\n  heading = "Objects for everyday rituals.",\n  description = "Quiet essentials, thoughtfully made for the spaces you call home.",\n  actionLabel = "Explore the collection",\n  action = "/collections/new",\n  imageSrc = "/static/storefront/theme-preview-default.png",\n  imageAlt = "A neutral collection of ceramic objects",\n}: HeroProps) {\n  return (\n    <section className="grid min-h-[42rem] bg-stone-100 lg:min-h-[50rem] lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]">\n      <div className="flex items-center px-[clamp(1.75rem,6vw,6rem)] py-20">\n        <div className="max-w-xl">\n          <p className="text-xs font-medium uppercase tracking-[0.24em] text-stone-500">\n            {eyebrow}\n          </p>\n          <h1 className="mt-6 font-serif text-[clamp(3.25rem,7vw,7rem)] leading-[0.88] tracking-[-0.055em] text-stone-950">\n            {heading}\n          </h1>\n          <p className="mt-7 max-w-md text-base leading-7 text-stone-600 lg:text-[19px]">\n            {description}\n          </p>\n          <div className="mt-8">\n            <ThemeLink\n              link={action}\n              className="inline-flex items-center justify-center rounded-md bg-stone-900 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-stone-800"\n            >\n              {actionLabel}\n            </ThemeLink>\n          </div>\n        </div>\n      </div>\n      <div className="min-h-[30rem] overflow-hidden lg:min-h-0">\n        <img src={imageSrc} alt={imageAlt} className="size-full object-cover" />\n      </div>\n    </section>\n  );\n}\n\n';

const themeLinkSource =
  'import type { AnchorHTMLAttributes, ReactNode } from "react";\nimport { Link } from "@tanstack/react-router";\n\n/** A destination as the editor\'s link field stores it. */\nexport type ThemeLinkDestination = {\n  href?: string;\n  target?: "_self" | "_blank";\n  rel?: string;\n};\n\nexport type ThemeLinkProps = Omit<\n  AnchorHTMLAttributes<HTMLAnchorElement>,\n  "href" | "target" | "rel"\n> & {\n  /**\n   * Where this goes.\n   *\n   * A bare string is the address, which is the shape a field declared as\n   * `url` holds. Accepting both means a component does not have to know\n   * which of the two its field is.\n   */\n  link?: ThemeLinkDestination | string;\n  [dataAttribute: `data-${string}`]: unknown;\n};\n/**\n * One destination, rendered with whichever element it actually needs.\n *\n * An address that leaves this store cannot go through the router, and a page\n * of this store should not force a full reload. The choice is per destination,\n * so it belongs to the value rather than to the markup \u2014 writing it once here\n * means every menu, button and footer link decides it the same way.\n *\n * Everything else it is given is forwarded untouched, so the editor\'s field\n * markers, the className and any aria attribute reach the real element.\n */\nexport default function ThemeLink({ link, children, ...rest }: ThemeLinkProps) {\n  const destination = typeof link === "string" ? { href: link } : (link ?? {});\n  const href = destination.href ?? "";\n  const isExternal = href.startsWith("http://") || href.startsWith("https://");\n\n  return isExternal ? (\n    <a href={href} target={destination.target} rel={destination.rel} {...rest}>\n      {children}\n    </a>\n  ) : (\n    <Link to={href} {...rest}>\n      {children}\n    </Link>\n  );\n}\n\n';

const sectionSelection = (): EditorSelectionDescriptor => ({
  sectionId: "section-1",
  kind: "link",
  componentType: "hero",
  tagName: "a",
  role: null,
  inputType: null,
  nodeId: "hero-action",
  sourceFilePath: "src/morph/link.tsx",
  elementKey: "action",
  fieldKey: "actionLabel",
  fieldPath: "actionLabel",
  className: "",
  isSection: false,
  computed: null,
  parentComputed: null,
  sectionComputed: null,
  inspectorOverride: null,
});

function renderInspector() {
  render(
    <EditorStyleInspector
      view="content"
      section={
        {
          id: "section-1",
          type: "hero",
          componentRef: "hero.default",
          enabled: true,
          props: {
            actionLabel: "Explore the collection",
            action: { href: "/collections/new" },
          },
        } as TestSection
      }
      themeFiles={
        [
          {
            path: "src/components/Hero.tsx",
            content: heroSource,
            mimeType: "text/typescript",
          },
          {
            path: "src/morph/link.tsx",
            content: themeLinkSource,
            mimeType: "text/typescript",
          },
        ] as never
      }
      selection={sectionSelection()}
      onPropsChange={vi.fn()}
    />,
  );
}

describe("a button whose destination is a declared link field", () => {
  it("keeps the label control the card provides", () => {
    renderInspector();
    expect(screen.getByDisplayValue("Explore the collection")).toBeTruthy();
  });

  it("offers no path box bound to a key the component does not have", () => {
    renderInspector();
    // The old card wrote `actionHref`. Editing that box changed a prop no
    // source reads, so the button silently kept its old destination.
    expect(screen.queryByLabelText("Action Button path or URL")).toBeNull();
    expect(screen.queryByText("Link path / URL")).toBeNull();
  });

  it("shows the declared link field instead", () => {
    renderInspector();
    expect(screen.getByText("Action link")).toBeTruthy();
  });
});

describe("a component that names its button pair differently", () => {
  /**
   * Nothing here is called `action` or `actionLabel`. The panel should still
   * show where the button goes when its label is selected, because the source
   * says the two meet on one element — which is the only thing that was ever
   * true about `action`/`actionLabel` in the first place.
   */
  const promoSource = `import ThemeLink from "../morph/link";

export const contentFields = {
  ctaLabel: { type: "text", label: "Button label" },
  ctaLink: { type: "link", label: "Button destination" },
} as const;

export default function Promo({ ctaLabel = "Go", ctaLink = {} }) {
  return <ThemeLink link={ctaLink}>{ctaLabel}</ThemeLink>;
}`;

  it("shows the destination beside the selected label", () => {
    render(
      <EditorStyleInspector
        view="content"
        section={
          {
            id: "section-1",
            type: "promo",
            componentRef: "promo.default",
            enabled: true,
            props: { ctaLabel: "Read more", ctaLink: { href: "/about" } },
          } as unknown as TestSection
        }
        themeFiles={
          [
            {
              path: "src/components/Promo.tsx",
              content: promoSource,
              mimeType: "text/typescript",
            },
            {
              path: "src/morph/link.tsx",
              content: themeLinkSource,
              mimeType: "text/typescript",
            },
          ] as never
        }
        selection={
          {
            ...sectionSelection(),
            componentType: "promo",
            kind: "text",
            tagName: "a",
            isSection: false,
            nodeId: "promo-cta",
            sourceFilePath: "src/morph/link.tsx",
            elementKey: "heading",
            fieldKey: "ctaLabel",
            fieldPath: "ctaLabel",
          } as never
        }
        onPropsChange={vi.fn()}
        onPreviewSelectionField={vi.fn()}
      />,
    );

    expect(screen.getByDisplayValue("Read more")).toBeTruthy();
    expect(screen.getByText("Button destination")).toBeTruthy();
  });
});

describe("selecting the wrapper around a button", () => {
  /**
   * The author clicks the padding around a button, not always the button. That
   * selects a container which binds nothing itself and reports the label as a
   * descendant — and the panel, having decided to show that label, owes the
   * author the destination beside it.
   */
  const promoSource = `import ThemeLink from "../morph/link";

export const contentFields = {
  ctaLabel: { type: "text", label: "Button label" },
  ctaLink: { type: "link", label: "Button destination" },
} as const;

export default function Promo({ ctaLabel = "Go", ctaLink = {} }) {
  return (
    <div>
      <ThemeLink link={ctaLink}>{ctaLabel}</ThemeLink>
    </div>
  );
}`;

  it("shows the destination of the button it contains", () => {
    render(
      <EditorStyleInspector
        view="content"
        section={
          {
            id: "section-1",
            type: "promo",
            componentRef: "promo.default",
            enabled: true,
            props: { ctaLabel: "Read more", ctaLink: { href: "/about" } },
          } as unknown as TestSection
        }
        themeFiles={
          [
            {
              path: "src/components/Promo.tsx",
              content: promoSource,
              mimeType: "text/typescript",
            },
            {
              path: "src/morph/link.tsx",
              content: themeLinkSource,
              mimeType: "text/typescript",
            },
          ] as never
        }
        selection={
          {
            ...sectionSelection(),
            componentType: "promo",
            kind: "container",
            tagName: "div",
            isSection: false,
            nodeId: "promo-wrap",
            sourceFilePath: "src/components/Promo.tsx",
            elementKey: null,
            fieldKey: null,
            fieldPath: null,
            descendantFields: [
              {
                sectionId: null,
                fieldKey: "ctaLabel",
                fieldPath: "ctaLabel",
                nodeId: "promo-cta",
                kind: "text",
              },
            ],
          } as never
        }
        onPropsChange={vi.fn()}
        onPreviewSelectionField={vi.fn()}
      />,
    );

    expect(screen.getByDisplayValue("Read more")).toBeTruthy();
    expect(screen.getByText("Button destination")).toBeTruthy();
  });
});
