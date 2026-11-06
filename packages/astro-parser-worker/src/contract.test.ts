// @vitest-environment node
/**
 * The contract's own checks on `template` answers, without a Worker: a
 * hand-built answer that is right, and each way of breaking one of its
 * invariants. What the Worker actually produces is pinned in
 * template.test.ts; this file pins what Core refuses.
 */
import { describe, expect, it } from "vitest";

import {
  ASTRO_PARSE_CONTRACT_VERSION_REASON,
  ASTRO_PARSER_CONTRACT_VERSION,
  astroParseRequestPath,
  checkAstroParseResponse,
  type AstroParseExpectation,
} from "./contract";

const SOURCE =
  "---\nconst a = 1;\n---\n<div {...p} title={a}>{c && <b/>}</div>";
const at = (text: string, from = 0) => {
  const index = SOURCE.indexOf(text, from);
  if (index < 0) throw new Error(`no ${text}`);
  return index;
};

const SHA = "a".repeat(64);
const expectation: AstroParseExpectation = {
  request: { mode: "template" },
  sourceSha256: SHA,
  sourceBytes: new TextEncoder().encode(SOURCE).byteLength,
  sourceLength: SOURCE.length,
};

/** A correct answer for SOURCE, built by hand from its text. */
function valid() {
  const fenceEnd = at("---", 3) + 3;
  const div = at("<div");
  const spread = at("{...p}");
  const title = at("title");
  const titleValue = at("{a}");
  const child = at("{c &&");
  const childEnd = at("}</div>") + 1;
  const b = at("<b/>");
  return {
    v: ASTRO_PARSER_CONTRACT_VERSION,
    ok: true,
    mode: "template",
    compiler: "0.5.1",
    source: {
      sha256: SHA,
      bytes: expectation.sourceBytes,
      length: SOURCE.length,
    },
    frontmatter: [0, fenceEnd],
    frontmatterInner: [3, fenceEnd - 3],
    tags: ["div", "b"],
    elements: [
      [div, SOURCE.length, 0, -1],
      [b, b + 4, 1, 0],
    ],
    attributes: [
      [0, "spread", "...", null, null, spread + 4, spread + 5],
      [0, "expression", "title", title, title + 5, titleValue, titleValue + 3],
    ],
    expressions: [
      [spread, spread + 6, spread + 4, spread + 5, 0, 0, []],
      [titleValue, titleValue + 3, titleValue + 1, titleValue + 2, 0, 1, []],
      [child, childEnd, child + 1, childEnd - 1, 0, -1, [1]],
    ],
    elementCount: 2,
    maxDepth: 1,
    diagnostics: { total: 0, first: [] },
  } as Record<string, unknown> & {
    elements: unknown[][];
    attributes: unknown[][];
    expressions: unknown[][];
  };
}

const reasonOf = (payload: unknown) => {
  const check = checkAstroParseResponse(payload, expectation);
  return check.ok ? "ok" : check.reason;
};

describe("contract v2 requests", () => {
  it("asks for a template on the same path", () => {
    expect(ASTRO_PARSER_CONTRACT_VERSION).toBe(2);
    expect(astroParseRequestPath({ mode: "template" })).toBe(
      "/parse/v1?mode=template",
    );
    expect(astroParseRequestPath({ mode: "outline" })).toBe(
      "/parse/v1?mode=outline",
    );
    expect(astroParseRequestPath({ mode: "at", offset: 7 })).toBe(
      "/parse/v1?mode=at&offset=7",
    );
  });
});

