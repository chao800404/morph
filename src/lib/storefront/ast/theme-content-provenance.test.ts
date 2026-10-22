import { describe, expect, it } from "vitest";
import {
  B1_INTEGRATION_CASES,
} from "@/lib/test-utils/binding-acceptance-b1-cases";
import {
  BAS_HERO_PATH,
  BAS_HERO_SOURCE,
  basRouteSource,
  type BasCase,
  type BasSpelling,
} from "@/lib/test-utils/binding-acceptance-cases";
import { livePreviewPlatformFiles } from "@/lib/test-utils/live-preview-render";
import {
  findB1WriteProvenanceFailure,
  analyzeB1Route,
  type B1Claim,
  type B1SourceFile,
} from "./theme-content-provenance";

/** Handwritten expectations: never derived from the production analysis. */
const EXPECTED_FIELDS: Readonly<Record<string, readonly string[]>> = {
  c1: ["hero.title", "hero.desc"],
  c2: ["hero.title", "hero.desc"],
  c3: ["hero.title", "hero.desc"],
  c4a: ["hero.title", "hero.desc"],
  c5: ["heroA.title", "heroA.desc", "heroB.title", "heroB.desc"],
  c6a: ["promo.desc"],
  p1: ["hero.title", "hero.desc"],
  p2: ["hero.desc"],
  p3: ["hero.desc"],
  p4a: ["hero.title", "hero.desc"],
  p5: ["heroA.title", "heroA.desc", "heroB.title", "heroB.desc"],
};

function analyze(testCase: BasCase, spelling: BasSpelling) {
  const files: B1SourceFile[] = [
    ...livePreviewPlatformFiles(),
    { path: BAS_HERO_PATH, content: BAS_HERO_SOURCE },
    {
      path: testCase.routeFile,
      content: basRouteSource(testCase, spelling),
    },
  ];
  return analyzeB1Route(files, testCase.routeFile);
}

function claimedFields(claims: Readonly<Record<string, B1Claim>>) {
  return Object.values(claims)
    .filter((claim): claim is Extract<B1Claim, { kind: "claim" }> =>
      claim.kind === "claim",
    )
    .map((claim) => `${claim.slot}.${claim.field}`)
    .sort();
}

