// @vitest-environment node
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { renderSafeThemeComponent } from "./safe-theme-component-renderer";

const promoSource = `export default function Promo({ heading = "Promo" }) {
  return (
    <section className="px-6">
      <h2 className="text-2xl">{heading}</h2>
    </section>
  );
}`;

function renderPromo(files = [{ path: "src/components/Promo.tsx", content: promoSource }]) {
  const result = renderSafeThemeComponent({
    files,
    sourcePath: "src/components/Promo.tsx",
    componentName: "Promo",
    props: {},
  } as never);
  expect(result.success, result.success ? "" : result.diagnostics.join()).toBe(
    true,
  );
  if (!result.success) throw new Error("render failed");
  return renderToStaticMarkup(result.node as never);
}

describe("Live preview source annotation", () => {
  it("annotates interpreted elements exactly as the build does", () => {
    // Live preview interprets source rather than running the built bundle, so
    // the build's Babel annotation never reaches it. Both modes must produce
    // the same identity or an element is selectable in one and not the other.
    const html = renderPromo();
    expect(html).toContain('data-morph-loc="src/components/Promo.tsx:3:5"');
    expect(html).toContain('data-morph-loc="src/components/Promo.tsx:4:7"');
  });

  it("does not overwrite an authored location attribute", () => {
    const html = renderPromo([
      {
        path: "src/components/Promo.tsx",
        content: `export default function Promo() {
  return <section data-morph-loc="authored:1:1" />;
}`,
      },
    ]);
    expect(html).toContain('data-morph-loc="authored:1:1"');
  });

  it("keeps annotations out of component invocations", () => {
    // A component receives it as an unused prop that never reaches the DOM,
    // so annotating one adds noise without adding identity.
    const html = renderPromo([
      {
        path: "src/components/Promo.tsx",
        content: `import Inner from "./Inner";
export default function Promo() {
  return <Inner />;
}`,
      },
      {
        path: "src/components/Inner.tsx",
        content: `export default function Inner() {
  return <span>inner</span>;
}`,
      },
    ]);
    // The span is annotated with its own file, not the caller's.
    expect(html).toContain('data-morph-loc="src/components/Inner.tsx:2:10"');
    expect(html).not.toContain('data-morph-loc="src/components/Promo.tsx:3:10"');
  });
});
