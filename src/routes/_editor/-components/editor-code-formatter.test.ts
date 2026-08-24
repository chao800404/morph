import { describe, expect, it } from "vitest";
import { formatEditorCode } from "./editor-code-formatter";

describe("editor code formatter", () => {
  it("uses standard Prettier indentation for nested TSX and long attributes", async () => {
    const source = `export default function Hero(){return <section data-morph-node="hero" data-long-attribute="a deliberately long attribute value that should wrap at the standard print width"><div className="flex items-center justify-between gap-4"><h1>Heading</h1></div></section>}`;

    await expect(formatEditorCode(source, "src/components/Hero.tsx")).resolves.toBe(
      `export default function Hero() {
  return (
    <section
      data-morph-node="hero"
      data-long-attribute="a deliberately long attribute value that should wrap at the standard print width"
    >
      <div className="flex items-center justify-between gap-4">
        <h1>Heading</h1>
      </div>
    </section>
  );
}
`,
    );
  });

  it("selects parsers by file extension", async () => {
    await expect(formatEditorCode("body{color:red}", "theme.css")).resolves.toContain(
      "body {\n  color: red;\n}",
    );
    await expect(formatEditorCode('{"title":"Hero"}', "theme.json")).resolves.toBe(
      '{\n  "title": "Hero"\n}\n',
    );
  });
});