describe("B1 route field provenance", () => {
  for (const testCase of B1_INTEGRATION_CASES) {
    for (const spelling of ["content", "loader"] as const) {
      it(`${testCase.id} (${spelling}) proves only its handwritten field targets`, () => {
        const result = analyze(testCase, spelling);
        expect(result.diagnostics).toEqual([]);
        expect(result.instances.length).toBeGreaterThan(0);
        expect(
          result.instances.flatMap((instance) =>
            claimedFields(instance.claims),
          ).sort(),
        ).toEqual([...(EXPECTED_FIELDS[testCase.id] ?? [])].sort());

        const conditional = result.instances.flatMap((instance) =>
          Object.values(instance.claims)
            .filter(
              (claim): claim is Extract<B1Claim, { kind: "claim" }> =>
                claim.kind === "claim" && claim.conditional !== null,
            )
            .map((claim) => `${claim.slot}.${claim.field}`),
        );
        const expectedConditional: Readonly<Record<string, readonly string[]>> = {
          c1: ["hero.title", "hero.desc"],
          c4a: ["hero.title", "hero.desc"],
          c5: [
            "heroA.title",
            "heroA.desc",
            "heroB.title",
            "heroB.desc",
          ],
          p3: ["hero.desc"],
          p4a: ["hero.title", "hero.desc"],
        };
        expect(conditional.sort()).toEqual(
          [...(expectedConditional[testCase.id] ?? [])].sort(),
        );

        if (testCase.id === "p4a") {
          const title = result.instances[0]?.claims.title;
          expect(title?.kind).toBe("claim");
          if (title?.kind === "claim") {
            expect(title.conditional).not.toBeNull();
          }
        }

        if (testCase.id === "c6a") {
          const literal = result.instances[0]?.claims.title;
          expect(literal).toMatchObject({ kind: "none", state: "literal" });
          const composed = result.instances[1]?.claims.title;
          expect(composed).toMatchObject({
            kind: "none",
            state: "derived",
            reason: "a template literal composes its value",
          });
        }
      });
    }
  }

  it("reports a simple inline contentFields route instance for integration diagnostics", () => {
    const files: B1SourceFile[] = [
      {
        path: "src/routes/__root.tsx",
        content: `import { Outlet, createRootRoute } from "@tanstack/react-router";
export const Route = createRootRoute({ component: Root });
function Root() { return <Outlet />; }`,
      },
      {
        path: "src/routes/index.tsx",
        content: `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import Promo from "../components/Promo";
export const Route = createFileRoute("/")({ component: Home });
function Home() { return <main><Promo {...content("promo")} /></main>; }`,
      },
      { path: "src/morph/content.ts", content: "export const content = () => ({});" },
      {
        path: "src/components/Promo.tsx",
        content: `export const contentFields = { heading: { type: "text", label: "Heading" } } as const;
export default function Promo({ heading = "Promo" }) { return <h2>{heading}</h2>; }`,
      },
    ];
    expect(analyzeB1Route(files, "src/routes/index.tsx").instances).toMatchObject([
      { section: "promo", declaredFields: ["heading"] },
    ]);
  });

  it("tracks page-object fields only when morph.pages.get matches this route", () => {
    const routeFile = "src/routes/index.tsx";
    const files: B1SourceFile[] = [
      {
        path: routeFile,
        content: `import { createFileRoute } from "@tanstack/react-router";
import { morph } from "../morph/content";
import Promo from "../components/Promo";
export const Route = createFileRoute("/")({ component: Home });
async function Home() {
  const page = await morph.pages.get("/");
  const { hero } = page;
  const { heading } = hero;
  return <Promo heading={heading} />;
}`,
      },
      { path: "src/morph/content.ts", content: "export const morph = {} as any;" },
      {
        path: "src/components/Promo.tsx",
        content: `export const contentFields = { heading: { type: "text", label: "Heading" } } as const;
export default function Promo({ heading = "Promo" }) { return <h2>{heading}</h2>; }`,
      },
    ];
    const [sameRoute] = analyzeB1Route(files, routeFile).instances;
    expect(sameRoute?.claims.heading).toMatchObject({
      kind: "claim",
      slot: "hero",
      field: "heading",
      sourceRoute: "/",
    });

    const mismatched = files.map((file) =>
      file.path === routeFile
        ? { ...file, content: file.content.replace('get("/")', 'get("/other")') }
        : file,
    );
    const [otherRoute] = analyzeB1Route(mismatched, routeFile).instances;
    expect(otherRoute?.claims.heading).toMatchObject({
      kind: "none",
      state: "unknown",
      reason: "the page Document path does not match this route",
    });
  });

  it("refuses a page-object field that is changed through an alias before render", () => {
    const routeFile = "src/routes/index.tsx";
    const files: B1SourceFile[] = [
      {
        path: routeFile,
        content: `import { createFileRoute } from "@tanstack/react-router";
import { morph } from "../morph/content";
import Promo from "../components/Promo";
export const Route = createFileRoute("/")({ component: Home });
async function Home() {
  const page = await morph.pages.get("/");
  const alias = page;
  alias.hero.heading = "changed";
  return <Promo heading={page.hero.heading} />;
}`,
      },
      { path: "src/morph/content.ts", content: "export const morph = {} as any;" },
      {
        path: "src/components/Promo.tsx",
        content: `export const contentFields = { heading: { type: "text", label: "Heading" } } as const;
export default function Promo({ heading = "Promo" }) { return <h2>{heading}</h2>; }`,
      },
    ];
    const [instance] = analyzeB1Route(files, routeFile).instances;
    expect(instance?.claims.heading).toMatchObject({
      kind: "none",
      state: "unknown",
      reason: '"hero.heading" may be changed by code before it renders',
    });
  });

  it("does not choose the first section when multiple spreads can supply one component", () => {
    const files: B1SourceFile[] = [
      {
        path: "src/routes/__root.tsx",
        content: `import { Outlet, createRootRoute } from "@tanstack/react-router";
export const Route = createRootRoute({ component: Root });
function Root() { return <Outlet />; }`,
      },
      {
        path: "src/routes/index.tsx",
        content: `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import Promo from "../components/Promo";
export const Route = createFileRoute("/")({ component: Home });
function Home() { return <main><Promo {...content("hero")} {...content("promo")} /></main>; }`,
      },
      { path: "src/morph/content.ts", content: "export const content = () => ({});" },
      {
        path: "src/components/Promo.tsx",
        content: `export const contentFields = { heading: { type: "text", label: "Heading" } } as const;
export default function Promo({ heading = "Promo" }) { return <h2>{heading}</h2>; }`,
      },
    ];

    const [instance] = analyzeB1Route(files, "src/routes/index.tsx").instances;
    expect(instance?.section).toBeNull();
    expect(instance?.claims.heading).toMatchObject({
      kind: "none",
      state: "unknown",
    });
  });

  it("keeps the section identity through its matching Morph hidden-section guard", () => {
    const files: B1SourceFile[] = [
      {
        path: "src/routes/index.tsx",
        content: `import { createFileRoute } from "@tanstack/react-router";
import { content, isSectionHidden } from "../morph/content";
import Promo from "../components/Promo";
export const Route = createFileRoute("/")({ component: Home });
function Home() {
  return <main>{!isSectionHidden("promo") && <Promo {...content("promo")} />}</main>;
}`,
      },
      { path: "src/morph/content.ts", content: "export const content = () => ({}); export const isSectionHidden = () => false;" },
      {
        path: "src/components/Promo.tsx",
        content: `export const contentFields = { heading: { type: "text", label: "Heading" } } as const;
export default function Promo({ heading = "Promo" }) { return <h2>{heading}</h2>; }`,
      },
    ];

    const [instance] = analyzeB1Route(files, "src/routes/index.tsx").instances;
    expect(instance?.section).toBe("promo");
    expect(instance?.claims.heading).toMatchObject({
      kind: "claim",
      slot: "promo",
      field: "heading",
    });
  });

  it("does not treat a mismatched hidden-section guard as direct", () => {
    const routeFile = "src/routes/index.tsx";
    const source = `import { createFileRoute } from "@tanstack/react-router";
import { content, isSectionHidden } from "../morph/content";
import Promo from "../components/Promo";
export const Route = createFileRoute("/")({ component: Home });
function Home() {
  return <main>{!isSectionHidden("other") && <Promo {...content("promo")} />}</main>;
}`;
    const files: B1SourceFile[] = [
      { path: routeFile, content: source },
      { path: "src/morph/content.ts", content: "export const content = () => ({}); export const isSectionHidden = () => false;" },
      {
        path: "src/components/Promo.tsx",
        content: `export const contentFields = { heading: { type: "text", label: "Heading" } } as const;
export default function Promo({ heading = "Promo" }) { return <h2>{heading}</h2>; }`,
      },
    ];

    const [instance] = analyzeB1Route(files, routeFile).instances;
    expect(instance?.section).toBe("promo");
    expect(instance?.claims.heading).toMatchObject({
      kind: "none",
      state: "unknown",
    });
  });

  it("does not trust a shadowing local with the platform guard's name", () => {
    const routeFile = "src/routes/index.tsx";
    const files: B1SourceFile[] = [
      {
        path: routeFile,
        content: `import { createFileRoute } from "@tanstack/react-router";
import { content, isSectionHidden } from "../morph/content";
import Promo from "../components/Promo";
export const Route = createFileRoute("/")({ component: Home });
function Home(isSectionHidden) {
  return <main>{!isSectionHidden("promo") && <Promo {...content("promo")} />}</main>;
}`,
      },
      { path: "src/morph/content.ts", content: "export const content = () => ({}); export const isSectionHidden = () => false;" },
      {
        path: "src/components/Promo.tsx",
        content: `export const contentFields = { heading: { type: "text", label: "Heading" } } as const;
export default function Promo({ heading = "Promo" }) { return <h2>{heading}</h2>; }`,
      },
    ];

    const [instance] = analyzeB1Route(files, routeFile).instances;
    expect(instance?.section).toBe("promo");
    expect(instance?.claims.heading).toMatchObject({
      kind: "none",
      state: "unknown",
    });
  });

  it("keeps section identity in a repeated call but refuses a per-field target", () => {
    const routeFile = "src/routes/index.tsx";
    const files: B1SourceFile[] = [
      {
        path: routeFile,
        content: `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import Promo from "../components/Promo";
export const Route = createFileRoute("/")({ component: Home });
function Home({ items }) {
  return <main>{items.map((item) => <Promo {...content("promo")} heading={item.title} />)}</main>;
}`,
      },
      { path: "src/morph/content.ts", content: "export const content = () => ({});" },
      {
        path: "src/components/Promo.tsx",
        content: `export const contentFields = { heading: { type: "text", label: "Heading" } } as const;
export default function Promo({ heading = "Promo" }) { return <h2>{heading}</h2>; }`,
      },
    ];

    const [instance] = analyzeB1Route(files, routeFile).instances;
    expect(instance?.section).toBe("promo");
    expect(instance?.claims.heading).toMatchObject({
      kind: "none",
      state: "unknown",
    });
  });

  it("does not let an unrelated route's same-slot content use taint this route", () => {
    const routeFile = "src/routes/bas-p4a-inspector.tsx";
    const files: B1SourceFile[] = [
      {
        path: "src/routes/__root.tsx",
        content: `import { Outlet, createRootRoute } from "@tanstack/react-router";
export const Route = createRootRoute({ component: Root });
function Root() { return <Outlet />; }`,
      },
      {
        path: routeFile,
        content: `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import BasHero from "../components/BasHero";
export const Route = createFileRoute("/bas-p4a-inspector")({ component: Home });
function Home() {
  return <main><BasHero title="Code literal P4a" {...content("hero")} /></main>;
}`,
      },
      {
        path: "src/routes/unrelated-same-slot.tsx",
        content: `import { content } from "../morph/content";
export const unrelated = JSON.stringify(content("hero"));`,
      },
      { path: "src/morph/content.ts", content: "export const content = () => ({});" },
      { path: BAS_HERO_PATH, content: BAS_HERO_SOURCE },
    ];

    const result = analyzeB1Route(files, routeFile);
    expect(result.diagnostics).toEqual([]);
    expect(result.instances).toHaveLength(1);
    expect(result.instances[0]?.claims.title).toMatchObject({
      kind: "claim",
      slot: "hero",
      field: "title",
      conditional: { requiresOwnKey: true },
    });
    expect(result.instances[0]?.claims.desc).toMatchObject({
      kind: "claim",
      slot: "hero",
      field: "desc",
    });
  });

  it("still taints a route when a reachable module can mutate its same-slot value", () => {
    const routeFile = "src/routes/bas-p4a-inspector.tsx";
    const files: B1SourceFile[] = [
      {
        path: "src/routes/__root.tsx",
        content: `import { Outlet, createRootRoute } from "@tanstack/react-router";
export const Route = createRootRoute({ component: Root });
function Root() { return <Outlet />; }`,
      },
      {
        path: routeFile,
        content: `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import "../lib/hero-audit";
import BasHero from "../components/BasHero";
export const Route = createFileRoute("/bas-p4a-inspector")({ component: Home });
function Home() {
  return <main><BasHero title="Code literal P4a" {...content("hero")} /></main>;
}`,
      },
      {
        path: "src/lib/hero-audit.ts",
        content: `import { content } from "../morph/content";
JSON.stringify(content("hero"));`,
      },
      { path: "src/morph/content.ts", content: "export const content = () => ({});" },
      { path: BAS_HERO_PATH, content: BAS_HERO_SOURCE },
    ];

    const result = analyzeB1Route(files, routeFile);
    expect(result.diagnostics).toEqual([]);
    expect(result.instances).toHaveLength(1);
    expect(result.instances[0]?.claims.title).toMatchObject({
      kind: "none",
      state: "unknown",
      reason: '"hero.title" may be changed by code before it renders',
    });
    expect(result.instances[0]?.claims.desc).toMatchObject({
      kind: "none",
      state: "unknown",
      reason: '"hero.desc" may be changed by code before it renders',
    });
  });
});

