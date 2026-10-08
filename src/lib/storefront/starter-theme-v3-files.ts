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
  /**
   * Identity Morph stores for a repeated row, when it has given the row one.
   *
   * Not a DOM id and not a marker to hand-write: the editor assigns it, and a
   * Theme's only use for it is as a React key. Keying by the array index
   * matches rows by position, so reordering carries one row's DOM node — its
   * caret, its scroll position, any state in that subtree — into another.
   */
  id?: string;
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
    {
      id: "morph-nav-shop",
      label: "Shop",
      link: { href: "/collections/all" },
    },
    {
      id: "morph-nav-about",
      label: "About",
      link: { href: "/pages/about" },
    },
    {
      id: "morph-nav-journal",
      label: "Journal",
      link: { href: "/blogs/journal" },
    },
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
          <ThemeLink
            key={item.id}
            link={item.link}
            className="hover:text-neutral-950"
          >
            {item.label}
          </ThemeLink>
        ))}
      </nav>
      <div className="flex items-center gap-5 text-xs text-neutral-600">
        <ThemeLink link={cartLink} className="hover:text-neutral-950">
          {cartLabel}
        </ThemeLink>
        <ThemeLink link={{ href: "/account" }} className="hover:text-neutral-950">
          Account
        </ThemeLink>
      </div>
    </header>
  );
}
`;

const HEADER_ACCOUNT_ACTIONS_CURRENT = `      <div className="flex items-center gap-5 text-xs text-neutral-600">
        <ThemeLink link={cartLink} className="hover:text-neutral-950">
          {cartLabel}
        </ThemeLink>
        <ThemeLink link={{ href: "/account" }} className="hover:text-neutral-950">
          Account
        </ThemeLink>
      </div>`;

const HEADER_CART_ACTION_LEGACY = `      <ThemeLink
        link={cartLink}
        className="text-xs text-neutral-600 hover:text-neutral-950"
      >
        {cartLabel}
      </ThemeLink>`;

/** The exact previous Header, before the Starter account route was linked. */
export const LEGACY_STARTER_THEME_HEADER_ACCOUNTLESS_SOURCE =
  STARTER_THEME_HEADER_SOURCE.replace(
    HEADER_ACCOUNT_ACTIONS_CURRENT,
    HEADER_CART_ACTION_LEGACY,
  );

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

/**
 * Every Header navigation the Starter has shipped, as the block that changed.
 *
 * One anchor and a list of what it replaced, rather than each snapshot deriving
 * from the one before: the previous arrangement reversed a single edit off the
 * *current* source, so the next edit to that source silently skipped a
 * generation — the Header with an index but still wrapped in a span matched
 * nothing and could never be upgraded again. Stating each generation outright
 * means adding one cannot quietly orphan another, and the tests below hold them
 * apart.
 */
const HEADER_NAV_BLOCK_CURRENT = `        {navItems.map((item) => (
          <ThemeLink
            key={item.id}
            link={item.link}
            className="hover:text-neutral-950"
          >
            {item.label}
          </ThemeLink>
        ))}`;

/**
 * The key as it stood while documents without row ids were still out there: an
 * id when the row had one, its position when it did not. One list keyed both
 * ways is what made reordering carry a row's DOM state into its neighbour, and
 * it could only be dropped once the editor, every draft write and publishing all
 * guaranteed a row arrives with an id.
 */
const HEADER_NAV_BLOCK_ID_FALLBACK = `        {navItems.map((item, index) => (
          <ThemeLink
            key={item.id ?? index}
            link={item.link}
            className="hover:text-neutral-950"
          >
            {item.label}
          </ThemeLink>
        ))}`;

/** Before a row had any identity to key by. */
const HEADER_NAV_BLOCK_INDEX_KEYED = `        {navItems.map((item, index) => (
          <ThemeLink
            key={index}
            link={item.link}
            className="hover:text-neutral-950"
          >
            {item.label}
          </ThemeLink>
        ))}`;

/**
 * The span around each link was doing by hand what the compiler now does:
 * giving the row a host element to carry its markers, because an attribute put
 * on a component is only a prop it may never pass on. The compiler recognises
 * `morph/link` and marks the anchor it renders.
 */
const HEADER_NAV_BLOCK_INDEXED_SPAN = `        {navItems.map((item, index) => (
          <span key={item.label}>
            <ThemeLink link={item.link} className="hover:text-neutral-950">
              {item.label}
            </ThemeLink>
          </span>
        ))}`;

/**
 * And before that, no index either. A `.map()` callback with no second
 * parameter leaves the compiler nothing to build `navItems.0.label` from, so
 * its rows carry no field path and share one source position — which looks
 * like working software while the array holds one item, and like a section
 * that lost its links at two.
 */
const HEADER_NAV_BLOCK_UNINDEXED_SPAN = `        {navItems.map((item) => (
          <span key={item.label}>
            <ThemeLink link={item.link} className="hover:text-neutral-950">
              {item.label}
            </ThemeLink>
          </span>
        ))}`;

/** The default rows as they are now: born with the id the editor keys by. */
const HEADER_NAV_DEFAULTS_CURRENT = `  navItems = [
    {
      id: "morph-nav-shop",
      label: "Shop",
      link: { href: "/collections/all" },
    },
    {
      id: "morph-nav-about",
      label: "About",
      link: { href: "/pages/about" },
    },
    {
      id: "morph-nav-journal",
      label: "Journal",
      link: { href: "/blogs/journal" },
    },
  ],`;

/**
 * And as they were before v26. Every generation below predates row identity, so
 * each one reverts the defaults as well as the map — a snapshot that reversed
 * only the key would describe a Header that never shipped, and would match no
 * workspace at all.
 */
const HEADER_NAV_DEFAULTS_IDLESS = `  navItems = [
    { label: "Shop", link: { href: "/collections/all" } },
    { label: "About", link: { href: "/pages/about" } },
    { label: "Journal", link: { href: "/blogs/journal" } },
  ],`;

/**
 * Every anchor a legacy snapshot substitutes, paired with the source it has to
 * be found in.
 *
 * Exported so a test can prove each one is still there. `String.replace` on a
 * string it cannot find returns the original, so an anchor that drifts out of
 * date does not fail — it makes every generation derived through it collapse
 * into the same text, which reads as "no upgrade needed" for workspaces that
 * badly need one. That is not hypothetical: changing the key in the current
 * Header without updating the anchor collapsed three generations into one, and
 * only the distinctness test downstream noticed.
 */
export const STARTER_THEME_LEGACY_ANCHORS: ReadonlyArray<{
  name: string;
  anchor: string;
  source: string;
}> = [
  {
    name: "Header nav map",
    anchor: HEADER_NAV_BLOCK_CURRENT,
    source: STARTER_THEME_HEADER_SOURCE,
  },
  {
    name: "Header nav defaults",
    anchor: HEADER_NAV_DEFAULTS_CURRENT,
    source: STARTER_THEME_HEADER_SOURCE,
  },
];

function legacyHeaderSource(navBlock: string) {
  return LEGACY_STARTER_THEME_HEADER_ACCOUNTLESS_SOURCE.replace(
    HEADER_NAV_DEFAULTS_CURRENT,
    HEADER_NAV_DEFAULTS_IDLESS,
  ).replace(HEADER_NAV_BLOCK_CURRENT, navBlock);
}

/** The Header of template version 25: an id when the row had one, else position. */
export const LEGACY_STARTER_THEME_HEADER_ID_FALLBACK_SOURCE =
  legacyHeaderSource(HEADER_NAV_BLOCK_ID_FALLBACK);

/** The Header of template version 24: the link as the row, keyed by position. */
export const LEGACY_STARTER_THEME_HEADER_INDEX_KEYED_SOURCE =
  legacyHeaderSource(HEADER_NAV_BLOCK_INDEX_KEYED);

/** The Header of template version 23: an index, and still the span. */
export const LEGACY_STARTER_THEME_HEADER_INDEXED_SPAN_SOURCE =
  legacyHeaderSource(HEADER_NAV_BLOCK_INDEXED_SPAN);

/** The Header before either change. */
export const LEGACY_STARTER_THEME_HEADER_UNINDEXED_SOURCE = legacyHeaderSource(
  HEADER_NAV_BLOCK_UNINDEXED_SPAN,
);

export const STARTER_THEME_FOOTER_SOURCE = `import type { ThemeContentFields } from "../morph/content-fields";
import ThemeLink from "../morph/link";

export type FooterLink = {
  href?: string;
  target?: "_self" | "_blank";
  rel?: string;
};

