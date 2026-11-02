/**
 * The `.astro` file-language layer for analysis: one `.astro` source,
 * projected into the Babel `File` (`ParsedThemeAst`) the B1 provenance
 * analysis reads, so an Astro route goes through the same scope oracle and
 * the same analysis as a TSX route (M2 plan v2 §2.1 step 3; decision D90).
 *
 * The input is a contract v2 `template` answer that `parseAstroTemplate`
 * accepted for this very source (pinned compiler, no diagnostics). This
 * module never parses the template and never looks for `---` itself: every
 * element, attribute, expression and the frontmatter come from the parser's
 * ranges. Babel reads only JavaScript the parser delimited:
 *
 * - the frontmatter, between the fences (`frontmatterInner`);
 * - every template expression, attribute value and spread argument.
 *
 * Each is parsed at its original offset (`startIndex`, `startLine`,
 * `startColumn`), so every Babel node keeps the source's own UTF-16 offset,
 * line and column, CRLF and astral characters included.
 *
 * JSX nested in an expression (`{cond && <Hero/>}`, `{items.map((i) =>
 * <Card {...i}/>)}`) is replaced, before Babel sees the expression, by a
 * placeholder identifier of exactly the JSX's length (line terminators kept),
 * and the projected element is grafted back **in place** of that identifier.
 * So code inside the JSX stays in its real lexical scope: `i` above is the
 * arrow's parameter. Hoisting it out instead binds wrongly (tested).
 *
 * Babel ends every node whose last token is the placeholder at the end of
 * the placeholder's *name*, not of the JSX it stands for. The graft restores
 * each such ancestor's end to the element's end. This step is mandatory: the
 * equal-length placeholder alone leaves those ancestors short (tested).
 *
 * The template itself becomes one synthetic `JSXFragment` statement after the
 * frontmatter's statements (Astro allows several roots). Synthetic nodes
 * carry no range and are listed in `synthetic`; every other node's range is
 * the parser's or Babel's, at the source's offsets.
 *
 * What this does not do: no parsing of `.astro` without the parser, no
 * fallback reading of a source the parser did not confirm, no write path.
 * A fragment Babel cannot read is a capability limit (`fragment-unparsed`),
 * never an author error and never "controlled by code". An answer whose
 * ranges do not fit the source is the parser's (`parser-invalid-response`).
 */
import { parse, parseExpression, type ParserOptions } from "@babel/parser";
import {
  ASTRO_TEMPLATE_FRAGMENT_TAG,
  type AstroParseTemplate,
  type AstroTemplateExpression,
} from "@morph/astro-parser-worker/contract";

import type { ParsedThemeAst } from "../ast/theme-source-ast";

/** One equal-length placeholder, for the position checks. */
export type AstroProjectionPlaceholder = Readonly<{
  start: number;
  end: number;
  name: string;
}>;

export type AstroProjection = Readonly<{
  ok: true;
  /** The source this projection is of; the analysis checks it is the file's. */
  source: string;
  ast: ParsedThemeAst;
  /** The synthetic `JSXFragment` holding the template's root nodes. */
  template: object;
  /** Nodes the projection made up; they have no source range. */
  synthetic: Readonly<{ has(node: object): boolean }>;
  placeholders: readonly AstroProjectionPlaceholder[];
}>;

export type AstroProjectionFailure =
  | Readonly<{
      ok: false;
      class: "capability-limit";
      reason: "fragment-unparsed";
      detail: string;
    }>
  | Readonly<{
      ok: false;
      class: "temporarily-unconfirmable";
      reason: "parser-invalid-response";
      detail: string;
    }>;

export type AstroProjectionResult = AstroProjection | AstroProjectionFailure;

class ProjectionRefusal extends Error {
  constructor(readonly failure: AstroProjectionFailure) {
    super(failure.detail);
  }
}

const unparsed = (detail: string) =>
  new ProjectionRefusal({
    ok: false,
    class: "capability-limit",
    reason: "fragment-unparsed",
    detail,
  });

