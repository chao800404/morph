// @vitest-environment node
/**
 * The `.astro` projection (M2 PR-B, D90-1), on contract v2 `template`
 * answers from the real parser Worker in local workerd, through Core's own
 * `parseAstroTemplate`: the projection only ever sees what Core accepted.
 *
 * Positions: every node the projection did not make up must slice the
 * source to its own text, and its line and column must be the source's,
 * on CRLF, Chinese, emoji and other astral text. Two reverse checks are kept
 * on purpose: without the ancestor-range restore those positions are wrong.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AstroParseTemplate } from "@morph/astro-parser-worker/contract";
import {
  startLocalAstroParser,
  type LocalAstroParser,
} from "@morph/astro-parser-worker/testing";
import { buildHandScopeOracle, type AnyNode } from "@/lib/storefront/ast/b1-scope";
import {
  ASTRO_B1_SAMPLES,
  ASTRO_SAMPLES_ENDING_AT_NESTED_JSX,
  astroPage,
} from "@/lib/test-utils/astro-b1-samples";

import { parseAstroTemplate } from "./astro-parser-client";
import {
  astroLineStarts,
  astroPositionAt,
  projectAstroTemplate,
  projectAstroTemplateReverseCheck,
  type AstroProjection,
  type AstroProjectionResult,
} from "./astro-source-language";

let parser: LocalAstroParser;
beforeAll(async () => {
  parser = await startLocalAstroParser();
}, 60_000);
afterAll(() => parser?.dispose());

async function confirmed(source: string): Promise<AstroParseTemplate> {
  const outcome = await parseAstroTemplate(parser.binding, source);
  if (outcome.status !== "confirmed") {
    throw new Error(`parser refused: ${outcome.code} ${outcome.detail}`);
  }
  return outcome.result;
}

function ok(result: AstroProjectionResult): AstroProjection {
  if (!result.ok) throw new Error(`projection refused: ${result.reason} ${result.detail}`);
  return result;
}

type Loose = { type: string; start?: number; end?: number; [key: string]: unknown };

function walk(root: unknown, visit: (node: Loose) => void) {
  const seen = new Set<object>();
  const step = (value: unknown) => {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) return value.forEach(step);
    const node = value as Loose;
    if (typeof node.type === "string") visit(node);
    for (const [key, child] of Object.entries(node)) {
      if (key === "loc" || key === "extra") continue;
      step(child);
    }
  };
  step(root);
}

/** Every non-synthetic node against the source: slice, line, column. */
function checkPositions(source: string, projection: AstroProjection) {
  const starts = astroLineStarts(source);
  const mismatches: string[] = [];
  let checked = 0;
  walk(projection.ast, (node) => {
    if (projection.synthetic.has(node)) return;
    const { start, end } = node;
    if (typeof start !== "number" || typeof end !== "number") {
      mismatches.push(`${node.type}: no range`);
      return;
    }
    checked += 1;
    const fail = (problem: string) =>
      mismatches.push(`${node.type} ${start}-${end}: ${problem}`);
    if (start < 0 || end > source.length || start > end) return fail("out of bounds");
    const text = source.slice(start, end);
    const loc = node.loc as
      | { start: { line: number; column: number }; end: { line: number; column: number } }
      | undefined;
    if (!loc) fail("no loc");
    else {
      const a = astroPositionAt(starts, start);
      const b = astroPositionAt(starts, end);
      if (
        loc.start.line !== a.line ||
        loc.start.column !== a.column ||
        loc.end.line !== b.line ||
        loc.end.column !== b.column
      ) {
        fail(`loc ${loc.start.line}:${loc.start.column}-${loc.end.line}:${loc.end.column}`);
      }
    }
    for (const placeholder of projection.placeholders) {
      const inside = (offset: number) =>
        offset > placeholder.start && offset < placeholder.end;
      const within = start >= placeholder.start && end <= placeholder.end;
      if (!within && (inside(start) || inside(end))) {
        fail(`boundary inside placeholder ${placeholder.start}-${placeholder.end}`);
      }
    }
    const extra = node.extra as { raw?: string } | undefined;
    switch (node.type) {
      case "Identifier": {
        const name = node.name as string;
        if (text !== name && !text.startsWith(`${name}:`) && !text.startsWith(`${name}?`)) {
          fail(`slice ${JSON.stringify(text)} is not ${name}`);
        }
        break;
      }
      case "JSXIdentifier":
        if (text !== node.name) fail(`slice ${JSON.stringify(text)}`);
        break;
      case "StringLiteral":
      case "NumericLiteral":
      case "JSXText":
        if (text !== extra?.raw) fail(`slice ${JSON.stringify(text)} is not raw`);
        break;
      case "JSXElement": {
        const opening = node.openingElement as Loose;
        const name = opening.name as Loose;
        const tag = source.slice(name.start, name.end);
        if (!text.startsWith(`<${tag}`) || !text.endsWith(">")) fail("element slice");
        break;
      }
      case "JSXFragment":
        if (!text.startsWith("<") || !text.endsWith(">")) fail("fragment slice");
        break;
      case "JSXExpressionContainer":
        if (
          !(text.startsWith("{") && text.endsWith("}")) &&
          !(text.startsWith("`") && text.endsWith("`"))
        ) {
          fail(`container slice ${JSON.stringify(text)}`);
        }
        break;
      case "JSXSpreadAttribute":
        if (!/^\{\s*\.\.\./.test(text) || !text.endsWith("}")) fail("spread slice");
        break;
      case "TemplateLiteral":
        if (!text.startsWith("`") || !text.endsWith("`")) fail("template literal slice");
        break;
      case "CommentLine":
        if (text !== `//${node.value as string}`) fail("comment slice");
        break;
      case "CommentBlock":
        if (text !== `/*${node.value as string}*/`) fail("comment slice");
        break;
      default:
        break;
    }
  });
  return { checked, mismatches };
}

const PROJECTED = ASTRO_B1_SAMPLES.filter((sample) => sample.expected !== "refused");
const answers = new Map<string, AstroParseTemplate>();

beforeAll(async () => {
  for (const sample of PROJECTED) answers.set(sample.id, await confirmed(sample.source));
}, 60_000);

describe("projectAstroTemplate positions", () => {
  for (const sample of PROJECTED) {
    it(`${sample.id}: every projected node slices the source to its own text`, () => {
      const projection = ok(projectAstroTemplate(sample.source, answers.get(sample.id)!));
      const { checked, mismatches } = checkPositions(sample.source, projection);
      expect(mismatches).toEqual([]);
      expect(checked).toBeGreaterThan(20);
    });
  }

  it("lines and columns are the source's on CRLF, Chinese and emoji (U1), in UTF-16 units", () => {
    const sample = PROJECTED.find((entry) => entry.id === "U1")!;
    expect(sample.source).toContain("\r\n");
    const projection = ok(projectAstroTemplate(sample.source, answers.get("U1")!));
    const elements: Loose[] = [];
    walk(projection.ast, (node) => {
      if (node.type === "JSXElement") elements.push(node);
    });
    const card = elements.find(
      (node) => ((node.openingElement as Loose).name as Loose).name === "Card",
    )!;
    // Independent count: lines split on CRLF, column in UTF-16 units.
    const before = sample.source.slice(0, card.start);
    const lines = before.split("\r\n");
    const loc = card.loc as { start: { line: number; column: number } };
    expect(loc.start.line).toBe(lines.length);
    expect(loc.start.column).toBe(lines[lines.length - 1]!.length);
    expect(sample.source.slice(card.start, card.start! + 5)).toBe("<Card");
    // The offset is not a UTF-8 byte offset: emoji and CJK come before it.
    expect(new TextEncoder().encode(before).length).toBeGreaterThan(card.start!);
  });
});

describe("D90-1 reverse check: without the ancestor-range restore", () => {
  for (const id of ASTRO_SAMPLES_ENDING_AT_NESTED_JSX) {
    it(`${id}: positions are wrong`, () => {
      const sample = PROJECTED.find((entry) => entry.id === id)!;
      const naive = ok(
        projectAstroTemplateReverseCheck(sample.source, answers.get(id)!, "no-ancestor-restore"),
      );
      const { mismatches } = checkPositions(sample.source, naive);
      expect(mismatches.length).toBeGreaterThan(0);
    });
  }

  it("the restore changes nothing where no ancestor ends at nested JSX (A1, S2, F5)", () => {
    for (const id of ["A1", "S2", "F5"]) {
      const sample = PROJECTED.find((entry) => entry.id === id)!;
      const naive = ok(
        projectAstroTemplateReverseCheck(sample.source, answers.get(id)!, "no-ancestor-restore"),
      );
      expect(checkPositions(sample.source, naive).mismatches, id).toEqual([]);
    }
  });

  it("N1: the restored LogicalExpression ends at the element's end, not the placeholder's name", () => {
    const sample = PROJECTED.find((entry) => entry.id === "N1")!;
    const answer = answers.get("N1")!;
    const hero = answer.elements.find((element) => answer.tags[element[2]] === "Hero")!;
    const logical = (projection: AstroProjection) => {
      let found: Loose | null = null;
      walk(projection.ast, (node) => {
        if (node.type === "LogicalExpression") found = node;
      });
      return found! as Loose;
    };
    const restored = logical(ok(projectAstroTemplate(sample.source, answer)));
    expect(restored.end).toBe(hero[1]);
    const naive = logical(
      ok(projectAstroTemplateReverseCheck(sample.source, answer, "no-ancestor-restore")),
    );
    expect(naive.end).toBe(hero[0] + 2);
  });
});

describe("in-place grafting", () => {
  it("N2: the nested element sits where it was written, and its `i` is the arrow's parameter", () => {
    const sample = PROJECTED.find((entry) => entry.id === "N2")!;
    const answer = answers.get("N2")!;
    const projection = ok(projectAstroTemplate(sample.source, answer));
    const oracle = buildHandScopeOracle(projection.ast);
    let card: Loose | null = null;
    walk(projection.ast, (node) => {
      if (
        node.type === "JSXElement" &&
        ((node.openingElement as Loose).name as Loose).name === "Card"
      ) {
        card = node;
      }
    });
    const element = card! as Loose;
    const range = answer.elements.find((entry) => answer.tags[entry[2]] === "Card")!;
    expect([element.start, element.end]).toEqual([range[0], range[1]]);
    const arrow = oracle.parentOf(element as unknown as AnyNode)!;
    expect(arrow.type).toBe("ArrowFunctionExpression");
    expect(oracle.parentOf(oracle.parentOf(arrow)!)!.type).toBe("JSXExpressionContainer");
    const spread = ((element.openingElement as Loose).attributes as Loose[])[0]!;
    const binding = oracle.bindingOf(spread.argument as unknown as AnyNode)!;
    expect(binding.kind).toBe("param");
    expect(binding.declaration).toBe(arrow);
  });

  it("F1: a comment-only container is an empty expression, and comments keep their text", () => {
    const sample = PROJECTED.find((entry) => entry.id === "F1")!;
    const projection = ok(projectAstroTemplate(sample.source, answers.get("F1")!));
    const empty: Loose[] = [];
    walk(projection.ast, (node) => {
      if (node.type === "JSXEmptyExpression") empty.push(node);
    });
    expect(empty).toHaveLength(1);
    const comments = (projection.ast as unknown as { comments: Loose[] }).comments;
    expect(comments.map((comment) => comment.value)).toEqual([
      " 註解 line comment",
      " block\n comment ",
      " jsx comment ",
    ]);
  });
});

describe("what the projection refuses", () => {
  it("a template that is not JavaScript Babel can read: capability limit, not author syntax", async () => {
    const source = astroPage(
      'const hero = {};\n',
      "{(() => { return<Hero {...hero} /> })()}",
    );
    const result = projectAstroTemplate(source, await confirmed(source));
    expect(result).toMatchObject({
      ok: false,
      class: "capability-limit",
      reason: "fragment-unparsed",
    });
  });

  it("an answer whose ranges do not fit the source: the parser's, not the author's", async () => {
    const source = astroPage("", "<section><p>x</p></section>");
    const answer = await confirmed(source);
    const shifted: AstroParseTemplate = {
      ...answer,
      elements: answer.elements.map((element, index) =>
        index === 1 ? [element[0] + 1, element[1], element[2], element[3]] : element,
      ),
    };
    expect(projectAstroTemplate(source, shifted)).toMatchObject({
      ok: false,
      class: "temporarily-unconfirmable",
      reason: "parser-invalid-response",
    });
    // An answer for another source of the same shape is refused the same way.
    expect(projectAstroTemplate(`${source} `, answer)).toMatchObject({
      ok: false,
      reason: "parser-invalid-response",
    });
  });

  it("reads `---` in the template as text and a page without frontmatter as template only", async () => {
    const source = "<p>--- not a fence ---</p>\n<hr />\n";
    const projection = ok(projectAstroTemplate(source, await confirmed(source)));
    expect(projection.ast.program.body).toHaveLength(1);
    expect(checkPositions(source, projection).mismatches).toEqual([]);
  });
});
