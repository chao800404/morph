import { describe, expect, it } from "vitest";
import { livePreviewPlatformFiles } from "@/lib/test-utils/live-preview-render";
import { STARTER_THEME_FILES } from "@/lib/storefront/starter-theme-files";
import {
  createHideCapabilityAnalyzer,
  type HideCapability,
} from "./theme-hide-capability";
import type { B1SourceFile } from "./theme-content-provenance";

/**
 * M3 PR-1, second Codex re-review (2026-11-26): hideable verdicts that still
 * rendered defaults. Each case is a leak (refused) beside its reverse
 * (supported), with expectations written by hand.
 */

const ROUTE = "src/routes/index.tsx";

const HERO = `export const contentFields = {
  title: { type: "text", label: "Title" },
} as const;
export default function Hero({ title = "HERO-DEFAULT" }: { title?: string }) {
  return <h1>{title}</h1>;
}
`;

const contentRoute = (body = "", imports = "", path = "/") =>
  `import { createFileRoute } from "@tanstack/react-router";
import { content, isSectionHidden } from "../morph/content";
import Hero from "../components/Hero";
${imports}
export const Route = createFileRoute("${path}")({ component: Home });

function Home() {
  return (
    <main>
      <Hero {...content("hero")} />
${body}
    </main>
  );
}
`;

/** A proven loader route rendering `hero` through per-field member reads. */
const loaderRoute = (before = "", path = "/") =>
  `import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { morph } from "../morph/content";
import Hero from "../components/Hero";

const getPage = createServerFn().handler(() => morph.pages.get("${path}"));

export const Route = createFileRoute("${path}")({
  loader: () => getPage(),
  component: Page,
});

function Page() {
  const page = Route.useLoaderData();
${before}
  return <Hero title={page.hero.title} />;
}
`;

function theme(
  routeSource: string,
  extra: readonly B1SourceFile[] = [],
  replace: Readonly<Record<string, string>> = {},
): B1SourceFile[] {
  const files = new Map<string, B1SourceFile>();
  for (const file of [
    ...livePreviewPlatformFiles(),
    { path: "src/components/Hero.tsx", content: HERO },
    { path: ROUTE, content: routeSource },
    ...extra,
  ]) {
    files.set(file.path, file);
  }
  for (const [path, content] of Object.entries(replace)) {
    files.set(path, { path, content });
  }
  return [...files.values()];
}

const classify = (
  files: readonly B1SourceFile[],
  slot = "hero",
  callSitePath = ROUTE,
): HideCapability =>
  createHideCapabilityAnalyzer(files).classify({
    callSitePath,
    slot,
    scope: "route",
  });

const SUPPORTED = { kind: "supported", slot: "hero" } as const;

describe("A: the hidden state a guard reads must be the effective one", () => {
  it("control: a loader site is supported", () => {
    expect(classify(theme(loaderRoute()))).toMatchObject(SUPPORTED);
  });

  it("refuses a call site whose own module clears page._hidden", () => {
    expect(classify(theme(loaderRoute(`  page._hidden = [];`)))).toMatchObject({
      kind: "unsupported",
      reason: "untraced-use",
      at: { file: ROUTE },
    });
  });

  it("refuses another route's guarded site when that route clears its page._hidden", () => {
    const files = theme(contentRoute(), [
      {
        path: "src/routes/about.tsx",
        content: loaderRoute(`  page._hidden.length = 0;`, "/about"),
      },
    ]);
    expect(classify(files)).toMatchObject({
      kind: "unsupported",
      reason: "untraced-use",
      at: { file: "src/routes/about.tsx" },
    });
    // Reverse: the same other route, leaving _hidden alone, is a guarded
    // call site of its own.
    const clean = theme(contentRoute(), [
      { path: "src/routes/about.tsx", content: loaderRoute("", "/about") },
    ]);
    expect(classify(clean)).toMatchObject(SUPPORTED);
  });

  it("refuses an alias of page._hidden", () => {
    expect(
      classify(theme(loaderRoute(`  const hidden = page._hidden; void hidden;`))),
    ).toMatchObject({ kind: "unsupported", reason: "untraced-use" });
  });
});

describe("B: a read of the hidden flag itself is a reader", () => {
  it("refuses isSectionHidden(slot) used other than as the exact guard", () => {
    const files = theme(contentRoute(), [
      {
        path: "src/components/Teaser.tsx",
        content: `import { isSectionHidden } from "../morph/content";
import Hero from "./Hero";
export default function Teaser() {
  return <div>{isSectionHidden("hero") && <Hero />}</div>;
}
`,
      },
    ]);
    expect(classify(files)).toMatchObject({
      kind: "unsupported",
      reason: "untraced-use",
      at: { file: "src/components/Teaser.tsx", line: 4 },
    });
  });

  it("refuses isSectionHidden handed on as a value", () => {
    const files = theme(contentRoute(), [
      {
        path: "src/components/Teaser.tsx",
        content: `import { isSectionHidden } from "../morph/content";
export const check = isSectionHidden;
`,
      },
    ]);
    expect(classify(files)).toMatchObject({
      kind: "unsupported",
      reason: "untraced-use",
      at: { file: "src/components/Teaser.tsx" },
    });
  });

  it("reverse: the exact Starter guard, and a flag read of another slot, are not readers", () => {
    const files = theme(contentRoute(), [
      {
        path: "src/components/Teaser.tsx",
        content: `import { isSectionHidden } from "../morph/content";
export default function Teaser() {
  return <div>{!isSectionHidden("hero") && <p>teaser</p>}{isSectionHidden("other") && <p />}</div>;
}
`,
      },
    ]);
    expect(classify(files)).toMatchObject(SUPPORTED);
  });

  it("but a second mount of the section's component without its content is refused", () => {
    // Since approach E step 1: the Starter guard around a bare <Hero /> still
    // renders Hero's defaults while shown, outside any gate.
    const files = theme(contentRoute(), [
      {
        path: "src/components/Teaser.tsx",
        content: `import { isSectionHidden } from "../morph/content";
import Hero from "./Hero";
export default function Teaser() {
  return <div>{!isSectionHidden("hero") && <Hero />}</div>;
}
`,
      },
    ]);
    expect(classify(files)).toMatchObject({
      kind: "unsupported",
      reason: "unguarded-mount",
    });
  });
});