const inconsistent = (detail: string) =>
  new ProjectionRefusal({
    ok: false,
    class: "temporarily-unconfirmable",
    reason: "parser-invalid-response",
    detail,
  });

// --------------------------------------------------------------- positions

/** Babel's line terminators: `\r\n`, `\n`, `\r`, U+2028, U+2029. */
const LINE_TERMINATOR_CODES = new Set([10, 13, 0x2028, 0x2029]);
const hasLineTerminator = (text: string) =>
  [...text].some((char) => LINE_TERMINATOR_CODES.has(char.charCodeAt(0)));

/** Offsets (UTF-16) where each line starts, by Babel's rules. */
export function astroLineStarts(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    if (code === 13) {
      if (source.charCodeAt(index + 1) === 10) index += 1;
      starts.push(index + 1);
    } else if (code === 10 || code === 0x2028 || code === 0x2029) {
      starts.push(index + 1);
    }
  }
  return starts;
}

export type AstroSourcePosition = Readonly<{
  line: number;
  column: number;
  index: number;
}>;

/** 1-based line and 0-based UTF-16 column, as Babel's `loc` has them. */
export function astroPositionAt(
  starts: readonly number[],
  offset: number,
): AstroSourcePosition {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (starts[mid]! <= offset) low = mid;
    else high = mid - 1;
  }
  return { line: low + 1, column: offset - starts[low]!, index: offset };
}

// -------------------------------------------------------------- projection

/** A Babel node as this module builds and edits it. */
type Node = { type: string; [key: string]: unknown };

const isNode = (value: unknown): value is Node =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { type?: unknown }).type === "string";

/** The reverse checks D90-1 keeps as tests; product code never sets one. */
type ProjectionVariant = "in-place" | "no-ancestor-restore" | "hoist";

/** A character that would join an identifier placed right after it. */
const isIdentifierPart = (char: string) =>
  /[\p{ID_Continue}$\\]/u.test(char) ||
  char.charCodeAt(0) === 0x200c ||
  char.charCodeAt(0) === 0x200d;

/**
 * Projects one `.astro` source, given the `template` answer that
 * `parseAstroTemplate` confirmed for exactly this source.
 */
export function projectAstroTemplate(
  source: string,
  answer: AstroParseTemplate,
): AstroProjectionResult {
  return project(source, answer, "in-place");
}

/**
 * The two wrong projections D90-1 keeps as reverse checks: without the
 * ancestor-range restore, and with nested JSX hoisted to the template's top
 * level instead of grafted in place. Tests only; never a product path.
 */
export function projectAstroTemplateReverseCheck(
  source: string,
  answer: AstroParseTemplate,
  variant: "no-ancestor-restore" | "hoist",
): AstroProjectionResult {
  return project(source, answer, variant);
}

function project(
  source: string,
  answer: AstroParseTemplate,
  variant: ProjectionVariant,
): AstroProjectionResult {
  try {
    return new Projector(source, answer, variant).run();
  } catch (error) {
    if (error instanceof ProjectionRefusal) return error.failure;
    throw error;
  }
}

const babelPlugins: ParserOptions["plugins"] = ["typescript"];

class Projector {
  private readonly starts: number[];
  private readonly synthetic = new WeakSet<object>();
  private readonly placeholders: AstroProjectionPlaceholder[] = [];
  private readonly comments: Node[] = [];
  private readonly hoisted: Node[] = [];

  private readonly attributesOf = new Map<number, number[]>();
  private readonly expressionOfAttribute = new Map<number, number>();
  private readonly childExpressionsOf = new Map<number, number[]>();
  private readonly childElementsOf = new Map<number, number[]>();
  private readonly elementOfAttribute = new Map<number, number>();
  private readonly usedElements = new Set<number>();
  private readonly usedExpressions = new Set<number>();

  constructor(
    private readonly source: string,
    private readonly answer: AstroParseTemplate,
    private readonly variant: ProjectionVariant,
  ) {
    this.starts = astroLineStarts(source);
  }

