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

  it("prepares a build exactly as the marker strip did", () => {
    expect(prepareSourcesForBuild(files)).toEqual(stripEditorMarkers(files));
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

    expect(prepared.files.map((file) => file.path)).toEqual([routePath]);
    expect(prepared.files[0]!.content).toContain(
      'data-storefront-section-id="error-recovery"',
    );
    expect(prepared.files[0]!.content).toContain(
      'createFileRoute("/error-recovery-updated")',
    );
    expect(prepared.files[0]!.content).not.toContain("KeptCardProps");
  });
});
