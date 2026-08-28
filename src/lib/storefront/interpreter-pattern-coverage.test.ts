// @vitest-environment node
import { describe, expect, it } from "vitest";
import { transformSync } from "esbuild";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as jsxRuntime from "react/jsx-runtime";
import { renderSafeThemeComponent } from "@/components/storefront/safe-theme-component-renderer";

const hostRequire = createRequire(import.meta.url);

/**
 * Patterns a competent React author would use that the starter Theme does not.
 *
 * The starter Theme is the only fixture the parity tests had, and a Theme
 * written by whoever also wrote the interpreter only exercises what that person
 * already knew was supported. This list is written the other way round: what a
 * React author would reach for, without regard for what the interpreter can do,
 * so a difference is a finding rather than a passing grade.
 *
 * Its limitation is worth stating plainly — it can only find gaps someone
 * thought to probe. A Theme written by an outsider will still find more.
 */
const CASES: Array<{ name: string; source: string; props?: Record<string, unknown> }> = [
  {
    name: "fragment shorthand",
    source: `export default function C() {
  return (
    <>
      <span>one</span>
      <span>two</span>
    </>
  );
}`,
  },
  {
    name: "conditional && with a falsy number",
    source: `export default function C({ count = 0 }) {
  return <div>{count && <span>has {count}</span>}</div>;
}`,
  },
  {
    name: "ternary with null branch",
    source: `export default function C({ show = false }) {
  return <div>{show ? <b>yes</b> : null}</div>;
}`,
  },
  {
    name: "template literal className",
    source: `export default function C({ size = "lg" }) {
  return <div className={\`box box-\${size} \${size === "lg" ? "wide" : ""}\`} />;
}`,
  },
  {
    name: "rest props spread onto an element",
    source: `export default function C({ id = "x", ...rest }) {
  return <div id={id} {...rest} />;
}`,
    props: { id: "y", "data-extra": "1", title: "t" },
  },
  {
    name: "map with index and a computed key",
    source: `export default function C({ items = ["a", "b", "c"] }) {
  return (
    <ul>
      {items.map((item, index) => (
        <li key={\`\${item}-\${index}\`}>{index + 1}. {item}</li>
      ))}
    </ul>
  );
}`,
  },
  {
    name: "filter then map",
    source: `export default function C({ items = [1, 2, 3, 4] }) {
  return <div>{items.filter((n) => n % 2 === 0).map((n) => <b key={n}>{n}</b>)}</div>;
}`,
  },
  {
    name: "optional chaining and nullish coalescing",
    source: `export default function C({ author }) {
  return <p>{author?.name ?? "Anonymous"}</p>;
}`,
  },
  {
    name: "inline style object",
    source: `export default function C({ gap = 8 }) {
  return <div style={{ display: "flex", gap: gap, marginTop: "1rem" }} />;
}`,
  },
  {
    name: "children prop composition",
    source: `function Box({ children, tone = "muted" }) {
  return <div className={"box " + tone}>{children}</div>;
}
export default function C() {
  return (
    <Box tone="loud">
      <span>inside</span>
    </Box>
  );
}`,
  },
  {
    name: "boolean and null children",
    source: `export default function C() {
  return <div>{true}{false}{null}{undefined}{0}{"text"}</div>;
}`,
  },
  {
    name: "nested arrays of elements",
    source: `export default function C({ rows = [["a", "b"], ["c"]] }) {
  return (
    <div>
      {rows.map((row, i) => (
        <div key={i}>{row.map((cell) => <span key={cell}>{cell}</span>)}</div>
      ))}
    </div>
  );
}`,
  },
  {
    name: "default parameter destructuring with nested defaults",
    source: `export default function C({ meta: { label = "none" } = {} } = {}) {
  return <em>{label}</em>;
}`,
  },
  {
    name: "component returning an array",
    source: `export default function C() {
  return [<i key="a">a</i>, <i key="b">b</i>];
}`,
  },
  {
    name: "string methods in expressions",
    source: `export default function C({ title = "hello world" }) {
  return <h2>{title.toUpperCase().split(" ").join(" · ")}</h2>;
}`,
  },
];

function renderReal(source: string, props: Record<string, unknown>): string {
  const { code } = transformSync(source, { loader: "tsx", jsx: "automatic", format: "cjs", target: "es2022" });
  const module = { exports: {} as Record<string, unknown> };
  const req = (id: string) =>
    id === "react/jsx-runtime" || id === "react/jsx-dev-runtime" ? jsxRuntime : hostRequire(id);
  new Function("exports", "module", "require", code)(module.exports, module, req);
  return renderToStaticMarkup(createElement(module.exports.default as never, props));
}

const EDITOR_ATTR = /\s(?:data-(?:morph|storefront|tsd)-[a-z-]+)="[^"]*"/g;
const normalize = (html: string) =>
  html.replace(EDITOR_ATTR, "").replace(/<!--[\s\S]*?-->/g, "").replace(/\s+/g, " ").trim();

describe("adversarial theme patterns", () => {
  for (const testCase of CASES) {
    it(testCase.name, () => {
      const props = testCase.props ?? {};
      const real = normalize(renderReal(testCase.source, props));
      const files = [{ path: "src/components/C.tsx", content: testCase.source }];
      const result = renderSafeThemeComponent({ files, sourcePath: "src/components/C.tsx", props });
      if (!result.success) {
        throw new Error(`interpreter refused: ${result.diagnostics.join("; ")} | real: ${real}`);
      }
      const interpreted = normalize(renderToStaticMarkup(result.node as never));
      expect(interpreted, `real: ${real}`).toBe(real);
    });
  }
});