  run(): AstroProjection {
    const { source, answer } = this;
    if (answer.mode !== "template" || answer.source.length !== source.length) {
      throw inconsistent("the answer is not a template answer for this source");
    }
    this.index();

    const body: Node[] = [];
    let directives: unknown[] = [];
    if (answer.frontmatter !== null) {
      if (answer.frontmatterInner === null) {
        throw inconsistent("frontmatter without its inner range");
      }
      const [from, to] = answer.frontmatterInner;
      let file: {
        program: { body: unknown[]; directives: unknown[] };
        comments?: unknown[];
      };
      try {
        file = parse(source.slice(from, to), {
          ...this.babelOptions(from),
          allowReturnOutsideFunction: true,
        }) as unknown as typeof file;
      } catch (error) {
        throw unparsed(`frontmatter: ${messageOf(error)}`);
      }
      body.push(...(file.program.body as Node[]));
      directives = file.program.directives;
      this.comments.push(...((file.comments ?? []) as Node[]));
    }

    const templateStart = answer.frontmatter?.[1] ?? 0;
    const template: Node = {
      type: "JSXFragment",
      openingFragment: this.made({ type: "JSXOpeningFragment" }),
      closingFragment: this.made({ type: "JSXClosingFragment" }),
      children: this.children(-1, templateStart, source.length),
    };
    (template.children as Node[]).push(...this.hoisted);
    this.made(template);
    body.push(this.made({ type: "ExpressionStatement", expression: template }));

    for (let i = 0; i < answer.elements.length; i += 1) {
      if (!this.usedElements.has(i)) {
        throw inconsistent(`element ${i} is not reachable from the template`);
      }
    }
    for (let i = 0; i < answer.expressions.length; i += 1) {
      if (!this.usedExpressions.has(i)) {
        throw inconsistent(
          `expression ${i} is not reachable from the template`,
        );
      }
    }

    const program = this.made({
      type: "Program",
      sourceType: "module",
      interpreter: null,
      body,
      directives,
    });
    const file = this.made({
      type: "File",
      program,
      comments: [...this.comments].sort(
        (a, b) => (a.start as number) - (b.start as number),
      ),
      errors: [],
    });
    return {
      ok: true,
      source,
      ast: file as unknown as ParsedThemeAst,
      template,
      synthetic: this.synthetic,
      placeholders: this.placeholders,
    };
  }

  // ----------------------------------------------------------------- index

  private index(): void {
    const { elements, attributes, expressions } = this.answer;
    const push = (map: Map<number, number[]>, key: number, value: number) => {
      const list = map.get(key) ?? [];
      list.push(value);
      map.set(key, list);
    };
    attributes.forEach((attribute, i) => {
      push(this.attributesOf, attribute[0], i);
      if (attribute[1] === "element") {
        const value = elements.findIndex(
          (element) =>
            element[0] === attribute[5] &&
            element[1] === attribute[6] &&
            element[3] === attribute[0],
        );
        if (value < 0)
          throw inconsistent(`attribute ${i} has no element value`);
        this.elementOfAttribute.set(i, value);
      }
    });
    const nested = new Set<number>(this.elementOfAttribute.values());
    expressions.forEach((expression, i) => {
      const [, , , , owner, attribute, jsx] = expression;
      if (attribute >= 0) {
        if (this.expressionOfAttribute.has(attribute)) {
          throw inconsistent(`attribute ${attribute} has two expressions`);
        }
        this.expressionOfAttribute.set(attribute, i);
      } else {
        push(this.childExpressionsOf, owner, i);
      }
      for (const element of jsx) nested.add(element);
    });
    elements.forEach((element, i) => {
      if (!nested.has(i)) push(this.childElementsOf, element[3], i);
    });
  }

  // ------------------------------------------------------------- utilities

  private loc(start: number, end: number) {
    return {
      start: astroPositionAt(this.starts, start),
      end: astroPositionAt(this.starts, end),
    };
  }

  private at<T extends Node>(node: T, start: number, end: number): T {
    const positioned: Node = node;
    positioned.start = start;
    positioned.end = end;
    positioned.loc = this.loc(start, end);
    return node;
  }

