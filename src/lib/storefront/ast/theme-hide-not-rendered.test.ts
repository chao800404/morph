import { describe, expect, it } from "vitest";
import { livePreviewPlatformFiles } from "@/lib/test-utils/live-preview-render";
import {
  createHideCapabilityAnalyzer,
  type HideCapabilityScope,
} from "./theme-hide-capability";
import type { B1SourceFile } from "./theme-content-provenance";

/**
 * M3 PR-1: a section the route's JSX does not name counts as "not rendered"
 * only when the source proves nothing that route renders reads it. Before
 * this, `templateHideCallSites` answered "not-rendered" for any slot the
 * route's own JSX did not name, and both the write and publish skipped it:
 * a component reading the hidden slot itself then showed its defaults on
 * the live site (handoff/2026-11-26/m3-restart-plan.md §1.6 P2).
 *
 * Expectations are written by hand, never derived from the analysis.
 */

const ROUTE = "src/routes/index.tsx";
const LAYOUT = "src/layouts/StorefrontLayout.tsx";

const HERO = `export const contentFields = {
  title: { type: "text", label: "Title" },
} as const;
export default function Hero({ title = "HERO-DEFAULT" }: { title?: string }) {
  return <h1>{title}</h1>;
}
`;

/** Reads `promo` itself, at line 3. */
const PROMO = `import { content } from "../morph/content";
export default function Promo() {
  const values = content("promo");
  return <h2>{String(values.title ?? "PROMO-DEFAULT")}</h2>;
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

function theme(
  routeSource: string,
  extra: readonly B1SourceFile[] = [],
): B1SourceFile[] {
  const files = new Map<string, B1SourceFile>();
  for (const file of [
    ...livePreviewPlatformFiles(),
    { path: "src/components/Hero.tsx", content: HERO },
    // The proof is whole-Theme: Promo reads `promo` wherever it sits, so it
    // is in the Theme only when the route renders it.
    ...(routeSource.includes("Promo")
      ? [{ path: "src/components/Promo.tsx", content: PROMO }]
      : []),
    { path: ROUTE, content: routeSource },
    ...extra,
  ]) {
    files.set(file.path, file);
  }
  return [...files.values()];
}

const prove = (
  files: readonly B1SourceFile[],
  slot: string,
  scope: HideCapabilityScope = "route",
  sourcePath = scope === "layout" ? LAYOUT : ROUTE,
) =>
  createHideCapabilityAnalyzer(files).proveNotRendered({
    sourcePath,
    slot,
    scope,
  });

const classify = (files: readonly B1SourceFile[], slot: string) =>
  createHideCapabilityAnalyzer(files).classify({
    callSitePath: ROUTE,
    slot,
    scope: "route",
  });

/** The home route renders `<Promo />`, which reads the hidden `promo` itself. */
const LEAK = theme(
  route(`      <Promo />`, `import Promo from "../components/Promo";`),
);

describe("proveNotRendered: the P2 leak", () => {
  it("refuses a slot an imported component reads itself, where the classifier does", () => {
    expect(prove(LEAK, "promo")).toMatchObject({
      kind: "unsupported",
      reason: "component-reads-content",
      at: { file: "src/components/Promo.tsx", line: 3 },
    });
    // The control: the classifier, asked directly, says the same.
    expect(classify(LEAK, "promo")).toMatchObject({
      kind: "unsupported",
      reason: "component-reads-content",
      at: { file: "src/components/Promo.tsx", line: 3 },
    });
  });

  it("reverse: without that component, nothing reads it, so it is not rendered", () => {
    const files = theme(route(`      <p>No promo</p>`));
    expect(prove(files, "promo")).toEqual({
      kind: "not-rendered",
      slot: "promo",
    });
  });

  it("reverse: a slot unused anywhere stays not rendered beside the component that reads another", () => {
    expect(prove(LEAK, "unused")).toEqual({
      kind: "not-rendered",
      slot: "unused",
    });
  });
});

describe("proveNotRendered: more shapes", () => {
  it("follows a component re-export chain to the component that reads it", () => {
    const files = theme(
      route(`      <Promo />`, `import { Promo } from "../components";`),
      [
        {
          path: "src/components/index.ts",
          content: `export { default as Promo } from "./Promo";\n`,
        },
      ],
    );
    expect(prove(files, "promo")).toMatchObject({
      kind: "unsupported",
      reason: "component-reads-content",
      at: { file: "src/components/Promo.tsx", line: 3 },
    });
  });

  it("refuses a slot read through a module that re-exports content(), which it cannot follow", () => {
    const files = theme(
      route(`      <Teaser />`, `import Teaser from "../components/Teaser";`),
      [
        {
          path: "src/lib/content.ts",
          content: `export { content } from "../morph/content";\n`,
        },
        {
          path: "src/components/Teaser.tsx",
          content: `import { content } from "../lib/content";
export default function Teaser() {
  return <p>{String(content("promo").title ?? "TEASER-DEFAULT")}</p>;
}
`,
        },
      ],
    );
    expect(prove(files, "promo")).toMatchObject({
      kind: "unsupported",
      reason: "untraced-use",
      at: { file: "src/lib/content.ts", line: 1 },
    });
  });

  it("refuses a computed slot id, which cannot be analysed", () => {
    const files = theme(
      route(`      <Slot id="promo" />`, `import Slot from "../components/Slot";`),
      [
        {
          path: "src/components/Slot.tsx",
          content: `import { content } from "../morph/content";
