import { describe, expect, it } from "vitest";
import { parse as parseBabel } from "@babel/parser";
import { livePreviewPlatformFiles } from "@/lib/test-utils/live-preview-render";
import {
  STARTER_THEME_FILES,
  starterThemeWorkspaceFiles,
} from "@/lib/storefront/starter-theme-files";
import { injectPreviewBindings } from "./inject-preview-bindings";
import { applyHideGuards, planHideGuards } from "./theme-hide-guard";
import {
  buildHideGuardVersion,
  withThemeMorphSdkIdentity,
  withThemeStartBuildIdentity,
} from "../compiler/theme-morph-sdk";
import { THEME_HIDE_GUARD_VERSION } from "./theme-hide-guard-version";
import { prepareSourcesForBuild } from "../source-language/tsx-source-language";
import { themeFramework } from "../theme-framework";
import { planNativeStartBuild } from "../theme-framework/tanstack-start-native-build";

/**
 * M3 Hide, approach E step 1: Morph's compiled guard, the same plan in
 * preview and build. Every section Morph can hide is mounted through the
 * platform's gate (`@morph/sdk/section-gate`):
 *
 *   <__MorphSectionGate slot={"x"} render={() => (<El …author props…/>)} />
 *
 * The gate reads the hidden list once, at its own top level, from the root
 * route's snapshot; the section's props are built only inside `render`, in a
 * body the gate mounts while the section is visible. Expected output is
 * written by hand.
 */

const ROUTE = "src/routes/index.tsx";
const LAYOUT = "src/layouts/StorefrontLayout.tsx";
const GATE_IMPORT = `import { MorphSectionGate as __MorphSectionGate } from "@morph/sdk/section-gate";`;
const PAGE_GATE_IMPORT = `import { MorphPageSectionGate as __MorphPageSectionGate } from "@morph/sdk/section-gate";`;
const gate = (slot: string, element: string) =>
  `<__MorphSectionGate slot={${JSON.stringify(slot)}} render={() => (${element})} />`;

const HERO = `export const contentFields = {
  title: { type: "text", label: "Title" },
  subtitle: { type: "text", label: "Subtitle" },
} as const;
export default function Hero({ title = "HERO-DEFAULT", subtitle = "SUB-DEFAULT" }) {
  return <section><h1>{title}</h1><p>{subtitle}</p></section>;
}
`;

const contentRoute = (body: string) =>
  `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import Hero from "../components/Hero";
export const Route = createFileRoute("/")({ component: Home });
function Home() {
${body}
}
`;

const loaderRoute = (body: string) =>
  `import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { morph } from "../morph/content";
import Hero from "../components/Hero";
const getPage = createServerFn().handler(() => morph.pages.get("/"));
export const Route = createFileRoute("/")({ loader: () => getPage(), component: Home });
function Home() {
${body}
}
`;

const theme = (route: string) => [
  ...livePreviewPlatformFiles(),
  { path: "src/components/Hero.tsx", content: HERO },
  { path: ROUTE, content: route },
];

const routeOut = (files: ReadonlyArray<{ path: string; content: string }>) =>
  files.find((file) => file.path === ROUTE)!.content;

const parses = (source: string) =>
  parseBabel(source, { sourceType: "module", plugins: ["jsx", "typescript"] });