describe("server-side B1 write proof", () => {
  const claim: Extract<B1Claim, { kind: "claim" }> = {
    kind: "claim",
    slot: "hero",
    field: "title",
    conditional: null,
  };

  it("fails closed when a writable field has no unique source claim", () => {
    expect(
      findB1WriteProvenanceFailure({
        sectionId: "hero",
        allowedFields: new Set(["title"]),
        requestedFields: ["title"],
        claimsByStoredField: new Map(),
        storedProps: {},
      }),
    ).toEqual({ field: "title", reason: "unproven-source" });
  });

  it("requires the claim to prove the exact section and stored field pair", () => {
    expect(
      findB1WriteProvenanceFailure({
        sectionId: "hero",
        allowedFields: new Set(["title"]),
        requestedFields: ["title"],
        claimsByStoredField: new Map([
          ["title", { ...claim, slot: "other" }],
        ]),
        storedProps: { title: "SALE" },
      }),
    ).toEqual({ field: "title", reason: "unproven-source" });
  });

  it("requires a conditional spread's own key to exist in the stored section", () => {
    const conditional: Extract<B1Claim, { kind: "claim" }> = {
      ...claim,
      conditional: {
        spread: { start: 1, end: 2 },
        otherwiseLabel: "literal",
        requiresOwnKey: true,
      },
    };
    const args = {
      sectionId: "hero",
      allowedFields: new Set(["title"]),
      requestedFields: ["title"],
      claimsByStoredField: new Map([["title", conditional]]),
    };
    expect(
      findB1WriteProvenanceFailure({ ...args, storedProps: {} }),
    ).toEqual({ field: "title", reason: "source-key-absent" });
    expect(
      findB1WriteProvenanceFailure({
        ...args,
        storedProps: { title: "SALE" },
      }),
    ).toBeNull();
  });

  it("leaves undeclared keys to the existing capability filter", () => {
    expect(
      findB1WriteProvenanceFailure({
        sectionId: "hero",
        allowedFields: new Set(["title"]),
        requestedFields: ["runtimeOnly"],
        claimsByStoredField: new Map(),
        storedProps: {},
      }),
    ).toBeNull();
  });
});