describe("D: a directory import Vite may resolve through package.json", () => {
  it("refuses ../morph when src/morph has a package.json", () => {
    const files = theme(contentRoute(`      <Teaser />`, `import Teaser from "../components/Teaser";`), [
      {
        path: "src/components/Teaser.tsx",
        content: `import { content } from "../morph";
export default function Teaser() { return <p>{String(content("hero").title ?? "")}</p>; }
`,
      },
      { path: "src/morph/index.ts", content: `export const nothing = 1;\n` },
      { path: "src/morph/package.json", content: `{"main":"./content.ts"}` },
    ]);
    expect(classify(files)).toMatchObject({
      kind: "unsupported",
      reason: "untraced-use",
      at: { file: "src/components/Teaser.tsx", line: 1 },
    });
  });
});

describe("E: computed access to the router and route objects", () => {
  it("refuses Route[...] computed access while the Starter root keeps content in the context", () => {
    const files = theme(
      contentRoute(
        `      <p>{String((Route as any)["useRouteContext"]()["morph" + "Content"])}</p>`,
      ),
    );
    expect(classify(files)).toMatchObject({
      kind: "unsupported",
      reason: "untraced-use",
      at: { file: ROUTE },
    });
  });

  it("refuses a namespace import of the router package", () => {
    const files = theme(contentRoute(), [
      {
        path: "src/components/Nav.tsx",
        content: `import * as Router from "@tanstack/react-router";
const key = "useRouter";
export const nav = () => (Router as any)[key]();
`,
      },
    ]);
    expect(classify(files)).toMatchObject({
      kind: "unsupported",
      reason: "untraced-use",
      at: { file: "src/components/Nav.tsx" },
    });
  });

  it("refuses a Route object handed to other code", () => {
    const files = theme(
      contentRoute(``, `import { inspect } from "../lib/inspect";\nvoid inspect(Route);`),
      [{ path: "src/lib/inspect.ts", content: `export const inspect = (x: unknown) => x;\n` }],
    );
    expect(classify(files)).toMatchObject({
      kind: "unsupported",
      reason: "untraced-use",
      at: { file: ROUTE },
    });
  });
});

describe("F: the content module is the platform's, exactly", () => {
  it("refuses an isSectionHidden that answers a constant", () => {
    const content = livePreviewPlatformFiles().find(
      (file) => file.path === "src/morph/content.ts",
    )!;
    const edited = content.content.replace(
      /export function isSectionHidden\(slotId: string\): boolean \{/,
      `export function isSectionHidden(slotId: string): boolean {\n  if (slotId) return false;`,
    );
    expect(edited).not.toBe(content.content);
    const files = theme(contentRoute(), [], { "src/morph/content.ts": edited });
    expect(classify(files)).toMatchObject({
      kind: "unsupported",
      reason: "content-module-unconfirmed",
    });
  });

  it("reverse: the same module with only a comment added is confirmed", () => {
    const content = livePreviewPlatformFiles().find(
      (file) => file.path === "src/morph/content.ts",
    )!;
    const files = theme(contentRoute(), [], {
      "src/morph/content.ts": `// The author's note.\n${content.content}\n// end\n`,
    });
    expect(classify(files)).toMatchObject(SUPPORTED);
  });
});

describe("I: the Starter root compared as code, not bytes", () => {
  const starter = () =>
    STARTER_THEME_FILES.map((file) => ({ path: file.path, content: file.content }));
  const homeSections = () =>
    createHideCapabilityAnalyzer(starter()).sectionsIn(ROUTE);

  it("keeps every Starter home section supported with a comment added to the root", () => {
    const files = starter().map((file) =>
      file.path === "src/routes/__root.tsx"
        ? { ...file, content: `${file.content}\n// A note from the author.\n` }
        : file,
    );
    const analyzer = createHideCapabilityAnalyzer(files);
    const sections = homeSections();
    expect(sections.length).toBeGreaterThan(0);
    for (const slot of sections) {
      expect(
        analyzer.classify({ callSitePath: ROUTE, slot, scope: "route" }),
        slot,
      ).toMatchObject({ kind: "supported" });
    }
  });

  it("still refuses a root that changes what it does", () => {
    const files = starter().map((file) =>
      file.path === "src/routes/__root.tsx"
        ? {
            ...file,
            content: file.content.replace(
              "morphContent: await loadContentSlots(location.pathname),",
              "morphContent: { ...(await loadContentSlots(location.pathname)), hiddenSlots: [] },",
            ),
          }
        : file,
    );
    expect(files.find((f) => f.path === "src/routes/__root.tsx")!.content).toContain(
      "hiddenSlots: []",
    );
    const [slot] = homeSections();
    expect(
      createHideCapabilityAnalyzer(files).classify({
        callSitePath: ROUTE,
        slot: slot!,
        scope: "route",
      }),
    ).toMatchObject({
      kind: "unsupported",
      // Approach E: the root is the gate's source of visibility, so an
      // edited root is refused first, and by name.
      reason: "root-route-unconfirmed",
      at: { file: "src/routes/__root.tsx" },
    });
  });
});
