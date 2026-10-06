// @vitest-environment node
import { describe, expect, it } from "vitest";
import { hoistColocatedContentFieldsForPreview } from "../ast/hoist-colocated-content-fields";
import { injectPreviewBindings } from "../ast/inject-preview-bindings";
import { stripEditorMarkers } from "../ast/strip-editor-markers";
import {
  prepareSourcesForBuild,
  prepareSourcesForLivePreview,
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
});