describe("checking a template answer", () => {
  it("accepts the hand-built answer, whose ranges slice to what they name", () => {
    const payload = valid();
    expect(reasonOf(payload)).toBe("ok");
    // The fixture itself is right, or the refusals below prove nothing.
    const [fence, inner] = [
      payload.frontmatter as number[],
      payload.frontmatterInner as number[],
    ];
    expect(SOURCE.slice(fence[0], fence[1])).toBe("---\nconst a = 1;\n---");
    expect(SOURCE.slice(inner[0], inner[1])).toBe("\nconst a = 1;\n");
    const slice = (entry: unknown[], from: number) =>
      SOURCE.slice(entry[from] as number, entry[from + 1] as number);
    expect(slice(payload.elements[1], 0)).toBe("<b/>");
    expect(slice(payload.attributes[0], 5)).toBe("p");
    expect(slice(payload.attributes[1], 3)).toBe("title");
    expect(slice(payload.attributes[1], 5)).toBe("{a}");
    expect(payload.expressions.map((entry) => slice(entry, 0))).toEqual([
      "{...p}",
      "{a}",
      "{c && <b/>}",
    ]);
    expect(payload.expressions.map((entry) => slice(entry, 2))).toEqual([
      "p",
      "a",
      "c && <b/>",
    ]);
  });

  it("refuses another contract version with its own reason", () => {
    expect(reasonOf({ ...valid(), v: 1 })).toBe(
      ASTRO_PARSE_CONTRACT_VERSION_REASON,
    );
    expect(
      reasonOf({ v: 1, ok: false, error: { code: "parser-busy", detail: "" } }),
    ).toBe(ASTRO_PARSE_CONTRACT_VERSION_REASON);
    expect(reasonOf([valid()])).toBe("shape");
  });

  it("refuses a template answer to another request", () => {
    const check = checkAstroParseResponse(valid(), {
      ...expectation,
      request: { mode: "outline" },
    });
    expect(check).toEqual({ ok: false, reason: "mode" });
  });

  type Mutation = (payload: ReturnType<typeof valid>) => void;
  const cases: [string, Mutation, string][] = [
    ["no compiler", (p) => delete p.compiler, "compiler"],
    ["an empty compiler", (p) => (p.compiler = ""), "compiler"],
    [
      "an inner frontmatter range outside the fences",
      (p) => (p.frontmatterInner = [3, 30]),
      "frontmatter-inner",
    ],
    [
      "an inner frontmatter range without fences",
      (p) => (p.frontmatter = null),
      "frontmatter-inner",
    ],
    [
      "fences without an inner range and without diagnostics",
      (p) => (p.frontmatterInner = null),
      "frontmatter-inner",
    ],
    [
      "a missing table",
      (p) => delete (p as Record<string, unknown>).expressions,
      "template",
    ],
    ["a wrong element count", (p) => (p.elementCount = 3), "element-count"],
    [
      "an element past the end of the source",
      (p) => (p.elements[1] = [0, SOURCE.length + 1, 1, -1]),
      "element-range-1",
    ],
    [
      "an element ending before it starts",
      (p) => (p.elements[1] = [30, 29, 1, 0]),
      "element-range-1",
    ],
    [
      "an element with a fractional position",
      (p) => (p.elements[1] = [30.5, 31, 1, 0]),
      "element-range-1",
    ],
    [
      "an element with an unknown tag",
      (p) => (p.elements[1][2] = 2),
      "element-tag-1",
    ],
    [
      "an element that is its own parent",
      (p) => (p.elements[1][3] = 1),
      "element-parent-1",
    ],
    [
      "an element outside its parent",
      (p) => (p.elements[1] = [0, 4, 1, 0]),
      "element-nesting-1",
    ],
    [
      "an element deeper than maxDepth",
      (p) => (p.maxDepth = 0),
      "element-depth-1",
    ],
    [
      "an element tuple of the wrong length",
      (p) => p.elements[0].push(0),
      "element-0",
    ],
    [
      "an unknown attribute kind",
      (p) => (p.attributes[1][1] = "shorthand"),
      "attribute-1",
    ],
    [
      "an attribute of a missing element",
      (p) => (p.attributes[1][0] = 2),
      "attribute-element-1",
    ],
    [
      "attributes out of element order",
      (p) => {
        const b = at("<b/>");
        const title = at("title");
        p.attributes.push(
          [1, "boolean", "x", b + 1, b + 2, null, null],
          [0, "boolean", "title", title, title + 5, null, null],
        );
      },
      "attribute-order-3",
    ],
    [
      "a spread with a name range",
      (p) => {
        p.attributes[0][3] = 22;
        p.attributes[0][4] = 23;
      },
      "attribute-name-0",
    ],
    [
      "a named attribute without a name range",
      (p) => (p.attributes[1][3] = null),
      "attribute-name-1",
    ],
    [
      "a name outside its element",
      (p) => {
        p.attributes[1][3] = 0;
        p.attributes[1][4] = 3;
      },
      "attribute-name-1",
    ],
    [
      "a boolean with a value",
      (p) => (p.attributes[1][1] = "boolean"),
      "attribute-value-1",
    ],
    [
      "a value past the end of the source",
      (p) => (p.attributes[1][6] = SOURCE.length + 1),
      "attribute-value-1",
    ],
    [
      "an expression whose inner range leaves it",
      (p) => (p.expressions[1][3] = (p.expressions[1][1] as number) + 1),
      "expression-inner-1",
    ],
    [
      "an expression outside its owner",
      (p) => (p.expressions[2][4] = 1),
      "expression-owner-2",
    ],
    [
      "an expression with an owner that does not exist",
      (p) => (p.expressions[2][4] = 5),
      "expression-owner-2",
    ],
    [
      "an attribute container that is not that attribute's value",
      (p) => (p.expressions[1][5] = 0),
      "expression-attribute-1",
    ],
    [
      "an attribute index that does not exist",
      (p) => (p.expressions[1][5] = 9),
      "expression-attribute-1",
    ],
    [
      "nested JSX that is not inside the expression",
      (p) => (p.expressions[1][6] = [1]),
      "expression-jsx-1",
    ],
    [
      "nested JSX owned by another element",
      (p) => (p.elements[1][3] = -1),
      "expression-jsx-2",
    ],
    [
      "nested JSX that does not exist",
      (p) => (p.expressions[2][6] = [2]),
      "expression-jsx-2",
    ],
    [
      "nested JSX listed twice",
      (p) => (p.expressions[2][6] = [1, 1]),
      "expression-jsx-2",
    ],
  ];

  it.each(cases)("refuses %s", (_, mutate, reason) => {
    const payload = valid();
    mutate(payload);
    expect(reasonOf(payload)).toBe(reason);
  });

  it("allows fences without an inner range only with diagnostics", () => {
    const payload = valid();
    payload.frontmatterInner = null;
    payload.diagnostics = {
      total: 1,
      first: [
        {
          severity: "error",
          text: "Unexpected token",
          byteStart: 0,
          byteEnd: 1,
        },
      ],
    };
    expect(reasonOf(payload)).toBe("ok");
  });
});