  private made<T extends Node>(node: T): T {
    this.synthetic.add(node);
    return node;
  }

  private babelOptions(base: number): ParserOptions {
    const position = astroPositionAt(this.starts, base);
    return {
      sourceType: "module",
      plugins: babelPlugins,
      startIndex: base,
      startLine: position.line,
      startColumn: position.column,
      allowAwaitOutsideFunction: true,
    };
  }

  private skipWhitespace(offset: number): number {
    let cursor = offset;
    while (cursor < this.source.length && /\s/.test(this.source[cursor]!)) {
      cursor += 1;
    }
    return cursor;
  }

  // ------------------------------------------------------------------ JSX

  /** A JSX name at `start`, from the parser's tag or attribute name text. */
  private jsxName(text: string, start: number, attribute: boolean): Node {
    if (this.source.slice(start, start + text.length) !== text) {
      throw inconsistent(`name "${text}" is not at ${start}`);
    }
    const colon = text.indexOf(":");
    if (colon > 0) {
      return this.at(
        {
          type: "JSXNamespacedName",
          namespace: this.at(
            { type: "JSXIdentifier", name: text.slice(0, colon) },
            start,
            start + colon,
          ),
          name: this.at(
            { type: "JSXIdentifier", name: text.slice(colon + 1) },
            start + colon + 1,
            start + text.length,
          ),
        },
        start,
        start + text.length,
      );
    }
    const dot = text.lastIndexOf(".");
    if (!attribute && dot > 0) {
      return this.at(
        {
          type: "JSXMemberExpression",
          object: this.jsxName(text.slice(0, dot), start, false),
          property: this.at(
            { type: "JSXIdentifier", name: text.slice(dot + 1) },
            start + dot + 1,
            start + text.length,
          ),
        },
        start,
        start + text.length,
      );
    }
    return this.at(
      { type: "JSXIdentifier", name: text },
      start,
      start + text.length,
    );
  }

  /**
   * The closing tag at the end of `[contentStart, end)`, if the element has
   * one: `</name>` with optional whitespace around the name. An element the
   * compiler closed implicitly (`<p>` before a block, a void `<br>`) has none.
   */
  private closingOf(
    name: string,
    contentStart: number,
    end: number,
  ): { start: number; nameStart: number } | null {
    if (this.source[end - 1] !== ">") return null;
    const at = this.source.lastIndexOf("</", end - 1);
    if (at < contentStart) return null;
    const inner = this.source.slice(at + 2, end - 1);
    if (inner.trim() !== name) return null;
    return {
      start: at,
      nameStart: at + 2 + (inner.length - inner.trimStart().length),
    };
  }

