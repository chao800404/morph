import { describe, expect, it } from "vitest";
import { livePreviewPlatformFiles } from "@/lib/test-utils/live-preview-render";
import { STARTER_THEME_FILES } from "@/lib/storefront/starter-theme-files";
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
 * M3 Hide P3+P4: Morph's compiled guard, the same plan in preview and build.
 * Expected output is written by hand.
 */

const ROUTE = "src/routes/index.tsx";

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

describe("applyHideGuards (the build's guard)", () => {
  it("H1: wraps a content() spread child, importing the hidden list beside content", () => {
    const route = contentRoute(
      `  return <main><Hero {...content("h1")} /></main>;`,
    );
    const result = applyHideGuards(theme(route));
    expect(routeOut(result.files)).toBe(
      `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content"; import { isSectionHidden as __morphSectionHidden } from "../morph/content";
import Hero from "../components/Hero";
export const Route = createFileRoute("/")({ component: Home });
function Home() {
  return <main>{__morphSectionHidden("h1") ? null : <Hero {...content("h1")} />}</main>;
}
`,
    );
    expect(result.guarded).toEqual({ [ROUTE]: ["h1"] });
  });

  it("H2: reads the hidden list from the same page object the slot comes from", () => {
    const route = loaderRoute(`  const page = Route.useLoaderData();
  return <main><Hero title={page.h2.title} subtitle={page.h2.cta.label} /></main>;`);
    expect(routeOut(applyHideGuards(theme(route)).files)).toContain(
      `<main>{(Array.isArray(page?._hidden) && page._hidden.includes("h2")) ? null : <Hero title={page.h2.title} subtitle={page.h2.cta.label} />}</main>`,
    );
  });

  it("uses return brackets for a returned call site", () => {
    const route = contentRoute(`  return <Hero {...content("solo")} />;`);
    expect(routeOut(applyHideGuards(theme(route)).files)).toContain(
      `return (__morphSectionHidden("solo") ? null : <Hero {...content("solo")} />);`,
    );
  });

  it("guards back-to-back sites on one line separately, in order", () => {
    const route = contentRoute(
      `  return <main><Hero {...content("a")} /><Hero {...content("b")} /></main>;`,
    );
    expect(routeOut(applyHideGuards(theme(route)).files)).toContain(
      `<main>{__morphSectionHidden("a") ? null : <Hero {...content("a")} />}{__morphSectionHidden("b") ? null : <Hero {...content("b")} />}</main>`,
    );
  });

  it("chooses a local name the module does not use", () => {
    const route = contentRoute(`  const __morphSectionHidden = 1;
  return <main data-n={__morphSectionHidden}><Hero {...content("h1")} /></main>;`);
    const out = routeOut(applyHideGuards(theme(route)).files);
    expect(out).toContain(
      `import { isSectionHidden as __morphSectionHidden0 } from "../morph/content";`,
    );
    expect(out).toContain(`{__morphSectionHidden0("h1") ? null : <Hero`);
  });

  it("H7: leaves an untouched Starter route byte for byte", () => {
    const files = STARTER_THEME_FILES.map((file) => ({
      path: file.path,
      content: file.content,
    }));
    const result = applyHideGuards(files);
    expect(routeOut(result.files)).toBe(
      files.find((file) => file.path === ROUTE)!.content,
    );
    expect(result.guarded[ROUTE]).toBeUndefined();
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
    expect(routeOut(on.files)).toContain(`__morphSectionHidden("h1") ? null :`);
    expect(on.hideGuarded).toEqual({ [ROUTE]: ["h1"] });
    expect(routeOut(off.files)).toBe(route);
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

  it("hands vite the guarded route, and the workspace source stays as written", () => {
    const route = contentRoute(
      `  return <main><Hero {...content("h1")} /></main>;`,
    );
    const files = project(route);
    const plan = planNativeStartBuild(files);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(routeOut(plan.workspaceFiles)).toContain(
      `{__morphSectionHidden("h1") ? null : <Hero {...content("h1")} />}`,
    );
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
      /\{__morphSectionHidden\("h1"\) \? null : <div data-storefront-section-id="h1"[^>]*><Hero \{\.\.\.content\("h1"\)\} \/><\/div>\}/,
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
