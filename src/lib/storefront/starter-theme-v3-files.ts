export const LEGACY_STARTER_THEME_HERO_SOURCE = `export type HeroProps = {
  eyebrow?: string;
  heading?: string;
  description?: string;
  actionLabel?: string;
  actionHref?: string;
  actionTarget?: "_self" | "_blank";
  imageSrc?: string;
  imageAlt?: string;
};

export default function Hero({
  eyebrow = "New collection",
  heading = "Objects for everyday rituals.",
  description = "Quiet essentials, thoughtfully made for the spaces you call home.",
  actionLabel = "Explore the collection",
  actionHref = "/collections/new",
  actionTarget = "_self",
  imageSrc = "/static/storefront/theme-preview-default.png",
  imageAlt = "A neutral collection of ceramic objects",
}: HeroProps) {
  // A new tab must not hand the opened page a window.opener handle back to the
  // store, which it could use to redirect this tab to a spoofed page.
  const actionRel = actionTarget === "_blank" ? "noopener noreferrer" : undefined;
  return (
    <section
      className="grid min-h-[42rem] bg-stone-100 lg:min-h-[50rem] lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]"
    >
      <div className="flex items-center px-[clamp(1.75rem,6vw,6rem)] py-20">
        <div className="max-w-xl">
          <p
            className="text-xs font-medium uppercase tracking-[0.24em] text-stone-500"
          >
            {eyebrow}
          </p>
          <h1
            className="mt-6 font-serif text-[clamp(3.25rem,7vw,7rem)] leading-[0.88] tracking-[-0.055em] text-stone-950"
          >
            {heading}
          </h1>
          <p
            className="mt-7 max-w-md text-base leading-7 text-stone-600"
          >
            {description}
          </p>
          <div className="mt-8">
            <a
              href={actionHref}
              target={actionTarget}
              rel={actionRel}
              className="inline-flex items-center justify-center rounded-md bg-stone-900 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-stone-800"
            >
              {actionLabel}
            </a>
          </div>
        </div>
      </div>
      <div
        className="min-h-[30rem] overflow-hidden lg:min-h-0"
      >
        <img
          src={imageSrc}
          alt={imageAlt}
          className="size-full object-cover"
        />
      </div>
    </section>
  );
}
`;

export const LEGACY_STARTER_THEME_CATEGORY_SHOWCASE_SOURCE = `export type CategoryShowcaseItem = {
  title?: string;
  caption?: string;
  href?: string;
  imageSrc?: string;
  imageAlt?: string;
  imagePosition?: string;
};

export type CategoryShowcaseProps = {
  heading?: string;
  items?: CategoryShowcaseItem[];
};

export default function CategoryShowcase({
  heading = "Shop by collection",
  items = [],
}: CategoryShowcaseProps) {
  return (
    <section
      className="bg-stone-900 px-[clamp(1.25rem,4vw,4rem)] py-[clamp(5rem,9vw,9rem)] text-stone-100"
    >
      <div className="mb-12 flex items-end justify-between border-b border-stone-700 pb-6">
        <h2
          data-storefront-field="heading"
          className="font-serif text-[clamp(2.5rem,5vw,5rem)] tracking-[-0.04em]"
        >
          {heading}
        </h2>
        <span className="hidden text-xs uppercase tracking-[0.2em] text-stone-400 sm:block">
          The collection
        </span>
      </div>
      <div
        className="grid gap-4 lg:grid-cols-3"
      >
        {items.map((item, index) => (
          <a
            key={item.href ?? index}
            href={item.href ?? "#"}
            data-storefront-field-path={\`items.\${index}\`}
            className="group block border-t border-stone-700 pt-4 lg:border-t-0 lg:pt-0"
          >
            <div className="aspect-[4/5] overflow-hidden bg-stone-800">
              <img
                src={item.imageSrc ?? "/static/storefront/theme-preview-default.png"}
                alt={item.imageAlt ?? "Collection item"}
                style={{ objectPosition: item.imagePosition ?? "center" }}
                className="size-full object-cover opacity-80 transition-transform duration-500 ease-out group-hover:scale-[1.025]"
              />
            </div>
            <div className="flex gap-5 py-5">
              <span className="pt-1 text-xs text-stone-500">{index + 1}</span>
              <div>
                <h3
                  data-storefront-field-path={\`items.\${index}.title\`}
                  className="font-serif text-2xl"
                >
                  {item.title ?? "Collection"}
                </h3>
                <p
                  data-storefront-field-path={\`items.\${index}.caption\`}
                  className="mt-2 max-w-xs text-sm leading-6 text-stone-400"
                >
                  {item.caption ?? ""}
                </p>
              </div>
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}
`;

export const LEGACY_STARTER_THEME_IMAGE_WITH_TEXT_SOURCE = `export type ImageWithTextProps = {
  eyebrow?: string;
  heading?: string;
  body?: string;
  actionLabel?: string;
  actionHref?: string;
  actionTarget?: "_self" | "_blank";
  imageSrc?: string;
  imageAlt?: string;
  imagePosition?: string;
};

export default function ImageWithText({
  eyebrow = "",
  heading = "Story",
  body = "",
  actionLabel = "Explore",
  actionHref = "#",
  actionTarget = "_self",
  imageSrc = "/static/storefront/theme-preview-default.png",
  imageAlt = "Image with text",
  imagePosition = "center",
}: ImageWithTextProps) {
  // A new tab must not hand the opened page a window.opener handle back to the
  // store, which it could use to redirect this tab to a spoofed page.
  const actionRel = actionTarget === "_blank" ? "noopener noreferrer" : undefined;
  return (
    <section
      className="grid bg-[#d8d0c3] lg:grid-cols-2"
    >
      <div
        className="min-h-[32rem] overflow-hidden lg:min-h-[52rem]"
      >
        <img
          src={imageSrc}
          alt={imageAlt}
          style={{ objectPosition: imagePosition }}
          className="size-full scale-110 object-cover"
        />
      </div>
      <div className="flex items-center px-[clamp(2rem,7vw,7rem)] py-20">
        <div className="max-w-xl">
          <p
            data-storefront-field="eyebrow"
            className="text-xs font-medium uppercase tracking-[0.22em] text-stone-600"
          >
            {eyebrow}
          </p>
          <h2
            data-storefront-field="heading"
            className="mt-5 font-serif text-[clamp(3rem,5vw,5.5rem)] leading-[0.94] tracking-[-0.045em] text-stone-950"
          >
            {heading}
          </h2>
          <p
            data-storefront-field="body"
            className="mt-7 text-base leading-7 text-stone-700"
          >
            {body}
          </p>
          <a
            href={actionHref}
            target={actionTarget}
            rel={actionRel}
            data-storefront-field="actionLabel"
            className="mt-9 inline-flex border-b border-current pb-1 text-sm font-medium"
          >
            {actionLabel}
          </a>
        </div>
      </div>
    </section>
  );
}
`;

export const LEGACY_STARTER_THEME_HEADER_SOURCE = `export default function Header({ storeName = "Online Store" }: { storeName?: string }) {
  return (
    <header className="flex h-16 items-center justify-between border-b border-neutral-200 bg-stone-50 px-5 sm:px-8">
      <span className="font-serif text-lg font-semibold tracking-tight">
        {storeName}
      </span>
      <nav
        className="hidden items-center gap-7 text-xs text-neutral-600 sm:flex"
        aria-label="Storefront navigation"
      >
        <a href="/collections/all" className="hover:text-neutral-950">Shop</a>
        <a href="/pages/about" className="hover:text-neutral-950">About</a>
        <a href="/blogs/journal" className="hover:text-neutral-950">Journal</a>
      </nav>
      <a href="/cart" className="text-xs text-neutral-600 hover:text-neutral-950">
        Cart (0)
      </a>
    </header>
  );
}
`;

/**
 * Header of the generation that wrote its own field markers.
 *
 * Every `data-storefront-field` in it is one the platform now derives, so the
 * attributes said nothing the renderer could not work out — while making the
 * component look as though the editor required bookkeeping from its author.
 */
export const LEGACY_STARTER_THEME_HEADER_FIELD_MARKED_SOURCE = `export type HeaderLink = {
  href?: string;
  target?: "_self" | "_blank";
  rel?: string;
};

export type HeaderNavItem = {
  label?: string;
  link?: HeaderLink;
};

export type HeaderProps = {
  storeName?: string;
  navItems?: HeaderNavItem[];
  cartLabel?: string;
  cartLink?: HeaderLink;
};

export const contentFields = {
  storeName: { type: "text", label: "Store name", maxLength: 80 },
  navItems: {
    type: "array",
    label: "Navigation",
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
  navItems = [
    { label: "Shop", link: { href: "/collections/all" } },
    { label: "About", link: { href: "/pages/about" } },
    { label: "Journal", link: { href: "/blogs/journal" } },
  ],
  cartLabel = "Cart (0)",
  cartLink = { href: "/cart" },
}: HeaderProps) {
  return (
    <header
      className="flex h-16 items-center justify-between border-b border-neutral-200 bg-stone-50 px-5 sm:px-8"
    >
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
        {navItems.map((item, index) => (
          <a
            key={item.label}
            data-storefront-field="label"
            data-storefront-field-path={\`navItems.\${index}.label\`}
            href={item.link.href}
            target={item.link.target}
            rel={item.link.rel}
            className="hover:text-neutral-950"
          >
            {item.label}
          </a>
        ))}
      </nav>
      <a
        data-storefront-field="cartLabel"
        href={cartLink.href}
        target={cartLink.target}
        rel={cartLink.rel}
        className="text-xs text-neutral-600 hover:text-neutral-950"
      >
        {cartLabel}
      </a>
    </header>
  );
}
`;

