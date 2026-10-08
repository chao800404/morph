import type { ThemeBuildContentSnapshot } from "../dto/storefront-theme-build.dto";

/**
 * A minimal Astro Theme for the prerender-content tests (docs/astro-theme-plan.md
 * 4.3, A3), the shape R2 used: a visible content reader that, like a typical
 * Theme, falls back to the component's default on any failed read.
 *
 * Three values for one field: the component default D, the sealed value A,
 * and the current draft B that changes after the build was created. A
 * prerendered page must hold A; D means a read failed quietly, B means the
 * build read something other than its sealed content.
 */
export const VALUE_DEFAULT = "A3-DEFAULT-D";
export const VALUE_SEALED = "A3-SEALED-A";
export const VALUE_DRAFT = "A3-DRAFT-B";

export const astroConfig = (extra = "") => `import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";

export default defineConfig({
  output: "server",
  adapter: cloudflare({ imageService: "passthrough", inspectorPort: false }),
  session: false,
  devToolbar: { enabled: false },
  telemetry: false,
  ${extra}
});
`;

const WRANGLER = `{
  "name": "morph-astro-a3",
  "main": "@astrojs/cloudflare/entrypoints/server",
  "compatibility_date": "2026-09-01",
  "compatibility_flags": ["nodejs_compat"]
}
`;

const CONTENT_READER = `// The Theme's own reader: origin from the request header only, content from
// GET <origin>/_morph/content?path=. Any failure renders the defaults.
export async function heroHeadline(request: Request, pathname: string): Promise<string | undefined> {
  const origin = request.headers.get("x-morph-content-origin");
  if (!origin) return undefined;
  try {
    const response = await fetch(origin + "/_morph/content?path=" + encodeURIComponent(pathname));
    if (!response.ok) return undefined;
    const content = await response.json();
    return content?.slots?.hero?.headline;
  } catch {
    return undefined;
  }
}
`;

const HERO = `---
const { headline = ${JSON.stringify(VALUE_DEFAULT)} } = Astro.props;
---
<h1 data-hero>{headline}</h1>
`;

const READING_PAGE = `---
import Hero from "../components/Hero.astro";
import { heroHeadline } from "../morph/content";
export const prerender = true;
const headline = await heroHeadline(Astro.request, Astro.url.pathname);
---
<html><body><Hero headline={headline} /></body></html>
`;

const PLAIN_PAGE = `---
export const prerender = true;
---
<html><body><p>A3-PLAIN-PAGE</p></body></html>
`;

const SSR_PAGE = `---
import Hero from "../components/Hero.astro";
import { heroHeadline } from "../morph/content";
export const prerender = false;
const headline = await heroHeadline(Astro.request, Astro.url.pathname);
---
<html><body><Hero headline={headline} /></body></html>
`;

/** Pages that read content, by path under `src/pages/`. */
export const READING_PAGES = {
  home: "index.astro",
  about: "about.astro",
  chinese: "關於.astro",
} as const;

/** The Theme's files; `pages` chooses which reading pages it has. */
export function astroThemeFiles(
  options: {
    config?: string;
    pages?: readonly string[];
    plain?: boolean;
    extra?: readonly Readonly<{ path: string; content: string }>[];
  } = {},
): readonly Readonly<{ path: string; content: string }>[] {
  const pages = options.pages ?? [READING_PAGES.home, READING_PAGES.about];
  return [
    { path: "astro.config.mjs", content: options.config ?? astroConfig() },
    { path: "wrangler.jsonc", content: WRANGLER },
    {
      path: "package.json",
      content: '{ "name": "morph-astro-a3", "type": "module" }\n',
    },
    { path: "src/morph/content.ts", content: CONTENT_READER },
    { path: "src/components/Hero.astro", content: HERO },
    { path: "src/pages/ssr.astro", content: SSR_PAGE },
    ...pages.map((page) => ({
      path: `src/pages/${page}`,
      content: READING_PAGE,
    })),
    ...(options.plain
      ? [{ path: "src/pages/plain.astro", content: PLAIN_PAGE }]
      : []),
    ...(options.extra ?? []),
  ];
}

/** A dynamic page that reads content for paths it lists itself. */
export const DYNAMIC_READING_PAGE = `---
import Hero from "../../components/Hero.astro";
import { heroHeadline } from "../../morph/content";
export const prerender = true;
export function getStaticPaths() {
  return [{ params: { slug: "first" } }];
}
const headline = await heroHeadline(Astro.request, Astro.url.pathname);
---
<html><body><Hero headline={headline} /></body></html>
`;

/**
 * A sealed snapshot holding A for the home page (the index template) and for
 * each route-owned path in `routes`.
 */
export function sealedSnapshot(
  routes: readonly string[],
  headline = VALUE_SEALED,
): ThemeBuildContentSnapshot {
  const section = {
    id: "hero",
    type: "hero",
    enabled: true,
    props: { headline },
  };
  return {
    publicationId: "pub",
    storefrontId: "store",
    themeId: "theme",
    documents: [
      {
        item: {
          id: "item-index",
          publicationId: "pub",
          itemType: "template",
          contentId: "index",
          revisionId: "revision",
          metadata: { templateType: "index" },
        },
        document: { version: 1, sections: [section] },
      },
      ...routes.map((routePath, index) => ({
        item: {
          id: `item-${index}`,
          publicationId: "pub",
          itemType: "template",
          contentId: `page-${index}`,
          revisionId: "revision",
          metadata: { routePath },
        },
        document: { version: 1, sections: [section] },
      })),
    ],
  } as never;
}
