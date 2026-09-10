// @vitest-environment node
/**
 * What happens to a `key` written on a component element.
 *
 * A host element keeps its key without help: `createElement` reads one out of
 * the props it is given. A component element does not — the interpreter
 * renders it to a node and returns that node — so `{items.map((item, index) =>
 * <ThemeLink key={index} …/>)}` produced a keyless list, and the key the
 * author wrote instead travelled on as an ordinary prop until a spread carried
 * it into the DOM.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { renderSafeThemeComponent } from "./safe-theme-component-renderer";

const ROW = `export default function Row({ label }) {
  return <li>{label}</li>;
}`;

const LIST = `import Row from "./Row";

export default function List({ items = [] }) {
  return <ul>{items.map((item, index) => <Row key={index} label={item} />)}</ul>;
}`;

function renderList() {
  return renderSafeThemeComponent({
    files: [
      { path: "src/components/Row.tsx", content: ROW },
      { path: "src/components/List.tsx", content: LIST },
    ],
    sourcePath: "src/components/List.tsx",
    props: { items: ["one", "two"] },
  } as never);
}

describe("a key on a component element", () => {
  it("keys the list instead of warning about it", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const result = renderList();
      expect(result.diagnostics).toEqual([]);
      const markup = renderToStaticMarkup(result.node as never);
      expect(markup).toContain(">one</li>");
      expect(markup).toContain(">two</li>");
      expect(errors.mock.calls.flat().join(" ")).not.toContain("unique");
    } finally {
      errors.mockRestore();
    }
  });

  it("is not forwarded to the component as a prop", () => {
    // A component that spreads its props is how the key actually escaped:
    // React strips `key` before a real component ever sees it, so anything
    // that reaches the spread reaches the DOM.
    const source = `export default function Probe(props) {
  return <span {...props} />;
}`;
    const result = renderSafeThemeComponent({
      files: [
        { path: "src/components/Probe.tsx", content: source },
        {
          path: "src/components/Host.tsx",
          content:
            'import Probe from "./Probe";\n\nexport default function Host() {\n  return <Probe key="k" label="x" />;\n}',
        },
      ],
      sourcePath: "src/components/Host.tsx",
      props: {},
    } as never);

    expect(result.diagnostics).toEqual([]);
    const markup = renderToStaticMarkup(result.node as never);
    expect(markup).toContain('label="x"');
    expect(markup).not.toContain("key=");
  });
});
