import { describe, expect, it } from "vitest";
import { livePreviewPlatformFiles } from "@/lib/test-utils/live-preview-render";
import { STARTER_THEME_FILES } from "@/lib/storefront/starter-theme-files";
import {
  classifyHideCapability,
  type HideCapability,
  type HideCapabilityScope,
} from "./theme-hide-capability";
import type { B1SourceFile } from "./theme-content-provenance";

/**
 * M3 Hide P1: the capability classifier over the plan's fixture H1–H10
 * (handoff/2026-11-02/m3-hide-plan-draft.md §4.1), v1 scope per D104/D107.
 * Expectations are written by hand, never derived from the analysis.
 */

const ROUTE = "src/routes/index.tsx";
const LAYOUT = "src/layouts/StorefrontLayout.tsx";

const HERO = `export const contentFields = {
  title: { type: "text", label: "Title" },
  subtitle: { type: "text", label: "Subtitle" },
} as const;
export default function Hero({ title = "HERO-DEFAULT", subtitle = "SUB-DEFAULT" }: { title?: string; subtitle?: string }) {
  return (
    <section>
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </section>
  );
}
`;

const CARD = `export const contentFields = {
  title: { type: "text", label: "Title" },
  cta: { type: "text", label: "Call to action" },
} as const;
export default function Card({ title = "CARD-DEFAULT", cta = "CTA-DEFAULT" }: { title?: string; cta?: string }) {
  return (
    <article>
      <h2>{title}</h2>
      <a href="#">{cta}</a>
    </article>
  );
}
`;

/** A component that reads its own content (H10a). */
const PROMO = `import { content } from "../morph/content";
export default function Promo() {
  const values = content("h10");
  return <h2>{String(values.title ?? "PROMO-DEFAULT")}</h2>;
}
`;

const contentRoute = (body: string, extraImports = "") =>
  `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import Hero from "../components/Hero";
${extraImports}
export const Route = createFileRoute("/")({ component: Home });

function Home() {
${body}
}
`;

const loaderRoute = (
  body: string,
  morphImport = `import { morph } from "../morph/content";`,
) =>
  `import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
${morphImport}
import Hero from "../components/Hero";
import Card from "../components/Card";

const getPage = createServerFn().handler(() => morph.pages.get("/"));

export const Route = createFileRoute("/")({
  loader: () => getPage(),
  component: Home,
});

function Home() {
${body}
}
`;

function theme(
  route: string,
  extra: readonly B1SourceFile[] = [],
): B1SourceFile[] {
  const files = new Map<string, B1SourceFile>();
  for (const file of [
    ...livePreviewPlatformFiles(),
    { path: "src/components/Hero.tsx", content: HERO },
    { path: "src/components/Card.tsx", content: CARD },
    { path: "src/components/Promo.tsx", content: PROMO },
    { path: ROUTE, content: route },
    ...extra,
  ]) {
    files.set(file.path, file);
  }
  return [...files.values()];
}

function classify(
  files: readonly B1SourceFile[],
  slot: string,
  scope: HideCapabilityScope = "route",
  callSitePath: string | null = scope === "layout" ? LAYOUT : ROUTE,
): HideCapability {
  return classifyHideCapability({ files, callSitePath, slot, scope });
}

function siteText(files: readonly B1SourceFile[], capability: HideCapability) {
  if (capability.kind !== "supported") return [];
  return capability.sites.map((site) =>
    files
      .find((file) => file.path === site.file)!
      .content.slice(site.start, site.end),
  );
}

const H1 = contentRoute(`  return (
    <main>
      <Hero {...content("h1")} />
    </main>
  );`);

const H2 = loaderRoute(`  const page = Route.useLoaderData();
  return (
    <main>
      <Card title={page.h2.title} cta={page.h2.cta.label} />
    </main>
  );`);

