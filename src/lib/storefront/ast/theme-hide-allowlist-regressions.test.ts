import { describe, expect, it } from "vitest";
import { livePreviewPlatformFiles } from "@/lib/test-utils/live-preview-render";
import { starterThemeWorkspaceFiles } from "@/lib/storefront/starter-theme-files";
import {
  createHideCapabilityAnalyzer,
  hideRefusalMessage,
  type HideCapability,
  type HideRefusalReason,
} from "./theme-hide-capability";
import type { B1SourceFile } from "./theme-content-provenance";

/**
 * M3 Hide approach E: the bypasses the managed Starter allowlist branch
 * (feat/m3-hide-starter-allowlist, 766a138) pinned that the whole-Theme proof
 * did not, judged against the compiler guard. Each is refused with its own
 * reason; none is "hideable" while the section's component would still
 * render somewhere with its defaults, or while the Theme builds through
 * inputs Morph does not run.
 */

const ROUTE = "src/routes/index.tsx";
const LAYOUT = "src/layouts/StorefrontLayout.tsx";

const HERO = `export const contentFields = {
  title: { type: "text", label: "Title" },
} as const;
export default function Hero({ title = "HERO-DEFAULT" }: { title?: string }) {
  return <section><h1>{title}</h1></section>;
}
`;

const route = (body: string, imports = "") =>
  `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import Hero from "../components/Hero";
${imports}
export const Route = createFileRoute("/")({ component: Home });
function Home() {
  return (
    <main>
      <Hero {...content("hero")} />
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

const classify = (
  files: B1SourceFile[],
  slot = "hero",
  callSitePath = ROUTE,
): HideCapability =>
  createHideCapabilityAnalyzer(files).classify({
    callSitePath,
    slot,
    scope: callSitePath === LAYOUT ? "layout" : "route",
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

describe("the section's component rendered other than as a section", () => {
  it("control: the plain Theme is hideable", () => {
    expect(classify(theme(route("")))).toMatchObject({ kind: "supported" });
  });

  it("a new component that renders the hero with no content", () => {
    const files = theme(
      route(`      <Promo />`, `import Promo from "../components/Promo";`),
      [
        {
          path: "src/components/Promo.tsx",
          content: `import Hero from "./Hero";\nexport default function Promo() { return <div><Hero /></div>; }\n`,
        },
      ],
    );
    expectRefused(classify(files), "unguarded-mount", "src/components/Promo.tsx");
  });

  it("the same, through a re-export", () => {
    const files = theme(
      route(`      <Promo />`, `import Promo from "../components/Promo";`),
      [
        {
          path: "src/components/heroes.ts",
          content: `export { default as TheHero } from "./Hero";\n`,
        },
        {
          path: "src/components/Promo.tsx",
          content: `import { TheHero } from "./heroes";\nexport default function Promo() { return <TheHero title="Hi" />; }\n`,
        },
      ],
    );
    expectRefused(classify(files), "unguarded-mount", "src/components/Promo.tsx");
  });

  it("the same, through a namespace import of a module that re-exports it", () => {
    const files = theme(
      route(`      <Promo />`, `import Promo from "../components/Promo";`),
      [
        { path: "src/components/index.ts", content: `export { default as Hero } from "./Hero";\n` },
        {
          path: "src/components/Promo.tsx",
          content: `import * as C from "./index";\nexport default function Promo() { return <C.Hero />; }\n`,
        },
      ],
    );
    expectRefused(classify(files), "unguarded-mount", "src/components/Promo.tsx");
  });

  it("the component used as a value", () => {
    const files = theme(route(""), [
      {
        path: "src/components/Promo.tsx",
        content: `import { createElement } from "react";\nimport Hero from "./Hero";\nexport default function Promo() { return createElement(Hero); }\n`,
      },
    ]);
    expectRefused(classify(files), "unguarded-mount", "src/components/Promo.tsx");
  });

  it("a second mount of the same component for another section is a section of its own", () => {
    const files = theme(route(`      <Hero {...content("hero-2")} />`));
    expect(classify(files)).toMatchObject({ kind: "supported" });
    expect(classify(files, "hero-2")).toMatchObject({ kind: "supported" });
  });

  it("the layout's Header rendered a second time", () => {
    const files = theme(route(""), [
      {
        path: LAYOUT,
        content: `import type { ReactNode } from "react";
import { content } from "../morph/content";
import Header from "../components/Header";
export default function StorefrontLayout({ children }: { children?: ReactNode }) {
  return <div><Header {...content("header")} />{children}</div>;
}
`,
      },
      {
        path: "src/components/Header.tsx",
        content: `export default function Header({ storeName = "Online Store" }: { storeName?: string }) { return <header>{storeName}</header>; }\n`,
      },
      {
        path: "src/components/Sticky.tsx",
        content: `import Header from "./Header";\nexport default function Sticky() { return <Header />; }\n`,
      },
    ]);
    expectRefused(classify(files, "header", LAYOUT), "unguarded-mount", "src/components/Sticky.tsx");
  });

  it("control: the untouched Starter hides every home and layout section", () => {
    const files = starterThemeWorkspaceFiles().map((file) => ({
      path: file.path,
      content: file.content,
    }));
    const analyzer = createHideCapabilityAnalyzer(files);
    for (const slot of analyzer.sectionsIn(ROUTE)) {
      expect(
        analyzer.classify({ callSitePath: ROUTE, slot, scope: "route" }),
        slot,
      ).toMatchObject({ kind: "supported" });
    }
    for (const slot of analyzer.sectionsIn(LAYOUT)) {
      expect(
        analyzer.classify({ callSitePath: LAYOUT, slot, scope: "layout" }),
        slot,
      ).toMatchObject({ kind: "supported" });
    }
    expect(analyzer.sectionsIn(ROUTE)).toHaveLength(6);
    expect(analyzer.sectionsIn(LAYOUT)).toHaveLength(2);
  });
});

describe("build inputs Morph does not run", () => {
  it.each([
    ["a root-level tool config", "postcss.config.js", `export default { plugins: [] };\n`],
    ["a .morph/ file", ".morph/plugin.mjs", `export default {};\n`],
    ["a package.json under src/", "src/morph/package.json", `{"main":"./content.ts"}`],
    ["a Start server entry", "src/server.ts", `export default {};\n`],
    ["a Start client entry", "src/client.tsx", `export {};\n`],
    ["a CSS @plugin", "src/styles/extra.css", `@plugin "./plugin.js";\n`],
  ])("%s", (_, path, content) => {
    const files = theme(route(""), [{ path, content }]);
    expectRefused(classify(files), "custom-build", path);
  });

  it("control: a stylesheet, a JSON file and a README change nothing", () => {
    const files = theme(route(""), [
      { path: "src/styles/extra.css", content: "p { color: red; }\n" },
      { path: "src/data/site.json", content: "{}" },
      { path: "README.md", content: "# Theme\n" },
    ]);
    expect(classify(files)).toMatchObject({ kind: "supported" });
  });
});