/**
 * The shape a component's `contentFields` declaration has to take.
 *
 * Shipped as a type rather than left to documentation because the declaration
 * is validated where the workspace is read, not where it is written: a
 * mistyped key becomes a field that never appears, with nothing said at the
 * place that caused it. Declaring it against this puts the error under the
 * author's cursor instead.
 */
export const STARTER_THEME_CONTENT_FIELDS_TYPES_SOURCE = `/**
 * The shape of a component's \`contentFields\` declaration.
 *
 * A component states what an author may edit by exporting \`contentFields\`. The
 * platform validates that declaration when it reads the workspace, so a typo
 * in it becomes a field that silently never appears rather than an error where
 * it was written. Declaring the shape here moves that feedback into the editor:
 *
 * \`\`\`ts
 * export const contentFields = {
 *   heading: { type: "text", label: "Heading" },
 * } as const satisfies ThemeContentFields;
 * \`\`\`
 *
 * \`as const\` first, \`satisfies\` second: the assertion keeps the literal types
 * the component's own props can be derived from, and the check confirms the
 * shape without widening what was written.
 */

/** Text shown beside the control, and the hint under it. */
type Described = Readonly<{
  label?: string;
  description?: string;
}>;

/** A single line of text. */
export type ThemeTextContentField = Described &
  Readonly<{ type: "text"; maxLength?: number }>;

/** Several lines of text. */
export type ThemeTextareaContentField = Described &
  Readonly<{ type: "textarea"; maxLength?: number }>;

/**
 * A bare address, stored as the string the author typed.
 *
 * Prefer \`link\` for anything rendered as a link: it carries the target and the
 * rel alongside the address, which a plain string cannot.
 */
export type ThemeUrlContentField = Described &
  Readonly<{ type: "url"; maxLength?: number }>;

/**
 * A destination, with how to open it.
 *
 * One field rather than separate \`href\`, \`target\` and \`title\` keys: they are
 * one decision and are edited together, so a repeated row can hold a whole
 * link instead of coordinating several sibling keys.
 */
export type ThemeLinkContentField = Described & Readonly<{ type: "link" }>;

/** Where a media field may take its value from. */
type MediaSource = Readonly<{
  /** Allow an address typed by the author. Defaults to true. */
  allowExternal?: boolean;
  /** Allow a file chosen from the store's library. Defaults to true. */
  allowAsset?: boolean;
}>;

export type ThemeImageContentField = Described &
  MediaSource &
  Readonly<{ type: "image" }>;

export type ThemeVideoContentField = Described &
  MediaSource &
  Readonly<{ type: "video" }>;

export type ThemeNumberContentField = Described &
  Readonly<{
    type: "number";
    min?: number;
    max?: number;
    /** Must be greater than zero. */
    step?: number;
  }>;

export type ThemeBooleanContentField = Described & Readonly<{ type: "boolean" }>;

/** One choice offered by a \`select\`. Values must be unique within the field. */
export type ThemeSelectOption = Readonly<{ label: string; value: string }>;

export type ThemeSelectContentField = Described &
  Readonly<{ type: "select"; options: readonly ThemeSelectOption[] }>;

/**
 * Every field a repeated row may contain.
 *
 * A row may not itself contain a list. A list of lists cannot be presented so
 * that an author can tell which level they are editing, and nesting for layout
 * belongs in the component's TSX rather than in its content shape.
 */
export type ThemeScalarContentField =
  | ThemeTextContentField
  | ThemeTextareaContentField
  | ThemeUrlContentField
  | ThemeLinkContentField
  | ThemeImageContentField
  | ThemeVideoContentField
  | ThemeNumberContentField
  | ThemeBooleanContentField
  | ThemeSelectContentField;

type ArrayBounds = Readonly<{
  minRows?: number;
  /** At most 200. */
  maxRows?: number;
}>;

/**
 * A repeated group of fields — a menu, a list of cards, a set of FAQ entries.
 *
 * The row shape comes from exactly one place: \`fields\` when the row is written
 * in this same file, or \`of\` when it is a component of its own. Accepting both
 * would leave which one wins to be discovered by experiment.
 */
export type ThemeArrayContentField = Described &
  ArrayBounds &
  Readonly<{
    type: "array";
    /** Row shape declared here, keyed by field name. */
    fields: Readonly<Record<string, ThemeScalarContentField>>;
    of?: never;
  }>;

export type ThemeArrayOfComponentContentField = Described &
  ArrayBounds &
  Readonly<{
    type: "array";
    /** Relative path to the component that renders one row, e.g. \`"./Card"\`. */
    of: string;
    fields?: never;
  }>;

/** Any field a component may declare. */
export type ThemeContentField =
  | ThemeScalarContentField
  | ThemeArrayContentField
  | ThemeArrayOfComponentContentField;

/**
 * A whole \`contentFields\` declaration.
 *
 * Keys are the component's own prop names: a field named \`heading\` edits the
 * \`heading\` prop, and nothing has to be registered anywhere for the two to
 * meet. A name must start with a letter and hold only letters, digits and
 * underscores.
 */
export type ThemeContentFields = Readonly<Record<string, ThemeContentField>>;
`;

/**
 * The destination component every starter link goes through.
 *
 * Kept out of `components/` because it is not a section: nothing renders it as
 * a slot, and offering it in the section picker would present a link as a
 * thing a page can be built from.
 */
/**
 * The link component before it took responsibility for `rel`.
 *
 * It forwarded whatever `rel` the destination carried, which left every
 * component that offered a new tab to remember `noopener` on its own — and
 * the two starters that did remember were the reason the rule was invisible
 * everywhere else.
 */
export const LEGACY_STARTER_THEME_LINK_MODULE_SOURCE = `import type { AnchorHTMLAttributes } from "react";
import { Link } from "@tanstack/react-router";

/** A destination as the editor's link field stores it. */
export type ThemeLinkDestination = {
  href?: string;
  target?: "_self" | "_blank";
  rel?: string;
};

/**
 * Everything an anchor accepts, minus the three parts the destination owns.
 *
 * The component decides the element, so it decides how the address reaches it:
 * one of the two branches has no href at all. Leaving those three out of the
 * props is what stops a caller setting one directly and quietly disagreeing
 * with the destination beside it. Everything else — className, aria, a data
 * attribute the editor wants to override — is forwarded untouched.
 */
export type ThemeLinkProps = Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  "href" | "target" | "rel"
> & {
  link?: ThemeLinkDestination;
  [dataAttribute: \`data-\${string}\`]: unknown;
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

export const STARTER_THEME_LINK_MODULE_SOURCE = `import type { AnchorHTMLAttributes } from "react";
import { Link } from "@tanstack/react-router";

/** A destination as the editor's link field stores it. */
export type ThemeLinkDestination = {
  href?: string;
  target?: "_self" | "_blank";
  rel?: string;
};

/**
 * Everything an anchor accepts, minus the three parts the destination owns.
 *
 * The component decides the element, so it decides how the address reaches it:
 * one of the two branches has no href at all. Leaving those three out of the
 * props is what stops a caller setting one directly and quietly disagreeing
 * with the destination beside it. Everything else — className, aria, a data
 * attribute the editor wants to override — is forwarded untouched.
 */
