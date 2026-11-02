/**
 * Turns a parsed AST into the contract's answer: positions and field info,
 * never the AST. The walk and the serialization are M1c's, measured there and
 * on Cloudflare in M1c-C; only the envelope (`ok`, `source`) is new.
 *
 * `template` (contract v2) is not M1c's: its size on Cloudflare is unmeasured.
 * It is capped the same way, while it is built.
 */
import type { CompilerDiagnostic, ParsedAstro } from "./compiler";
import {
  ASTRO_PARSER_CONTRACT_VERSION,
  ASTRO_PARSER_LIMITS,
  ASTRO_TEMPLATE_FRAGMENT_TAG,
  type AstroParseDiagnostics,
  type AstroParseRequest,
  type AstroParseSource,
  type AstroTemplateAttributeKind,
} from "./contract";

export class ResultTooLarge extends Error {}

/**
 * A string builder that refuses to grow past the cap, so serialization is
 * bounded while it runs rather than checked afterwards. It counts UTF-16
 * units, which undercounts bytes only for non-ASCII tag names and diagnostic
 * text; the finished string is measured in bytes once more. Builders made
 * with the same `budget` share one cap.
 */
class CappedOut {
  private readonly parts: string[] = [];
  constructor(
    private readonly cap: number,
    private readonly budget: { units: number } = { units: 0 },
  ) {}
  push(part: string) {
    this.budget.units += part.length;
    if (this.budget.units > this.cap)
      throw new ResultTooLarge(`result over ${this.cap} bytes`);
    this.parts.push(part);
  }
  /** Appends a builder on the same budget, which has counted it already. */
  append(other: CappedOut) {
    if (other.budget !== this.budget) throw new Error("different budgets");
    this.parts.push(...other.parts);
  }
  toString() {
    return this.parts.join("");
  }
}

interface Node {
  type?: string;
  start?: number;
  end?: number;
  [key: string]: unknown;
}
interface NameNode {
  type?: string;
  name?: string | NameNode;
  object?: NameNode;
  property?: NameNode;
  namespace?: NameNode;
}
interface Attribute {
  type?: string;
  name?: NameNode;
  value?: { type?: string; start?: number; end?: number } | null;
  start: number;
  end: number;
}

function nameOf(name: NameNode | undefined): string {
  if (!name) return "#fragment";
  if (name.type === "JSXIdentifier") return String(name.name);
  if (name.type === "JSXMemberExpression")
    return `${nameOf(name.object)}.${String(name.property?.name)}`;
  if (name.type === "JSXNamespacedName")
    return `${String(name.namespace?.name)}:${String((name.name as NameNode | undefined)?.name)}`;
  return String(name.type);
}

const openingOf = (node: Node) =>
  node.openingElement as
    { name?: NameNode; attributes?: Attribute[] } | undefined;

const elementName = (node: Node) => nameOf(openingOf(node)?.name);

function attributeName(attribute: Attribute): string {
  if (attribute.type === "JSXSpreadAttribute") return "...";
  return nameOf(attribute.name);
}

function attributeKind(attribute: Attribute): string {
  if (attribute.type === "JSXSpreadAttribute") return "spread";
  if (attribute.value == null) return "boolean";
  if (attribute.value.type === "Literal") return "literal";
  if (attribute.value.type === "JSXExpressionContainer") return "expression";
  return String(attribute.value.type);
}

/**
 * Every JSX element with its depth, in document order. Iterative: the AST can
 * be as deep as the compiler allowed, and a recursive walk would overflow the
 * JS stack before it did.
 */
function* elements(root: unknown): Generator<[Node, number]> {
  const stack: [unknown, number][] = [[root, 0]];
  while (stack.length) {
    const [node, depth] = stack.pop()!;
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) stack.push([node[i], depth]);
      continue;
    }
    if (!node || typeof node !== "object") continue;
    const current = node as Node;
    const isElement =
      current.type === "JSXElement" || current.type === "JSXFragment";
    if (isElement) yield [current, depth];
    const keys = Object.keys(current);
    for (let i = keys.length - 1; i >= 0; i--) {
      const key = keys[i];
      if (key === "type" || key === "start" || key === "end") continue;
      const value = current[key];
      if (value && typeof value === "object")
        stack.push([value, isElement ? depth + 1 : depth]);
    }
  }
}

