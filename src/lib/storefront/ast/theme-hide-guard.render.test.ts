import { describe, expect, it } from "vitest";
import type { StorefrontPageDocument } from "@/db/storefront.schema";
import {
  livePreviewPlatformFiles,
  renderLivePreviewRoute,
} from "@/lib/test-utils/live-preview-render";

/**
 * M3 Hide P3, rendered (client-only Live Preview harness, E1-level): the
 * product preview transform, real React, a real router and the preview's own
 * content resolver. In-process only: the full Start preview (E2) and a real
 * build (E3) are container acceptance, not measured here.
 *
 * Each "guard off" case is the same render with only the guard switched off,
 * showing the assertion can see the failure the guard removes.
 */

const ROUTE = "src/routes/index.tsx";
const PAGE_MARK = "PAGE-RENDERS";

const HERO = `export const contentFields = {
  title: { type: "text", label: "Title" },
  subtitle: { type: "text", label: "Subtitle" },
} as const;
export default function Hero({ title = "HERO-DEFAULT", subtitle = "SUB-DEFAULT" }: { title?: string; subtitle?: string; cta?: string }) {
  return <section><h1>{title}</h1><p>{subtitle}</p></section>;
}
`;

const H1_ROUTE = `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import Hero from "../components/Hero";
export const Route = createFileRoute("/")({ component: Home });
function Home() {
  return (
    <main>
      <p>${PAGE_MARK}</p>
      <Hero {...content("h1")} />
    </main>
  );
}
`;

/** Deep access and a call-site derivation, through the loader's page. */
const H2_ROUTE = `import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { morph } from "../morph/content";
import Hero from "../components/Hero";
const getPage = createServerFn().handler(() => morph.pages.get("/"));
export const Route = createFileRoute("/")({ loader: () => getPage(), component: Home });
function Home() {
  const page = Route.useLoaderData();
  return (
    <main>
      <p>${PAGE_MARK}</p>
      <Hero
        title={page.h2.title.toUpperCase()}
        subtitle={page.h2.subtitle}
        cta={page.h2.cta.label}
      />
    </main>
  );
}
`;

const files = (route: string) => [
  ...livePreviewPlatformFiles(),
  { path: "src/components/Hero.tsx", content: HERO },
  { path: ROUTE, content: route },
];

const index = (
  sections: StorefrontPageDocument["sections"],
): { index: StorefrontPageDocument } => ({
  index: { version: 1, sections } as StorefrontPageDocument,
});

const h1 = (enabled: boolean) =>
  index([
    { id: "h1", type: "hero", enabled, props: { title: "H1-STORED" } },
  ] as StorefrontPageDocument["sections"]);
const h2 = (enabled: boolean) =>
  index([
    {
      id: "h2",
      type: "hero",
      enabled,
      props: {
        title: "h2-stored",
        subtitle: "H2-SUB",
        cta: { label: "H2-CTA" },
      },
    },
  ] as StorefrontPageDocument["sections"]);

describe("a hidden section in the Live Preview, with Morph's guard", () => {
  it("H1: not rendered, no defaults; shown again, its stored values return", async () => {
    const hidden = await renderLivePreviewRoute({
      files: files(H1_ROUTE),
      documents: h1(false),
    });
    expect(hidden.html).toContain(PAGE_MARK);
    expect(hidden.html).not.toContain("HERO-DEFAULT");
    expect(hidden.html).not.toContain("H1-STORED");
    expect(hidden.html).not.toContain("<section>");
    expect(hidden.prepared.bindings.hideGuarded).toEqual({ [ROUTE]: ["h1"] });

    const shown = await renderLivePreviewRoute({
      files: files(H1_ROUTE),
      documents: h1(true),
    });
    expect(shown.html).toContain("H1-STORED");
    expect(shown.html).not.toContain("HERO-DEFAULT");
  });

  it("H1, guard off: the component defaults show", async () => {
    const { html } = await renderLivePreviewRoute({
      files: files(H1_ROUTE),
      documents: h1(false),
      hideGuards: false,
    });
    expect(html).toContain("HERO-DEFAULT");
  });

  it("H2: deep access and a derived value at the call site do not crash, and nothing renders", async () => {
    const hidden = await renderLivePreviewRoute({
      files: files(H2_ROUTE),
      documents: h2(false),
    });
    expect(hidden.html).toContain(PAGE_MARK);
    expect(hidden.html).not.toContain("<section>");
    expect(hidden.html).not.toContain("H2-SUB");
    expect(hidden.html).not.toContain("SUB-DEFAULT");

    const shown = await renderLivePreviewRoute({
      files: files(H2_ROUTE),
      documents: h2(true),
    });
    expect(shown.html).toContain("H2-STORED");
    expect(shown.html).toContain("H2-SUB");
  });

  it("H2, guard off: the page crashes reading the absent section", async () => {
    // The route throws while rendering; the router either rethrows or
    // renders its error boundary instead of the page. Either way the page
    // is gone, which is the crash the guard prevents.
    const outcome = await renderLivePreviewRoute({
      files: files(H2_ROUTE),
      documents: h2(false),
      hideGuards: false,
    }).then(
      (render) => render.html,
      (error: unknown) => error,
    );
    if (typeof outcome === "string") {
      expect(outcome).not.toContain(PAGE_MARK);
    } else {
      expect(outcome).toBeInstanceOf(Error);
    }
  });
});
