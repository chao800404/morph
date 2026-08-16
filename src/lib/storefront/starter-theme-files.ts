export const STARTER_THEME_FILES: Array<{
  path: string;
  content: string;
  mimeType: string;
  isEntry?: boolean;
}> = [
  {
    path: "package.json",
    mimeType: "application/json",
    content: JSON.stringify(
      {
        name: "morph-storefront-theme",
        version: "1.0.0",
        private: true,
        type: "module",
        dependencies: {
          react: "^19.0.0",
          "react-dom": "^19.0.0",
          "lucide-react": "^0.475.0",
          "clsx": "^2.1.1",
          "tailwind-merge": "^3.0.1",
        },
      },
      null,
      2,
    ),
  },
  {
    path: "src/styles/global.css",
    mimeType: "text/css",
    content: `@import "tailwindcss";

:root {
  --color-brand-primary: #1c1917;
  --color-brand-accent: #78716c;
  --font-serif: Georgia, Cambria, "Times New Roman", Times, serif;
}

body {
  margin: 0;
  padding: 0;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: #1c1917;
  background-color: #fafaf9;
}
`,
  },
  {
    path: "src/components/Hero.tsx",
    mimeType: "text/typescript",
    content: `export type HeroProps = {
  eyebrow?: string;
  heading?: string;
  description?: string;
  actionLabel?: string;
  actionHref?: string;
  imageSrc?: string;
  imageAlt?: string;
};

export default function Hero({
  eyebrow = "New collection",
  heading = "Objects for everyday rituals.",
  description = "Quiet essentials, thoughtfully made for the spaces you call home.",
  actionLabel = "Explore the collection",
  actionHref = "/collections/new",
  imageSrc = "/static/storefront/theme-preview-default.png",
  imageAlt = "A neutral collection of ceramic objects",
}: HeroProps) {
  return (
    <section
      data-morph-section="hero"
      data-morph-node="hero-root"
      className="grid min-h-[42rem] bg-stone-100 lg:min-h-[50rem] lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]"
    >
      <div className="flex items-center px-[clamp(1.75rem,6vw,6rem)] py-20">
        <div className="max-w-xl">
          <p
            data-morph-node="hero-eyebrow"
            data-morph-element="eyebrow"
            className="text-xs font-medium uppercase tracking-[0.24em] text-stone-500"
          >
            {eyebrow}
          </p>
          <h1
            data-morph-node="hero-heading"
            data-morph-element="heading"
            className="mt-6 font-serif text-[clamp(3.25rem,7vw,7rem)] leading-[0.88] tracking-[-0.055em] text-stone-950"
          >
            {heading}
          </h1>
          <p
            data-morph-node="hero-description"
            data-morph-element="description"
            className="mt-7 max-w-md text-base leading-7 text-stone-600"
          >
            {description}
          </p>
          <div className="mt-8">
            <a
              href={actionHref}
              data-morph-node="hero-action"
              data-morph-element="action"
              className="inline-flex items-center justify-center rounded-md bg-stone-900 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-stone-800"
            >
              {actionLabel}
            </a>
          </div>
        </div>
      </div>
      <div
        data-morph-node="hero-image"
        data-morph-element="image"
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
`,
  },
  {
    path: "src/components/Header.tsx",
    mimeType: "text/typescript",
    content: `export default function Header({ storeName = "Online Store" }: { storeName?: string }) {
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
`,
  },
  {
    path: "src/components/Footer.tsx",
    mimeType: "text/typescript",
    content: `export default function Footer({ storeName = "Online Store" }: { storeName?: string }) {
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
`,
  },
  {
    path: "src/pages/index.tsx",
    isEntry: true,
    mimeType: "text/typescript",
    content: `import Header from "../components/Header";
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
`,
  },
  {
    path: "morph.theme.json",
    mimeType: "application/json",
    content: JSON.stringify(
      {
        name: "Dawn Starter",
        version: "1.0.0",
        author: "Morph Studio",
        entry: "src/pages/index.tsx",
        components: {
          "hero.default": {
            name: "Hero",
            source: "src/components/Hero.tsx",
            sectionType: "hero",
          },
          "layout.header": {
            name: "Header",
            source: "src/components/Header.tsx",
          },
          "layout.footer": {
            name: "Footer",
            source: "src/components/Footer.tsx",
          },
        },
        sections: {
          hero: {
            componentRef: "hero.default",
            source: "src/components/Hero.tsx",
          },
        },
      },
      null,
      2,
    ),
  },
];