function diagnosticsOf(
  diagnostics: CompilerDiagnostic[],
): AstroParseDiagnostics {
  return {
    total: diagnostics.length,
    first: diagnostics
      .slice(0, ASTRO_PARSER_LIMITS.maxDiagnostics)
      .map((diagnostic) => ({
        severity: String(diagnostic.severity),
        text: String(diagnostic.text).slice(
          0,
          ASTRO_PARSER_LIMITS.maxDiagnosticTextChars,
        ),
        byteStart: diagnostic.labels?.[0]?.start ?? null,
        byteEnd: diagnostic.labels?.[0]?.end ?? null,
      })),
  };
}

// ------------------------------------------------------------------ template

const isJsx = (node: Node) =>
  node.type === "JSXElement" || node.type === "JSXFragment";

/**
 * The outermost JSX nodes inside an expression, in source order: it does not
 * descend into the JSX it finds, whose own children and containers are
 * walked as template. Iterative for the same reason as `elements`.
 */
function outermostJsx(expression: unknown): Node[] {
  const found: Node[] = [];
  const stack: unknown[] = [expression];
  while (stack.length) {
    const value = stack.pop();
    if (Array.isArray(value)) {
      for (const item of value) stack.push(item);
      continue;
    }
    if (!value || typeof value !== "object") continue;
    const node = value as Node;
    if (isJsx(node)) {
      found.push(node);
      continue;
    }
    for (const key of Object.keys(node)) {
      if (key === "type" || key === "start" || key === "end") continue;
      const child = node[key];
      if (child && typeof child === "object") stack.push(child);
    }
  }
  return found.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
}

/**
 * The text strictly between the frontmatter's fences, confirmed against the
 * source and the compiler's own ranges: the compiler's range has `---` at
 * each end (after only whitespace at the front, which it includes), and its
 * program lies between them. Null if any of that does not hold, which the
 * contract allows only with diagnostics.
 */
function frontmatterInner(
  text: string,
  fm: Node,
): [number, number] | null {
  const start = fm.start ?? -1;
  const end = fm.end ?? -1;
  const open = text.indexOf("---", start);
  if (open < 0 || text.slice(start, open).trim() !== "") return null;
  const innerStart = open + 3;
  const innerEnd = end - 3;
  if (innerEnd < innerStart || text.slice(innerEnd, end) !== "---")
    return null;
  const program = fm.program as Node | undefined;
  if (
    program &&
    ((program.start ?? -1) < innerStart || (program.end ?? -1) > innerEnd)
  )
    return null;
  return [innerStart, innerEnd];
}

interface TemplateTask {
  node: Node;
  parent: number;
  depth: number;
  /** Index of the expression this node is outermost JSX of, else -1. */
  expression: number;
}

interface ExpressionEntry {
  start: number;
  end: number;
  innerStart: number;
  innerEnd: number;
  owner: number;
  attribute: number;
  jsx: number[];
}

function attributeValueKind(
  value: Attribute["value"],
): AstroTemplateAttributeKind | string {
  if (value == null) return "boolean";
  if (value.type === "Literal") return "literal";
  if (value.type === "JSXExpressionContainer") return "expression";
  if (value.type === "JSXElement" || value.type === "JSXFragment")
    return "element";
  // Not a kind of this contract: Core's check refuses the answer.
  return String(value.type);
}

/**
 * `mode=template`: the template's elements, attributes and expressions with
 * their ranges (contract.ts, `AstroParseTemplate`). Elements are numbered in
 * pre-order, so a parent is always numbered before its children; attributes
 * and expressions are recorded when their element is reached.
 */