  private element(index: number): Node {
    if (this.usedElements.has(index)) {
      throw inconsistent(`element ${index} is used twice`);
    }
    this.usedElements.add(index);
    const [start, end, tagIndex] = this.answer.elements[index]!;
    const tag = this.answer.tags[tagIndex]!;
    if (this.source[start] !== "<") {
      throw inconsistent(`element ${index} does not start with "<"`);
    }

    if (tag === ASTRO_TEMPLATE_FRAGMENT_TAG) {
      const close = this.skipWhitespace(start + 1);
      if (this.source[close] !== ">") {
        throw unparsed(`fragment at ${start}: unexpected opening`);
      }
      const openingEnd = close + 1;
      const closing = this.closingOf("", openingEnd, end);
      if (!closing) throw unparsed(`fragment at ${start}: no closing "</>"`);
      return this.at(
        {
          type: "JSXFragment",
          openingFragment: this.at(
            { type: "JSXOpeningFragment" },
            start,
            openingEnd,
          ),
          closingFragment: this.at(
            { type: "JSXClosingFragment" },
            closing.start,
            end,
          ),
          children: this.children(index, openingEnd, closing.start),
        },
        start,
        end,
      );
    }

    const name = this.jsxName(tag, start + 1, false);
    let cursor = start + 1 + tag.length;
    const attributes = (this.attributesOf.get(index) ?? []).map((attribute) => {
      const node = this.attribute(attribute);
      if ((node.start as number) < cursor) {
        throw inconsistent(`attribute ${attribute} overlaps what precedes it`);
      }
      cursor = node.end as number;
      return node;
    });
    cursor = this.skipWhitespace(cursor);
    let openingEnd: number;
    let selfClosing: boolean;
    if (this.source.startsWith("/>", cursor)) {
      openingEnd = cursor + 2;
      selfClosing = true;
    } else if (this.source[cursor] === ">") {
      openingEnd = cursor + 1;
      selfClosing = false;
    } else {
      throw unparsed(
        `<${tag}> at ${start}: unrecognised text in the opening tag`,
      );
    }
    if (openingEnd > end || (selfClosing && openingEnd !== end)) {
      throw inconsistent(`<${tag}> at ${start}: opening tag past the element`);
    }
    const opening = this.at(
      { type: "JSXOpeningElement", name, attributes, selfClosing },
      start,
      openingEnd,
    );
    if (selfClosing) {
      if (
        (this.childElementsOf.get(index)?.length ?? 0) > 0 ||
        (this.childExpressionsOf.get(index)?.length ?? 0) > 0
      ) {
        throw inconsistent(`<${tag}/> at ${start} has children`);
      }
      return this.at(
        {
          type: "JSXElement",
          openingElement: opening,
          closingElement: null,
          children: [],
        },
        start,
        end,
      );
    }
    const closing = this.closingOf(tag, openingEnd, end);
    const children = this.children(
      index,
      openingEnd,
      closing ? closing.start : end,
    );
    return this.at(
      {
        type: "JSXElement",
        openingElement: opening,
        closingElement: closing
          ? this.at(
              {
                type: "JSXClosingElement",
                name: this.jsxName(tag, closing.nameStart, false),
              },
              closing.start,
              end,
            )
          : null,
        children,
      },
      start,
      end,
    );
  }

  /** Children of element `owner` (-1: the template) in `[from, to)`. */
  private children(owner: number, from: number, to: number): Node[] {
    const items = [
      ...(this.childElementsOf.get(owner) ?? []).map((index) => {
        const [start, end] = this.answer.elements[index]!;
        return { start, end, make: () => this.element(index) };
      }),
      ...(this.childExpressionsOf.get(owner) ?? []).map((index) => {
        const [start, end] = this.answer.expressions[index]!;
        return { start, end, make: () => this.container(index) };
      }),
    ].sort((a, b) => a.start - b.start);
    const out: Node[] = [];
    let cursor = from;
    for (const item of items) {
      if (item.start < cursor || item.end > to) {
        throw unparsed(
          `a child at ${item.start} lies outside its parent's content [${from}, ${to})`,
        );
      }
      if (item.start > cursor) out.push(this.text(cursor, item.start));
      out.push(item.make());
      cursor = item.end;
    }
    if (to > cursor) out.push(this.text(cursor, to));
    return out;
  }

  /** Text between children: written verbatim, HTML comments included. */
  private text(start: number, end: number): Node {
    const raw = this.source.slice(start, end);
    return this.at(
      { type: "JSXText", value: raw, extra: { raw, rawValue: raw } },
      start,
      end,
    );
  }