export type ThemeLinkProps = Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  "href" | "target" | "rel"
> & {
  link?: ThemeLinkDestination | string;
  [dataAttribute: \`data-\${string}\`]: unknown;
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
  const destination = typeof link === "string" ? { href: link } : (link ?? {});
  const href = destination.href ?? "";
  const isExternal = href.startsWith("http://") || href.startsWith("https://");
  // A bare fragment is a position on this page, not a route. Handing it to the
  // router turns "jump to this section" into a navigation to a path that does
  // not exist, and an empty destination has nowhere to navigate at all.
  const isFragment = href === "" || href.startsWith("#");
  // The rel arrives already worked out: Morph derives it from the target and
  // the destination before the value reaches a component, so shipping an
  // unprotected new tab cannot depend on every theme remembering to add it.
  // Computing it a second time here appended a duplicate.
  return isExternal || isFragment ? (
    <a
      href={href}
      target={destination.target}
      rel={destination.rel}
      {...rest}
    >
      {children}
    </a>
  ) : (
    <Link
      to={href}
      target={destination.target}
      rel={destination.rel}
      {...rest}
    >
      {children}
    </Link>
  );
}
`;

export const STARTER_THEME_HEADER_SOURCE = `import type { ThemeContentFields } from "../morph/content-fields";
import ThemeLink from "../morph/link";

export type HeaderLink = {
  href?: string;
  target?: "_self" | "_blank";
  rel?: string;
};

export type HeaderNavItem = {
  label?: string;
  link?: HeaderLink;
};

export type HeaderProps = {
  storeName?: string;
  navItems?: HeaderNavItem[];
  cartLabel?: string;
  cartLink?: HeaderLink;
};

export const contentFields = {
  storeName: { type: "text", label: "Store name", maxLength: 80 },
  navItems: {
    type: "array",
    label: "Navigation",
    fields: {
      label: { type: "text", label: "Label", maxLength: 40 },
      link: { type: "link", label: "Destination" },
    },
  },
  cartLabel: { type: "text", label: "Cart label", maxLength: 40 },
  cartLink: { type: "link", label: "Cart link" },
} as const satisfies ThemeContentFields;

export default function Header({
  storeName = "Online Store",
  navItems = [
    { label: "Shop", link: { href: "/collections/all" } },
    { label: "About", link: { href: "/pages/about" } },
    { label: "Journal", link: { href: "/blogs/journal" } },
  ],
  cartLabel = "Cart (0)",
  cartLink = { href: "/cart" },
}: HeaderProps) {
  return (
    <header
      className="flex h-16 items-center justify-between border-b border-neutral-200 bg-stone-50 px-5 sm:px-8"
    >
      <span className="font-serif text-lg font-semibold tracking-tight">
        {storeName}
      </span>
      <nav
        className="hidden items-center gap-7 text-xs text-neutral-600 sm:flex"
        aria-label="Storefront navigation"
      >
        {navItems.map((item) => (
          <span key={item.label}>
            <ThemeLink link={item.link} className="hover:text-neutral-950">
              {item.label}
            </ThemeLink>
          </span>
        ))}
      </nav>
      <ThemeLink
        link={cartLink}
        className="text-xs text-neutral-600 hover:text-neutral-950"
      >
        {cartLabel}
      </ThemeLink>
    </header>
  );
}
`;

/**
 * Header shipped between the first starter and the content-fields rewrite.
 *
 * Recorded in both the shape Morph emitted it and the shape it takes once the
 * `data-morph-*` markers are gone, because the editor stopped needing those
 * attributes and workspaces on this generation hold one or the other. Matching
 * is byte-exact, so a generation missing from this list is a workspace the
 * Header upgrade can never reach — which is what left such a Theme with a
 * single editable field while every section had its own.
 */
export const LEGACY_STARTER_THEME_HEADER_MARKED_SOURCE = `export type HeaderProps = {
  storeName?: string;
};

export default function Header({ storeName = "Online Store" }: HeaderProps) {
  return (
    <header
      data-morph-section="header"
      data-morph-node="header-root"
      className="flex h-16 items-center justify-between border-b border-neutral-200 bg-stone-50 px-5 sm:px-8"
    >
      <span
        data-morph-node="header-brand"
        data-morph-element="brand"
        className="font-serif text-lg font-semibold tracking-tight"
      >
        {storeName}
      </span>
      <nav
        data-morph-node="header-navigation"
        data-morph-element="navigation"
        className="hidden items-center gap-7 text-xs text-neutral-600 sm:flex"
        aria-label="Storefront navigation"
      >
        <a href="/collections/all" className="hover:text-neutral-950">Shop</a>
        <a href="/pages/about" className="hover:text-neutral-950">About</a>
        <a href="/blogs/journal" className="hover:text-neutral-950">Journal</a>
      </nav>
      <a
        href="/cart"
        data-morph-node="header-cart"
        data-morph-element="action"
        className="text-xs text-neutral-600 hover:text-neutral-950"
      >
        Cart (0)
      </a>
    </header>
  );
}
`;

/** The same generation after the `data-morph-*` markers were removed. */
export const LEGACY_STARTER_THEME_HEADER_UNMARKED_SOURCE = `export type HeaderProps = {
  storeName?: string;
};

export default function Header({ storeName = "Online Store" }: HeaderProps) {
  return (
    <header
      className="flex h-16 items-center justify-between border-b border-neutral-200 bg-stone-50 px-5 sm:px-8"
    >
      <span
        className="font-serif text-lg font-semibold tracking-tight"
      >
        {storeName}
      </span>
      <nav
        className="hidden items-center gap-7 text-xs text-neutral-600 sm:flex"
        aria-label="Storefront navigation"
      >
        <a href="/collections/all" className="hover:text-neutral-950">Shop</a>
        <a href="/pages/about" className="hover:text-neutral-950">About</a>
        <a href="/blogs/journal" className="hover:text-neutral-950">Journal</a>
      </nav>
      <a
        href="/cart"
        className="text-xs text-neutral-600 hover:text-neutral-950"
      >
        Cart (0)
      </a>
    </header>
  );
}
`;

export const LEGACY_STARTER_THEME_FOOTER_SOURCE = `export default function Footer({ storeName = "Online Store" }: { storeName?: string }) {
  return (
    <footer className="grid gap-12 bg-stone-950 px-[clamp(1.75rem,6vw,6rem)] py-16 text-stone-300 sm:grid-cols-2 lg:grid-cols-[1.5fr_0.75fr_0.75fr]">
      <div>
        <p className="font-serif text-3xl text-stone-100">{storeName}</p>
        <p className="mt-4 max-w-xs text-sm leading-6 text-stone-500">
          Objects with lasting character for thoughtful, everyday living.
        </p>
      </div>
      <div className="text-sm leading-8">
        <p className="mb-2 text-xs uppercase tracking-[0.18em] text-stone-600">Explore</p>
        <a className="block hover:text-white" href="/collections/all">Shop all</a>
        <a className="block hover:text-white" href="/pages/about">Our story</a>
        <a className="block hover:text-white" href="/blogs/journal">Journal</a>
      </div>
      <div className="text-sm leading-8">
        <p className="mb-2 text-xs uppercase tracking-[0.18em] text-stone-600">Help</p>
        <a className="block hover:text-white" href="/pages/contact">Contact</a>
        <a className="block hover:text-white" href="/pages/shipping">Shipping</a>
        <a className="block hover:text-white" href="/pages/returns">Returns</a>
      </div>
    </footer>
  );
}
`;

/**
 * The footer before its links went through `ThemeLink`.
 *
 * It wrote each anchor by hand and read `item.link.href` directly, so a row
 * whose destination had been cleared took the whole footer down with it, and
 * every entry left the store through a plain `<a>` even when it pointed at a
 * page of this store.
 */
export const LEGACY_STARTER_THEME_FOOTER_MARKED_LINK_SOURCE = `export type FooterLink = {
  href?: string;
  target?: "_self" | "_blank";
  rel?: string;
};

export type FooterNavItem = {
  label?: string;
  link?: FooterLink;
};

export type FooterProps = {
  storeName?: string;
  copyrightText?: string;
  tagline?: string;
  exploreHeading?: string;
  exploreItems?: FooterNavItem[];
  helpHeading?: string;
  helpItems?: FooterNavItem[];
};

export const contentFields = {
  storeName: { type: "text", label: "Store name", maxLength: 80 },
  copyrightText: { type: "text", label: "Copyright text", maxLength: 120 },
  tagline: { type: "textarea", label: "Tagline", maxLength: 200 },
  exploreHeading: { type: "text", label: "Explore heading", maxLength: 40 },
  exploreItems: {
    type: "array",
    label: "Explore links",
    fields: {
      label: { type: "text", label: "Label", maxLength: 40 },
      link: { type: "link", label: "Destination" },
    },
  },
  helpHeading: { type: "text", label: "Help heading", maxLength: 40 },
  helpItems: {
    type: "array",
    label: "Help links",
    fields: {
      label: { type: "text", label: "Label", maxLength: 40 },
      link: { type: "link", label: "Destination" },
    },
  },
} as const;

export default function Footer({
  storeName = "Online Store",
  copyrightText = "© Online Store",
  tagline = "Objects with lasting character for thoughtful, everyday living.",
  exploreHeading = "Explore",
  exploreItems = [
    { label: "Shop all", link: { href: "/collections/all" } },
    { label: "Our story", link: { href: "/pages/about" } },
    { label: "Journal", link: { href: "/blogs/journal" } },
  ],
  helpHeading = "Help",
  helpItems = [
    { label: "Contact", link: { href: "/pages/contact" } },
    { label: "Shipping", link: { href: "/pages/shipping" } },
    { label: "Returns", link: { href: "/pages/returns" } },
  ],
}: FooterProps) {
  return (
    <footer
      className="grid gap-12 bg-stone-950 px-[clamp(1.75rem,6vw,6rem)] py-16 text-stone-300 sm:grid-cols-2 lg:grid-cols-[1.5fr_0.75fr_0.75fr]"
    >
      <div>
        <p data-storefront-field="storeName" className="font-serif text-3xl text-stone-100">{storeName}</p>
        <p data-storefront-field="tagline" className="mt-4 max-w-xs text-sm leading-6 text-stone-500">
          {tagline}
        </p>
      </div>
      <div
        className="text-sm leading-8"
      >
        <p data-storefront-field="exploreHeading" className="mb-2 text-xs uppercase tracking-[0.18em] text-stone-600">{exploreHeading}</p>
        {exploreItems.map((item, index) => (
          <a
            key={item.label}
            data-storefront-field="label"
            data-storefront-field-path={\`exploreItems.\${index}.label\`}
            className="block hover:text-white"
            href={item.link.href}
            target={item.link.target}
            rel={item.link.rel}
          >
            {item.label}
          </a>
        ))}
      </div>
      <div
        className="text-sm leading-8"
      >
        <p data-storefront-field="helpHeading" className="mb-2 text-xs uppercase tracking-[0.18em] text-stone-600">{helpHeading}</p>
        {helpItems.map((item, index) => (
          <a
            key={item.label}
            data-storefront-field="label"
            data-storefront-field-path={\`helpItems.\${index}.label\`}
            className="block hover:text-white"
            href={item.link.href}
            target={item.link.target}
            rel={item.link.rel}
          >
            {item.label}
          </a>
        ))}
      </div>
      <div
        data-storefront-field="copyrightText"
        className="border-t border-stone-800 pt-6 text-xs text-stone-600 sm:col-span-2 lg:col-span-3"
      >
        {copyrightText}
      </div>
    </footer>
  );
}
`;

export const STARTER_THEME_FOOTER_SOURCE = `import type { ThemeContentFields } from "../morph/content-fields";
import ThemeLink from "../morph/link";

export type FooterLink = {
  href?: string;
  target?: "_self" | "_blank";
  rel?: string;
};

export type FooterNavItem = {
  label?: string;
  link?: FooterLink | string;
};

export type FooterProps = {
  storeName?: string;
  copyrightText?: string;
  tagline?: string;
  exploreHeading?: string;
  exploreItems?: FooterNavItem[];
  helpHeading?: string;
  helpItems?: FooterNavItem[];
};

export const contentFields = {
  storeName: { type: "text", label: "Store name", maxLength: 80 },
  copyrightText: { type: "text", label: "Copyright text", maxLength: 120 },
  tagline: { type: "textarea", label: "Tagline", maxLength: 200 },
  exploreHeading: { type: "text", label: "Explore heading", maxLength: 40 },
  exploreItems: {
    type: "array",
    label: "Explore links",
    fields: {
      label: { type: "text", label: "Label", maxLength: 40 },
      link: { type: "link", label: "Destination" },
    },
  },
  helpHeading: { type: "text", label: "Help heading", maxLength: 40 },
  helpItems: {
    type: "array",
    label: "Help links",
    fields: {
      label: { type: "text", label: "Label", maxLength: 40 },
      link: { type: "link", label: "Destination" },
    },
  },
} as const satisfies ThemeContentFields;

export default function Footer({
  storeName = "Online Store",
  copyrightText = "© Online Store",
  tagline = "Objects with lasting character for thoughtful, everyday living.",
  exploreHeading = "Explore",
  exploreItems = [
    { label: "Shop all", link: { href: "/collections/all" } },
    { label: "Our story", link: { href: "/pages/about" } },
    { label: "Journal", link: { href: "/blogs/journal" } },
  ],
  helpHeading = "Help",
  helpItems = [
    { label: "Contact", link: { href: "/pages/contact" } },
    { label: "Shipping", link: { href: "/pages/shipping" } },
    { label: "Returns", link: { href: "/pages/returns" } },
  ],
}: FooterProps) {
  return (
    <footer className="grid gap-12 bg-stone-950 px-[clamp(1.75rem,6vw,6rem)] py-16 text-stone-300 sm:grid-cols-2 lg:grid-cols-[1.5fr_0.75fr_0.75fr]">
      <div>
        <p className="font-serif text-3xl text-stone-100">{storeName}</p>
        <p className="mt-4 max-w-xs text-sm leading-6 text-stone-500">
          {tagline}
        </p>
      </div>
      <div className="text-sm leading-8">
        <p className="mb-2 text-xs uppercase tracking-[0.18em] text-stone-600">
          {exploreHeading}
        </p>
        {exploreItems.map((item, index) => (
          <ThemeLink
            key={index}
            link={item.link}
            className="block hover:text-white"
          >
            {item.label}
          </ThemeLink>
        ))}
      </div>
      <div className="text-sm leading-8">
        <p className="mb-2 text-xs uppercase tracking-[0.18em] text-stone-600">
          {helpHeading}
        </p>
        {helpItems.map((item, index) => (
          <ThemeLink
            key={index}
            link={item.link}
            className="block hover:text-white"
          >
            {item.label}
          </ThemeLink>
        ))}
      </div>
      <div className="border-t border-stone-800 pt-6 text-xs text-stone-600 sm:col-span-2 lg:col-span-3">
        {copyrightText}
      </div>
    </footer>
  );
}
`;

/** Footer of the same generation as the marked Header above. */
export const LEGACY_STARTER_THEME_FOOTER_MARKED_SOURCE = `export type FooterProps = {
  storeName?: string;
  copyrightText?: string;
};

export default function Footer({
  storeName = "Online Store",
  copyrightText = "© Online Store",
}: FooterProps) {
  return (
    <footer
      data-morph-section="footer"
      data-morph-node="footer-root"
      className="grid gap-12 bg-stone-950 px-[clamp(1.75rem,6vw,6rem)] py-16 text-stone-300 sm:grid-cols-2 lg:grid-cols-[1.5fr_0.75fr_0.75fr]"
    >
      <div data-morph-node="footer-brand" data-morph-element="content">
        <p className="font-serif text-3xl text-stone-100">{storeName}</p>
        <p className="mt-4 max-w-xs text-sm leading-6 text-stone-500">
          Objects with lasting character for thoughtful, everyday living.
        </p>
      </div>
      <div
        data-morph-node="footer-explore"
        data-morph-element="navigation"
        className="text-sm leading-8"
      >
        <p className="mb-2 text-xs uppercase tracking-[0.18em] text-stone-600">Explore</p>
        <a className="block hover:text-white" href="/collections/all">Shop all</a>
        <a className="block hover:text-white" href="/pages/about">Our story</a>
        <a className="block hover:text-white" href="/blogs/journal">Journal</a>
      </div>
      <div
        data-morph-node="footer-help"
        data-morph-element="navigation"
        className="text-sm leading-8"
      >
        <p className="mb-2 text-xs uppercase tracking-[0.18em] text-stone-600">Help</p>
        <a className="block hover:text-white" href="/pages/contact">Contact</a>
        <a className="block hover:text-white" href="/pages/shipping">Shipping</a>
        <a className="block hover:text-white" href="/pages/returns">Returns</a>
      </div>
      <div
        data-morph-node="footer-copyright"
        data-morph-element="text"
        className="border-t border-stone-800 pt-6 text-xs text-stone-600 sm:col-span-2 lg:col-span-3"
      >
        {copyrightText}
      </div>
    </footer>
  );
}
`;

/** The same generation after the `data-morph-*` markers were removed. */
export const LEGACY_STARTER_THEME_FOOTER_UNMARKED_SOURCE = `export type FooterProps = {
  storeName?: string;
  copyrightText?: string;
};

export default function Footer({
  storeName = "Online Store",
  copyrightText = "© Online Store",
}: FooterProps) {
  return (
    <footer
      className="grid gap-12 bg-stone-950 px-[clamp(1.75rem,6vw,6rem)] py-16 text-stone-300 sm:grid-cols-2 lg:grid-cols-[1.5fr_0.75fr_0.75fr]"
    >
      <div>
        <p className="font-serif text-3xl text-stone-100">{storeName}</p>
        <p className="mt-4 max-w-xs text-sm leading-6 text-stone-500">
          Objects with lasting character for thoughtful, everyday living.
        </p>
      </div>
      <div
        className="text-sm leading-8"
      >
        <p className="mb-2 text-xs uppercase tracking-[0.18em] text-stone-600">Explore</p>
        <a className="block hover:text-white" href="/collections/all">Shop all</a>
        <a className="block hover:text-white" href="/pages/about">Our story</a>
        <a className="block hover:text-white" href="/blogs/journal">Journal</a>
      </div>
      <div
        className="text-sm leading-8"
      >
        <p className="mb-2 text-xs uppercase tracking-[0.18em] text-stone-600">Help</p>
        <a className="block hover:text-white" href="/pages/contact">Contact</a>
        <a className="block hover:text-white" href="/pages/shipping">Shipping</a>
        <a className="block hover:text-white" href="/pages/returns">Returns</a>
      </div>
      <div
        className="border-t border-stone-800 pt-6 text-xs text-stone-600 sm:col-span-2 lg:col-span-3"
      >
        {copyrightText}
      </div>
    </footer>
  );
}
`;

export const LEGACY_STARTER_THEME_INDEX_SOURCE = `import Header from "../components/Header";
import Hero from "../components/Hero";
import Footer from "../components/Footer";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-stone-50 text-neutral-950">
      <Header />
      <main>
        <Hero />
      </main>
      <Footer />
    </div>
  );
}
`;

export const STARTER_THEME_INDEX_SOURCE = `import type { ReactNode } from "react";
import Header from "../components/Header";
import Footer from "../components/Footer";

export type HomePageProps = {
  storeName?: string;
  copyrightText?: string;
  children?: ReactNode;
};

export default function HomePage({
  storeName = "Online Store",
  copyrightText = "© Online Store",
  children,
}: HomePageProps) {
  return (
    <div
      className="min-h-screen bg-stone-50 text-neutral-950"
    >
      <Header storeName={storeName} />
      {children}
      <Footer storeName={storeName} copyrightText={copyrightText} />
    </div>
  );
}
`;

/**
 * Layout of the same generation, still carrying the `data-morph-*` markers.
 * `STARTER_THEME_INDEX_SOURCE` is the same file once they were removed.
 */
export const LEGACY_STARTER_THEME_LAYOUT_MARKED_SOURCE = `import type { ReactNode } from "react";
import Header from "../components/Header";
import Footer from "../components/Footer";

export type HomePageProps = {
  storeName?: string;
  copyrightText?: string;
  children?: ReactNode;
};

export default function HomePage({
  storeName = "Online Store",
  copyrightText = "© Online Store",
  children,
}: HomePageProps) {
  return (
    <div
      data-morph-node="page-root"
      className="min-h-screen bg-stone-50 text-neutral-950"
    >
      <Header storeName={storeName} />
      {children}
      <Footer storeName={storeName} copyrightText={copyrightText} />
    </div>
  );
}
`;

/**
 * The shell that let the two components own their defaults but gave the
 * author nowhere to store an edit. Kept so it can be recognised and replaced.
 */
export const LEGACY_STARTER_THEME_LAYOUT_PROPLESS_SOURCE = `import type { ReactNode } from "react";
import Header from "../components/Header";
import Footer from "../components/Footer";

export type StorefrontLayoutProps = {
  children?: ReactNode;
};

export default function StorefrontLayout({ children }: StorefrontLayoutProps) {
  return (
    <div className="min-h-screen bg-stone-50 text-neutral-950">
      <Header />
      {children}
      <Footer />
    </div>
  );
}
`;

/**
 * The page shell every route renders inside.
 *
 * Header and footer content reaches the components the same way a section's
 * does — through a slot the Document holds — so one editor, one store and one
 * publish path serve all of it. The shell owning its own `storeName` came
 * first and was worse twice over: the call-site attribute beat the default
 * props the inspector patches, and source defaults cannot hold a list or a
 * link at all.
 */
export const STARTER_THEME_LAYOUT_SOURCE = `import type { ReactNode } from "react";
import { content } from "../morph/content";
import Header from "../components/Header";
import Footer from "../components/Footer";

export type StorefrontLayoutProps = {
  children?: ReactNode;
};

export default function StorefrontLayout({ children }: StorefrontLayoutProps) {
  return (
    <div className="min-h-screen bg-stone-50 text-neutral-950">
      <Header {...content("starter-header")} />
      {children}
      <Footer {...content("starter-footer")} />
    </div>
  );
}
`;

/**
 * Root route emitted before the Theme owned its own document shell.
 *
 * It renders only the layout, so a build using it produces SSR output with no
 * <html>, no <head> and no stylesheet link — the editor preview still looks
 * correct because that shell is platform-generated, while production would
 * serve an unstyled fragment. Kept verbatim so an untouched copy can be
 * upgraded and an edited one left alone.
 */
export const LEGACY_STARTER_THEME_ROOT_ROUTE_SOURCE = `import { Outlet, createRootRoute } from "@tanstack/react-router";
import StorefrontLayout from "../layouts/StorefrontLayout";

export const Route = createRootRoute({
  component: RootRoute,
});

function RootRoute() {
  return (
    <StorefrontLayout>
      <Outlet />
    </StorefrontLayout>
  );
}
`;

/**
 * Root route emitted before published content reached the runtime.
 *
 * It renders the document shell but never loads slot values, so an edited
 * heading stayed in the Document and the site kept showing component defaults.
 * Kept verbatim so an untouched copy can be upgraded and an edited one left
 * alone.
 */
export const LEGACY_STARTER_THEME_ROOT_ROUTE_CONTENTLESS_SOURCE = `import type { ReactNode } from "react";
import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import StorefrontLayout from "../layouts/StorefrontLayout";
import "../styles/global.css";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Online Store" },
    ],
  }),
  component: RootComponent,
  shellComponent: RootDocument,
});

function RootComponent() {
  return (
    <StorefrontLayout>
      <Outlet />
    </StorefrontLayout>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
`;

export const STARTER_THEME_ROOT_ROUTE_SOURCE = `import type { ReactNode } from "react";
import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import { MorphContentProvider, loadContentSlots } from "../morph/content";
import StorefrontLayout from "../layouts/StorefrontLayout";
import "../styles/global.css";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Online Store" },
    ],
  }),
  // Runs on the server during SSR and its result is serialized to the client,
  // so every route below reads published content without fetching it again.
  beforeLoad: async ({ location }) => ({
    morphContent: await loadContentSlots(location.pathname),
  }),
  component: RootComponent,
  shellComponent: RootDocument,
});

function RootComponent() {
  const { morphContent } = Route.useRouteContext();
  return (
    <MorphContentProvider value={morphContent}>
      <StorefrontLayout>
        <Outlet />
      </StorefrontLayout>
    </MorphContentProvider>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
`;

export const STARTER_THEME_ROUTER_SOURCE = `import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
`;

export const LEGACY_STARTER_THEME_HOME_ROUTE_SOURCE = `import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: HomeRoute,
});

function HomeRoute() {
  return <main />;
}
`;

export const LEGACY_STARTER_THEME_STOREFRONT_PAGE_ROUTE_SOURCE = `import { createFileRoute } from "@tanstack/react-router";
import { StorefrontPage } from "@morph/storefront-runtime";

export const Route = createFileRoute("/")({
  component: HomeRoute,
});

function HomeRoute() {
  return <StorefrontPage />;
}
`;

/**
 * Home route emitted before content slots existed.
 *
 * It renders each section with no props, so authored content in the Page
 * Document could never reach the component. Kept verbatim so an untouched copy
 * can be upgraded and an edited one left alone.
 */
/**
 * The slot-bound home route before sections could be hidden.
 *
 * Renders every section unconditionally, so hiding one in the editor still
 * published the component with its own defaults. Listed here so an existing
 * workspace on this exact source is upgraded — matching only the older legacy
 * shapes left every theme created since then stuck with it.
 */
export const LEGACY_STARTER_THEME_HOME_ROUTE_ALWAYS_VISIBLE_SOURCE = `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import CategoryShowcase from "../components/CategoryShowcase";
import EditorialIntro from "../components/EditorialIntro";
import Hero from "../components/Hero";
import ImageWithText from "../components/ImageWithText";
import Newsletter from "../components/Newsletter";
import Principles from "../components/Principles";

export const Route = createFileRoute("/")({
  component: HomeRoute,
});

function HomeRoute() {
  return (
    <main>
      <Hero {...content("starter-hero")} />
      <EditorialIntro {...content("starter-introduction")} />
      <CategoryShowcase {...content("starter-categories")} />
      <ImageWithText {...content("starter-story")} />
      <Principles {...content("starter-principles")} />
      <Newsletter {...content("starter-newsletter")} />
    </main>
  );
}
`;
export const LEGACY_STARTER_THEME_CONTENT_MODULE_V12_SOURCE = `import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createContext, useContext } from "react";

export type MorphContentSlots = Record<string, Record<string, unknown>>;

const MorphContentContext = createContext<MorphContentSlots>({});

export const MorphContentProvider = MorphContentContext.Provider;

/** Reads the stored values for one content slot. */
export function content(slotId: string): Record<string, unknown> {
  const slots = useContext(MorphContentContext);
  return slots[slotId] ?? {};
}

/**
 * Loads the published content for one route.
 *
 * The server branch is the only one that touches the request; Start strips it
 * from the client bundle, which is what keeps the server-only import out of
 * client code. The client branch returns nothing because the root route has
 * already serialized the server's answer into the router context.
 *
 * Morph Core owns the answer \u2014 only it knows which release is active \u2014 so
 * this asks it back on the origin it forwarded the request from, rather than
 * reading any store directly. Every failure degrades to defaults: content must
 * never be able to take the storefront down.
 */
export const loadContentSlots = createIsomorphicFn()
  .client(async (_pathname: string): Promise<MorphContentSlots> => ({}))
  .server(async (pathname: string): Promise<MorphContentSlots> => {
    try {
      const request = getRequest();
      const origin = request.headers.get("x-morph-content-origin");
      if (!origin) return {};
      const response = await fetch(
        origin + "/_morph/content?path=" + encodeURIComponent(pathname),
        { headers: { accept: "application/json" } },
      );
      if (!response.ok) return {};
      const payload = (await response.json()) as { slots?: MorphContentSlots };
      return payload?.slots ?? {};
    } catch {
      return {};
    }
  });
`;

export const LEGACY_STARTER_THEME_HOME_ROUTE_SLOTLESS_SOURCE = `import { createFileRoute } from "@tanstack/react-router";
import CategoryShowcase from "../components/CategoryShowcase";
import EditorialIntro from "../components/EditorialIntro";
import Hero from "../components/Hero";
import ImageWithText from "../components/ImageWithText";
import Newsletter from "../components/Newsletter";
import Principles from "../components/Principles";

export const Route = createFileRoute("/")({
  component: HomeRoute,
});

function HomeRoute() {
  return (
    <main>
      <Hero />
      <EditorialIntro />
      <CategoryShowcase />
      <ImageWithText />
      <Principles />
      <Newsletter />
    </main>
  );
}
`;

/**
 * Platform-provided content access for a Theme.
 *
 * `content("slot")` is the single binding between authored structure and stored
 * values: the route declares which slots exist and in what order, and the Page
 * Document holds only their values. Nothing has to be registered for a
 * customer-written component to become editable.
 *
 * Slot values are supplied by the platform at render time, so a Theme never
 * reads storage itself.
 */
/**
 * Content module before published content could reach the rendered Theme.
 *
 * Kept so the bootstrap upgrade can recognise an untouched copy and replace it.
 * An authored copy is left alone.
 */
export const LEGACY_STARTER_THEME_CONTENT_MODULE_SOURCE = `import { createContext, useContext } from "react";

export type MorphContentSlots = Record<string, Record<string, unknown>>;

const MorphContentContext = createContext<MorphContentSlots>({});

export const MorphContentProvider = MorphContentContext.Provider;

/** Reads the stored values for one content slot. */
export function content(slotId: string): Record<string, unknown> {
  const slots = useContext(MorphContentContext);
  return slots[slotId] ?? {};
}
`;

export const LEGACY_STARTER_THEME_CONTENT_MODULE_V13_SOURCE = `import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createContext, useContext } from "react";

export type MorphContentSlots = Record<string, Record<string, unknown>>;

export type MorphContent = {
  slots: MorphContentSlots;
  /** Sections the author hid. Absent slots are not the same thing. */
  hiddenSlots: string[];
};

const MorphContentContext = createContext<MorphContent>({
  slots: {},
  hiddenSlots: [],
});

export const MorphContentProvider = MorphContentContext.Provider;

/** Reads the stored values for one content slot. */
export function content(slotId: string): Record<string, unknown> {
  return useContext(MorphContentContext).slots[slotId] ?? {};
}

/**
 * Whether the author hid this section.
 *
 * Spreading props cannot cancel a render, so the route has to ask. A slot with
 * no stored values is not hidden — it just has none, and the component's
 * defaults are the right answer for it.
 */
export function isSectionHidden(slotId: string): boolean {
  return useContext(MorphContentContext).hiddenSlots.includes(slotId);
}

/**
 * Loads the published content for one route.
 *
 * The server branch is the only one that touches the request; Start strips it
 * from the client bundle, which is what keeps the server-only import out of
 * client code. The client branch returns nothing because the root route has
 * already serialized the server's answer into the router context.
 *
 * Morph Core owns the answer \u2014 only it knows which release is active \u2014 so
 * this asks it back on the origin it forwarded the request from, rather than
 * reading any store directly. Every failure degrades to defaults: content must
 * never be able to take the storefront down.
 */
/** Every degradation path returns this, so callers never see a partial shape. */
const EMPTY_CONTENT: MorphContent = { slots: {}, hiddenSlots: [] };

export const loadContentSlots = createIsomorphicFn()
  .client(async (_pathname: string): Promise<MorphContent> => EMPTY_CONTENT)
  .server(async (pathname: string): Promise<MorphContent> => {
    try {
      const request = getRequest();
      const origin = request.headers.get("x-morph-content-origin");
      if (!origin) return EMPTY_CONTENT;
      const response = await fetch(
        origin + "/_morph/content?path=" + encodeURIComponent(pathname),
        { headers: { accept: "application/json" } },
      );
      if (!response.ok) return EMPTY_CONTENT;
      const payload = (await response.json()) as {
        slots?: MorphContentSlots;
        hiddenSlots?: string[];
      };
      return {
        slots: payload?.slots ?? {},
        hiddenSlots: payload?.hiddenSlots ?? [],
      };
    } catch {
      return EMPTY_CONTENT;
    }
  });
`;

export const STARTER_THEME_CONTENT_MODULE_SOURCE = `import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createContext, useContext } from "react";

export type MorphContentSlots = Record<string, Record<string, unknown>>;

export type MorphContent = {
  slots: MorphContentSlots;
  /** Sections the author hid. Absent slots are not the same thing. */
  hiddenSlots: string[];
};

const MorphContentContext = createContext<MorphContent>({
  slots: {},
  hiddenSlots: [],
});

export const MorphContentProvider = MorphContentContext.Provider;

/** Reads the stored values for one content slot. */
export function content(slotId: string): Record<string, unknown> {
  return useContext(MorphContentContext).slots[slotId] ?? {};
}

/**
 * Whether the author hid this section.
 *
 * Spreading props cannot cancel a render, so the route has to ask. A slot with
 * no stored values is not hidden — it just has none, and the component's
 * defaults are the right answer for it.
 */
export function isSectionHidden(slotId: string): boolean {
  return useContext(MorphContentContext).hiddenSlots.includes(slotId);
}

/**
 * Loads the published content for one route.
 *
 * The server branch is the only one that touches the request; Start strips it
 * from the client bundle, which is what keeps the server-only import out of
 * client code. Client navigation fetches the destination route's public content;
 * an error must not silently replace authored values/visibility with defaults.
 *
 * Morph Core owns the answer \u2014 only it knows which release is active \u2014 so
 * this asks it back on the origin it forwarded the request from, rather than
 * reading any store directly. Every failure degrades to defaults: content must
 * never be able to take the storefront down.
 */
/** Every degradation path returns this, so callers never see a partial shape. */
const EMPTY_CONTENT: MorphContent = { slots: {}, hiddenSlots: [] };

export const loadContentSlots = createIsomorphicFn()
  .client(async (pathname: string): Promise<MorphContent> => {
    const response = await fetch(
      "/_morph/content?path=" + encodeURIComponent(pathname),
      { headers: { accept: "application/json" }, credentials: "omit", signal: AbortSignal.timeout(15_000) },
    );
    if (!response.ok) throw new Error("Published content is temporarily unavailable.");
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object"
      || !("slots" in payload) || !payload.slots || typeof payload.slots !== "object" || Array.isArray(payload.slots)
      || !("hiddenSlots" in payload) || !Array.isArray(payload.hiddenSlots)
      || !payload.hiddenSlots.every((slot: unknown) => typeof slot === "string")) {
      throw new Error("Invalid published content response.");
    }
    return { slots: payload.slots as MorphContentSlots, hiddenSlots: payload.hiddenSlots as string[] };
  })
  .server(async (pathname: string): Promise<MorphContent> => {
    try {
      const request = getRequest();
      const origin = request.headers.get("x-morph-content-origin");
      if (!origin) return EMPTY_CONTENT;
      const response = await fetch(
        origin + "/_morph/content?path=" + encodeURIComponent(pathname),
        { headers: { accept: "application/json" } },
      );
      if (!response.ok) return EMPTY_CONTENT;
      const payload = (await response.json()) as {
        slots?: MorphContentSlots;
        hiddenSlots?: string[];
      };
      return {
        slots: payload?.slots ?? {},
        hiddenSlots: payload?.hiddenSlots ?? [],
      };
    } catch {
      return EMPTY_CONTENT;
    }
  });
`;

export const STARTER_THEME_HOME_ROUTE_SOURCE = `import { createFileRoute } from "@tanstack/react-router";
import { content, isSectionHidden } from "../morph/content";
import CategoryShowcase from "../components/CategoryShowcase";
import EditorialIntro from "../components/EditorialIntro";
import Hero from "../components/Hero";
import ImageWithText from "../components/ImageWithText";
import Newsletter from "../components/Newsletter";
import Principles from "../components/Principles";

export const Route = createFileRoute("/")({
  component: HomeRoute,
});

function HomeRoute() {
  return (
    <main>
      {!isSectionHidden("starter-hero") && <Hero {...content("starter-hero")} />}
      {!isSectionHidden("starter-introduction") && (
        <EditorialIntro {...content("starter-introduction")} />
      )}
      {!isSectionHidden("starter-categories") && (
        <CategoryShowcase {...content("starter-categories")} />
      )}
      {!isSectionHidden("starter-story") && (
        <ImageWithText {...content("starter-story")} />
      )}
      {!isSectionHidden("starter-principles") && (
        <Principles {...content("starter-principles")} />
      )}
      {!isSectionHidden("starter-newsletter") && (
        <Newsletter {...content("starter-newsletter")} />
      )}
    </main>
  );
}
`;

export const STARTER_THEME_V4_NEW_FILES = [
  {
    path: "src/morph/content.ts",
    mimeType: "text/typescript",
    content: STARTER_THEME_CONTENT_MODULE_SOURCE,
  },
  {
    path: "src/router.tsx",
    mimeType: "text/typescript",
    content: STARTER_THEME_ROUTER_SOURCE,
  },
  {
    path: "src/layouts/StorefrontLayout.tsx",
    mimeType: "text/typescript",
    content: STARTER_THEME_LAYOUT_SOURCE,
  },
  {
    path: "src/routes/__root.tsx",
    mimeType: "text/typescript",
    content: STARTER_THEME_ROOT_ROUTE_SOURCE,
  },
  {
    path: "src/routes/index.tsx",
    mimeType: "text/typescript",
    content: STARTER_THEME_HOME_ROUTE_SOURCE,
    isEntry: true,
  },
] as const;

/**
 * The card grid before a row's destination became one `link` field.
 *
 * Each row held a bare `href` string, so a row could not carry the target
 * and rel that belong to the same decision, and the anchor was written by
 * hand rather than left to `ThemeLink`.
 */
export const LEGACY_STARTER_THEME_CATEGORY_SHOWCASE_URL_FIELD_SOURCE = `export type CategoryShowcaseItem = {
  title?: string;
  caption?: string;
  href?: string;
  image?: { src?: string; alt?: string };
  /** Read-only compatibility for documents created before image was grouped. */
  imageSrc?: string;
  imageAlt?: string;
  imagePosition?: string;
};

export type CategoryShowcaseProps = {
  heading?: string;
  items?: CategoryShowcaseItem[];
};

export const contentFields = {
  heading: { type: "text", label: "Heading", maxLength: 200 },
  items: {
    type: "array",
    label: "Collections",
    fields: {
      title: { type: "text", label: "Title", maxLength: 150 },
      caption: { type: "textarea", label: "Caption", maxLength: 300 },
      href: { type: "url", label: "Link" },
      image: { type: "image", label: "Image" },
      imagePosition: { type: "text", label: "Image position", maxLength: 100 },
    },
  },
} as const;

export default function CategoryShowcase({
  heading = "Shop by collection",
  items = [],
}: CategoryShowcaseProps) {
  return (
    <section
      className="bg-stone-900 px-[clamp(1.25rem,4vw,4rem)] py-[clamp(5rem,9vw,9rem)] text-stone-100"
    >
      <div className="mb-12 flex items-end justify-between border-b border-stone-700 pb-6">
        <h2
          data-storefront-field="heading"
          className="font-serif text-[clamp(2.5rem,5vw,5rem)] tracking-[-0.04em]"
        >
          {heading}
        </h2>
        <span className="hidden text-xs uppercase tracking-[0.2em] text-stone-400 sm:block">
          The collection
        </span>
      </div>
      <div
        className="grid gap-4 lg:grid-cols-3"
      >
        {items.map((item, index) => (
          <a
            key={item.href ?? index}
            href={item.href ?? "#"}
            data-storefront-field-path={\`items.\${index}\`}
            className="group block border-t border-stone-700 pt-4 lg:border-t-0 lg:pt-0"
          >
            <div className="aspect-[4/5] overflow-hidden bg-stone-800">
              <img
                data-storefront-field="image"
                data-storefront-field-path={\`items.\${index}.image\`}
                src={item.image?.src ?? item.imageSrc ?? "/static/storefront/theme-preview-default.png"}
                alt={item.image?.alt ?? item.imageAlt ?? "Collection item"}
                style={{ objectPosition: item.imagePosition ?? "center" }}
                className="size-full object-cover opacity-80 transition-transform duration-500 ease-out group-hover:scale-[1.025]"
              />
            </div>
            <div className="flex gap-5 py-5">
              <span className="pt-1 text-xs text-stone-500">{index + 1}</span>
              <div>
                <h3
                  data-storefront-field-path={\`items.\${index}.title\`}
                  className="font-serif text-2xl"
                >
                  {item.title ?? "Collection"}
                </h3>
                <p
                  data-storefront-field-path={\`items.\${index}.caption\`}
                  className="mt-2 max-w-xs text-sm leading-6 text-stone-400"
                >
                  {item.caption ?? ""}
                </p>
              </div>
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}
`;

/**
 * The split section before its destination became one `link` field.
 *
 * It carried `actionHref` and `actionTarget` as separate props and derived
 * `rel` itself, which is the duplication `ThemeLink` now holds once.
 */
export const LEGACY_STARTER_THEME_IMAGE_WITH_TEXT_URL_FIELD_SOURCE = `export type ImageWithTextProps = {
  eyebrow?: string;
  heading?: string;
  body?: string;
  actionLabel?: string;
  actionHref?: string;
  actionTarget?: "_self" | "_blank";
  image?: { src?: string; alt?: string };
  /** Read-only compatibility for documents created before image was grouped. */
  imageSrc?: string;
  imageAlt?: string;
  imagePosition?: string;
};

export const contentFields = {
  eyebrow: { type: "text", label: "Eyebrow", maxLength: 100 },
  heading: { type: "text", label: "Heading", maxLength: 200 },
  body: { type: "textarea", label: "Body", maxLength: 700 },
  actionLabel: { type: "text", label: "Action label", maxLength: 100 },
  actionHref: { type: "url", label: "Action link" },
  actionTarget: { type: "text", label: "Open in" },
  image: { type: "image", label: "Image" },
} as const;

export default function ImageWithText({
  eyebrow = "",
  heading = "Story",
  body = "",
  actionLabel = "Explore",
  actionHref = "#",
  actionTarget = "_self",
  image,
  imageSrc,
  imageAlt,
  imagePosition = "center",
}: ImageWithTextProps) {
  // A new tab must not hand the opened page a window.opener handle back to the
  // store, which it could use to redirect this tab to a spoofed page.
  const actionRel = actionTarget === "_blank" ? "noopener noreferrer" : undefined;
  const displayImage = image ?? {
    src: imageSrc ?? "/static/storefront/theme-preview-default.png",
    alt: imageAlt ?? "Image with text",
  };
  return (
    <section
      className="grid bg-[#d8d0c3] lg:grid-cols-2"
    >
      <div
        className="min-h-[32rem] overflow-hidden lg:min-h-[52rem]"
      >
        <img
          data-storefront-field="image"
          src={displayImage.src}
          alt={displayImage.alt}
          style={{ objectPosition: imagePosition }}
          className="size-full scale-110 object-cover"
        />
      </div>
      <div className="flex items-center px-[clamp(2rem,7vw,7rem)] py-20">
        <div className="max-w-xl">
          <p
            data-storefront-field="eyebrow"
            className="text-xs font-medium uppercase tracking-[0.22em] text-stone-600"
          >
            {eyebrow}
          </p>
          <h2
            data-storefront-field="heading"
            className="mt-5 font-serif text-[clamp(3rem,5vw,5.5rem)] leading-[0.94] tracking-[-0.045em] text-stone-950"
          >
            {heading}
          </h2>
          <p
            data-storefront-field="body"
            className="mt-7 text-base leading-7 text-stone-700"
          >
            {body}
          </p>
          <a
            href={actionHref}
            target={actionTarget}
            rel={actionRel}
            data-storefront-field="actionLabel"
            className="mt-9 inline-flex border-b border-current pb-1 text-sm font-medium"
          >
            {actionLabel}
          </a>
        </div>
      </div>
    </section>
  );
}
`;

/**
 * The card grid while it still spelled out the row paths it now infers.
 *
 * Three of its four markers named what the interpreter already derives: it
 * runs the `map()` itself, so it knows which row it is on. The fourth stays,
 * because the image's source is a fallback chain rather than one field.
 */
export const LEGACY_STARTER_THEME_CATEGORY_SHOWCASE_PATH_MARKED_SOURCE = `import type { ThemeContentFields } from "../morph/content-fields";
import ThemeLink from "../morph/link";

export type CategoryShowcaseLink = {
  href?: string;
  target?: "_self" | "_blank";
  rel?: string;
};

export type CategoryShowcaseItem = {
  title?: string;
  caption?: string;
  link?: CategoryShowcaseLink | string;
  image?: { src?: string; alt?: string };
  /** Read-only compatibility for documents created before image was grouped. */
  imageSrc?: string;
  imageAlt?: string;
  imagePosition?: string;
};

export type CategoryShowcaseProps = {
  heading?: string;
  items?: CategoryShowcaseItem[];
};

export const contentFields = {
  heading: { type: "text", label: "Heading", maxLength: 200 },
  items: {
    type: "array",
    label: "Collections",
    fields: {
      title: { type: "text", label: "Title", maxLength: 150 },
      caption: { type: "textarea", label: "Caption", maxLength: 300 },
      link: { type: "link", label: "Destination" },
      image: { type: "image", label: "Image" },
      imagePosition: { type: "text", label: "Image position", maxLength: 100 },
    },
  },
} as const satisfies ThemeContentFields;

export default function CategoryShowcase({
  heading = "Shop by collection",
  items = [],
}: CategoryShowcaseProps) {
  return (
    <section
      className="bg-stone-900 px-[clamp(1.25rem,4vw,4rem)] py-[clamp(5rem,9vw,9rem)] text-stone-100"
    >
      <div className="mb-12 flex items-end justify-between border-b border-stone-700 pb-6">
        <h2
          data-storefront-field="heading"
          className="font-serif text-[clamp(2.5rem,5vw,5rem)] tracking-[-0.04em]"
        >
          {heading}
        </h2>
        <span className="hidden text-xs uppercase tracking-[0.2em] text-stone-400 sm:block">
          The collection
        </span>
      </div>
      <div
        className="grid gap-4 lg:grid-cols-3"
      >
        {items.map((item, index) => (
          <ThemeLink
            key={index}
            link={item.link}
            data-storefront-field-path={\`items.\${index}\`}
            className="group block border-t border-stone-700 pt-4 lg:border-t-0 lg:pt-0"
          >
            <div className="aspect-[4/5] overflow-hidden bg-stone-800">
              <img
                data-storefront-field="image"
                data-storefront-field-path={\`items.\${index}.image\`}
                src={item.image?.src ?? item.imageSrc ?? "/static/storefront/theme-preview-default.png"}
                alt={item.image?.alt ?? item.imageAlt ?? "Collection item"}
                style={{ objectPosition: item.imagePosition ?? "center" }}
                className="size-full object-cover opacity-80 transition-transform duration-500 ease-out group-hover:scale-[1.025]"
              />
            </div>
            <div className="flex gap-5 py-5">
              <span className="pt-1 text-xs text-stone-500">{index + 1}</span>
              <div>
                <h3
                  data-storefront-field-path={\`items.\${index}.title\`}
                  className="font-serif text-2xl"
                >
                  {item.title ?? "Collection"}
                </h3>
                <p
                  data-storefront-field-path={\`items.\${index}.caption\`}
                  className="mt-2 max-w-xs text-sm leading-6 text-stone-400"
                >
                  {item.caption ?? ""}
                </p>
              </div>
            </div>
          </ThemeLink>
        ))}
      </div>
    </section>
  );
}
`;

export const STARTER_THEME_V3_NEW_FILES = [
  {
    path: "src/morph/content-fields.ts",
    mimeType: "text/typescript",
    content: STARTER_THEME_CONTENT_FIELDS_TYPES_SOURCE,
  },
  {
    path: "src/morph/link.tsx",
    mimeType: "text/typescript",
    content: STARTER_THEME_LINK_MODULE_SOURCE,
  },
  {
    path: "src/components/EditorialIntro.tsx",
    mimeType: "text/typescript",
    content: `export type EditorialIntroProps = {
  label?: string;
  heading?: string;
  body?: string;
};

export default function EditorialIntro({
  label = "About",
  heading = "Fewer things. Better chosen.",
  body = "Crafted with intention for long-lasting quality.",
}: EditorialIntroProps) {
  return (
    <section
      className="bg-stone-50 px-[clamp(1.75rem,7vw,7rem)] py-[clamp(6rem,12vw,11rem)]"
    >
      <div className="grid gap-10 border-t border-stone-300 pt-8 lg:grid-cols-[0.55fr_1.45fr]">
        <p
          data-storefront-field="label"
          className="text-xs font-medium uppercase tracking-[0.22em] text-stone-500"
        >
          {label}
        </p>
        <div>
          <h2
            data-storefront-field="heading"
            className="max-w-4xl font-serif text-[clamp(3rem,6vw,6.5rem)] leading-[0.92] tracking-[-0.045em] text-stone-950"
          >
            {heading}
          </h2>
          <p
            data-storefront-field="body"
            className="ml-auto mt-10 max-w-xl text-lg leading-8 text-stone-600"
          >
            {body}
          </p>
        </div>
      </div>
    </section>
  );
}
`,
  },
  {
    path: "src/components/CategoryShowcase.tsx",
    mimeType: "text/typescript",
    content: `import type { ThemeContentFields } from "../morph/content-fields";
import ThemeLink from "../morph/link";

export type CategoryShowcaseLink = {
  href?: string;
  target?: "_self" | "_blank";
  rel?: string;
};

export type CategoryShowcaseItem = {
  title?: string;
  caption?: string;
  link?: CategoryShowcaseLink | string;
  image?: { src?: string; alt?: string };
  /** Read-only compatibility for documents created before image was grouped. */
  imageSrc?: string;
  imageAlt?: string;
  imagePosition?: string;
};

export type CategoryShowcaseProps = {
  heading?: string;
  items?: CategoryShowcaseItem[];
};

export const contentFields = {
  heading: { type: "text", label: "Heading", maxLength: 200 },
  items: {
    type: "array",
    label: "Collections",
    fields: {
      title: { type: "text", label: "Title", maxLength: 150 },
      caption: { type: "textarea", label: "Caption", maxLength: 300 },
      link: { type: "link", label: "Destination" },
      image: { type: "image", label: "Image" },
      imagePosition: { type: "text", label: "Image position", maxLength: 100 },
    },
  },
} as const satisfies ThemeContentFields;

export default function CategoryShowcase({
  heading = "Shop by collection",
  items = [],
}: CategoryShowcaseProps) {
  return (
    <section
      className="bg-stone-900 px-[clamp(1.25rem,4vw,4rem)] py-[clamp(5rem,9vw,9rem)] text-stone-100"
    >
      <div className="mb-12 flex items-end justify-between border-b border-stone-700 pb-6">
        <h2
          data-storefront-field="heading"
          className="font-serif text-[clamp(2.5rem,5vw,5rem)] tracking-[-0.04em]"
        >
          {heading}
        </h2>
        <span className="hidden text-xs uppercase tracking-[0.2em] text-stone-400 sm:block">
          The collection
        </span>
      </div>
      <div
        className="grid gap-4 lg:grid-cols-3"
      >
        {items.map((item, index) => (
          <ThemeLink
            key={index}
            link={item.link}
            className="group block border-t border-stone-700 pt-4 lg:border-t-0 lg:pt-0"
          >
            <div className="aspect-[4/5] overflow-hidden bg-stone-800">
              <img
                src={item.image?.src ?? item.imageSrc ?? "/static/storefront/theme-preview-default.png"}
                alt={item.image?.alt ?? item.imageAlt ?? "Collection item"}
                style={{ objectPosition: item.imagePosition ?? "center" }}
                className="size-full object-cover opacity-80 transition-transform duration-500 ease-out group-hover:scale-[1.025]"
              />
            </div>
            <div className="flex gap-5 py-5">
              <span className="pt-1 text-xs text-stone-500">{index + 1}</span>
              <div>
                <h3
                  className="font-serif text-2xl"
                >
                  {item.title ?? "Collection"}
                </h3>
                <p
                  className="mt-2 max-w-xs text-sm leading-6 text-stone-400"
                >
                  {item.caption ?? ""}
                </p>
              </div>
            </div>
          </ThemeLink>
        ))}
      </div>
    </section>
  );
}`,
  },
  {
    path: "src/components/ImageWithText.tsx",
    mimeType: "text/typescript",
    content: `import type { ThemeContentFields } from "../morph/content-fields";
import ThemeLink from "../morph/link";

export type ImageWithTextLink = {
  href?: string;
  target?: "_self" | "_blank";
  rel?: string;
};

export type ImageWithTextProps = {
  eyebrow?: string;
  heading?: string;
  body?: string;
  actionLabel?: string;
  action?: ImageWithTextLink | string;
  image?: { src?: string; alt?: string };
  /** Read-only compatibility for documents created before image was grouped. */
  imageSrc?: string;
  imageAlt?: string;
  imagePosition?: string;
};

export const contentFields = {
  eyebrow: { type: "text", label: "Eyebrow", maxLength: 100 },
  heading: { type: "text", label: "Heading", maxLength: 200 },
  body: { type: "textarea", label: "Body", maxLength: 700 },
  actionLabel: { type: "text", label: "Action label", maxLength: 100 },
  action: { type: "link", label: "Action link" },
  image: { type: "image", label: "Image" },
} as const satisfies ThemeContentFields;

export default function ImageWithText({
  eyebrow = "",
  heading = "Story",
  body = "",
  actionLabel = "Explore",
  action = { href: "#" },
  image,
  imageSrc,
  imageAlt,
  imagePosition = "center",
}: ImageWithTextProps) {
  const displayImage = image ?? {
    src: imageSrc ?? "/static/storefront/theme-preview-default.png",
    alt: imageAlt ?? "Image with text",
  };
  return (
    <section
      className="grid bg-[#d8d0c3] lg:grid-cols-2"
    >
      <div
        className="min-h-[32rem] overflow-hidden lg:min-h-[52rem]"
      >
        <img
          data-storefront-field="image"
          src={displayImage.src}
          alt={displayImage.alt}
          style={{ objectPosition: imagePosition }}
          className="size-full scale-110 object-cover"
        />
      </div>
      <div className="flex items-center px-[clamp(2rem,7vw,7rem)] py-20">
        <div className="max-w-xl">
          <p
            data-storefront-field="eyebrow"
            className="text-xs font-medium uppercase tracking-[0.22em] text-stone-600"
          >
            {eyebrow}
          </p>
          <h2
            data-storefront-field="heading"
            className="mt-5 font-serif text-[clamp(3rem,5vw,5.5rem)] leading-[0.94] tracking-[-0.045em] text-stone-950"
          >
            {heading}
          </h2>
          <p
            data-storefront-field="body"
            className="mt-7 text-base leading-7 text-stone-700"
          >
            {body}
          </p>
          <ThemeLink
            link={action}
            data-storefront-field="actionLabel"
            className="mt-9 inline-flex border-b border-current pb-1 text-sm font-medium"
          >
            {actionLabel}
          </ThemeLink>
        </div>
      </div>
    </section>
  );
}`,
  },
  {
    path: "src/components/Newsletter.tsx",
    mimeType: "text/typescript",
    content: `export type NewsletterProps = {
  eyebrow?: string;
  heading?: string;
  body?: string;
  placeholder?: string;
  actionLabel?: string;
};

export default function Newsletter({
  eyebrow = "Stay connected",
  heading = "Join our newsletter",
  body = "",
  placeholder = "Enter your email",
  actionLabel = "Subscribe",
}: NewsletterProps) {
  return (
    <section
      className="bg-[#b7ad9d] px-[clamp(1.75rem,8vw,8rem)] py-[clamp(6rem,11vw,10rem)]"
    >
      <div className="mx-auto max-w-4xl text-center">
        <p
          data-storefront-field="eyebrow"
          className="text-xs font-medium uppercase tracking-[0.24em] text-stone-700"
        >
          {eyebrow}
        </p>
        <h2
          data-storefront-field="heading"
          className="mt-6 font-serif text-[clamp(3rem,6vw,6rem)] leading-[0.92] tracking-[-0.045em] text-stone-950"
        >
          {heading}
        </h2>
        <p
          data-storefront-field="body"
          className="mx-auto mt-6 max-w-lg text-base leading-7 text-stone-700"
        >
          {body}
        </p>
        <div
          className="mx-auto mt-10 flex max-w-xl border-b border-stone-800 py-3 text-left"
          aria-label={placeholder}
        >
          <span data-storefront-field="placeholder" className="flex-1 text-sm text-stone-700">
            {placeholder}
          </span>
          <span data-storefront-field="actionLabel" className="text-sm font-medium text-stone-950">
            {actionLabel}
          </span>
        </div>
      </div>
    </section>
  );
}
`,
  },
] as const;