export type FooterNavItem = {
  /**
   * Identity Morph stores for a repeated row, when it has given the row one.
   *
   * Not a DOM id and not a marker to hand-write: the editor assigns it, and a
   * Theme's only use for it is as a React key. Keying by the array index
   * matches rows by position, so reordering carries one row's DOM node — its
   * caret, its scroll position, any state in that subtree — into another.
   */
  id?: string;
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
    {
      id: "morph-explore-shop-all",
      label: "Shop all",
      link: { href: "/collections/all" },
    },
    {
      id: "morph-explore-our-story",
      label: "Our story",
      link: { href: "/pages/about" },
    },
    {
      id: "morph-explore-journal",
      label: "Journal",
      link: { href: "/blogs/journal" },
    },
  ],
  helpHeading = "Help",
  helpItems = [
    {
      id: "morph-help-contact",
      label: "Contact",
      link: { href: "/pages/contact" },
    },
    {
      id: "morph-help-shipping",
      label: "Shipping",
      link: { href: "/pages/shipping" },
    },
    {
      id: "morph-help-returns",
      label: "Returns",
      link: { href: "/pages/returns" },
    },
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
        {exploreItems.map((item) => (
          <ThemeLink
            key={item.id}
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
        {helpItems.map((item) => (
          <ThemeLink
            key={item.id}
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
const FOOTER_EXPLORE_DEFAULTS_CURRENT = `    {
      id: "morph-explore-shop-all",
      label: "Shop all",
      link: { href: "/collections/all" },
    },
    {
      id: "morph-explore-our-story",
      label: "Our story",
      link: { href: "/pages/about" },
    },
    {
      id: "morph-explore-journal",
      label: "Journal",
      link: { href: "/blogs/journal" },
    },`;

const FOOTER_EXPLORE_DEFAULTS_IDLESS = `    { label: "Shop all", link: { href: "/collections/all" } },
    { label: "Our story", link: { href: "/pages/about" } },
    { label: "Journal", link: { href: "/blogs/journal" } },`;

const FOOTER_HELP_DEFAULTS_CURRENT = `    {
      id: "morph-help-contact",
      label: "Contact",
      link: { href: "/pages/contact" },
    },
    {
      id: "morph-help-shipping",
      label: "Shipping",
      link: { href: "/pages/shipping" },
    },
    {
      id: "morph-help-returns",
      label: "Returns",
      link: { href: "/pages/returns" },
    },`;

const FOOTER_HELP_DEFAULTS_IDLESS = `    { label: "Contact", link: { href: "/pages/contact" } },
    { label: "Shipping", link: { href: "/pages/shipping" } },
    { label: "Returns", link: { href: "/pages/returns" } },`;

/**
 * The Footer of template version 25: rows without ids in its defaults, and a key
 * that fell back to position when a row had none.
 *
 * Derived by reversing exactly the two edits v26 made, and only for the
 * generation immediately before it. Reversing one edit off the current source to
 * describe an older generation is what once orphaned a snapshot that then
 * matched no workspace and could never be upgraded again.
 */
/** The Footer's half of the anchor list above; same reason, same guard. */
export const STARTER_THEME_FOOTER_LEGACY_ANCHORS: ReadonlyArray<{
  name: string;
  anchor: string;
  source: string;
}> = [
  {
    name: "Footer explore defaults",
    anchor: FOOTER_EXPLORE_DEFAULTS_CURRENT,
    source: STARTER_THEME_FOOTER_SOURCE,
  },
  {
    name: "Footer help defaults",
    anchor: FOOTER_HELP_DEFAULTS_CURRENT,
    source: STARTER_THEME_FOOTER_SOURCE,
  },
];

export const LEGACY_STARTER_THEME_FOOTER_ID_FALLBACK_SOURCE =
  STARTER_THEME_FOOTER_SOURCE.replace(
    FOOTER_EXPLORE_DEFAULTS_CURRENT,
    FOOTER_EXPLORE_DEFAULTS_IDLESS,
  )
    .replace(FOOTER_HELP_DEFAULTS_CURRENT, FOOTER_HELP_DEFAULTS_IDLESS)
    .replaceAll("key={item.id}", "key={item.id ?? index}")
    .replaceAll(
      "{exploreItems.map((item) => (",
      "{exploreItems.map((item, index) => (",
    )
    .replaceAll(
      "{helpItems.map((item) => (",
      "{helpItems.map((item, index) => (",
    );

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

/**
 * The content module before it gained `morph.pages.get`: slot values by id,
 * read through the React context, with no way to fetch a page by path.
 * Kept verbatim so an untouched copy can be upgraded and an edited one left
 * alone.
 */
export const LEGACY_STARTER_THEME_CONTENT_MODULE_V14_SOURCE = `import { createIsomorphicFn } from "@tanstack/react-start";
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

/**
 * Why a page could not be read. A closed set, so a route can show something
 * specific for the cases it understands and treat the rest alike.
 */
export type MorphContentErrorCode =
  | "no_content_source"
  | "invalid_content_origin"
  | "invalid_path"
  | "store_unreachable"
  | "content_not_found"
  | "store_error"
  | "redirect_refused"
  | "invalid_response"
  | "response_too_large"
  | "reserved_slot";

/**
 * The words for each code. Written here and not taken from the store's
 * answer, so what reaches a browser is never an upstream response, an address
 * or a stack. The detail goes to the server's log.
 */
const MORPH_CONTENT_MESSAGES: Record<MorphContentErrorCode, string> = {
  no_content_source:
    "No content source. Run inside Morph, or while developing set MORPH_CONTENT_ORIGIN to your store address, for example https://your-store.example.",
  invalid_content_origin: "The content source address is not usable.",
  invalid_path: "A page path starts with / and is at most 500 characters.",
  store_unreachable: "The content service could not be reached.",
  content_not_found: "The store has no content for this page.",
  store_error: "The content service reported an error.",
  redirect_refused: "The content service redirected, which is not followed.",
  invalid_response: "The content service sent a response that could not be used.",
  response_too_large: "The content service response was too large.",
  reserved_slot: "The content service sent a slot named _hidden, which is reserved.",
};

/** Raised when a page cannot be read. The caller decides what to show instead. */
export class MorphContentError extends Error {
  readonly code: MorphContentErrorCode;
  constructor(code: MorphContentErrorCode, message?: string) {
    super(message ?? MORPH_CONTENT_MESSAGES[code]);
    this.name = "MorphContentError";
    this.code = code;
  }
}

function isMorphContentErrorCode(value: unknown): value is MorphContentErrorCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(MORPH_CONTENT_MESSAGES, value);
}

/**
 * One page's published content: each slot's values under its slot id, ready to
 * spread onto a section. Sections the author hid are listed in _hidden, which
 * no slot id can be called because ids never start with an underscore.
 */
export type MorphPage = {
  readonly _hidden: readonly string[];
  readonly [slotId: string]: any;
};

const CONTENT_TIMEOUT_MS = 15_000;

/**
 * The address of a Morph store, from the local environment. Server only, and
 * only while developing: a build that reaches here without the platform's own
 * address must fail, not quietly read whichever store the shell names.
 */
function localContentOrigin(): string | null {
  // Written as import.meta.env so a build can replace it with a constant. Held
  // in a variable first, Vite would not recognise it and the check would be
  // decided at run time by whatever the host provides.
  if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV !== true) return null;
  const env = (
    globalThis as { process?: { env?: Record<string, string | undefined> } }
  ).process?.env;
  const value = env?.MORPH_CONTENT_ORIGIN?.trim();
  return value ? value : null;
}

/**
 * Reads one page of published content. Unlike loadContentSlots this never
 * falls back to component defaults: a page that cannot be read throws, so a
 * wrong address or a missing release is something you see rather than a site
 * that quietly shows placeholder text.
 */
async function fetchPage(url: string, onServer: boolean): Promise<MorphPage> {
  // The detail of a failure belongs in the log of the machine that saw it. It
  // is not put in the error, which a page may render for anyone to read.
  const note = (detail: string) => {
    if (onServer) console.warn("[morph] " + detail);
  };
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: "application/json" },
      credentials: "omit",
      signal: AbortSignal.timeout(CONTENT_TIMEOUT_MS),
    });
  } catch (error) {
    note("Could not reach " + url + ": " + (error instanceof Error ? error.message : "request failed"));
    throw new MorphContentError("store_unreachable");
  }
  if (!response.ok) {
    // The local development proxy names its refusals with one of the codes
    // above. Anything else, including Core's plain-text errors, is told apart
    // by status alone.
    let named: unknown = null;
    try {
      named = ((await response.json()) as { code?: unknown } | null)?.code;
    } catch {
      named = null;
    }
    note(url + " answered " + response.status + ".");
    throw new MorphContentError(
      isMorphContentErrorCode(named)
        ? named
        : response.status === 404 ? "content_not_found" : "store_error",
    );
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    note(url + " did not send JSON.");
    throw new MorphContentError("invalid_response");
  }
  if (!payload || typeof payload !== "object"
    || !("slots" in payload) || !payload.slots || typeof payload.slots !== "object" || Array.isArray(payload.slots)
    || !("hiddenSlots" in payload) || !Array.isArray(payload.hiddenSlots)
    || !payload.hiddenSlots.every((slot: unknown) => typeof slot === "string")) {
    note(url + " sent a payload of the wrong shape.");
    throw new MorphContentError("invalid_response");
  }
  // _hidden is where the hidden list lives. A slot of that name would be lost
  // behind it, so it is refused instead of dropped.
  if (Object.prototype.hasOwnProperty.call(payload.slots, "_hidden")) {
    throw new MorphContentError("reserved_slot");
  }
  return { ...(payload.slots as Record<string, unknown>), _hidden: payload.hiddenSlots as string[] };
}

const getPage = createIsomorphicFn()
  .client(async (path: string): Promise<MorphPage> =>
    fetchPage("/_morph/content?path=" + encodeURIComponent(path), false),
  )
  .server(async (path: string): Promise<MorphPage> => {
    // Inside Morph the platform names its own address on each request. On your
    // own machine nothing does, so the store is named once in the environment.
    // A header that is present but unusable is an error of its own: falling
    // through to the local address would swap a release's content for another
    // store's without anyone seeing it happen.
    const forwarded = getRequest().headers.get("x-morph-content-origin");
    const local = forwarded === null ? localContentOrigin() : null;
    const origin = forwarded ?? local;
    if (origin === null) throw new MorphContentError("no_content_source");
    const label = forwarded !== null
      ? "The platform content origin header"
      : "MORPH_CONTENT_ORIGIN";
    let base: URL;
    try {
      base = new URL(origin);
    } catch {
      throw new MorphContentError("invalid_content_origin", label + " is not a valid address.");
    }
    if (base.protocol !== "https:" && base.protocol !== "http:") {
      throw new MorphContentError("invalid_content_origin", label + " must be an http or https address.");
    }
    return fetchPage(base.origin + "/_morph/content?path=" + encodeURIComponent(path), true);
  });

export const morph = {
  pages: {
    /**
     * const home = await morph.pages.get("/home");
     * <Hero {...home.hero} />
     */
    get(path: string): Promise<MorphPage> {
      if (typeof path !== "string" || !path.startsWith("/") || path.length > 500) {
        return Promise.reject(new MorphContentError("invalid_path"));
      }
      return getPage(path);
    },
    /** Whether the author hid this section on the page. */
    isHidden(page: MorphPage, slotId: string): boolean {
      return page._hidden.includes(slotId);
    },
  },
};
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

export const STARTER_THEME_ORDER_TRANSFER_ROUTE_SOURCE = `import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/order-transfer")({
  validateSearch: (search: Record<string, unknown>) => ({
    order_id:
      typeof search.order_id === "string" &&
      /^[A-Za-z0-9_-]{1,128}$/.test(search.order_id)
        ? search.order_id
        : undefined,
  }),
  head: () => ({
    meta: [{ name: "referrer", content: "no-referrer" }],
  }),
  component: OrderTransferRoute,
});

function OrderTransferRoute() {
  const search = Route.useSearch();
  const [orderId, setOrderId] = useState(search.order_id ?? "");
  const [token, setToken] = useState("");
  const [pendingAction, setPendingAction] = useState<"accept" | "decline" | null>(null);
  const [outcome, setOutcome] = useState<"accepted" | "declined" | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setOrderId(search.order_id ?? "");
    const suppliedToken = new URLSearchParams(window.location.hash.slice(1)).get("token");
    setToken(suppliedToken ?? "");
    if (window.location.hash) {
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
    }
  }, [search.order_id]);

  async function confirmTransfer(action: "accept" | "decline") {
    const reference = orderId.trim();
    const code = token.trim();
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(reference)) {
      setMessage("請輸入有效的訂單參考編號。");
      return;
    }
    if (!/^[0-9a-f]{64}$/i.test(code)) {
      setMessage("請輸入信件中的 64 位確認碼。");
      return;
    }

    setPendingAction(action);
    setMessage("");
    try {
      const response = await fetch(
        "/api/store/orders/" + encodeURIComponent(reference) + "/transfer/" + action,
        {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify({ token: code }),
          credentials: "omit",
          redirect: "error",
          signal: AbortSignal.timeout(15_000),
        },
      );
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const error =
          payload && typeof payload === "object" && "error" in payload
            ? payload.error
            : null;
        throw new Error(
          error === "ORDER_TRANSFER_UNAVAILABLE"
            ? "確認碼無效、已過期，或這筆訂單已處理。"
            : "目前無法確認訂單轉移，請稍後再試。",
        );
      }
      setOutcome(action === "accept" ? "accepted" : "declined");
      setToken("");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "目前無法確認訂單轉移，請稍後再試。",
      );
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <main className="min-h-screen bg-stone-50 px-5 py-16 text-stone-950 sm:px-8 sm:py-24">
      <section className="mx-auto max-w-xl border-t border-stone-300 pt-7">
        <p className="text-xs font-medium uppercase tracking-[0.22em] text-stone-500">
          Customer account
        </p>
        <h1 className="mt-5 font-serif text-4xl tracking-[-0.04em] sm:text-5xl">
          訂單轉移確認
        </h1>
        <p className="mt-5 max-w-lg text-sm leading-7 text-stone-600">
          請確認是否將這筆訪客訂單移至已驗證的會員帳戶。確認碼只會使用一次，且 30 分鐘後失效。
        </p>

        {outcome ? (
          <p className="mt-8 rounded-md border border-stone-300 bg-white p-5 text-sm leading-7" role="status">
            {outcome === "accepted"
              ? "訂單已轉移至會員帳戶。"
              : "已拒絕這筆訂單轉移；訂單仍維持原狀。"}
          </p>
        ) : (
          <div className="mt-8 space-y-6">
            <div>
              <label htmlFor="order-reference" className="block text-sm font-medium">
                訂單參考編號
              </label>
              <input
                id="order-reference"
                autoComplete="off"
                maxLength={128}
                value={orderId}
                onChange={(event) => setOrderId(event.currentTarget.value)}
                className="mt-2 w-full rounded-md border border-stone-300 bg-white px-3 py-3 text-sm outline-none focus:border-stone-900 focus:ring-2 focus:ring-stone-900/15"
              />
            </div>
            <div>
              <label htmlFor="transfer-code" className="block text-sm font-medium">
                電子郵件確認碼
              </label>
              <input
                id="transfer-code"
                autoComplete="one-time-code"
                inputMode="text"
                maxLength={64}
                value={token}
                onChange={(event) => setToken(event.currentTarget.value)}
                className="mt-2 w-full rounded-md border border-stone-300 bg-white px-3 py-3 font-mono text-sm tracking-[0.12em] outline-none focus:border-stone-900 focus:ring-2 focus:ring-stone-900/15"
              />
              <p className="mt-2 text-xs leading-5 text-stone-500">
                若確認碼未自動帶入，請複製信件中的 64 位英數碼。
              </p>
            </div>
            {message ? (
              <p className="text-sm leading-6 text-red-700" role="alert">
                {message}
              </p>
            ) : null}
            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                disabled={pendingAction !== null}
                onClick={() => void confirmTransfer("accept")}
                className="inline-flex min-h-11 flex-1 items-center justify-center rounded-md bg-stone-900 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-stone-800 disabled:cursor-wait disabled:opacity-60"
              >
                {pendingAction === "accept" ? "確認中…" : "確認並轉移訂單"}
              </button>
              <button
                type="button"
                disabled={pendingAction !== null}
                onClick={() => void confirmTransfer("decline")}
                className="inline-flex min-h-11 flex-1 items-center justify-center rounded-md border border-stone-300 bg-white px-5 py-3 text-sm font-medium text-stone-800 transition-colors hover:border-stone-500 disabled:cursor-wait disabled:opacity-60"
              >
                {pendingAction === "decline" ? "處理中…" : "拒絕轉移"}
              </button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
`;

export const STARTER_THEME_CUSTOMER_ACCOUNT_ROUTE_SOURCE = `import { createFileRoute } from "@tanstack/react-router";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/account")({
  component: CustomerAccountRoute,
});

type AccountUser = { id: string; name: string; email: string; emailVerified: boolean };
type Address = {
  id: string;
  addressName: string | null;
  isDefaultShipping: boolean;
  isDefaultBilling: boolean;
  company: string | null;
  firstName: string | null;
  lastName: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  countryCode: string | null;
  province: string | null;
  postalCode: string | null;
  phone: string | null;
};
type Profile = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  phone: string | null;
  addresses: Address[];
};
type Order = {
  id: string;
  displayId: number;
  status: string;
  currencyCode: string;
  total: number;
  createdAt: string;
};
type OrderDetail = {
  order: Order;
  items: Array<{ id: string; title: string; quantity: number; fulfilledQuantity: number; unitPrice: number }>;
};
type AccountOrderEdit = {
  id: string;
  order_id: string;
  status: string | null;
  requested_at: string | null;
  actions: Array<{
    id: string;
    action: string;
    ordering: number;
    details: {
      email?: string;
      no_notification?: boolean;
      title?: string;
      previous_quantity?: number;
      quantity?: number;
      previous_order_total?: number;
      proposed_order_total?: number;
      removed?: boolean;
    };
    applied: boolean;
  }>;
};
type ReturnableItem = { id: string; title: string; sku: string | null; returnableQuantity: number };
type AccountReturn = {
  id: string;
  displayId: number;
  status: "open" | "requested" | "received" | "partially_received" | "canceled";
  claimId: string | null;
  exchangeId: string | null;
  requestedAt: string | null;
  items: Array<{ id: string; title: string; quantity: number; receivedQuantity: number }>;
};
type AccountClaim = {
  id: string;
  displayId: number;
  type: "refund" | "replace";
  returnId: string | null;
  createdAt: string;
  canceledAt: string | null;
  items: Array<{
    id: string;
    title: string;
    sku: string | null;
    quantity: number;
    reason: "missing_item" | "wrong_item" | "production_failure" | "other" | null;
    isAdditionalItem: boolean;
  }>;
};
type AccountExchange = {
  id: string;
  displayId: number;
  returnId: string | null;
  createdAt: string;
  canceledAt: string | null;
  returnStatus: AccountReturn["status"] | null;
  inboundItems: Array<{
    id: string;
    title: string;
    sku: string | null;
    quantity: number;
    receivedQuantity: number;
  }>;
  items: Array<{
    id: string;
    title: string;
    sku: string | null;
    quantity: number;
  }>;
};
type StoreCreditAccount = {
  id: string;
  currency_code: string;
  balance: number;
  total_credits: number;
  total_debits: number;
  created_at: string;
};
type StoreCreditTransaction = {
  id: string;
  type: "credit" | "debit";
  amount: number;
  reference: string | null;
  note: string | null;
  created_at: string;
};
type AddressDraft = {
  addressName: string;
  firstName: string;
  lastName: string;
  company: string;
  address1: string;
  address2: string;
  city: string;
  province: string;
  postalCode: string;
  countryCode: string;
  phone: string;
  isDefaultShipping: boolean;
  isDefaultBilling: boolean;
};

const emptyAddress: AddressDraft = {
  addressName: "", firstName: "", lastName: "", company: "", address1: "",
  address2: "", city: "", province: "", postalCode: "", countryCode: "tw",
  phone: "", isDefaultShipping: false, isDefaultBilling: false,
};

async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    redirect: "error",
    headers: { accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15_000),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string"
      ? payload.message
      : "目前無法完成此操作，請稍後再試。";
    throw new Error(message);
  }
  return payload as T;
}