describe("classifyHideCapability: supported v1 shapes", () => {
  it("H1: a content() spread with no guard is supported, at its own call site", () => {
    const files = theme(H1);
    const capability = classify(files, "h1");
    expect(capability).toMatchObject({
      kind: "supported",
      sites: [
        {
          file: ROUTE,
          root: "content",
          position: "child",
          contentImportSource: "../morph/content",
          pageLocal: null,
        },
      ],
    });
    expect(siteText(files, capability)).toEqual([
      `<Hero {...content("h1")} />`,
    ]);
  });

  it("H2: loader nested member reads at the call site are supported through the page local", () => {
    const files = theme(H2);
    const capability = classify(files, "h2");
    expect(capability).toMatchObject({
      kind: "supported",
      sites: [{ root: "loader", position: "child", pageLocal: "page" }],
    });
    expect(siteText(files, capability)).toEqual([
      `<Card title={page.h2.title} cta={page.h2.cta.label} />`,
    ]);
  });

  it("H4: a value derived at the call site is never evaluated outside it", () => {
    const files = theme(
      loaderRoute(`  const page = Route.useLoaderData();
  return (
    <main>
      <Hero title={page.h4.title.toUpperCase()} subtitle={page.h4.subtitle} />
    </main>
  );`),
    );
    expect(classify(files, "h4")).toMatchObject({
      kind: "supported",
      sites: [{ root: "loader", pageLocal: "page" }],
    });
  });

  it("H6: a layout section read by an author layout through content() is supported", () => {
    const layout = `import type { ReactNode } from "react";
import { content } from "../morph/content";
import Hero from "../components/Hero";
export default function StorefrontLayout({ children }: { children?: ReactNode }) {
  return (
    <div>
      <Hero {...content("h6")} />
      {children}
    </div>
  );
}
`;
    const about = `import { createFileRoute } from "@tanstack/react-router";
import Card from "../components/Card";
export const Route = createFileRoute("/about")({ component: About });
function About() {
  return <Card title="About" />;
}
`;
    const files = theme(H1, [
      { path: LAYOUT, content: layout },
      { path: "src/routes/about.tsx", content: about },
    ]);
    expect(classify(files, "h6", "layout")).toMatchObject({
      kind: "supported",
      sites: [{ file: LAYOUT, root: "content", position: "child" }],
    });

    // Reverse: a route that reads the same layout slot itself.
    const reads = files.map((file) =>
      file.path === "src/routes/about.tsx"
        ? {
            ...file,
            content: about
              .replace(
                `import Card from "../components/Card";`,
                `import Card from "../components/Card";\nimport { content } from "../morph/content";`,
              )
              .replace(`title="About"`, `title={String(content("h6").title)}`),
          }
        : file,
    );
    expect(classify(reads, "h6", "layout")).toMatchObject({
      kind: "unsupported",
      reason: "component-reads-content",
      at: { file: "src/routes/about.tsx" },
    });
  });

  it("H7: an untouched Starter route keeps its own guard, which is recognised and left alone", () => {
    const files = STARTER_THEME_FILES.map((file) => ({
      path: file.path,
      content: file.content,
    }));
    const route = files.find((file) => file.path === ROUTE)!;
    expect(route.content).toContain(`!isSectionHidden("starter-hero") &&`);
    expect(classify(files, "starter-hero")).toMatchObject({
      kind: "supported",
      sites: [{ root: "content", position: "guarded" }],
    });
  });

  it("a call site returned directly is supported with return brackets", () => {
    const files = theme(
      contentRoute(`  return <Hero {...content("solo")} />;`),
    );
    expect(classify(files, "solo")).toMatchObject({
      kind: "supported",
      sites: [{ position: "return" }],
    });
  });
});

describe("classifyHideCapability: refused before hiding", () => {
  it("H3: an alias of the section is outside v1 (D107 Q3)", () => {
    const files = theme(
      loaderRoute(`  const { h3: hero } = Route.useLoaderData();
  return (
    <main>
      <Hero title={hero.title} subtitle={hero.subtitle} />
    </main>
  );`),
    );
    expect(classify(files, "h3")).toMatchObject({
      kind: "unsupported",
      reason: "unsupported-shape",
    });
  });

  it("H5: one slot rendered at two call sites is outside v1", () => {
    const files = theme(
      contentRoute(`  return (
    <main>
      <Hero {...content("h5")} />
      <Hero {...content("h5")} />
    </main>
  );`),
    );
    expect(classify(files, "h5")).toMatchObject({
      kind: "unsupported",
      reason: "unsupported-shape",
    });
  });

  it("H8: an @morph/sdk/start loader is not proven by B1 yet, so no call site is found", () => {
    const files = theme(
      loaderRoute(
        `  const page = Route.useLoaderData();
  return (
    <main>
      <Card title={page.h8.title} cta={page.h8.cta} />
    </main>
  );`,
        `import { morph } from "@morph/sdk/start";`,
      ),
    );
    expect(classify(files, "h8")).toMatchObject({
      kind: "unsupported",
      reason: "no-call-site",
    });
  });

  it("H9: a value computed before the JSX is refused as early computation, with its line", () => {
    const files = theme(
      loaderRoute(`  const page = Route.useLoaderData();
  const t = page.h9.title.toUpperCase();
  return <Hero title={t} />;`),
    );
    expect(classify(files, "h9")).toMatchObject({
      kind: "unsupported",
      reason: "early-computation",
      at: { file: ROUTE, line: 16 },
    });
  });

  it("H10a: a component that calls content() itself is refused", () => {
    const files = theme(
      contentRoute(
        `  return (
    <main>
      <Promo />
    </main>
  );`,
        `import Promo from "../components/Promo";`,
      ),
    );
    expect(classify(files, "h10")).toMatchObject({
      kind: "unsupported",
      reason: "component-reads-content",
      at: { file: "src/components/Promo.tsx", line: 3 },
    });
  });

  it("H10b: an untraced spread at the call site is refused", () => {
    const files = theme(
      contentRoute(
        `  const extra = makeExtra();
  return (
    <main>
      <Hero {...content("h10")} {...extra} />
    </main>
  );`,
        `import { makeExtra } from "../lib/extra";`,
      ),
      [
        {
          path: "src/lib/extra.ts",
          content: "export const makeExtra = () => ({});",
        },
      ],
    );
    expect(classify(files, "h10")).toMatchObject({
      kind: "unsupported",
      reason: "untraced-spread",
    });
  });

  it("a legacy shell that names no call site is refused", () => {
    expect(classify(theme(H1), "header", "layout", null)).toMatchObject({
      kind: "unsupported",
      reason: "legacy-shell",
    });
  });
});