describe("applyHideGuards (the build's guard)", () => {
  it("H1: mounts a content() spread child through the gate, importing it on the first import's line", () => {
    const route = contentRoute(
      `  return <main><Hero {...content("h1")} /></main>;`,
    );
    const result = applyHideGuards(theme(route));
    expect(routeOut(result.files)).toBe(
      `import { createFileRoute } from "@tanstack/react-router"; ${GATE_IMPORT}
import { content } from "../morph/content";
import Hero from "../components/Hero";
export const Route = createFileRoute("/")({ component: Home });
function Home() {
  return <main>${gate("h1", `<Hero {...content("h1")} />`)}</main>;
}
`,
    );
    expect(result.guarded).toEqual({ [ROUTE]: ["h1"] });
  });

  it("H2: a loader site's gate takes the hidden list of the page the slot comes from", () => {
    const route = loaderRoute(`  const page = Route.useLoaderData();
  return <main><Hero title={page.h2.title} subtitle={page.h2.cta.label} /></main>;`);
    const out = routeOut(applyHideGuards(theme(route)).files);
    expect(out).toContain(PAGE_GATE_IMPORT);
    expect(out).toContain(
      `<main><__MorphPageSectionGate slot={"h2"} hidden={page?._hidden} render={() => (<Hero title={page.h2.title} subtitle={page.h2.cta.label} />)} /></main>`,
    );
  });

  it("a returned call site is the gate element itself", () => {
    const route = contentRoute(`  return <Hero {...content("solo")} />;`);
    expect(routeOut(applyHideGuards(theme(route)).files)).toContain(
      `return ${gate("solo", `<Hero {...content("solo")} />`)};`,
    );
  });

  it("guards back-to-back sites on one line separately, in order", () => {
    const route = contentRoute(
      `  return <main><Hero {...content("a")} /><Hero {...content("b")} /></main>;`,
    );
    expect(routeOut(applyHideGuards(theme(route)).files)).toContain(
      `<main>${gate("a", `<Hero {...content("a")} />`)}${gate("b", `<Hero {...content("b")} />`)}</main>`,
    );
  });

  it("chooses a local name the module does not use", () => {
    const route = contentRoute(`  const __MorphSectionGate = 1;
  return <main data-n={__MorphSectionGate}><Hero {...content("h1")} /></main>;`);
    const out = routeOut(applyHideGuards(theme(route)).files);
    expect(out).toContain(
      `import { MorphSectionGate as __MorphSectionGate0 } from "@morph/sdk/section-gate";`,
    );
    expect(out).toContain(`<__MorphSectionGate0 slot={"h1"} render={() => (<Hero`);
  });

  it("H7: wraps the Starter's own guarded mounts too, around the author's check", () => {
    // The Starter's `!isSectionHidden("x") && <X {...content("x")} />`
    // otherwise calls `content()`, a hook, only while the section shows.
    // The gate goes around the whole check (review P2-7): it then renders
    // whether the section shows or not, so a Hide can be acknowledged by the
    // gate's own commit of it, never by the section's absence alone.
    const files = starterThemeWorkspaceFiles().map((file) => ({
      path: file.path,
      content: file.content,
    }));
    const result = applyHideGuards(files);
    const home = routeOut(result.files);
    expect(home).toContain(
      `{${gate("starter-hero", `!isSectionHidden("starter-hero") && <Hero {...content("starter-hero")} />`)}}`,
    );
    expect(result.guarded[ROUTE]).toEqual([
      "starter-hero",
      "starter-introduction",
      "starter-categories",
      "starter-story",
      "starter-principles",
      "starter-newsletter",
    ]);
    expect(result.guarded[LAYOUT]).toEqual(["starter-header", "starter-footer"]);
    for (const path of [ROUTE, LAYOUT]) {
      const before = files.find((file) => file.path === path)!.content;
      const after = result.files.find((file) => file.path === path)!.content;
      expect(() => parses(after)).not.toThrow();
      // No line moves: the import sits on the first import's own line.
      expect(after.split("\n")).toHaveLength(before.split("\n").length);
    }
  });

  it("H9: an instance it refuses gets no guard and is left as written", () => {
    const route = loaderRoute(`  const page = Route.useLoaderData();
  const t = page.h9.title.toUpperCase();
  return <Hero title={t} subtitle={page.h9.subtitle} />;`);
    const files = theme(route);
    expect(planHideGuards(files).get(ROUTE)).toBeUndefined();
    expect(routeOut(applyHideGuards(files).files)).toBe(route);
  });

  it("changes only the compiled output, never the input files", () => {
    const files = theme(
      contentRoute(`  return <main><Hero {...content("h1")} /></main>;`),
    );
    const before = JSON.stringify(files);
    applyHideGuards(files);
    prepareSourcesForBuild(files);
    injectPreviewBindings(files);
    expect(JSON.stringify(files)).toBe(before);
  });

  it("prepareSourcesForBuild ships the guard; switched off, it ships the source as written", () => {
    const route = contentRoute(
      `  return <main><Hero {...content("h1")} /></main>;`,
    );
    const on = prepareSourcesForBuild(theme(route));
    const off = prepareSourcesForBuild(theme(route), { hideGuards: false });
    expect(routeOut(on.files)).toContain(gate("h1", `<Hero {...content("h1")} />`));
    expect(on.hideGuarded).toEqual({ [ROUTE]: ["h1"] });
    expect(routeOut(off.files)).toBe(route);
  });

  it("keeps a module's directive prologue first", () => {
    const route = `"use client";\n${contentRoute(`  return <main><Hero {...content("h1")} /></main>;`)}`;
    const out = routeOut(applyHideGuards(theme(route)).files);
    expect(out.startsWith(`"use client";\nimport { createFileRoute } from "@tanstack/react-router"; ${GATE_IMPORT}`)).toBe(true);
  });
});

