import { describe, expect, it } from "vitest";
import { livePreviewPlatformFiles } from "@/lib/test-utils/live-preview-render";
import {
  createHideCapabilityAnalyzer,
  type HideCapability,
} from "./theme-hide-capability";
import type { B1SourceFile } from "./theme-content-provenance";

/**
 * M3 PR-1 review (2026-11-26): the Hide proof is a whole-Theme proof. A
 * section is hideable only when the source proves that nothing Vite can
 * execute reads it some other way; anything Morph cannot resolve exactly as
 * Vite would, any route-tree module the proof would otherwise never visit,
 * and any reader of the raw content is a refusal, never "not read".
 *
 * Every case is written as a pair: the leak (refused) and its reverse (the
 * same Theme without the reader, supported), so a refusal is never just
 * "everything is refused". Expectations are written by hand.
 */

const ROUTE = "src/routes/index.tsx";

const HERO = `export const contentFields = {
  title: { type: "text", label: "Title" },
} as const;
export default function Hero({ title = "HERO-DEFAULT" }: { title?: string }) {
  return <h1>{title}</h1>;
}
`;

const route = (body = "", imports = "", options = "component: Home") =>
  `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import Hero from "../components/Hero";
${imports}
export const Route = createFileRoute("/")({ ${options} });

function Home() {
  return (
    <main>
      <Hero {...content("hero")} />
${body}
    </main>
  );
}
`;