  private attribute(index: number): Node {
    const [, kind, name, nameStart, nameEnd, valueStart, valueEnd] =
      this.answer.attributes[index]!;
    if (kind === "spread") {
      const expressionIndex = this.expressionOfAttribute.get(index);
      if (expressionIndex === undefined) {
        throw inconsistent(`spread attribute ${index} has no expression`);
      }
      this.usedExpressions.add(expressionIndex);
      const expression = this.answer.expressions[expressionIndex]!;
      return this.at(
        {
          type: "JSXSpreadAttribute",
          argument: this.fragment(valueStart!, valueEnd!, expression[6], false),
        },
        expression[0],
        expression[1],
      );
    }
    if (nameStart === null || nameEnd === null) {
      throw inconsistent(`attribute ${index} has no name range`);
    }
    const nameNode = this.jsxName(name, nameStart, true);
    if (nameNode.end !== nameEnd) {
      throw inconsistent(`attribute ${index}: name range is not "${name}"`);
    }
    switch (kind) {
      case "boolean":
        return this.at(
          { type: "JSXAttribute", name: nameNode, value: null },
          nameStart,
          nameEnd,
        );
      case "literal": {
        const raw = this.source.slice(valueStart!, valueEnd!);
        const quote = raw[0];
        if (
          raw.length < 2 ||
          (quote !== '"' && quote !== "'") ||
          raw[raw.length - 1] !== quote
        ) {
          throw inconsistent(`attribute ${index}: literal value is not quoted`);
        }
        const value = raw.slice(1, -1);
        return this.at(
          {
            type: "JSXAttribute",
            name: nameNode,
            value: this.at(
              { type: "StringLiteral", value, extra: { raw, rawValue: value } },
              valueStart!,
              valueEnd!,
            ),
          },
          nameStart,
          valueEnd!,
        );
      }
      case "expression": {
        const expressionIndex = this.expressionOfAttribute.get(index);
        if (expressionIndex === undefined) {
          throw inconsistent(`attribute ${index} has no expression`);
        }
        // The shorthand `{title}`: the name sits inside the value, which is
        // then the whole attribute.
        const shorthand = nameStart >= valueStart!;
        return this.at(
          {
            type: "JSXAttribute",
            name: nameNode,
            value: this.container(expressionIndex),
          },
          shorthand ? valueStart! : nameStart,
          valueEnd!,
        );
      }
      case "element": {
        const element = this.elementOfAttribute.get(index)!;
        return this.at(
          {
            type: "JSXAttribute",
            name: nameNode,
            value: this.element(element),
          },
          nameStart,
          valueEnd!,
        );
      }
      default:
        throw inconsistent(`attribute ${index}: unknown kind`);
    }
  }

  /** A `JSXExpressionContainer`, braces included or (backtick value) not. */
  private container(index: number): Node {
    if (this.usedExpressions.has(index)) {
      throw inconsistent(`expression ${index} is used twice`);
    }
    this.usedExpressions.add(index);
    const expression: AstroTemplateExpression = this.answer.expressions[index]!;
    const [start, end, innerStart, , , , jsx] = expression;
    const braced = start !== innerStart;
    if (
      braced &&
      (this.source[start] !== "{" || this.source[end - 1] !== "}")
    ) {
      throw inconsistent(`expression ${index} is not braced`);
    }
    const from = braced ? start + 1 : start;
    const to = braced ? end - 1 : end;
    return this.at(
      {
        type: "JSXExpressionContainer",
        expression: this.fragment(from, to, jsx, braced),
      },
      start,
      end,
    );
  }

