/**
 * Turns a parsed AST into the contract's answer: positions and field info,
 * never the AST. The walk and the serialization are M1c's, measured there and
 * on Cloudflare in M1c-C; only the envelope (`ok`, `source`) is new.
 */
import type { CompilerDiagnostic, ParsedAstro } from "./compiler";
import {
  ASTRO_PARSER_CONTRACT_VERSION,
  ASTRO_PARSER_LIMITS,
  type AstroParseDiagnostics,
  type AstroParseRequest,
  type AstroParseSource,
} from "./contract";

export class ResultTooLarge extends Error {}

/**
 * A string builder that refuses to grow past the cap, so serialization is
 * bounded while it runs rather than checked afterwards. It counts UTF-16
 * units, which undercounts bytes only for non-ASCII tag names and diagnostic
 * text; the finished string is measured in bytes once more.
 */
class CappedOut {
  private readonly parts: string[] = [];
  private units = 0;
  constructor(private readonly cap: number) {}
  push(part: string) {
    this.units += part.length;
    if (this.units > this.cap)
      throw new ResultTooLarge(`result over ${this.cap} bytes`);
    this.parts.push(part);
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

/** The answer's JSON text, at most `maxResponseBytes` UTF-8 bytes. */
export function answer(
  parsed: ParsedAstro,
  request: AstroParseRequest,
  source: AstroParseSource,
): string {
  const cap = ASTRO_PARSER_LIMITS.maxResponseBytes;
  const out = new CappedOut(cap);
  const root = parsed.ast as Node;
  const fm = root.frontmatter as Node | undefined | null;
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
  const text = out.toString();
  const bytes = new TextEncoder().encode(text).byteLength;
  if (bytes > cap) throw new ResultTooLarge(`result ${bytes} bytes`);
  return text;
}
