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

export const STARTER_THEME_HEADER_SOURCE = `export type HeaderLink = {
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
        className="font-serif text-lg font-semibold tracking-tight"
      >
        {storeName}
      </span>
      <nav
        className="hidden items-center gap-7 text-xs text-neutral-600 sm:flex"
        aria-label="Storefront navigation"
      >
        {navItems.map((item) => (
          <a
            key={item.label}
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

export const STARTER_THEME_FOOTER_SOURCE = `export type FooterLink = {
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
        <p className="font-serif text-3xl text-stone-100">{storeName}</p>
        <p className="mt-4 max-w-xs text-sm leading-6 text-stone-500">
          {tagline}
        </p>
      </div>
      <div
        className="text-sm leading-8"
      >
        <p className="mb-2 text-xs uppercase tracking-[0.18em] text-stone-600">{exploreHeading}</p>
        {exploreItems.map((item) => (
          <a
            key={item.label}
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
        <p className="mb-2 text-xs uppercase tracking-[0.18em] text-stone-600">{helpHeading}</p>
        {helpItems.map((item) => (
          <a
            key={item.label}
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

/** The v4 starter keeps the old page shell as a compatibility source while
 * making the real Theme contract a standard TanStack Start route tree. */
export const STARTER_THEME_LAYOUT_SOURCE = STARTER_THEME_INDEX_SOURCE;

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

export const STARTER_THEME_V3_NEW_FILES = [
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
    content: `export type CategoryShowcaseItem = {
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
`,
  },
  {
    path: "src/components/ImageWithText.tsx",
    mimeType: "text/typescript",
    content: `export type ImageWithTextProps = {
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
`,
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
