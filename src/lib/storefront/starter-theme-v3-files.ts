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

export const STARTER_THEME_HEADER_SOURCE = `export type HeaderProps = {
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

export const STARTER_THEME_FOOTER_SOURCE = `export type FooterProps = {
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

/** The v4 starter keeps the old page shell as a compatibility source while
 * making the real Theme contract a standard TanStack Start route tree. */
export const STARTER_THEME_LAYOUT_SOURCE = STARTER_THEME_INDEX_SOURCE;

export const STARTER_THEME_ROOT_ROUTE_SOURCE = `import type { ReactNode } from "react";
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
  return <main data-morph-node="home-route" />;
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

export const STARTER_THEME_HOME_ROUTE_SOURCE = `import { createFileRoute } from "@tanstack/react-router";
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
    <main data-morph-node="home-route">
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

export const STARTER_THEME_V4_NEW_FILES = [
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
      data-morph-section="editorial-intro"
      data-morph-node="editorial-intro-root"
      className="bg-stone-50 px-[clamp(1.75rem,7vw,7rem)] py-[clamp(6rem,12vw,11rem)]"
    >
      <div className="grid gap-10 border-t border-stone-300 pt-8 lg:grid-cols-[0.55fr_1.45fr]">
        <p
          data-storefront-field="label"
          data-morph-node="editorial-intro-label"
          data-morph-element="label"
          className="text-xs font-medium uppercase tracking-[0.22em] text-stone-500"
        >
          {label}
        </p>
        <div data-morph-node="editorial-intro-content" data-morph-element="content">
          <h2
            data-storefront-field="heading"
            data-morph-node="editorial-intro-heading"
            data-morph-element="heading"
            className="max-w-4xl font-serif text-[clamp(3rem,6vw,6.5rem)] leading-[0.92] tracking-[-0.045em] text-stone-950"
          >
            {heading}
          </h2>
          <p
            data-storefront-field="body"
            data-morph-node="editorial-intro-body"
            data-morph-element="body"
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
      data-morph-section="category-showcase"
      data-morph-node="category-showcase-root"
      className="bg-stone-900 px-[clamp(1.25rem,4vw,4rem)] py-[clamp(5rem,9vw,9rem)] text-stone-100"
    >
      <div className="mb-12 flex items-end justify-between border-b border-stone-700 pb-6">
        <h2
          data-storefront-field="heading"
          data-morph-node="category-showcase-heading"
          data-morph-element="heading"
          className="font-serif text-[clamp(2.5rem,5vw,5rem)] tracking-[-0.04em]"
        >
          {heading}
        </h2>
        <span className="hidden text-xs uppercase tracking-[0.2em] text-stone-400 sm:block">
          The collection
        </span>
      </div>
      <div
        data-morph-node="category-showcase-grid"
        data-morph-element="grid"
        className="grid gap-4 lg:grid-cols-3"
      >
        {items.map((item, index) => (
          <a
            key={item.href ?? index}
            href={item.href ?? "#"}
            data-storefront-field-path={\`items.\${index}\`}
            data-morph-node="category-showcase-item"
            data-morph-element="collection-item"
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
  imageSrc = "/static/storefront/theme-preview-default.png",
  imageAlt = "Image with text",
  imagePosition = "center",
}: ImageWithTextProps) {
  return (
    <section
      data-morph-section="image-with-text"
      data-morph-node="image-with-text-root"
      className="grid bg-[#d8d0c3] lg:grid-cols-2"
    >
      <div
        data-morph-node="image-with-text-image"
        data-morph-element="image"
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
        <div data-morph-node="image-with-text-content" data-morph-element="content" className="max-w-xl">
          <p
            data-storefront-field="eyebrow"
            data-morph-node="image-with-text-eyebrow"
            data-morph-element="eyebrow"
            className="text-xs font-medium uppercase tracking-[0.22em] text-stone-600"
          >
            {eyebrow}
          </p>
          <h2
            data-storefront-field="heading"
            data-morph-node="image-with-text-heading"
            data-morph-element="heading"
            className="mt-5 font-serif text-[clamp(3rem,5vw,5.5rem)] leading-[0.94] tracking-[-0.045em] text-stone-950"
          >
            {heading}
          </h2>
          <p
            data-storefront-field="body"
            data-morph-node="image-with-text-body"
            data-morph-element="body"
            className="mt-7 text-base leading-7 text-stone-700"
          >
            {body}
          </p>
          <a
            href={actionHref}
            data-storefront-field="actionLabel"
            data-morph-node="image-with-text-action"
            data-morph-element="action"
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
      data-morph-section="newsletter"
      data-morph-node="newsletter-root"
      className="bg-[#b7ad9d] px-[clamp(1.75rem,8vw,8rem)] py-[clamp(6rem,11vw,10rem)]"
    >
      <div data-morph-node="newsletter-content" data-morph-element="content" className="mx-auto max-w-4xl text-center">
        <p
          data-storefront-field="eyebrow"
          data-morph-node="newsletter-eyebrow"
          data-morph-element="eyebrow"
          className="text-xs font-medium uppercase tracking-[0.24em] text-stone-700"
        >
          {eyebrow}
        </p>
        <h2
          data-storefront-field="heading"
          data-morph-node="newsletter-heading"
          data-morph-element="heading"
          className="mt-6 font-serif text-[clamp(3rem,6vw,6rem)] leading-[0.92] tracking-[-0.045em] text-stone-950"
        >
          {heading}
        </h2>
        <p
          data-storefront-field="body"
          data-morph-node="newsletter-body"
          data-morph-element="body"
          className="mx-auto mt-6 max-w-lg text-base leading-7 text-stone-700"
        >
          {body}
        </p>
        <div
          data-morph-node="newsletter-form"
          data-morph-element="form"
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
