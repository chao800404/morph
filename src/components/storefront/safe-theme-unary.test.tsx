// @vitest-environment node
/**
 * What the interpreter does with an operator it does not implement.
 *
 * `typeof` is the operator a component reaches for as soon as one prop can
 * arrive in two shapes — a destination field promoted from a plain address to
 * a link object still holds the string until it is next edited. Returning
 * `undefined` for it made `typeof v === "string"` false for a string, so the
 * branch it guarded silently became the other one: the preview rendered a
 * link with no address while the build rendered it correctly.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { renderSafeThemeComponent } from "./safe-theme-component-renderer";

function render(body: string, props: Record<string, unknown>) {
  const source = `export default function Probe({ v }) {\n  return ${body};\n}`;
  return renderSafeThemeComponent({
    files: [{ path: "src/components/Probe.tsx", content: source }],
    sourcePath: "src/components/Probe.tsx",
    componentName: "Probe",
    props,
  } as never);
}

describe("the typeof operator", () => {
  it("recognises a string", () => {
    const r = render('<a href={typeof v === "string" ? v : v.href}>go</a>', {
      v: "/hello",
    });
    expect(r.diagnostics).toEqual([]);
    expect(renderToStaticMarkup(r.node as never)).toContain('href="/hello"');
  });

  it("recognises an object on the same expression", () => {
    const r = render('<a href={typeof v === "string" ? v : v.href}>go</a>', {
      v: { href: "/there" },
    });
    expect(r.diagnostics).toEqual([]);
    expect(renderToStaticMarkup(r.node as never)).toContain('href="/there"');
  });

  it("reports the type it actually found", () => {
    const r = render("<span>{typeof v}</span>", { v: 3 });
    expect(r.diagnostics).toEqual([]);
    expect(renderToStaticMarkup(r.node as never)).toContain("number");
  });
});

describe("an operator the interpreter does not implement", () => {
  it("is refused rather than answered with undefined", () => {
    // Silence is the dangerous answer: a condition that quietly turns false
    // drops whatever it guarded, and nothing anywhere says so.
    const r = render("<span>{~v}</span>", { v: 1 });

    expect(r.success).toBe(false);
    expect(r.diagnostics.join(" ")).toContain("not supported");
  });
});