describe("a Theme written without semicolons", () => {
  const route = `import { createFileRoute } from "@tanstack/react-router"
import { content } from "../morph/content"
import Hero from "../components/Hero"
export const Route = createFileRoute("/")({ component: Home })
function Home() {
  return <main><Hero {...content("h1")} /><p className="note">after</p></main>
}
`;
  const layout = `import type { ReactNode } from "react"
import { content } from "../morph/content"
import Hero from "../components/Hero"
export default function StorefrontLayout({ children }: { children?: ReactNode }) {
  return <div><Hero {...content("h6")} />{children}</div>
}
`;
  const files = () =>
    theme(route).map((file) =>
      file.path === LAYOUT ? { ...file, content: layout } : file,
    );
  const out = (
    result: ReadonlyArray<{ path: string; content: string }>,
    path: string,
  ) => result.find((file) => file.path === path)!.content;

  it("the build's guarded route and layout still parse, and are guarded", () => {
    const result = applyHideGuards(files());
    expect(result.guarded).toEqual({ [ROUTE]: ["h1"], [LAYOUT]: ["h6"] });
    for (const path of [ROUTE, LAYOUT]) {
      expect(() => parses(out(result.files, path))).not.toThrow();
    }
    expect(out(result.files, ROUTE)).toContain(
      `import { createFileRoute } from "@tanstack/react-router"; ${GATE_IMPORT}`,
    );
    expect(out(result.files, LAYOUT)).toContain(
      `import type { ReactNode } from "react"; ${GATE_IMPORT}`,
    );
  });

  it("the preview's guarded route and layout still parse, and every data-morph-loc stays authored", () => {
    const withGuard = injectPreviewBindings(files());
    const without = injectPreviewBindings(files(), { hideGuards: false });
    expect(withGuard.hideGuarded).toEqual({
      [ROUTE]: ["h1"],
      [LAYOUT]: ["h6"],
    });
    for (const path of [ROUTE, LAYOUT]) {
      expect(() => parses(out(withGuard.files, path))).not.toThrow();
      const locs = (content: string) =>
        [...content.matchAll(/data-morph-loc="([^"]+)"/g)].map((m) => m[1]);
      expect(locs(out(withGuard.files, path))).toEqual(
        locs(out(without.files, path)),
      );
    }
  });

  it("reverse: the same two imports on one line without the semicolon do not parse", () => {
    expect(() =>
      parses(
        `import { createFileRoute } from "@tanstack/react-router" ${GATE_IMPORT}`,
      ),
    ).toThrow();
  });
});