export default function Slot({ id }: { id: string }) {
  return <p>{String(content(id).title ?? "SLOT-DEFAULT")}</p>;
}
`,
        },
      ],
    );
    expect(prove(files, "promo")).toMatchObject({
      kind: "unsupported",
      reason: "component-reads-content",
      at: { file: "src/components/Slot.tsx", line: 3 },
    });
  });

  it("refuses when a module of the Theme cannot be parsed", () => {
    const files = theme(
      route(`      <Broken />`, `import Broken from "../components/Broken";`),
      [
        {
          path: "src/components/Broken.tsx",
          content: `export default function Broken() { return <p>{</p>; }\n`,
        },
      ],
    );
    // Whole-Theme proof: the module that cannot be read is named.
    expect(prove(files, "promo")).toMatchObject({
      kind: "unsupported",
      reason: "source-unconfirmed",
      at: { file: "src/components/Broken.tsx" },
    });
  });

  it("refuses a layout section proof when any module of the Theme cannot be parsed", () => {
    const files = theme(route(``), [
      {
        path: "src/components/Unused.tsx",
        content: `export default function Unused() { return <p>{</p>; }\n`,
      },
    ]);
    expect(prove(files, "unused", "layout")).toMatchObject({
      kind: "unsupported",
      reason: "source-unconfirmed",
      at: { file: "src/components/Unused.tsx" },
    });
    // Reverse: the same Theme with that module parsing proves it.
    const parsed = files.map((file) =>
      file.path === "src/components/Unused.tsx"
        ? { ...file, content: `export default function Unused() { return <p />; }\n` }
        : file,
    );
    expect(prove(parsed, "unused", "layout")).toEqual({
      kind: "not-rendered",
      slot: "unused",
    });
  });

  it("still catches a layout component reading a page slot the route does not name", () => {
    const files = theme(route(``), [
      {
        path: LAYOUT,
        content: `import type { ReactNode } from "react";
import { content } from "../morph/content";
export default function StorefrontLayout({ children }: { children?: ReactNode }) {
  return <div><p>{String(content("promo").title ?? "LAYOUT-DEFAULT")}</p>{children}</div>;
}
`,
      },
    ]);
    expect(prove(files, "promo")).toMatchObject({
      kind: "unsupported",
      reason: "component-reads-content",
      at: { file: LAYOUT, line: 4 },
    });
  });

  it("refuses a layout slot the layout does not name when a route reads it", () => {
    expect(prove(LEAK, "promo", "layout")).toMatchObject({
      kind: "unsupported",
      reason: "component-reads-content",
      at: { file: "src/components/Promo.tsx" },
    });
    expect(prove(LEAK, "unused", "layout")).toEqual({
      kind: "not-rendered",
      slot: "unused",
    });
  });

  it("finds a read in a module imported through a path alias, as where it is imported relatively", () => {
    const files = theme(
      route(`      <Promo />`, `import Promo from "@/components/Promo";`),
      [
        {
          path: "tsconfig.json",
          content: JSON.stringify({
            compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } },
          }),
        },
      ],
    );
    // The whole Theme is read, so the alias no longer hides the module: the
    // read is found where it is, whichever way the route imports it.
    expect(prove(files, "promo")).toMatchObject({
      kind: "unsupported",
      reason: "component-reads-content",
      at: { file: "src/components/Promo.tsx" },
    });
    const relative = files.map((file) =>
      file.path === ROUTE
        ? {
            ...file,
            content: file.content.replace(
              `"@/components/Promo"`,
              `"../components/Promo"`,
            ),
          }
        : file,
    );
    expect(prove(relative, "promo")).toMatchObject({
      reason: "component-reads-content",
      at: { file: "src/components/Promo.tsx" },
    });
  });

  it("refuses when a rendered module reads Morph content through @morph/sdk directly", () => {
    const files = theme(
      route(`      <Live />`, `import Live from "../components/Live";`),
      [
        {
          path: "src/components/Live.tsx",
          content: `import { morph } from "@morph/sdk/start";
export default function Live() {
  return <p>{String(morph)}</p>;
}
`,
        },
      ],
    );
    expect(prove(files, "promo")).toMatchObject({
      kind: "unsupported",
      reason: "untraced-use",
      at: { file: "src/components/Live.tsx", line: 1 },
    });
  });

  it("hands a slot the route reads outside a named section to the classifier", () => {
    const files = theme(
      route(
        `      <p>{String(content("promo").title ?? "")}</p>`,
      ),
    );
    expect(prove(files, "promo")).toMatchObject({ kind: "unsupported" });
    expect(prove(files, "promo")).toEqual(classify(files, "promo"));
  });

  it("reading the source never changes it", () => {
    const before = JSON.stringify(LEAK);
    prove(LEAK, "promo");
    prove(LEAK, "unused", "layout");
    expect(JSON.stringify(LEAK)).toBe(before);
  });
});

describe("classify: the same reads, for a section the route does name", () => {
  it("refuses a supported site when another rendered module re-exports content() and reads the slot", () => {
    const teaser = [
      {
        path: "src/lib/content.ts",
        content: `export { content } from "../morph/content";\n`,
      },
      {
        path: "src/components/Teaser.tsx",
        content: `import { content } from "../lib/content";
export default function Teaser() {
  return <p>{String(content("hero").title ?? "TEASER-DEFAULT")}</p>;
}
`,
      },
    ];
    const files = theme(
      route(`      <Teaser />`, `import Teaser from "../components/Teaser";`),
      teaser,
    );
    expect(classify(files, "hero")).toMatchObject({
      kind: "unsupported",
      reason: "untraced-use",
      at: { file: "src/lib/content.ts" },
    });
    // Reverse: without Teaser and its re-export in the Theme, hero is
    // supported (the proof is whole-Theme, so an unrendered Teaser would
    // still count as a reader).
    expect(classify(theme(route(``)), "hero")).toMatchObject({
      kind: "supported",
    });
  });
});
