/**
 * A shared element component, used the way a Theme author would use one.
 *
 * Three things have to hold at once for this to be a pattern anyone can rely
 * on: a component imported from outside `components/` renders, the props it is
 * handed reach the real element it produces, and a per-row condition picks a
 * different element for each entry. The interpreter covers a controlled subset
 * of React, so each of those is a capability rather than a given — and a menu
 * whose field markers stopped at the wrapper would be unselectable on the
 * canvas while looking perfectly fine on the page.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { renderSafeThemeRoute } from "@/components/storefront/safe-theme-route-renderer";
import {
  createDefaultStorefrontHomeDocument,
  createDefaultStorefrontLayoutDocument,
} from "./default-storefront-document";
import { STARTER_THEME_FILES } from "./starter-theme-files";
import type { StorefrontPageDocument } from "@/db/storefront.schema";

const THEME_LINK_SOURCE = `import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

/** A destination as the editor's \`type: "link"\` field stores it. */
export type ThemeLinkDestination = {
  href?: string;
  target?: "_self" | "_blank";
  rel?: string;
};

export type ThemeLinkProps = {
  link?: ThemeLinkDestination;
  children?: ReactNode;
};

/**
 * One destination, rendered with whichever element it actually needs.
 *
 * An address that leaves this store cannot go through the router, and a page
 * of this store should not force a full reload. The choice is per destination,
 * so it belongs to the value rather than to the markup — writing it once here
 * means every menu, button and footer link decides it the same way.
 *
 * Everything else it is given is forwarded untouched, so the editor's field
 * markers, the className and any aria attribute reach the real element.
 */
export default function ThemeLink({ link, children, ...rest }: ThemeLinkProps) {
  const destination = link ?? {};
  const href = destination.href ?? "";
  const isExternal = href.startsWith("http://") || href.startsWith("https://");

  return isExternal ? (
    <a href={href} target={destination.target} rel={destination.rel} {...rest}>
      {children}
    </a>
  ) : (
    <Link to={href} {...rest}>
      {children}
    </Link>
  );
}
`;

const HEADER_SOURCE = `import ThemeLink from "../morph/link";

export type HeaderLink = {
  href?: string;
  target?: "_self" | "_blank";
  rel?: string;
};

export type HeaderItem = {
  label?: string;
  link?: HeaderLink;
};

export type HeaderProps = {
  storeName?: string;
  items?: HeaderItem[];
  cartLabel?: string;
  cartLink?: HeaderLink;
};

export const contentFields = {
  storeName: { type: "text", label: "Store name", maxLength: 80 },
  items: {
    type: "array",
    label: "Menu",
    minRows: 1,
    maxRows: 8,
    fields: {
      label: { type: "text", label: "Label", maxLength: 40 },
      link: { type: "link", label: "Destination" },
    },
  },
  cartLabel: { type: "text", label: "Cart label", maxLength: 40 },
  cartLink: { type: "link", label: "Cart link" },
} as const;

export default function Header({
  storeName = "Online Store",
  items = [
    { label: "home", link: { href: "/" } },
    { label: "product", link: { href: "/products" } },
    { label: "contact us", link: { href: "https://example.com/contact" } },
  ],
  cartLabel = "Cart (0)",
  cartLink = { href: "/cart" },
}: HeaderProps) {
  return (
    <header className="flex h-16 items-center justify-between border-b border-neutral-200 bg-stone-50 px-5 sm:px-8">
      <span
        data-storefront-field="storeName"
        className="font-serif text-lg font-semibold tracking-tight"
      >
        {storeName}
      </span>
      <nav
        className="hidden items-center gap-7 text-xs text-neutral-600 sm:flex"
        aria-label="Storefront navigation"
      >
        {items.map((item, index) => (
          <ThemeLink
            key={item.label}
            link={item.link}
            data-storefront-field="label"
            data-storefront-field-path={\`items.\${index}.label\`}
            className="hover:text-neutral-950"
          >
            {item.label}
          </ThemeLink>
        ))}
      </nav>
      <ThemeLink
        link={cartLink}
        data-storefront-field="cartLabel"
        className="text-xs text-neutral-600 hover:text-neutral-950"
      >
        {cartLabel}
      </ThemeLink>
    </header>
  );
}
`;

function render(): string {
  const files = [
    ...STARTER_THEME_FILES.map((file) =>
      file.path === "src/components/Header.tsx"
        ? { path: file.path, content: HEADER_SOURCE }
        : { path: file.path, content: file.content },
    ),
    { path: "src/morph/link.tsx", content: THEME_LINK_SOURCE },
  ];
  const layout = createDefaultStorefrontLayoutDocument();
  const page = createDefaultStorefrontHomeDocument();
  const document_: StorefrontPageDocument = {
    ...page,
    sections: [{ ...layout.sections[0]!, props: {} }, ...page.sections],
  };
  const result = renderSafeThemeRoute({
    files,
    pathname: "/",
    document: document_,
  } as never);
  expect(result.diagnostics).toEqual([]);
  expect(result.success).toBe(true);
  return renderToStaticMarkup(result.node as never);
}

describe("a link component shared from outside components/", () => {
  it("renders at all", () => {
    expect(render()).toContain("Storefront navigation");
  });

  it("forwards the editor's field markers to the real element", () => {
    // Without this the entries render correctly and cannot be selected.
    const html = render();

    expect(html).toContain('data-storefront-field-path="items.0.label"');
    expect(html).toContain('data-storefront-field-path="items.2.label"');
    expect(html).toContain('data-storefront-field="cartLabel"');
  });

  it("forwards the className it is given", () => {
    expect(render()).toContain("hover:text-neutral-950");
  });

  it("picks the element per entry rather than for the whole list", () => {
    const html = render();
    const nav = html.slice(html.indexOf("<nav"), html.indexOf("</nav>"));

    // The address that leaves the store keeps its own target and rel; the
    // pages of this store go through the router.
    expect(nav).toContain('href="https://example.com/contact"');
    expect(nav).toContain('href="/products"');
  });
});