describe("the native Start build plan carries the guard", () => {
  const ROUTER = STARTER_THEME_FILES.find(
    (file) => file.path === "src/router.tsx",
  )!;
  const NATIVE_CONFIG = [
    {
      path: "vite.config.ts",
      content: `import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [cloudflare({ viteEnvironment: { name: "ssr" } }), tanstackStart(), viteReact()],
});
`,
    },
    {
      path: "wrangler.jsonc",
      content: `{
  "name": "hide-guard",
  "compatibility_date": "2025-09-02",
  "compatibility_flags": ["nodejs_compat"],
  "main": "@tanstack/react-start/server-entry",
}`,
    },
  ];
  const project = (route: string) => [
    ...theme(route),
    { path: ROUTER.path, content: ROUTER.content },
    ...NATIVE_CONFIG,
  ];

  it("hands vite the guarded route and the gate module, and the workspace source stays as written", () => {
    const route = contentRoute(
      `  return <main><Hero {...content("h1")} /></main>;`,
    );
    const files = project(route);
    const plan = planNativeStartBuild(files);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(routeOut(plan.workspaceFiles)).toContain(
      gate("h1", `<Hero {...content("h1")} />`),
    );
    expect(
      plan.workspaceFiles.some((file) => file.path === ".morph/section-gate.ts"),
    ).toBe(true);
    expect(routeOut(files)).toBe(route);
  });
});

describe("the preview's guard (inside injectPreviewBindings)", () => {
  const sameLine = contentRoute(
    `  return <main><Hero {...content("h1")} /><p className="note">after</p></main>;`,
  );
  const locs = (content: string) =>
    [...content.matchAll(/data-morph-loc="([^"]+)"/g)].map((match) => match[1]);

  it("wraps the section wrapper too, outermost", () => {
    const out = routeOut(injectPreviewBindings(theme(sameLine)).files);
    expect(out).toMatch(
      /<__MorphSectionGate slot=\{"h1"\} render=\{\(\) => \(<div data-storefront-section-id="h1"[^>]*><Hero \{\.\.\.content\("h1"\)\} \/><\/div>\)\} \/>/,
    );
  });

  it("G9: every data-morph-loc names the authored position, guard or no guard", () => {
    const withGuard = routeOut(injectPreviewBindings(theme(sameLine)).files);
    const without = routeOut(
      injectPreviewBindings(theme(sameLine), { hideGuards: false }).files,
    );
    expect(withGuard).not.toBe(without);
    expect(locs(withGuard)).toEqual(locs(without));
    // The <p> after the guarded element on the same line, at its authored column.
    const line = sameLine.split("\n").findIndex((text) => text.includes("<p "));
    const column = sameLine.split("\n")[line]!.indexOf("<p ") + 1;
    expect(locs(withGuard)).toContain(`${ROUTE}:${line + 1}:${column}`);
  });

  it("reports what it guarded", () => {
    expect(injectPreviewBindings(theme(sameLine)).hideGuarded).toEqual({
      [ROUTE]: ["h1"],
    });
  });
});

describe("the build records the guard in its compiler identity", () => {
  it("a Start build's version carries the guard version; an SDK-only one does not", () => {
    const start = withThemeStartBuildIdentity("1.2.3");
    // Past every value a branch built with (hide-1 main, hide-2 the
    // allowlist, hide-3 PR-1), so none of their artifacts is trusted.
    expect(THEME_HIDE_GUARD_VERSION).toBe("hide-6");
    expect(start).toBe(
      `${withThemeMorphSdkIdentity("1.2.3")}.${THEME_HIDE_GUARD_VERSION}`,
    );
    expect(start.length).toBeLessThanOrEqual(50);
    expect(buildHideGuardVersion(start)).toBe(THEME_HIDE_GUARD_VERSION);
    expect(
      buildHideGuardVersion(withThemeMorphSdkIdentity("1.2.3")),
    ).toBeNull();
    expect(buildHideGuardVersion(null)).toBeNull();
    expect(buildHideGuardVersion("4.1.17")).toBeNull();
  });

  it("the native Start framework's identity carries it", () => {
    const identity =
      themeFramework("tanstack-start").build.native.compilerIdentity();
    expect(buildHideGuardVersion(identity.version)).toBe(
      THEME_HIDE_GUARD_VERSION,
    );
    expect(identity.version.length).toBeLessThanOrEqual(50);
  });
});