describe("classifyHideCapability: reverse checks (one variable each)", () => {
  it("moving H9's computation into the call site makes it supported", () => {
    const early = theme(
      loaderRoute(`  const page = Route.useLoaderData();
  const t = page.h9.title.toUpperCase();
  return <Hero title={t} subtitle={page.h9.subtitle} />;`),
    );
    const atCallSite = theme(
      loaderRoute(`  const page = Route.useLoaderData();
  return <Hero title={page.h9.title.toUpperCase()} subtitle={page.h9.subtitle} />;`),
    );
    expect(classify(early, "h9")).toMatchObject({
      reason: "early-computation",
    });
    expect(classify(atCallSite, "h9")).toMatchObject({ kind: "supported" });
  });

  it("H1 inside a condition is refused; the same element unconditioned is supported", () => {
    const conditional = theme(
      contentRoute(`  const show = Math.random() > 0.5;
  return (
    <main>
      {show && <Hero {...content("h1")} />}
    </main>
  );`),
    );
    expect(classify(conditional, "h1")).toMatchObject({
      kind: "unsupported",
      reason: "unsupported-shape",
    });
    expect(classify(theme(H1), "h1")).toMatchObject({ kind: "supported" });
  });

  it("A6: an edited content module that no longer exports isSectionHidden refuses a content() hide", () => {
    const files = theme(H1);
    const edited = files.map((file) =>
      file.path === "src/morph/content.ts"
        ? {
            ...file,
            content: file.content.replace(
              "export function isSectionHidden(",
              "function isSectionHidden(",
            ),
          }
        : file,
    );
    expect(edited).not.toEqual(files);
    expect(classify(edited, "h1")).toMatchObject({
      kind: "unsupported",
      reason: "content-module-unconfirmed",
      at: { file: "src/morph/content.ts" },
    });
    expect(classify(files, "h1")).toMatchObject({ kind: "supported" });
  });

  it("A6: any edit to the content module refuses a loader hide (byte match only)", () => {
    const files = theme(H2);
    const edited = files.map((file) =>
      file.path === "src/morph/content.ts"
        ? { ...file, content: `${file.content}\n// edited\n` }
        : file,
    );
    expect(classify(edited, "h2")).toMatchObject({
      kind: "unsupported",
      reason: "content-module-unconfirmed",
    });
    expect(classify(files, "h2")).toMatchObject({ kind: "supported" });
  });

  it("handing the whole page to a function refuses the hide; the same route without it is supported", () => {
    const escaped = theme(
      loaderRoute(`  const page = Route.useLoaderData();
  track(page);
  return (
    <main>
      <Card title={page.h2.title} cta={page.h2.cta.label} />
    </main>
  );`).replace(
        "function Home() {",
        "declare function track(value: unknown): void;\nfunction Home() {",
      ),
    );
    expect(classify(escaped, "h2")).toMatchObject({
      kind: "unsupported",
      reason: "untraced-use",
    });
    expect(classify(theme(H2), "h2")).toMatchObject({ kind: "supported" });
  });

  it("a component reading the slot itself refuses it; without that component it is supported", () => {
    const withPromo = theme(
      contentRoute(
        `  return (
    <main>
      <Hero {...content("h10")} />
      <Promo />
    </main>
  );`,
        `import Promo from "../components/Promo";`,
      ),
    );
    const withoutPromo = theme(
      contentRoute(`  return (
    <main>
      <Hero {...content("h10")} />
    </main>
  );`),
    );
    expect(classify(withPromo, "h10")).toMatchObject({
      reason: "component-reads-content",
    });
    expect(classify(withoutPromo, "h10")).toMatchObject({ kind: "supported" });
  });

  it("classifying reads the source and never changes it", () => {
    const files = theme(H2);
    const before = JSON.stringify(files);
    classify(files, "h2");
    classify(files, "missing");
    expect(JSON.stringify(files)).toBe(before);
  });
});
