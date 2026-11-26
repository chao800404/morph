// @vitest-environment node
import { describe, expect, it } from "vitest";
import { hoistColocatedContentFieldsForPreview } from "../ast/hoist-colocated-content-fields";
import { injectPreviewBindings } from "../ast/inject-preview-bindings";
import { stripEditorMarkers } from "../ast/strip-editor-markers";
import { livePreviewPlatformFiles } from "@/lib/test-utils/live-preview-render";
import {
  prepareSourcesForBuild,
  prepareSourcesForLivePreview,
  prepareChangedSourcesForLivePreview,
} from "./tsx-source-language";

const files = [
  {
    path: "src/components/Hero.tsx",
    content: `export const contentFields = {
  heading: { type: "text", label: "Heading" },
} as const;
export default function Hero({ heading }: { heading?: string }) {
  return <h1 data-morph-node="hero-title">{heading}</h1>;
}
`,
  },
  {
    path: "src/components/Card.tsx",
    content: `export default function Card({ title }: { title?: string }) { return <h2>{title}</h2>; }\n`,
  },
  {
    path: "src/components/Card.fields.ts",
    content: `export const contentFields = { title: { type: "text" } } as const;\n`,
  },
];

describe("the TSX file-language layer", () => {
  // The same passes in the same order as the planner and the preview sync ran
  // them before they were gathered here.
  it("prepares a Live Preview exactly as identity-then-lift did", () => {
    const before = hoistColocatedContentFieldsForPreview(
      injectPreviewBindings(files).files,
    );
    const after = prepareSourcesForLivePreview(files);
    expect(after.files).toEqual(before.files);
    expect(after.hoist.hoisted).toEqual(before.hoisted);
    expect(after.bindings).toEqual(injectPreviewBindings(files));
  });

  it("prepares a build as the marker strip did, then adds Morph's hide guard", () => {
    // Nothing here is a section call site, so the guard adds nothing.
    expect(prepareSourcesForBuild(files)).toEqual({
      ...stripEditorMarkers(files),
      hideGuarded: {},
    });
    expect(prepareSourcesForBuild(files, { hideGuards: false })).toEqual({
      ...stripEditorMarkers(files),
      hideGuarded: {},
    });
  });

  it("uses the complete source graph to prepare a changed route but returns only that route", () => {
    const routePath = "src/routes/error-recovery.tsx";
    const componentPath = "src/components/KeptCard.tsx";
    const fullSource = [
      ...livePreviewPlatformFiles(),
      {
        path: componentPath,
        content: `export const contentFields = {
  title: { type: "text", label: "Card title" },
} as const;
type KeptCardProps = { title?: string };
export default function KeptCard({ title = "Kept default" }: KeptCardProps) {
  return <section><h2>{title}</h2></section>;
}`,
      },
      {
        path: routePath,
        content: `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import KeptCard from "../components/KeptCard";
export const Route = createFileRoute("/error-recovery")({ component: Page });
function Page() {
  return <main><KeptCard {...content("error-recovery")} /></main>;
}`,
      },
    ];
    const editedRoute = {
      path: routePath,
      content: fullSource.find((file) => file.path === routePath)!.content.replace(
        'createFileRoute("/error-recovery")',
        'createFileRoute("/error-recovery-updated")',
      ),
    };

    const prepared = prepareChangedSourcesForLivePreview(
      [editedRoute],
      fullSource,
    );

    // The edited route first; any other module the hide guard can be
    // written into follows it, prepared from the same snapshot.
    expect(prepared.files[0]!.path).toBe(routePath);
    expect(prepared.files[0]!.content).toContain(
      'data-storefront-section-id="error-recovery"',
    );
    expect(prepared.files[0]!.content).toContain(
      'createFileRoute("/error-recovery-updated")',
    );
    expect(prepared.files[0]!.content).not.toContain("KeptCardProps");
  });
});

// Review P1-3: whether a section can be hidden is a property of the whole
// Theme, so an edit to one module can add a guard to another. The route the
// running preview serves must then be rewritten with its gate, in the same
// sync, or it keeps rendering the section's defaults once Hide succeeds.
describe("an incremental sync rewrites the modules whose guard changed", () => {
  const ROUTE = "src/routes/index.tsx";
  const TEASER = "src/components/Teaser.tsx";
  const HERO_SOURCE = `export const contentFields = {
  title: { type: "text", label: "Title" },
} as const;
export default function Hero({ title = "HERO-DEFAULT" }: { title?: string }) {
  return <section><h1>{title}</h1></section>;
}
`;
  const ROUTE_SOURCE = `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import Hero from "../components/Hero";
export const Route = createFileRoute("/")({ component: Home });
function Home() {
  return (
    <main>
      <Hero {...content("hero")} />
    </main>
  );
}
`;
  const teaser = (body: string) => ({
    path: TEASER,
    content: `import { content } from "../morph/content";
export default function Teaser() { return <p>{${body}}</p>; }
`,
  });
  const saved = (teaserFile: { path: string; content: string }) => [
    ...livePreviewPlatformFiles(),
    { path: "src/components/Hero.tsx", content: HERO_SOURCE },
    { path: ROUTE, content: ROUTE_SOURCE },
    teaserFile,
  ];

  it("control: while another module reads the section, the route has no gate", () => {
    const before = prepareSourcesForLivePreview(
      saved(teaser(`String(content("hero").title ?? "")`)),
    );
    expect(before.files.find((file) => file.path === ROUTE)!.content).not.toContain(
      "__MorphSectionGate",
    );
  });

  it("an edit that drops the other read writes the route again, with its gate", () => {
    const edited = teaser(`"teaser"`);
    const prepared = prepareChangedSourcesForLivePreview([edited], saved(edited));
    expect(prepared.files.map((file) => file.path)).toContain(TEASER);
    const route = prepared.files.find((file) => file.path === ROUTE);
    expect(route, "the route is written in the same sync").toBeDefined();
    expect(route!.content).toContain('<__MorphSectionGate slot={"hero"}');
    // Exactly what a full layout of the same source writes.
    expect(route!.content).toBe(
      prepareSourcesForLivePreview(saved(edited)).files.find(
        (file) => file.path === ROUTE,
      )!.content,
    );
  });
});