  /**
   * `source[from, to)` as one Babel expression at its original offset, with
   * the nested JSX `jsx` (element indices) grafted back in place.
   */
  private fragment(
    from: number,
    to: number,
    jsx: readonly number[],
    mayBeEmpty: boolean,
  ): Node {
    const { source } = this;
    const nested = jsx
      .map((index) => ({
        index,
        start: this.answer.elements[index]![0],
        end: this.answer.elements[index]![1],
      }))
      .sort((a, b) => a.start - b.start);
    let fed = "";
    let cursor = from;
    const names = new Map<
      number,
      { name: string; index: number; end: number }
    >();
    nested.forEach((entry, ordinal) => {
      if (entry.start < cursor || entry.end > to) {
        throw inconsistent(
          `nested JSX at ${entry.start} is outside its expression`,
        );
      }
      const name = `$${ordinal.toString(36)}`;
      const original = source.slice(entry.start, entry.end);
      if (
        original.length < name.length ||
        hasLineTerminator(original.slice(0, name.length))
      ) {
        throw unparsed(
          `nested JSX at ${entry.start} is too short for a placeholder`,
        );
      }
      const before = entry.start > from ? source[entry.start - 1]! : "";
      if (before !== "" && isIdentifierPart(before)) {
        throw unparsed(`nested JSX at ${entry.start} directly follows a name`);
      }
      let text = name;
      for (let i = name.length; i < original.length; i += 1) {
        const char = original[i]!;
        text += hasLineTerminator(char) ? char : " ";
      }
      fed += source.slice(cursor, entry.start) + text;
      names.set(entry.start, { name, index: entry.index, end: entry.end });
      this.placeholders.push({ start: entry.start, end: entry.end, name });
      cursor = entry.end;
    });
    fed += source.slice(cursor, to);
    if (fed.length !== to - from) {
      throw inconsistent("placeholder length drift");
    }

    let expression: Node;
    try {
      expression = parseExpression(
        fed,
        this.babelOptions(from),
      ) as unknown as Node;
    } catch (error) {
      if (mayBeEmpty && nested.length === 0) {
        const empty = this.emptyExpression(fed, from, to);
        if (empty) return empty;
      }
      throw unparsed(`expression at ${from}: ${messageOf(error)}`);
    }
    this.comments.push(...((expression.comments as Node[] | undefined) ?? []));
    delete expression.comments;
    delete expression.errors;
    delete expression.tokens;

    const isPlaceholder = (node: unknown): node is Node =>
      isNode(node) &&
      node.type === "Identifier" &&
      typeof node.start === "number" &&
      names.get(node.start)?.name === node.name &&
      node.end === node.start + (node.name as string).length;

    let grafted = 0;
    const ancestors: Node[] = [];
    const replace = (placeholder: Node): Node => {
      grafted += 1;
      const entry = names.get(placeholder.start as number)!;
      // Babel ended every node whose last token is the placeholder at the
      // end of its name; the JSX it stands for ends later. Restore them.
      if (this.variant !== "no-ancestor-restore") {
        for (let i = ancestors.length - 1; i >= 0; i -= 1) {
          const ancestor = ancestors[i]!;
          if (ancestor.end !== placeholder.end) break;
          ancestor.end = entry.end;
          const loc = ancestor.loc as { start: unknown } | undefined;
          if (loc) {
            ancestor.loc = {
              ...loc,
              end: astroPositionAt(this.starts, entry.end),
            };
          }
        }
      }
      const element = this.element(entry.index);
      if (this.variant === "hoist") {
        this.hoisted.push(element);
        return this.at(
          { type: "Identifier", name: "undefined" },
          placeholder.start as number,
          placeholder.end as number,
        );
      }
      return element;
    };
    const walk = (node: Node): void => {
      ancestors.push(node);
      for (const key of Object.keys(node)) {
        if (key === "loc" || key === "extra" || key.endsWith("Comments"))
          continue;
        const value = node[key];
        if (Array.isArray(value)) {
          value.forEach((child, i) => {
            if (isPlaceholder(child)) value[i] = replace(child);
            else if (isNode(child)) walk(child);
          });
        } else if (isPlaceholder(value)) {
          node[key] = replace(value);
        } else if (isNode(value)) {
          walk(value);
        }
      }
      ancestors.pop();
    };
    if (isPlaceholder(expression)) expression = replace(expression);
    else walk(expression);
    if (grafted !== nested.length) {
      throw unparsed(
        `expression at ${from}: grafted ${grafted} of ${nested.length} nested JSX`,
      );
    }
    return expression;
  }

  /**
   * A container holding only comments, `{/* c *\/}`: Babel reads it as a
   * program with no statements. Anything else is not empty.
   */
  private emptyExpression(fed: string, from: number, to: number): Node | null {
    let file: {
      program: { body: unknown[]; directives: unknown[] };
      comments?: unknown[];
    };
    try {
      file = parse(fed, this.babelOptions(from)) as unknown as typeof file;
    } catch {
      return null;
    }
    if (file.program.body.length > 0 || file.program.directives.length > 0) {
      return null;
    }
    const comments = (file.comments ?? []) as Node[];
    this.comments.push(...comments);
    return this.at(
      { type: "JSXEmptyExpression", innerComments: comments },
      from,
      to,
    );
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
