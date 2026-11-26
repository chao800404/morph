import { describe, expect, it } from "vitest";
import { livePreviewPlatformFiles } from "@/lib/test-utils/live-preview-render";
import {
  createHideCapabilityAnalyzer,
  hideRefusalMessage,
  type HideCapability,
  type HideRefusalReason,
} from "./theme-hide-capability";
import type { B1SourceFile } from "./theme-content-provenance";

/**
 * M3 Hide approach E: the review of f1bcc7a
 * (~/handoff/2026-11-27/hide-compiler-guard-codex-review.txt). Each case is
 * a Theme the classifier admitted although a hidden section could still
 * render, or render something in its place.
 */

const ROUTE = "src/routes/index.tsx";

const FIELDS = `export const contentFields = {
  title: { type: "text", label: "Title" },
} as const;
`;
const HERO = `${FIELDS}export default function Hero({ title = "HERO-DEFAULT" }: { title?: string }) {
  return <section><h1>{title}</h1></section>;
}
`;

const route = (body: string, imports = "", mount = `      <Hero {...content("hero")} />`) =>
  `import { createFileRoute } from "@tanstack/react-router";
import { content, isSectionHidden } from "../morph/content";
${imports || `import Hero from "../components/Hero";`}
export const Route = createFileRoute("/")({ component: Home });
function Home() {
  return (
    <main>
${mount}
${body}
    </main>
  );
}
`;

function theme(routeSource: string, extra: B1SourceFile[] = []): B1SourceFile[] {
  const files = [
    ...livePreviewPlatformFiles(),
    { path: "src/components/Hero.tsx", content: HERO },
    { path: ROUTE, content: routeSource },
  ];
  const paths = new Set(extra.map((file) => file.path));
  return [...files.filter((file) => !paths.has(file.path)), ...extra];
}

const classify = (files: B1SourceFile[], slot = "hero"): HideCapability =>
  createHideCapabilityAnalyzer(files).classify({
    callSitePath: ROUTE,
    slot,
    scope: "route",
  });

function expectRefused(
  verdict: HideCapability,
  reason: HideRefusalReason,
  file?: string,
) {
  expect(verdict).toMatchObject({ kind: "unsupported", reason });
  if (verdict.kind !== "unsupported") return;
  expect(verdict.message.startsWith(hideRefusalMessage(reason))).toBe(true);
  if (file) expect(verdict.at?.file).toBe(file);
}

const PROMO_MOUNT = `      <Promo />`;
const PROMO_IMPORT = `import Hero from "../components/Hero";\nimport Promo from "../components/Promo";`;

describe("P1-1: every way to reach the section's component is followed", () => {
  it("control: the plain Theme is hideable", () => {
    expect(classify(theme(route("")))).toMatchObject({ kind: "supported" });
  });

  it("a named export of the same implementation, rendered with no content", () => {
    const files = theme(route(PROMO_MOUNT, PROMO_IMPORT), [
      {
        path: "src/components/Hero.tsx",
        content: `${FIELDS}export function Hero({ title = "HERO-DEFAULT" }: { title?: string }) {
  return <section><h1>{title}</h1></section>;
}
export default Hero;
`,
      },
      {
        path: "src/components/Promo.tsx",
        content: `import { Hero } from "./Hero";\nexport default function Promo() { return <Hero />; }\n`,
      },
    ]);
    expectRefused(classify(files), "unguarded-mount", "src/components/Promo.tsx");
  });

  it("control: the section mounted through a barrel is hideable", () => {
    const files = theme(
      route("", `import { Hero } from "../components";`),
      [{ path: "src/components/index.ts", content: `export { default as Hero } from "./Hero";\n` }],
    );
    expect(classify(files)).toMatchObject({ kind: "supported" });
  });

  it("a direct import of the file, while the section is mounted through a barrel", () => {
    const files = theme(
      route(PROMO_MOUNT, `import { Hero } from "../components";\nimport Promo from "../components/Promo";`),
      [
        { path: "src/components/index.ts", content: `export { default as Hero } from "./Hero";\n` },
        {
          path: "src/components/Promo.tsx",
          content: `import Hero from "./Hero";\nexport default function Promo() { return <Hero />; }\n`,
        },
      ],
    );
    expectRefused(classify(files), "unguarded-mount", "src/components/Promo.tsx");
  });

  it("a second mount inside the component's own module", () => {
    const files = theme(
      route(`      <HeroPromo />`, `import Hero, { HeroPromo } from "../components/Hero";`),
      [
        {
          path: "src/components/Hero.tsx",
          content: `${HERO}export function HeroPromo() {
  return <aside><Hero /></aside>;
}
`,
        },
      ],
    );
    expectRefused(classify(files), "unguarded-mount", "src/components/Hero.tsx");
  });

  it("a literal dynamic import, mounted through React.lazy", () => {
    const files = theme(route(PROMO_MOUNT, PROMO_IMPORT), [
      {
        path: "src/components/Promo.tsx",
        content: `import { lazy, Suspense } from "react";
const LazyHero = lazy(() => import("./Hero"));
export default function Promo() {
  return <Suspense fallback={null}><LazyHero /></Suspense>;
}
`,
      },
    ]);
    expectRefused(classify(files), "unguarded-mount", "src/components/Promo.tsx");
  });

  it("a dynamic import whose module Morph cannot tell", () => {
    const files = theme(route(PROMO_MOUNT, PROMO_IMPORT), [
      {
        path: "src/components/Promo.tsx",
        content: `import { lazy, Suspense } from "react";
const name = "Hero";
const LazyHero = lazy(() => import(\`./\${name}\`));
export default function Promo() {
  return <Suspense fallback={null}><LazyHero /></Suspense>;
}
`,
      },
    ]);
    expectRefused(classify(files), "unguarded-mount", "src/components/Promo.tsx");
  });

  it("a component wrapped before it is exported, rendered elsewhere unwrapped", () => {
    const files = theme(route(PROMO_MOUNT, PROMO_IMPORT), [
      {
        path: "src/components/Hero.tsx",
        content: `import { memo } from "react";
${FIELDS}export function HeroBody({ title = "HERO-DEFAULT" }: { title?: string }) {
  return <section><h1>{title}</h1></section>;
}
export default memo(HeroBody);
`,
      },
      {
        path: "src/components/Promo.tsx",
        content: `import { HeroBody } from "./Hero";\nexport default function Promo() { return <HeroBody />; }\n`,
      },
    ]);
    expectRefused(classify(files), "unguarded-mount");
  });
});

