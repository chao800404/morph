// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  EDITOR_ONLY_ATTRIBUTES,
  stripEditorMarkers,
} from "./strip-editor-markers";

const run = (content: string, path = "src/components/Hero.tsx") =>
  stripEditorMarkers([{ path, content }]);

describe("keeping the editor's attributes out of what ships", () => {
  it("removes a hand-written marker from the copy a build compiles", () => {
    const result = run(`export default function Hero({ heading }) {
  return <h1 data-storefront-field="heading" className="title">{heading}</h1>;
}
`);
    const out = result.files[0]!.content;
    expect(out).not.toContain("data-storefront-field");
    expect(out).toContain('className="title"');
    expect(result.stripped["src/components/Hero.tsx"]).toBe(1);
  });

  it("removes every attribute that exists only for the editor", () => {
    const attributes = EDITOR_ONLY_ATTRIBUTES.map((name) => `${name}="x"`).join(
      " ",
    );
    const out = run(`export default () => <p ${attributes}>hi</p>;\n`).files[0]!
      .content;
    for (const name of EDITOR_ONLY_ATTRIBUTES) {
      expect(out).not.toContain(name);
    }
  });

  it("moves no byte, so a diagnostic still points where the author looks", () => {
    const source = `export default function Hero({ heading }) {
  return <h1 data-storefront-field="heading">{heading}</h1>;
}
`;
    const out = run(source).files[0]!.content;
    expect(out).toHaveLength(source.length);
    expect(out.indexOf("{heading}</h1>")).toBe(
      source.indexOf("{heading}</h1>"),
    );
  });

  it("leaves a Theme author's own data attributes alone", () => {
    // A build silently dropping one of theirs would be a worse bug than
    // shipping a few of ours, which is why this is a list and not a pattern.
    const out = run(
      `export default () => <p data-morph-ish="mine" data-analytics-id="cta">hi</p>;\n`,
    ).files[0]!.content;
    expect(out).toContain('data-morph-ish="mine"');
    expect(out).toContain('data-analytics-id="cta"');
  });

  it("does not touch a file that has none", () => {
    const source = `export default () => <p className="a">hi</p>;\n`;
    const result = run(source);
    expect(result.files[0]!.content).toBe(source);
    expect(result.stripped).toEqual({});
  });

  it("hands unparseable source to the build as the author wrote it", () => {
    const source = `export default () => <p data-morph-loc="x">{ <<< }</p>;`;
    expect(run(source).files[0]!.content).toBe(source);
  });

  it("still produces valid syntax after everything it removes", async () => {
    const { parse } = await import("@babel/parser");
    const out = run(`export default function Hero({ items = [] }) {
  return (
    <ul data-morph-source-file="src/components/Hero.tsx">
      {items.map((item, i) => (
        <li key={i} data-storefront-field-path={\`items.\${i}\`} className="row">
          {item.title}
        </li>
      ))}
    </ul>
  );
}
`).files[0]!.content;
    expect(out).toContain('className="row"');
    expect(() =>
      parse(out, { sourceType: "module", plugins: ["jsx", "typescript"] }),
    ).not.toThrow();
  });
});
