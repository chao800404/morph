// @vitest-environment node
import { parse } from "@babel/parser";
import { describe, expect, it } from "vitest";
import {
  collectPageVariables,
  isPageBindingExpression,
  readPageBindingKey,
} from "./theme-content-binding";

const parseSource = (source: string) =>
  parse(source, { sourceType: "module", plugins: ["jsx", "typescript"] });

const IMPORT = `import { morph } from "../morph/content";\n`;

function spreadArgument(source: string): any {
  const ast = parseSource(source);
  let argument: any = null;
  const visit = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(visit);
    if (node.type === "JSXSpreadAttribute") argument = node.argument;
    for (const [key, value] of Object.entries(node)) {
      if (key !== "loc") visit(value);
    }
  };
  visit(ast.program);
  return argument;
}

describe("page variables", () => {
  it("collects a variable declared from a literal morph.pages.get call", () => {
    const ast = parseSource(
      `${IMPORT}async function load() { const home = await morph.pages.get("/home"); }`,
    );
    expect([...collectPageVariables(ast)]).toEqual(["home"]);
  });

  it("follows the local name morph is imported under", () => {
    const ast = parseSource(
      `import { morph as m } from "../morph/content";\nconst home = await m.pages.get("/home");`,
    );
    expect([...collectPageVariables(ast)]).toEqual(["home"]);
  });

  it("ignores a morph that did not come from the Theme content module", () => {
    const ast = parseSource(
      `import { morph } from "some-package";\nconst home = await morph.pages.get("/home");`,
    );
    expect(collectPageVariables(ast).size).toBe(0);
  });

  it.each([
    ["a computed path", `const home = await morph.pages.get(path);`],
    ["no await", `const home = morph.pages.get("/home");`],
    ["another method", `const home = await morph.pages.list("/home");`],
    ["a destructuring pattern", `const { hero } = await morph.pages.get("/home");`],
  ])("does not treat %s as a page variable", (_label, line) => {
    expect(collectPageVariables(parseSource(`${IMPORT}${line}`)).size).toBe(0);
  });
});

describe("page bindings", () => {
  const vars = new Set(["home"]);

  it("reads a dotted key and a bracketed key, including a hyphenated slot id", () => {
    expect(
      readPageBindingKey(spreadArgument("<Hero {...home.hero} />"), vars),
    ).toBe("hero");
    expect(
      readPageBindingKey(
        spreadArgument('<Gallery {...home["summer-sale"]} />'),
        vars,
      ),
    ).toBe("summer-sale");
  });

  it("does not resolve a computed key or an unknown variable", () => {
    expect(
      readPageBindingKey(spreadArgument("<Hero {...home[key]} />"), vars),
    ).toBeNull();
    expect(
      readPageBindingKey(spreadArgument("<Hero {...other.hero} />"), vars),
    ).toBeNull();
  });

  it("still reports a spread off a page variable that has no usable key", () => {
    const argument = spreadArgument("<Hero {...home[key]} />");
    expect(isPageBindingExpression(argument, vars)).toBe(true);
  });
});