describe("P1-2: the Starter's own check is exempt only when it just omits the section", () => {
  const guarded = (expression: string) =>
    theme(route("", `import Hero from "../components/Hero";\nimport Promo from "../components/Promo";`, `      {${expression}}`), [
      {
        path: "src/components/Promo.tsx",
        content: `${FIELDS}export default function Promo({ title = "PROMO-DEFAULT" }: { title?: string }) {
  return <aside>{title}</aside>;
}
`,
      },
    ]);

  it("control: the exact check around the section's own mount", () => {
    expect(
      classify(guarded(`!isSectionHidden("hero") && <Hero {...content("hero")} />`)),
    ).toMatchObject({ kind: "supported" });
  });

  it("refuses fallback markup rendered when the section is hidden", () => {
    expectRefused(
      classify(
        guarded(
          `(!isSectionHidden("hero") && <Hero {...content("hero")} />) || <p>HERO-FALLBACK</p>`,
        ),
      ),
      "untraced-use",
      ROUTE,
    );
  });

  it("refuses the check of one section around another's mount", () => {
    const files = theme(
      route(
        `      {!isSectionHidden("hero") && <Promo {...content("promo")} />}`,
        `import Hero from "../components/Hero";\nimport Promo from "../components/Promo";`,
      ),
      guarded("null").filter((file) => file.path === "src/components/Promo.tsx"),
    );
    expectRefused(classify(files, "hero"), "untraced-use", ROUTE);
  });

  it("refuses the check's result kept rather than rendered", () => {
    const files = theme(
      `import { createFileRoute } from "@tanstack/react-router";
import { content, isSectionHidden } from "../morph/content";
import Hero from "../components/Hero";
export const Route = createFileRoute("/")({ component: Home });
function Home() {
  const hero = !isSectionHidden("hero") && <Hero {...content("hero")} />;
  return <main>{hero || <p>HERO-FALLBACK</p>}</main>;
}
`,
    );
    expect(classify(files)).toMatchObject({ kind: "unsupported" });
  });
});

describe("P2-6: the root pin counts what the compiler reads in comments and directives", () => {
  const withRoot = (edit: (source: string) => string) => {
    const files = theme(route(""));
    return files.map((file) =>
      file.path === "src/routes/__root.tsx"
        ? { ...file, content: edit(file.content) }
        : file,
    );
  };

  it("control: a plain comment added to the root changes nothing", () => {
    expect(
      classify(withRoot((source) => `// The storefront's root.\n${source}`)),
    ).toMatchObject({ kind: "supported" });
  });

  it.each([
    ["@jsxImportSource", "/** @jsxImportSource preact */\n"],
    ["@jsx", "/** @jsx h */\n"],
    ["@jsxRuntime", "/** @jsxRuntime classic */\n"],
    ["@jsxFrag", "/** @jsxFrag Fragment */\n"],
  ])("refuses a root that gained a %s pragma", (_, pragma) => {
    expectRefused(
      classify(withRoot((source) => `${pragma}${source}`)),
      "root-route-unconfirmed",
      "src/routes/__root.tsx",
    );
  });

  it("refuses a root that gained a directive", () => {
    expectRefused(
      classify(withRoot((source) => `"use client";\n${source}`)),
      "root-route-unconfirmed",
      "src/routes/__root.tsx",
    );
  });
});