function templateAnswer(
  root: Node,
  text: string,
  out: CappedOut,
  budget: { units: number },
  cap: number,
): { elementCount: number; maxDepth: number } {
  const elementsOut = new CappedOut(cap, budget);
  const attributesOut = new CappedOut(cap, budget);
  const tags = new Map<string, number>();
  const expressions: ExpressionEntry[] = [];
  let elementCount = 0;
  let attributeCount = 0;
  let maxDepth = 0;

  const stack: TemplateTask[] = [];
  /** Queues `tasks` so they come off the stack in the order given. */
  const schedule = (tasks: TemplateTask[]) => {
    for (let i = tasks.length - 1; i >= 0; i--) stack.push(tasks[i]);
  };
  const expression = (
    container: Node,
    inner: Node | undefined,
    owner: number,
    attribute: number,
    depth: number,
  ): TemplateTask[] => {
    const index = expressions.length;
    expressions.push({
      start: container.start ?? -1,
      end: container.end ?? -1,
      innerStart: inner?.start ?? -1,
      innerEnd: inner?.end ?? -1,
      owner,
      attribute,
      jsx: [],
    });
    return outermostJsx(inner).map((node) => ({
      node,
      parent: owner,
      depth,
      expression: index,
    }));
  };
  /** The tasks for a list of template children owned by `owner`. */
  const children = (nodes: unknown, owner: number, depth: number) => {
    const tasks: TemplateTask[] = [];
    for (const child of Array.isArray(nodes) ? (nodes as Node[]) : []) {
      if (!child || typeof child !== "object") continue;
      if (isJsx(child))
        tasks.push({ node: child, parent: owner, depth, expression: -1 });
      else if (child.type === "JSXExpressionContainer")
        tasks.push(
          ...expression(
            child,
            child.expression as Node | undefined,
            owner,
            -1,
            depth,
          ),
        );
      // Text, HTML comments, the doctype, and a <script>'s or <style>'s
      // body are not template elements.
    }
    return tasks;
  };

  schedule(children(root.body, -1, 0));
  while (stack.length) {
    const { node, parent, depth, expression: within } = stack.pop()!;
    const index = elementCount++;
    maxDepth = Math.max(maxDepth, depth);
    if (within >= 0) expressions[within].jsx.push(index);

    const opening = openingOf(node);
    const name = opening?.name as (NameNode & Node) | undefined;
    const tag =
      node.type === "JSXFragment" || !name
        ? ASTRO_TEMPLATE_FRAGMENT_TAG
        : text.slice(name.start ?? 0, name.end ?? 0);
    let tagIndex = tags.get(tag);
    if (tagIndex === undefined) tags.set(tag, (tagIndex = tags.size));
    elementsOut.push(
      `${index === 0 ? "" : ","}[${node.start},${node.end},${tagIndex},${parent}]`,
    );

    const tasks: TemplateTask[] = [];
    for (const attribute of opening?.attributes ?? []) {
      const attributeIndex = attributeCount++;
      let kind: string;
      let nameText: string;
      let nameRange: [number, number] | [null, null];
      let valueRange: [number, number] | [null, null];
      if (attribute.type === "JSXSpreadAttribute") {
        const argument = (attribute as unknown as { argument?: Node }).argument;
        kind = "spread";
        nameText = "...";
        nameRange = [null, null];
        valueRange = [argument?.start ?? -1, argument?.end ?? -1];
        tasks.push(
          ...expression(
            attribute as unknown as Node,
            argument,
            index,
            attributeIndex,
            depth + 1,
          ),
        );
      } else {
        const attributeName = attribute.name as (NameNode & Node) | undefined;
        const value = attribute.value;
        kind = attributeValueKind(value);
        nameRange = [attributeName?.start ?? -1, attributeName?.end ?? -1];
        nameText = text.slice(nameRange[0], nameRange[1]);
        valueRange = value
          ? [value.start ?? -1, value.end ?? -1]
          : [null, null];
        if (value?.type === "JSXExpressionContainer") {
          tasks.push(
            ...expression(
              value as Node,
              (value as Node).expression as Node | undefined,
              index,
              attributeIndex,
              depth + 1,
            ),
          );
        } else if (value && isJsx(value as Node)) {
          tasks.push({
            node: value as Node,
            parent: index,
            depth: depth + 1,
            expression: -1,
          });
        }
      }
      attributesOut.push(
        `${attributeIndex === 0 ? "" : ","}[${index},${JSON.stringify(kind)},${JSON.stringify(nameText)},${nameRange[0]},${nameRange[1]},${valueRange[0]},${valueRange[1]}]`,
      );
    }
    tasks.push(...children(node.children, index, depth + 1));
    schedule(tasks);
  }

  const expressionsOut = new CappedOut(cap, budget);
  expressions.forEach((entry, i) => {
    expressionsOut.push(
      `${i === 0 ? "" : ","}[${entry.start},${entry.end},${entry.innerStart},${entry.innerEnd},${entry.owner},${entry.attribute},${JSON.stringify(entry.jsx)}]`,
    );
  });
  out.push(`,"tags":${JSON.stringify([...tags.keys()])},"elements":[`);
  out.append(elementsOut);
  out.push(`],"attributes":[`);
  out.append(attributesOut);
  out.push(`],"expressions":[`);
  out.append(expressionsOut);
  out.push("]");
  return { elementCount, maxDepth };
}