function money(amount: number, currency: string) {
  try {
    const formatter = new Intl.NumberFormat("zh-TW", { style: "currency", currency });
    const fractionDigits = formatter.resolvedOptions().maximumFractionDigits;
    return formatter.format(amount / 10 ** fractionDigits);
  } catch {
    return currency + " " + amount;
  }
}

function majorMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("zh-TW", { style: "currency", currency }).format(amount);
  } catch {
    return currency + " " + amount;
  }
}

function returnStatusLabel(status: AccountReturn["status"]) {
  return {
    open: "已建立",
    requested: "等待商店確認",
    received: "已收件",
    partially_received: "部分收件",
    canceled: "已取消",
  }[status];
}

function CustomerAccountRoute() {
  const [user, setUser] = useState<AccountUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [count, setCount] = useState(0);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [storeCreditAccounts, setStoreCreditAccounts] = useState<StoreCreditAccount[]>([]);
  const [selectedCreditAccountId, setSelectedCreditAccountId] = useState<string | null>(null);
  const [creditTransactions, setCreditTransactions] = useState<StoreCreditTransaction[]>([]);
  const [creditTransactionCount, setCreditTransactionCount] = useState(0);
  const [creditCode, setCreditCode] = useState("");
  const [storeCreditLoadError, setStoreCreditLoadError] = useState("");
  const [view, setView] = useState<"profile" | "orders" | "addresses" | "store-credit">("profile");
  const [authMode, setAuthMode] = useState<"signin" | "signup" | "verify" | "reset">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [addressDraft, setAddressDraft] = useState<AddressDraft>(emptyAddress);
  const [selectedOrder, setSelectedOrder] = useState<OrderDetail | null>(null);
  const [orderEdit, setOrderEdit] = useState<AccountOrderEdit | null>(null);
  const [orderReturns, setOrderReturns] = useState<AccountReturn[]>([]);
  const [orderClaims, setOrderClaims] = useState<AccountClaim[]>([]);
  const [orderExchanges, setOrderExchanges] = useState<AccountExchange[]>([]);
  const [returnableItems, setReturnableItems] = useState<ReturnableItem[]>([]);
  const [returnQuantities, setReturnQuantities] = useState<Record<string, number>>({});

  async function loadAccount() {
    const session = await api<{ user?: AccountUser | null } | null>("/api/auth/get-session");
    const nextUser = session?.user;
    if (!nextUser?.emailVerified) {
      setUser(null);
      setProfile(null);
      setOrders([]);
      setAddresses([]);
      setOrderReturns([]);
      setOrderClaims([]);
      setOrderExchanges([]);
      setOrderEdit(null);
      setStoreCreditAccounts([]);
      setSelectedCreditAccountId(null);
      setCreditTransactions([]);
      setCreditTransactionCount(0);
      setStoreCreditLoadError("");
      return;
    }
    setUser(nextUser);
    setStoreCreditLoadError("");
    const [profileResult, orderPage, addressPage, creditPage] = await Promise.all([
      api<{ customer: Profile }>("/api/store/customers/me"),
      api<{ orders: Order[]; count: number }>("/api/store/customers/me/orders?limit=20&offset=0"),
      api<{ addresses: Address[] }>("/api/store/customers/me/addresses?limit=100&offset=0"),
      api<{ store_credit_accounts: StoreCreditAccount[] }>("/api/store/customers/me/store-credit-accounts").catch(() => null),
    ]);
    setProfile(profileResult.customer);
    setOrders(orderPage.orders);
    setCount(orderPage.count);
    setAddresses(addressPage.addresses);
    setStoreCreditAccounts(creditPage?.store_credit_accounts ?? []);
    setStoreCreditLoadError(
      creditPage ? "" : "儲值金目前無法載入，請稍後重試。",
    );
  }

  async function loadMoreOrders() {
    const nextOffset = orders.length;
    setBusy(true);
    try {
      const page = await api<{ orders: Order[]; count: number }>(
        "/api/store/customers/me/orders?limit=20&offset=" + nextOffset,
      );
      setOrders((current) => [...current, ...page.orders]);
      setCount(page.count);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "無法載入更多訂單。 ");
    } finally {
      setBusy(false);
    }
  }

  async function claimStoreCredit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const result = await api<{
        store_credit_account: StoreCreditAccount;
      }>("/api/store/store-credit-accounts/claim", "POST", {
        code: creditCode.trim(),
      });
      setStoreCreditAccounts((current) => [
        ...current.filter(
          (account) => account.id !== result.store_credit_account.id,
        ),
        result.store_credit_account,
      ]);
      setStoreCreditLoadError("");
      setCreditCode("");
      setSelectedCreditAccountId(null);
      setCreditTransactions([]);
      setCreditTransactionCount(0);
      setMessage("儲值金已加入帳戶。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "無法兌領儲值金，請確認兌領碼後再試。");
    } finally {
      setBusy(false);
    }
  }

  async function openStoreCreditAccount(accountId: string) {
    setSelectedCreditAccountId(accountId);
    setCreditTransactions([]);
    setCreditTransactionCount(0);
    setBusy(true);
    setMessage("");
    try {
      const result = await api<{
        transactions: StoreCreditTransaction[];
        count: number;
      }>(
        "/api/store/customers/me/store-credit-accounts/" +
          encodeURIComponent(accountId) +
          "/transactions?limit=20&offset=0",
      );
      setCreditTransactions(result.transactions);
      setCreditTransactionCount(result.count);
    } catch (error) {
      setCreditTransactions([]);
      setMessage(error instanceof Error ? error.message : "無法載入儲值金交易紀錄。");
    } finally {
      setBusy(false);
    }
  }

  async function loadMoreCreditTransactions() {
    if (!selectedCreditAccountId || creditTransactions.length >= creditTransactionCount) return;
    setBusy(true);
    try {
      const result = await api<{
        transactions: StoreCreditTransaction[];
        count: number;
      }>(
        "/api/store/customers/me/store-credit-accounts/" +
          encodeURIComponent(selectedCreditAccountId) +
          "/transactions?limit=20&offset=" +
          creditTransactions.length,
      );
      setCreditTransactions((current) => [...current, ...result.transactions]);
      setCreditTransactionCount(result.count);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "無法載入更多儲值金交易紀錄。");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void loadAccount().catch(() => setUser(null));
  }, []);

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      if (authMode === "signup") {
        await api("/api/auth/sign-up/email", "POST", { name: name.trim(), email: email.trim(), password });
        await api("/api/auth/email-otp/send-verification-otp", "POST", { email: email.trim(), type: "email-verification" });
        setAuthMode("verify");
        setMessage("帳戶已建立，請輸入寄到電子郵件的驗證碼。");
      } else if (authMode === "reset") {
        await api("/api/auth/email-otp/reset-password", "POST", {
          email: email.trim(),
          otp: otp.trim(),
          password,
        });
        setPassword("");
        setOtp("");
        setAuthMode("signin");
        setMessage("密碼已更新，請使用新密碼登入。");
      } else if (authMode === "verify") {
        await api("/api/auth/email-otp/verify-email", "POST", { email: email.trim(), otp: otp.trim() });
        await api("/api/auth/sign-in/email", "POST", { email: email.trim(), password });
        await loadAccount();
        setMessage("電子郵件已驗證，歡迎回來。");
      } else {
        await api("/api/auth/sign-in/email", "POST", { email: email.trim(), password });
        await loadAccount();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "登入失敗，請檢查資料後再試。 ");
    } finally {
      setBusy(false);
    }
  }

  async function sendVerificationCode() {
    setBusy(true);
    setMessage("");
    try {
      await api("/api/auth/email-otp/send-verification-otp", "POST", { email: email.trim(), type: "email-verification" });
      setAuthMode("verify");
      setMessage("驗證碼已寄出，請查看電子郵件。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "目前無法寄送驗證碼。 ");
    } finally {
      setBusy(false);
    }
  }

  async function sendPasswordResetCode() {
    setBusy(true);
    setMessage("");
    try {
      await api("/api/auth/email-otp/send-verification-otp", "POST", {
        email: email.trim(),
        type: "forget-password",
      });
      setAuthMode("reset");
      setMessage("密碼重設驗證碼已寄出，請查看電子郵件。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "目前無法寄送密碼重設驗證碼。");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    try {
      await api("/api/auth/sign-out", "POST", {});
      setUser(null);
      setProfile(null);
      setOrders([]);
      setAddresses([]);
      setOrderReturns([]);
      setOrderClaims([]);
      setOrderExchanges([]);
      setOrderEdit(null);
      setStoreCreditAccounts([]);
      setSelectedCreditAccountId(null);
      setCreditTransactions([]);
      setCreditTransactionCount(0);
      setCreditCode("");
      setStoreCreditLoadError("");
      setSelectedOrder(null);
      setMessage("你已安全登出。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "目前無法登出。 ");
    } finally {
      setBusy(false);
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile) return;
    setBusy(true);
    try {
      const result = await api<{ customer: Profile }>("/api/store/customers/me", "PATCH", {
        firstName: profile.firstName ?? "", lastName: profile.lastName ?? "",
        companyName: profile.companyName ?? "", phone: profile.phone ?? "",
      });
      setProfile(result.customer);
      setMessage("個人資料已更新。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "無法儲存個人資料。 ");
    } finally {
      setBusy(false);
    }
  }

  async function openOrder(orderId: string) {
    setBusy(true);
    setMessage("");
    try {
      const orderPath = "/api/store/customers/me/orders/" + encodeURIComponent(orderId);
      const [result, returnPage, claimsResult, exchangesResult, editResult] = await Promise.all([
        api<OrderDetail>(orderPath),
        api<{ returns: AccountReturn[] }>(orderPath + "/returns?limit=20&offset=0"),
        api<{ claims: AccountClaim[] }>(orderPath + "/claims"),
        api<{ exchanges: AccountExchange[] }>(orderPath + "/exchanges"),
        api<{ order_edit: AccountOrderEdit | null }>(orderPath + "/edits"),
      ]);
      setSelectedOrder(result);
      setOrderEdit(editResult.order_edit);
      setOrderReturns(returnPage.returns);
      setOrderClaims(claimsResult.claims);
      setOrderExchanges(exchangesResult.exchanges);
      setReturnableItems([]);
      setReturnQuantities({});
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "無法載入訂單。 ");
    } finally {
      setBusy(false);
    }
  }

  async function respondToOrderEdit(action: "confirm" | "decline") {
    if (!selectedOrder || !orderEdit) return;
    setBusy(true);
    setMessage("");
    try {
      const orderPath = "/api/store/customers/me/orders/" + encodeURIComponent(selectedOrder.order.id);
      await api<{ order_edit: AccountOrderEdit }>(
        orderPath + "/edits/" + encodeURIComponent(orderEdit.id) + "/" + action,
        "POST",
        {},
      );
      setOrderEdit(null);
      if (action === "confirm") {
        try {
          const refreshedOrder = await api<OrderDetail>(orderPath);
          setSelectedOrder(refreshedOrder);
        } catch {
          setMessage("你已接受訂單變更，但訂單資料暫時無法重新載入。");
          return;
        }
        setMessage("你已接受商店提出的訂單變更。");
      } else {
        setMessage("你已拒絕商店提出的訂單變更。");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "目前無法回覆訂單變更，請稍後再試。");
    } finally {
      setBusy(false);
    }
  }

  async function startReturn() {
    if (!selectedOrder) return;
    setBusy(true);
    try {
      const result = await api<{ items: ReturnableItem[] }>(
        "/api/store/customers/me/orders/" + encodeURIComponent(selectedOrder.order.id) + "/returnable-items",
      );
      setReturnableItems(result.items);
      setReturnQuantities(Object.fromEntries(result.items.map((item) => [item.id, 0])));
      if (!result.items.length) setMessage("這筆訂單目前沒有可申請退貨的品項。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "無法載入可退貨品項。 ");
    } finally {
      setBusy(false);
    }
  }

  async function submitReturn() {
    if (!selectedOrder) return;
    const items = returnableItems
      .filter((item) => (returnQuantities[item.id] ?? 0) > 0)
      .map((item) => ({ itemId: item.id, quantity: returnQuantities[item.id] }));
    if (!items.length) {
      setMessage("請先選擇要退貨的品項數量。");
      return;
    }
    setBusy(true);
    try {
      const returnPath =
        "/api/store/customers/me/orders/" + encodeURIComponent(selectedOrder.order.id) + "/returns";
      await api(
        returnPath,
        "POST",
        { items },
      );
      const returnPage = await api<{ returns: AccountReturn[] }>(returnPath + "?limit=20&offset=0");
      setOrderReturns(returnPage.returns);
      setReturnableItems([]);
      setMessage("退貨申請已送出，商店會再與你聯絡。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "無法送出退貨申請。 ");
    } finally {
      setBusy(false);
    }
  }

  async function cancelReturn(returnRequest: AccountReturn) {
    if (!selectedOrder || !window.confirm("確定撤回這筆尚未完成的退貨申請嗎？已收件的數量會保留。")) return;
    setBusy(true);
    try {
      const returnPath =
        "/api/store/customers/me/orders/" + encodeURIComponent(selectedOrder.order.id) + "/returns";
      await api(
        returnPath + "/" + encodeURIComponent(returnRequest.id),
        "DELETE",
      );
      const returnPage = await api<{ returns: AccountReturn[] }>(returnPath + "?limit=20&offset=0");
      setOrderReturns(returnPage.returns);
      setMessage("退貨申請已撤回。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "無法撤回退貨申請。 ");
    } finally {
      setBusy(false);
    }
  }

  async function saveAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const path = "/api/store/customers/me/addresses" + (selectedAddress ? "/" + encodeURIComponent(selectedAddress) : "");
      await api(path, selectedAddress ? "PATCH" : "POST", addressDraft);
      const result = await api<{ addresses: Address[] }>("/api/store/customers/me/addresses?limit=100&offset=0");
      setAddresses(result.addresses);
      setSelectedAddress(null);
      setAddressDraft(emptyAddress);
      setMessage("地址已儲存。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "無法儲存地址。 ");
    } finally {
      setBusy(false);
    }
  }

  function editAddress(address: Address) {
    setSelectedAddress(address.id);
    setAddressDraft({
      addressName: address.addressName ?? "", firstName: address.firstName ?? "",
      lastName: address.lastName ?? "", company: address.company ?? "",
      address1: address.address1 ?? "", address2: address.address2 ?? "",
      city: address.city ?? "", province: address.province ?? "",
      postalCode: address.postalCode ?? "", countryCode: address.countryCode ?? "tw",
      phone: address.phone ?? "", isDefaultShipping: address.isDefaultShipping,
      isDefaultBilling: address.isDefaultBilling,
    });
  }

  async function deleteAddress(id: string) {
    setBusy(true);
    try {
      await api("/api/store/customers/me/addresses/" + encodeURIComponent(id), "DELETE");
      setAddresses((current) => current.filter((address) => address.id !== id));
      setMessage("地址已刪除。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "無法刪除地址。 ");
    } finally {
      setBusy(false);
    }
  }

  const textInput = (key: Exclude<keyof AddressDraft, "isDefaultShipping" | "isDefaultBilling">, label: string, required = false) => (
    <label className="block text-sm">
      <span className="mb-2 block font-medium">{label}</span>
      <input
        required={required}
        maxLength={key === "address1" || key === "address2" ? 300 : key === "countryCode" ? 2 : key === "phone" ? 50 : 150}
        value={addressDraft[key]}
        onChange={(event) => {
          const value = event.currentTarget.value;
          setAddressDraft((current) => ({ ...current, [key]: value }));
        }}
        className="w-full rounded-md border border-stone-300 bg-white px-3 py-3 outline-none focus:border-stone-900"
      />
    </label>
  );

  return (
    <main className="min-h-screen bg-stone-50 px-5 py-14 text-stone-950 sm:px-8 sm:py-20">
      <section className="mx-auto max-w-5xl">
        <div className="flex flex-col justify-between gap-5 border-b border-stone-300 pb-7 sm:flex-row sm:items-end">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.22em] text-stone-500">Customer account</p>
            <h1 className="mt-4 font-serif text-4xl tracking-[-0.04em] sm:text-5xl">會員帳戶</h1>
            <p className="mt-3 text-sm leading-6 text-stone-600">管理個人資料、收件地址與訂單。</p>
          </div>
          {user ? <button type="button" onClick={() => void signOut()} disabled={busy} className="self-start border-b border-stone-400 pb-1 text-sm hover:border-stone-900 sm:self-auto">登出</button> : null}
        </div>

        {message ? <p className="mt-6 rounded-md border border-stone-300 bg-white px-4 py-3 text-sm leading-6" role="status">{message}</p> : null}

        {!user ? (
          <div className="mx-auto mt-10 max-w-xl border border-stone-200 bg-white p-6 sm:p-9">
            <div className="flex gap-6 border-b border-stone-200">
              {(["signin", "signup"] as const).map((mode) => (
                <button key={mode} type="button" onClick={() => { setAuthMode(mode); setMessage(""); }} className={"pb-3 text-sm " + (authMode === mode ? "border-b-2 border-stone-900 font-medium" : "text-stone-500")}>
                  {mode === "signin" ? "登入" : "建立帳戶"}
                </button>
              ))}
              {authMode === "verify" ? <span className="border-b-2 border-stone-900 pb-3 text-sm font-medium">電子郵件驗證</span> : null}
              {authMode === "reset" ? <span className="border-b-2 border-stone-900 pb-3 text-sm font-medium">重設密碼</span> : null}
            </div>
            <form onSubmit={(event) => void submitAuth(event)} className="mt-7 space-y-5">
              {authMode === "signup" ? <label className="block text-sm font-medium">姓名<input required maxLength={100} autoComplete="name" value={name} onChange={(event) => setName(event.currentTarget.value)} className="mt-2 w-full rounded-md border border-stone-300 px-3 py-3 font-normal outline-none focus:border-stone-900" /></label> : null}
              <label className="block text-sm font-medium">電子郵件<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.currentTarget.value)} className="mt-2 w-full rounded-md border border-stone-300 px-3 py-3 font-normal outline-none focus:border-stone-900" /></label>
              {authMode === "verify" || authMode === "reset" ? <label className="block text-sm font-medium">{authMode === "reset" ? "密碼重設驗證碼" : "電子郵件驗證碼"}<input required inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={otp} onChange={(event) => setOtp(event.currentTarget.value)} className="mt-2 w-full rounded-md border border-stone-300 px-3 py-3 font-mono font-normal tracking-[0.2em] outline-none focus:border-stone-900" /></label> : null}
              {authMode !== "verify" ? <label className="block text-sm font-medium">{authMode === "reset" ? "新密碼" : "密碼"}<input required type="password" minLength={8} autoComplete={authMode === "signin" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.currentTarget.value)} className="mt-2 w-full rounded-md border border-stone-300 px-3 py-3 font-normal outline-none focus:border-stone-900" /></label> : null}
              <button type="submit" disabled={busy} className="w-full rounded-md bg-stone-900 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-stone-800 disabled:opacity-60">{busy ? "處理中…" : authMode === "signup" ? "建立帳戶並寄送驗證碼" : authMode === "verify" ? "驗證並登入" : authMode === "reset" ? "更新密碼" : "登入會員帳戶"}</button>
            </form>
            {authMode === "signin" ? <button type="button" disabled={busy || !email.trim()} onClick={() => void sendPasswordResetCode()} className="mt-4 text-sm text-stone-600 underline underline-offset-4 disabled:opacity-50">忘記密碼？</button> : null}
            {authMode === "verify" ? <button type="button" disabled={busy || !email.trim()} onClick={() => void sendVerificationCode()} className="mt-4 text-sm text-stone-600 underline underline-offset-4 disabled:opacity-50">重新寄送驗證碼</button> : null}
            {authMode === "reset" ? <button type="button" onClick={() => { setAuthMode("signin"); setMessage(""); }} className="mt-4 text-sm text-stone-600 underline underline-offset-4">返回登入</button> : null}
          </div>
        ) : (
          <div className="mt-9 grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
            <aside className="space-y-2" aria-label="帳戶導覽">
              {(["profile", "orders", "addresses", "store-credit"] as const).map((item) => (
                <button key={item} type="button" onClick={() => { setView(item); setSelectedOrder(null); setMessage(""); }} className={"block w-full rounded-md px-4 py-3 text-left text-sm " + (view === item ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-stone-200")}>
                  {item === "profile" ? "個人資料" : item === "orders" ? "訂單紀錄" : item === "addresses" ? "收件地址" : "儲值金"}
                </button>
              ))}
            </aside>

            <div className="min-w-0">
              {view === "profile" && profile ? (
                <form onSubmit={(event) => void saveProfile(event)} className="max-w-2xl space-y-5">
                  <div><h2 className="font-serif text-2xl">個人資料</h2><p className="mt-2 text-sm text-stone-600">登入電子郵件：{profile.email}</p></div>
                  {[ ["firstName", "名字"], ["lastName", "姓氏"], ["companyName", "公司名稱"], ["phone", "電話"] ].map(([key, label]) => (
                    <label key={key} className="block text-sm font-medium">{label}<input value={(profile[key as keyof Profile] as string | null) ?? ""} onChange={(event) => { const value = event.currentTarget.value; setProfile((current) => current ? { ...current, [key]: value } : current); }} className="mt-2 w-full rounded-md border border-stone-300 bg-white px-3 py-3 font-normal outline-none focus:border-stone-900" /></label>
                  ))}
                  <button disabled={busy} className="rounded-md bg-stone-900 px-5 py-3 text-sm font-medium text-white disabled:opacity-60">儲存資料</button>
                </form>
              ) : null}

              {view === "orders" ? (
                <div>
                  <div className="flex items-end justify-between gap-4"><div><h2 className="font-serif text-2xl">訂單紀錄</h2><p className="mt-2 text-sm text-stone-600">共 {count} 筆訂單</p></div>{selectedOrder ? <button type="button" onClick={() => setSelectedOrder(null)} className="text-sm underline underline-offset-4">返回訂單列表</button> : null}</div>
                  {selectedOrder ? (
                    <div className="mt-6 border-t border-stone-300">
                      <div className="flex flex-wrap justify-between gap-3 border-b border-stone-200 py-4 text-sm"><span>訂單 #{selectedOrder.order.displayId}</span><span>{new Date(selectedOrder.order.createdAt).toLocaleDateString("zh-TW")}</span><span>{money(selectedOrder.order.total, selectedOrder.order.currencyCode)}</span></div>
                      {orderEdit ? <section className="mt-5 border border-amber-300 bg-amber-50 p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-serif text-xl">商店提出訂單變更</h3><p className="mt-2 text-sm leading-6 text-stone-700">請確認下方變更內容，再選擇接受或拒絕。</p></div><span className="text-xs text-stone-500">{orderEdit.requested_at ? new Date(orderEdit.requested_at).toLocaleDateString("zh-TW") : "等待你的回覆"}</span></div><div className="mt-4 space-y-2 border-t border-amber-200 pt-4 text-sm">{orderEdit.actions.map((action) => <div key={action.id}>{typeof action.details.email === "string" ? <p>訂單聯絡信箱：{action.details.email}</p> : null}{typeof action.details.no_notification === "boolean" ? <p>{action.details.no_notification ? "商店不會寄送訂單更新通知。" : "商店會寄送訂單更新通知。"}</p> : null}{action.action === "ITEM_UPDATE" && action.details.title && action.details.previous_quantity !== undefined && action.details.quantity !== undefined ? <p>商品數量調整：{action.details.title} · {action.details.previous_quantity} 件 → {action.details.quantity} 件</p> : null}{action.action === "ITEM_REMOVE" && action.details.title ? <p>移除商品：{action.details.title} · 原數量 {action.details.previous_quantity ?? "—"} 件</p> : null}{action.details.previous_order_total !== undefined && action.details.proposed_order_total !== undefined ? <p className="font-medium">訂單總額：{money(action.details.previous_order_total, selectedOrder.order.currencyCode)} → {money(action.details.proposed_order_total, selectedOrder.order.currencyCode)}</p> : null}</div>)}</div><div className="mt-5 flex flex-wrap gap-3"><button type="button" disabled={busy} onClick={() => void respondToOrderEdit("confirm")} className="rounded-md bg-stone-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50">接受變更</button><button type="button" disabled={busy} onClick={() => void respondToOrderEdit("decline")} className="rounded-md border border-stone-400 px-4 py-2.5 text-sm hover:border-stone-900 disabled:opacity-50">拒絕變更</button></div></section> : null}
                      {selectedOrder.items.map((item) => <div key={item.id} className="flex justify-between gap-4 border-b border-stone-200 py-4 text-sm"><span>{item.title} × {item.quantity}</span><span>{money(item.unitPrice * item.quantity, selectedOrder.order.currencyCode)}</span></div>)}
                      {orderReturns.length ? <section className="mt-6 border-t border-stone-200 pt-5"><h3 className="font-serif text-xl">退貨進度</h3><div className="mt-3 divide-y divide-stone-200">{orderReturns.map((returnRequest) => <article key={returnRequest.id} className="py-4"><div className="flex flex-wrap justify-between gap-3 text-sm"><span>退貨 #{returnRequest.displayId}</span><span>{returnStatusLabel(returnRequest.status)}</span></div><p className="mt-2 text-xs text-stone-500">{returnRequest.requestedAt ? new Date(returnRequest.requestedAt).toLocaleDateString("zh-TW") : "等待商店確認日期"}</p><ul className="mt-2 space-y-1 text-sm text-stone-600">{returnRequest.items.map((item) => <li key={item.id}>{item.title} · 申請 {item.quantity} 件，已收 {item.receivedQuantity} 件</li>)}</ul>{(returnRequest.status === "requested" || returnRequest.status === "partially_received") && !returnRequest.claimId && !returnRequest.exchangeId ? <button type="button" disabled={busy} onClick={() => void cancelReturn(returnRequest)} className="mt-3 rounded-md border border-stone-400 px-3 py-2 text-xs hover:border-stone-900 disabled:opacity-50">撤回退貨申請</button> : null}</article>)}</div></section> : null}
                      {orderClaims.length ? <section className="mt-6 border-t border-stone-200 pt-5"><h3 className="font-serif text-xl">退款與補寄處理</h3><div className="mt-3 divide-y divide-stone-200">{orderClaims.map((claim) => { const linkedReturn = orderReturns.find((returnRequest) => returnRequest.id === claim.returnId); return <article key={claim.id} className="py-4"><div className="flex flex-wrap justify-between gap-3 text-sm"><span>{claim.type === "refund" ? "退款申請" : "商品補寄申請"} #{claim.displayId}</span><span>{claim.canceledAt ? "已取消" : linkedReturn ? returnStatusLabel(linkedReturn.status) : "已記錄"}</span></div><p className="mt-2 text-xs text-stone-500">{new Date(claim.createdAt).toLocaleDateString("zh-TW")}</p><ul className="mt-2 space-y-1 text-sm text-stone-600">{claim.items.map((item) => <li key={item.id}>{item.isAdditionalItem ? "補寄：" : ""}{item.title} × {item.quantity}{item.reason ? " · " + ({ missing_item: "缺少品項", wrong_item: "品項錯誤", production_failure: "商品瑕疵", other: "其他" }[item.reason] ?? "") : ""}</li>)}</ul>{claim.type === "refund" && !claim.canceledAt ? <p className="mt-2 text-xs leading-5 text-stone-500">退款申請已記錄；商店會通知後續處理狀態。</p> : null}</article>; })}</div></section> : null}
                      {orderExchanges.length ? <section className="mt-6 border-t border-stone-200 pt-5"><h3 className="font-serif text-xl">換貨進度</h3><div className="mt-3 divide-y divide-stone-200">{orderExchanges.map((exchange) => <article key={exchange.id} className="py-4"><div className="flex flex-wrap justify-between gap-3 text-sm"><span>換貨 #{exchange.displayId}</span><span>{exchange.canceledAt ? "已取消" : exchange.returnStatus ? returnStatusLabel(exchange.returnStatus) : "商店處理中"}</span></div><p className="mt-2 text-xs text-stone-500">{new Date(exchange.createdAt).toLocaleDateString("zh-TW")}</p><ul className="mt-2 space-y-1 text-sm text-stone-600">{exchange.inboundItems.map((item) => <li key={item.id}>寄回：{item.title} × {item.quantity} · 已收 {item.receivedQuantity} 件</li>)}{exchange.items.map((item) => <li key={item.id}>更換為：{item.title} × {item.quantity}</li>)}</ul></article>)}</div></section> : null}
                      <button type="button" disabled={busy} onClick={() => void startReturn()} className="mt-5 rounded-md border border-stone-400 px-4 py-2.5 text-sm hover:border-stone-900 disabled:opacity-50">申請退貨</button>
                      {returnableItems.length ? <div className="mt-5 space-y-3 border-t border-stone-200 pt-5"><h3 className="font-medium">選擇退貨品項與數量</h3>{returnableItems.map((item) => <label key={item.id} className="flex items-center justify-between gap-4 text-sm"><span>{item.title}（可退 {item.returnableQuantity} 件）</span><input type="number" min={0} max={item.returnableQuantity} value={returnQuantities[item.id] ?? 0} onChange={(event) => { const quantity = Math.min(item.returnableQuantity, Math.max(0, Number(event.currentTarget.value))); setReturnQuantities((current) => ({ ...current, [item.id]: quantity })); }} className="w-20 rounded-md border border-stone-300 px-2 py-2" /></label>)}<button type="button" disabled={busy} onClick={() => void submitReturn()} className="rounded-md bg-stone-900 px-4 py-2.5 text-sm text-white disabled:opacity-50">送出退貨申請</button></div> : null}
                    </div>
                  ) : orders.length ? (
                    <div className="mt-6 divide-y divide-stone-200 border-y border-stone-300">{orders.map((order) => <button key={order.id} type="button" onClick={() => void openOrder(order.id)} className="flex w-full flex-wrap items-center justify-between gap-3 py-5 text-left text-sm hover:bg-stone-100"><span>訂單 #{order.displayId}<span className="ml-3 text-stone-500">{new Date(order.createdAt).toLocaleDateString("zh-TW")}</span></span><span>{money(order.total, order.currencyCode)} <span className="ml-2 text-stone-500">查看 →</span></span></button>)}</div>
                  ) : <p className="mt-6 border-y border-stone-300 py-6 text-sm text-stone-600">目前沒有訂單。</p>}
                  {!selectedOrder && orders.length < count ? <button type="button" disabled={busy} onClick={() => void loadMoreOrders()} className="mt-5 text-sm underline underline-offset-4 disabled:opacity-50">載入更多訂單</button> : null}
                </div>
              ) : null}

              {view === "addresses" ? (
                <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(300px,0.8fr)]">
                  <div><h2 className="font-serif text-2xl">收件地址</h2>{addresses.length ? <div className="mt-5 space-y-3">{addresses.map((address) => <article key={address.id} className="border border-stone-200 bg-white p-4"><div className="flex justify-between gap-3"><div className="text-sm"><p className="font-medium">{address.addressName || [address.firstName, address.lastName].filter(Boolean).join(" ") || "收件地址"}</p><p className="mt-2 text-stone-600">{[address.address1, address.address2, address.city, address.province, address.postalCode, address.countryCode?.toUpperCase()].filter(Boolean).join("、")}</p><p className="mt-1 text-stone-500">{address.phone}</p>{address.isDefaultShipping || address.isDefaultBilling ? <p className="mt-2 text-xs text-stone-500">{address.isDefaultShipping ? "預設配送" : ""}{address.isDefaultShipping && address.isDefaultBilling ? " · " : ""}{address.isDefaultBilling ? "預設帳單" : ""}</p> : null}</div><div className="flex shrink-0 gap-3 text-xs"><button type="button" onClick={() => editAddress(address)} className="underline underline-offset-4">編輯</button><button type="button" disabled={busy} onClick={() => void deleteAddress(address.id)} className="text-red-700 underline underline-offset-4">刪除</button></div></div></article>)}</div> : <p className="mt-4 text-sm text-stone-600">尚未儲存地址。</p>}</div>
                  <form onSubmit={(event) => void saveAddress(event)} className="space-y-4 border-t border-stone-300 pt-5 xl:border-l xl:border-t-0 xl:pl-7 xl:pt-0"><div className="flex justify-between gap-4"><h3 className="font-serif text-xl">{selectedAddress ? "編輯地址" : "新增地址"}</h3>{selectedAddress ? <button type="button" onClick={() => { setSelectedAddress(null); setAddressDraft(emptyAddress); }} className="text-xs underline">取消</button> : null}</div>{textInput("addressName", "地址名稱")}{textInput("firstName", "名字", true)}{textInput("lastName", "姓氏", true)}{textInput("company", "公司名稱")}{textInput("phone", "電話")}{textInput("address1", "地址", true)}{textInput("address2", "地址補充")}{textInput("city", "縣市", true)}{textInput("province", "行政區")}{textInput("postalCode", "郵遞區號")}{textInput("countryCode", "國家代碼（例如 TW）", true)}<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={addressDraft.isDefaultShipping} onChange={(event) => { const checked = event.currentTarget.checked; setAddressDraft((current) => ({ ...current, isDefaultShipping: checked })); }} />設為預設配送地址</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={addressDraft.isDefaultBilling} onChange={(event) => { const checked = event.currentTarget.checked; setAddressDraft((current) => ({ ...current, isDefaultBilling: checked })); }} />設為預設帳單地址</label><button disabled={busy} className="rounded-md bg-stone-900 px-5 py-3 text-sm font-medium text-white disabled:opacity-60">{selectedAddress ? "儲存變更" : "新增地址"}</button></form>
                </div>
              ) : null}

              {view === "store-credit" ? (
                <section className="max-w-3xl space-y-8">
                  <div>
                    <h2 className="font-serif text-2xl">儲值金</h2>
                    <p className="mt-2 text-sm leading-6 text-stone-600">查看可用餘額與交易紀錄，也可以兌領商店提供的儲值金代碼。</p>
                  </div>
                  <form onSubmit={(event) => void claimStoreCredit(event)} className="space-y-4 border border-stone-200 bg-white p-5 sm:p-6">
                    <label className="block text-sm font-medium">
                      儲值金兌領碼
                      <input
                        required
                        minLength={64}
                        maxLength={64}
                        pattern="[a-fA-F0-9]{64}"
                        autoComplete="off"
                        spellCheck={false}
                        value={creditCode}
                        onChange={(event) => setCreditCode(event.currentTarget.value)}
                        className="mt-2 w-full rounded-md border border-stone-300 px-3 py-3 font-mono font-normal tracking-[0.08em] outline-none focus:border-stone-900"
                      />
                    </label>
                    <p className="text-xs leading-5 text-stone-500">請輸入商店寄給你的 64 位英數兌領碼；兌領後餘額會綁定目前登入的帳戶。</p>
                    <button type="submit" disabled={busy || creditCode.trim().length !== 64} className="rounded-md bg-stone-900 px-5 py-3 text-sm font-medium text-white disabled:cursor-wait disabled:opacity-50">{busy ? "處理中…" : "兌領儲值金"}</button>
                  </form>

                  {storeCreditLoadError ? <p className="border-y border-amber-300 bg-amber-50 py-4 text-sm leading-6 text-amber-950" role="alert">{storeCreditLoadError}</p> : null}

                  {!storeCreditLoadError && storeCreditAccounts.length ? (
                    <div>
                      <h3 className="font-serif text-xl">我的餘額</h3>
                      <div className="mt-4 divide-y divide-stone-200 border-y border-stone-300">
                        {storeCreditAccounts.map((account) => (
                          <article key={account.id} className="flex flex-wrap items-center justify-between gap-4 py-5">
                            <div>
                              <p className="text-xs uppercase tracking-[0.16em] text-stone-500">{account.currency_code.toUpperCase()} 儲值金</p>
                              <p className="mt-2 font-serif text-2xl">{majorMoney(account.balance, account.currency_code)}</p>
                              <p className="mt-2 text-xs text-stone-500">累計增加 {majorMoney(account.total_credits, account.currency_code)} · 累計使用 {majorMoney(account.total_debits, account.currency_code)}</p>
                            </div>
                            <button type="button" disabled={busy} onClick={() => void openStoreCreditAccount(account.id)} className="rounded-md border border-stone-300 px-4 py-2.5 text-sm hover:border-stone-900 disabled:opacity-50">{selectedCreditAccountId === account.id ? "重新載入紀錄" : "查看交易紀錄"}</button>
                          </article>
                        ))}
                      </div>
                    </div>
                  ) : !storeCreditLoadError ? (
                    <p className="border-y border-stone-300 py-6 text-sm text-stone-600">目前沒有儲值金餘額；取得兌領碼後可在上方加入帳戶。</p>
                  ) : null}

                  {selectedCreditAccountId ? (
                    <div>
                      <div className="flex flex-wrap items-end justify-between gap-3">
                        <div>
                          <h3 className="font-serif text-xl">交易紀錄</h3>
                          <p className="mt-2 text-xs text-stone-500">帳戶末碼 {selectedCreditAccountId.slice(-8)} · 共 {creditTransactionCount} 筆</p>
                        </div>
                        <button type="button" onClick={() => { setSelectedCreditAccountId(null); setCreditTransactions([]); setCreditTransactionCount(0); }} className="text-sm underline underline-offset-4">收合</button>
                      </div>
                      {creditTransactions.length ? (
                        <div className="mt-4 divide-y divide-stone-200 border-y border-stone-300">
                          {creditTransactions.map((transaction) => (
                            <div key={transaction.id} className="flex flex-wrap justify-between gap-3 py-4 text-sm">
                              <div>
                                <p className="font-medium">{transaction.note || (transaction.type === "credit" ? "儲值金增加" : "使用儲值金")}</p>
                                <p className="mt-1 text-xs text-stone-500">{new Date(transaction.created_at).toLocaleString("zh-TW")}</p>
                              </div>
                              <span className={transaction.type === "credit" ? "font-medium text-emerald-800" : "font-medium text-stone-700"}>
                                {transaction.type === "credit" ? "+" : "−"}{majorMoney(transaction.amount, storeCreditAccounts.find((account) => account.id === selectedCreditAccountId)?.currency_code ?? "TWD")}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-4 border-y border-stone-300 py-5 text-sm text-stone-600">此帳戶目前沒有交易紀錄。</p>
                      )}
                      {creditTransactions.length < creditTransactionCount ? <button type="button" disabled={busy} onClick={() => void loadMoreCreditTransactions()} className="mt-4 text-sm underline underline-offset-4 disabled:opacity-50">載入更多交易紀錄</button> : null}
                    </div>
                  ) : null}
                </section>
              ) : null}
            </div>
          </div>
        )}
      </section>
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
  {
    path: "src/routes/order-transfer.tsx",
    mimeType: "text/typescript",
    content: STARTER_THEME_ORDER_TRANSFER_ROUTE_SOURCE,
  },
  {
    path: "src/routes/account.tsx",
    mimeType: "text/typescript",
    content: STARTER_THEME_CUSTOMER_ACCOUNT_ROUTE_SOURCE,
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
    content: `import type { ThemeContentFields } from "../morph/content-fields";

export type EditorialIntroProps = {
  label?: string;
  heading?: string;
  body?: string;
};

export const contentFields = {
  label: { type: "text", label: "Label", maxLength: 100 },
  heading: { type: "text", label: "Heading", maxLength: 200 },
  body: { type: "textarea", label: "Body", maxLength: 500 },
} as const satisfies ThemeContentFields;

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
          className="text-xs font-medium uppercase tracking-[0.22em] text-stone-500"
        >
          {label}
        </p>
        <div>
          <h2
            className="max-w-4xl font-serif text-[clamp(3rem,6vw,6.5rem)] leading-[0.92] tracking-[-0.045em] text-stone-950"
          >
            {heading}
          </h2>
          <p
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
  return (
    <section
      className="grid bg-[#d8d0c3] lg:grid-cols-2"
    >
      <div
        className="min-h-[32rem] overflow-hidden lg:min-h-[52rem]"
      >
        <img
          src={image?.src ?? imageSrc ?? "/static/storefront/theme-preview-default.png"}
          alt={image?.alt ?? imageAlt ?? "Image with text"}
          style={{ objectPosition: imagePosition }}
          className="size-full scale-110 object-cover"
        />
      </div>
      <div className="flex items-center px-[clamp(2rem,7vw,7rem)] py-20">
        <div className="max-w-xl">
          <p
            className="text-xs font-medium uppercase tracking-[0.22em] text-stone-600"
          >
            {eyebrow}
          </p>
          <h2
            className="mt-5 font-serif text-[clamp(3rem,5vw,5.5rem)] leading-[0.94] tracking-[-0.045em] text-stone-950"
          >
            {heading}
          </h2>
          <p
            className="mt-7 text-base leading-7 text-stone-700"
          >
            {body}
          </p>
          <ThemeLink
            link={action}
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
    content: `import type { ThemeContentFields } from "../morph/content-fields";

export type NewsletterProps = {
  eyebrow?: string;
  heading?: string;
  body?: string;
  placeholder?: string;
  actionLabel?: string;
};

export const contentFields = {
  eyebrow: { type: "text", label: "Eyebrow", maxLength: 100 },
  heading: { type: "text", label: "Heading", maxLength: 200 },
  body: { type: "textarea", label: "Body", maxLength: 700 },
  placeholder: { type: "text", label: "Placeholder", maxLength: 100 },
  actionLabel: { type: "text", label: "Action label", maxLength: 100 },
} as const satisfies ThemeContentFields;

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
          className="text-xs font-medium uppercase tracking-[0.24em] text-stone-700"
        >
          {eyebrow}
        </p>
        <h2
          className="mt-6 font-serif text-[clamp(3rem,6vw,6rem)] leading-[0.92] tracking-[-0.045em] text-stone-950"
        >
          {heading}
        </h2>
        <p
          className="mx-auto mt-6 max-w-lg text-base leading-7 text-stone-700"
        >
          {body}
        </p>
        <div
          className="mx-auto mt-10 flex max-w-xl border-b border-stone-800 py-3 text-left"
          aria-label={placeholder}
        >
          <span className="flex-1 text-sm text-stone-700">
            {placeholder}
          </span>
          <span className="text-sm font-medium text-stone-950">
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
