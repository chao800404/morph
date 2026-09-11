import { describe, expect, it } from "vitest";
import { renderSafeThemeComponent } from "./safe-theme-component-renderer";

describe("safe-theme lucide and fallback support", () => {
  it("renders lucide-react icons without runtime crash", () => {
    const source = `
      import { Sparkles } from "lucide-react";

      export default function IconFeature() {
        return (
          <div data-morph-node="wrapper">
            <Sparkles className="size-5 text-amber-500" />
            <span>Magic</span>
          </div>
        );
      }
    `;

    const result = renderSafeThemeComponent({
      sourcePath: "src/components/IconFeature.tsx",
      props: {},
      files: [{ path: "src/components/IconFeature.tsx", content: source }],
    });

    expect(result.success).toBe(true);
    expect(result.node).toBeTruthy();
  });

  it("refuses a component from a package the preview does not run", () => {
    // Not a placeholder. A deleted local file is an edit the author can undo,
    // so it renders a gap; an import of a package the sandbox will not run is
    // something the real build refuses too, and a preview that quietly drew a
    // box would be the divergence rather than the protection. The message
    // names the module, because "not a local component" does not tell anyone
    // which import to remove.
    const source = `
      import { UnknownWidget } from "some-foreign-package";

      export default function ForeignSection() {
        return (
          <div data-morph-node="container">
            <UnknownWidget prop="val" />
            <p>Content preserved</p>
          </div>
        );
      }
    `;

    const result = renderSafeThemeComponent({
      sourcePath: "src/components/ForeignSection.tsx",
      props: {},
      files: [{ path: "src/components/ForeignSection.tsx", content: source }],
    });

    expect(result.success).toBe(false);
    expect(result.diagnostics.join(" ")).toContain("UnknownWidget");
    expect(result.diagnostics.join(" ")).toContain("some-foreign-package");
  });
});