/**
 * The answer's JSON text, at most `maxResponseBytes` UTF-8 bytes. `text` is
 * the decoded source the AST is about.
 */
export function answer(
  parsed: ParsedAstro,
  request: AstroParseRequest,
  source: AstroParseSource,
  text: string,
  compiler: string,
): string {
  const cap = ASTRO_PARSER_LIMITS.maxResponseBytes;
  const budget = { units: 0 };
  const out = new CappedOut(cap, budget);
  const root = parsed.ast as Node;
  const fm = root.frontmatter as Node | undefined | null;
  if (request.mode === "template") {
    // The compiler reports a zero-width frontmatter at 0 for a file without
    // one; `template` says null instead (v1 modes keep the compiler's range).
    const present = fm && (fm.end ?? 0) > (fm.start ?? 0);
    const frontmatter = present ? [fm.start, fm.end] : null;
    const inner = present ? frontmatterInner(text, fm) : null;
    out.push(
      `{"v":${ASTRO_PARSER_CONTRACT_VERSION},"ok":true,"mode":"template","compiler":${JSON.stringify(compiler)},"source":${JSON.stringify(source)},"frontmatter":${JSON.stringify(frontmatter)},"frontmatterInner":${JSON.stringify(inner)}`,
    );
    const counts = templateAnswer(root, text, out, budget, cap);
    out.push(
      `,"elementCount":${counts.elementCount},"maxDepth":${counts.maxDepth},"diagnostics":${JSON.stringify(diagnosticsOf(parsed.diagnostics))}}`,
    );
    return finish(out, cap);
  }
  const frontmatter = fm ? [fm.start, fm.end] : null;
  const head = `{"v":${ASTRO_PARSER_CONTRACT_VERSION},"ok":true,"mode":"${request.mode}","source":${JSON.stringify(source)},"frontmatter":${JSON.stringify(frontmatter)}`;
  let count = 0;
  let maxDepth = 0;
  if (request.mode === "at") {
    const { offset } = request;
    let innermost: { node: Node; depth: number } | null = null;
    const path: [string, number, number][] = [];
    for (const [node, depth] of elements(root)) {
      count++;
      maxDepth = Math.max(maxDepth, depth);
      const start = node.start ?? -1;
      const end = node.end ?? -1;
      if (start <= offset && offset < end) {
        path[depth] = [elementName(node), start, end];
        path.length = depth + 1;
        if (!innermost || depth >= innermost.depth) innermost = { node, depth };
      }
    }
    const fields =
      (innermost && openingOf(innermost.node)?.attributes)?.map(
        (attribute) => ({
          name: attributeName(attribute),
          kind: attributeKind(attribute),
          start: attribute.start,
          end: attribute.end,
          valueStart: attribute.value?.start ?? null,
          valueEnd: attribute.value?.end ?? null,
        }),
      ) ?? [];
    out.push(
      `${head},"offset":${offset},"path":${JSON.stringify(path.filter(Boolean))},"fields":${JSON.stringify(fields)},"elementCount":${count},"maxDepth":${maxDepth},"diagnostics":${JSON.stringify(diagnosticsOf(parsed.diagnostics))}}`,
    );
  } else {
    const tags = new Map<string, number>();
    out.push(`${head},"nodes":[`);
    let first = true;
    for (const [node, depth] of elements(root)) {
      count++;
      maxDepth = Math.max(maxDepth, depth);
      const name = elementName(node);
      let index = tags.get(name);
      if (index === undefined) tags.set(name, (index = tags.size));
      const attributes = openingOf(node)?.attributes?.length ?? 0;
      out.push(
        `${first ? "" : ","}${node.start},${node.end},${index},${depth},${attributes}`,
      );
      first = false;
    }
    out.push(
      `],"tags":${JSON.stringify([...tags.keys()])},"elementCount":${count},"maxDepth":${maxDepth},"diagnostics":${JSON.stringify(diagnosticsOf(parsed.diagnostics))}}`,
    );
  }
  return finish(out, cap);
}

function finish(out: CappedOut, cap: number): string {
  const json = out.toString();
  const bytes = new TextEncoder().encode(json).byteLength;
  if (bytes > cap) throw new ResultTooLarge(`result ${bytes} bytes`);
  return json;
}