function theme(
  routeSource: string,
  extra: readonly B1SourceFile[] = [],
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

/** A component that reads `hero` itself through `specifier`. */
const reader = (specifier: string) => `import { content } from "${specifier}";
export default function Teaser() {
  return <p>{String(content("hero").title ?? "TEASER-DEFAULT")}</p>;
}
`;

const SUPPORTED = { kind: "supported", slot: "hero" } as const;

describe("item 1: modules resolved other than exactly as Vite would", () => {
  it("control: the plain Theme is supported", () => {
    expect(classify(theme(route()))).toMatchObject(SUPPORTED);
  });

  it("refuses a content import by a root-absolute /src/ path", () => {
    const files = theme(
      route(`      <Teaser />`, `import Teaser from "../components/Teaser";`),
      [
        {
          path: "src/components/Teaser.tsx",
          content: reader("/src/morph/content.ts"),
        },
      ],
    );
    expect(classify(files)).toMatchObject({
      kind: "unsupported",
      reason: "untraced-use",
      at: { file: "src/components/Teaser.tsx", line: 1 },
    });
  });

  it("refuses a content import with a query suffix", () => {
    const files = theme(
      route(`      <Teaser />`, `import Teaser from "../components/Teaser";`),
      [
        {
          path: "src/components/Teaser.tsx",
          content: reader("../morph/content?v=1"),
        },
      ],
    );
    expect(classify(files)).toMatchObject({
      kind: "unsupported",
      reason: "untraced-use",
      at: { file: "src/components/Teaser.tsx", line: 1 },
    });
  });

  it("refuses an extensionless import two files could answer (Other.tsx and Other.js)", () => {
    const files = theme(
      route(`      <Other />`, `import Other from "../components/Other";`),
      [
        {
          path: "src/components/Other.tsx",
          content: `export default function Other() { return <p>clean</p>; }\n`,
        },
        {
          path: "src/components/Other.js",
          content: `export default function Other() { return null; }\n`,
        },
      ],
    );
    expect(classify(files)).toMatchObject({
      kind: "unsupported",
      reason: "untraced-use",
      at: { file: ROUTE },
    });
    // Reverse: with one candidate, the import is exact.
    expect(
      classify(files.filter((file) => file.path !== "src/components/Other.js")),
    ).toMatchObject(SUPPORTED);
  });

  it("refuses a relative import that leaves src/", () => {
    const files = theme(
      route(`      <Outside />`, `import Outside from "../../lib/outside";`),
      [
        {
          path: "lib/outside.tsx",
          content: reader("../src/morph/content"),
        },
      ],
    );
    expect(classify(files)).toMatchObject({
      kind: "unsupported",
      reason: "untraced-use",
      at: { file: ROUTE },
    });
  });

  it("refuses a worker loaded through new URL(..., import.meta.url) from outside src/", () => {
    const files = theme(
      route(
        ``,
        `const worker = new Worker(new URL("../../workers/read.ts", import.meta.url));`,
      ),
      [
        {
          path: "workers/read.ts",
          content: `import { content } from "../src/morph/content";\nexport const title = content("hero").title;\n`,
        },
      ],
    );
    expect(classify(files)).toMatchObject({
      kind: "unsupported",
      reason: "untraced-use",
      at: { file: ROUTE },
    });
  });

  it("refuses a Theme that carries its own Vite config (native aliases and plugins)", () => {
    const files = theme(route(), [
      {
        path: "vite.config.ts",
        content: `import { defineConfig } from "vite";
export default defineConfig({ resolve: { alias: { "~content": "/src/morph/content.ts" } } });
`,
      },
    ]);
    expect(classify(files)).toMatchObject({
      kind: "unsupported",
      reason: "source-unconfirmed",
      at: { file: "vite.config.ts" },
    });
  });

  it("refuses an imported .vue, .svelte or .astro module, which only a plugin can execute", () => {
    for (const extension of ["vue", "svelte", "astro"]) {
      const files = theme(
        route(``, `import Widget from "../components/Widget.${extension}";`),
        [{ path: `src/components/Widget.${extension}`, content: "<template />" }],
      );
      expect(classify(files)).toMatchObject({
        kind: "unsupported",
        reason: "source-unconfirmed",
      });
    }
  });

  it("reverse: a plain stylesheet, JSON or image import is inert", () => {
    const files = theme(
      route(
        ``,
        `import "../styles/extra.css";\nimport data from "../data/site.json";\nimport logo from "../assets/logo.svg";\nvoid data; void logo;`,
      ),
      [
        { path: "src/styles/extra.css", content: "p { color: red; }" },
        { path: "src/data/site.json", content: "{}" },
        { path: "src/assets/logo.svg", content: "<svg />" },
      ],
    );
    expect(classify(files)).toMatchObject(SUPPORTED);
  });
});

describe("item 2: route-tree modules no import edge reaches", () => {
  it("refuses a parent route that renders a component reading the child's slot", () => {
    const child = route().replace(`createFileRoute("/")`, `createFileRoute("/products/$handle")`);
    const files = theme(child, [
      { path: "src/components/Teaser.tsx", content: reader("../morph/content") },
      {
        path: "src/routes/products.tsx",
        content: `import { Outlet, createFileRoute } from "@tanstack/react-router";
import Teaser from "../components/Teaser";
export const Route = createFileRoute("/products")({ component: Products });
function Products() { return <div><Teaser /><Outlet /></div>; }
`,
      },
    ]);
    expect(classify(files)).toMatchObject({
      kind: "unsupported",
      reason: "component-reads-content",
      at: { file: "src/components/Teaser.tsx", line: 3 },
    });
  });

  it("refuses a generated .lazy companion that reads the slot", () => {
    const files = theme(route(), [
      {
        path: "src/routes/index.lazy.tsx",
        content: `import { createLazyFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
export const Route = createLazyFileRoute("/")({ pendingComponent: Pending });
function Pending() { return <p>{String(content("hero").title ?? "")}</p>; }
`,
      },
    ]);
    expect(classify(files)).toMatchObject({
      kind: "unsupported",
      reason: "component-reads-content",
      at: { file: "src/routes/index.lazy.tsx", line: 4 },
    });
  });

  it("refuses when any src/ module cannot be parsed, even one the route never imports", () => {
    const files = theme(route(), [
      {
        path: "src/components/Broken.tsx",
        content: `export default function Broken() { return <p>{</p>; }\n`,
      },
    ]);
    expect(classify(files)).toMatchObject({
      kind: "unsupported",
      reason: "source-unconfirmed",
      at: { file: "src/components/Broken.tsx" },
    });
  });
});

describe("item 3: other readers of the content", () => {
  it("refuses a loader returning loadContentSlots() read through Route.useLoaderData()", () => {
    const files = theme(
      route(
        `      <p>{String(Route.useLoaderData().slots.hero?.title ?? "RAW")}</p>`,
        `import { loadContentSlots } from "../morph/content";`,
        `component: Home, loader: () => loadContentSlots("/")`,
      ),
    );
    expect(classify(files)).toMatchObject({
      kind: "unsupported",
      reason: "untraced-use",
      at: { file: ROUTE },
    });
  });

  it("refuses an extra named helper of the content module imported by a component", () => {
    const files = theme(
      route(`      <Teaser />`, `import Teaser from "../components/Teaser";`),
      [
        {
          path: "src/components/Teaser.tsx",
          content: `import { readHeroTitle } from "../morph/content";
export default function Teaser() { return <p>{readHeroTitle()}</p>; }
`,
        },
      ],
    );
    expect(classify(files)).toMatchObject({
      kind: "unsupported",
      reason: "untraced-use",
      at: { file: "src/components/Teaser.tsx", line: 1 },
    });
  });

  it("refuses a second SDK read in the call-site module itself", () => {
    const files = theme(
      route(
        `      <p>{String(morph)}</p>`,
        `import { morph } from "@morph/sdk/start";`,
      ),
    );
    expect(classify(files)).toMatchObject({
      kind: "unsupported",
      reason: "untraced-use",
      at: { file: ROUTE },
    });
  });

  it("refuses a component reading the root's morphContent from the route context", () => {
    const files = theme(
      route(`      <Teaser />`, `import Teaser from "../components/Teaser";`),
      [
        {
          path: "src/components/Teaser.tsx",
          content: `import { getRouteApi } from "@tanstack/react-router";
const root = getRouteApi("__root__");
export default function Teaser() {
  return <p>{String(root.useRouteContext().morphContent.slots.hero?.title ?? "")}</p>;
}
`,
        },
      ],
    );
    expect(classify(files)).toMatchObject({
      kind: "unsupported",
      reason: "untraced-use",
      at: { file: "src/components/Teaser.tsx", line: 1 },
    });
  });

  it("refuses a child route loader that reads the root's context", () => {
    const files = theme(
      route(
        ``,
        ``,
        `component: Home, loader: ({ context }) => context.morphContent`,
      ),
    );
    expect(classify(files)).toMatchObject({
      kind: "unsupported",
      reason: "untraced-use",
      at: { file: ROUTE },
    });
  });

  it("refuses morph.pages.get of another path read anywhere in the Theme", () => {
    const files = theme(route(), [
      {
        path: "src/routes/$.tsx",
        content: `import { createFileRoute } from "@tanstack/react-router";
import { morph } from "../morph/content";
export const Route = createFileRoute("/$")({ component: CatchAll });
async function read() { return (await morph.pages.get("/")).hero.title; }
function CatchAll() { void read; return <p />; }
`,
      },
    ]);
    expect(classify(files)).toMatchObject({
      kind: "unsupported",
      reason: "component-reads-content",
      at: { file: "src/routes/$.tsx" },
    });
  });
});
