/**
 * The contract between Morph Core and the dedicated `.astro` parser Worker
 * (docs/astro-theme-plan.md 0.3 and 3.1).
 *
 * Core calls the Worker through a service binding with `fetch`, never with an
 * RPC method that takes the source as a string: M1c measured that a string
 * argument is deserialized into the parser isolate before admission can run
 * (+5.2 MiB for eight queued 369 KB calls), while a queued `fetch` holds no
 * body at all. So the request is
 *
 *     POST https://astro-parser/parse/v1?mode=outline
 *     POST https://astro-parser/parse/v1?mode=at&offset=<UTF-16 offset>
 *     POST https://astro-parser/parse/v1?mode=template        (contract v2)
 *     body: the source file, UTF-8, nothing else
 *
 * and every answer, success or failure, is a JSON payload that says what it
 * is. The HTTP status repeats the error class for logs and dashboards; Core
 * reads the payload's `code`, not the status, and never an exception message
 * (an error crossing a binding keeps its message only, see the RPC note in
 * the plan's 3.1 and memory "RPC errors lose fields").
 *
 * The path keeps its `v1`: it names the route. The contract version is the
 * payload's `v`, which every answer carries, in every mode and on failure.
 *
 * The answer never carries the AST. A 100 KB page's AST is 2.4 M characters of
 * JSON; the outline of it is 35 KB and one position's field info is 390 bytes
 * (M1c report 3.9).
 *
 * Positions: every position in this contract is a **UTF-16 code unit**
 * offset into the decoded source (what `String.prototype.slice` takes), with
 * one exception, diagnostic labels, which are UTF-8 byte offsets (see
 * `AstroParseDiagnostic`). compiler-rs reports its AST in UTF-16 units and the
 * Worker passes them through unconverted; the tests pin this on CRLF, CJK,
 * emoji and other astral characters. Ranges are `[start, end)`.
 *
 * Known limitation, a leading UTF-8 BOM: the Worker hashes and counts the
 * bytes it received, BOM included, but its UTF-8 decoder strips the BOM, so
 * `source.length` and every position are one short of the caller's string.
 * A caller that checks `length` (Core does) refuses such an answer as not
 * about its source. That is a platform limit, never the author's syntax, and
 * the caller must not strip the BOM itself to get an answer: that changes the
 * hash and every offset into the file it will write.
 *
 * ## Contract v2
 *
 * Finalised by decision D90 (2026-11-02) from the M2 projection experiment.
 * The v1 modes `outline` and `at` are unchanged apart from `v`. The new mode
 * `template` (`AstroParseTemplate`) gives the ranges Core needs to project a
 * `.astro` file's frontmatter and template expressions into one module for
 * its own analysis, and a compiler version (`AstroParseTemplate.compiler`:
 * the version in the compiler binding's own package.json, bundled with the
 * `.wasm` the Worker loads, not a version the Wasm reports at runtime), so
 * Core can refuse an answer from any compiler but the one it is pinned to.
 * Still no
 * AST, and still at most `maxResponseBytes`, else `result-too-large`.
 * Whether an element is a component, or sits inside an expression, is not
 * in the answer: both follow from the tag and the ranges.
 *
 * Pure TypeScript with no imports, so Core can depend on it without pulling
 * in the parser.
 */

/** The deployment unit's name; Core's service binding targets it. */
export const ASTRO_PARSER_WORKER_NAME = "morph-astro-parser";

/**
 * Bumped on any change a caller could observe.
 * 2: `mode=template`, with `compiler` in its answer.
 */
export const ASTRO_PARSER_CONTRACT_VERSION = 2;

export const ASTRO_PARSER_PARSE_PATH = "/parse/v1";

/**
 * Optional request id, echoed in the Worker's log line so a caller's record,
 * the log and the platform's invocation event can be matched one to one. A
 * header rather than a query parameter: Workers Logs redacts ids it finds in
 * the URL (M1c-C method notes).
 */
export const ASTRO_PARSER_REQUEST_ID_HEADER = "x-morph-request-id";
export const ASTRO_PARSER_REQUEST_ID_PATTERN = /^[0-9a-f-]{36}$/;

/**
 * The values M1c measured and M1c-C verified on Cloudflare. They are code,
 * not configuration: nothing in an environment can loosen them. Changing one
 * means repeating the cloud verification for it.
 */
export const ASTRO_PARSER_LIMITS = {
  /** Source bytes, enforced while the body streams in. */
  maxSourceBytes: 102_400,
  /** Bytes of the serialized answer, enforced while it is built. */
  maxResponseBytes: 262_144,
  /** One parse at a time per isolate; this many may wait behind it. */
  maxWaiters: 4,
  maxWaitMs: 2_000,
  /**
   * The slot is taken before the body is read, so a body that stops arriving
   * would hold it forever. Core sends a file it already has in memory, so this
   * only ends a stalled stream. Not part of M1c.
   */
  maxBodyReadMs: 5_000,
  maxDiagnostics: 20,
  maxDiagnosticTextChars: 200,
  /** Upper bound on `offset` in `at` mode, far above any admitted source. */
  maxOffset: 1_000_000,
} as const;

export type AstroParseMode = "outline" | "at" | "template";

export const ASTRO_PARSER_ERROR_STATUS = {
  /** Unknown mode, a bad offset, a request id of the wrong shape. */
  "invalid-request": 400,
  /** A path or method the Worker does not serve. */
  "not-found": 404,
  "source-not-utf8": 400,
  "source-too-large": 413,
  "source-read-timeout": 408,
  /** The waiting line is full; refused at once. */
  "parser-busy": 503,
  "parser-wait-timeout": 503,
  /**
   * The compiler threw while parsing this source (stack overflow and the
   * like). The isolate is poisoned from here on.
   */
  "parser-trapped": 500,
  /**
   * An earlier trap poisoned this isolate. It is never rebuilt: reuse broke
   * after 94 traps and every rebuild left 13-22 MiB behind (M1c report 3.8).
   */
  "parser-unavailable": 503,
  "result-too-large": 422,
  internal: 500,
} as const;

export type AstroParserErrorCode = keyof typeof ASTRO_PARSER_ERROR_STATUS;

export function isAstroParserErrorCode(
  value: unknown,
): value is AstroParserErrorCode {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(ASTRO_PARSER_ERROR_STATUS, value)
  );
}

export interface AstroParseSource {
  /** SHA-256 of the UTF-8 bytes the Worker received, lowercase hex. */
  sha256: string;
  bytes: number;
  /**
   * UTF-16 length of the decoded source: every position is below it. One
   * less than the caller's string for a source with a leading BOM, which the
   * decoder strips (see the BOM note at the top).
   */
  length: number;
}

export interface AstroParseDiagnostic {
  severity: string;
  text: string;
  /**
   * The compiler's first label, in **UTF-8 byte** offsets, unlike every other
   * position in this contract: compiler-rs reports diagnostics in bytes and
   * the AST in UTF-16 units (the worker test pins both). Null when the
   * diagnostic has no label.
   */
  byteStart: number | null;
  byteEnd: number | null;
}

export interface AstroParseDiagnostics {
  total: number;
  first: AstroParseDiagnostic[];
}

interface AstroParseCommon {
  v: typeof ASTRO_PARSER_CONTRACT_VERSION;
  ok: true;
  source: AstroParseSource;
  /**
   * `[start, end]` of the frontmatter, fences included, UTF-16 offsets.
   *
   * In `outline` and `at` (unchanged from v1) this is the compiler's range
   * as given, which is `[0, 0]`, not null, for a file without frontmatter.
   * In `template` it is null for a file without frontmatter.
   */
  frontmatter: [number, number] | null;
  elementCount: number;
  maxDepth: number;
  diagnostics: AstroParseDiagnostics;
}

/**
 * Every element, flattened five numbers each:
 * `start, end, tagIndex, depth, attributeCount`, in document order.
 * Positions are UTF-16 offsets into the source.
 */
export interface AstroParseOutline extends AstroParseCommon {
  mode: "outline";
  nodes: number[];
  tags: string[];
}

export type AstroAttributeKind =
  "spread" | "boolean" | "literal" | "expression" | string;

export interface AstroAttributeInfo {
  /** `...` for a spread. */
  name: string;
  kind: AstroAttributeKind;
  start: number;
  end: number;
  valueStart: number | null;
  valueEnd: number | null;
}

/**
 * The elements containing `offset`, outermost first, as `[tag, start, end]`,
 * and the attributes of the innermost one.
 */
export interface AstroParseAt extends AstroParseCommon {
  mode: "at";
  offset: number;
  path: [string, number, number][];
  fields: AstroAttributeInfo[];
}

// ------------------------------------------------------------- template (v2)

/** The tag of a `<>...</>` fragment, which has no name in the source. */
export const ASTRO_TEMPLATE_FRAGMENT_TAG = "#fragment";

/**
 * One template element (a `JSXElement`, or a `<>` `JSXFragment`), in
 * document order (pre-order):
 *
 * - `start`, `end`: the whole element, `<` to the end of its closing tag;
 * - `tag`: index into `tags`, whose entries are the opening tag's name as
 *   source text (`div`, `Hero`, `UI.Badge`, `Fragment`), or
 *   `ASTRO_TEMPLATE_FRAGMENT_TAG` for `<>`;
 * - `parent`: index of the nearest enclosing element, or -1 at the top of
 *   the template. Nesting through an expression counts: in
 *   `<div>{c && <p/>}</div>` the parent of `p` is `div`. An element given as
 *   an attribute value (`slot=<b/>`) has the attribute's element as parent.
 *   Always below the element's own index.
 *
 * Only the template: JSX written inside the frontmatter, and the bodies of
 * `<script>` and `<style>`, are not elements here. Neither are HTML comments
 * and the doctype.
 */
export type AstroTemplateElement = [
  start: number,
  end: number,
  tag: number,
  parent: number,
];

/**
 * The attribute kinds. What decides the kind is the compiler's node:
 *
 * - `boolean`: no value (`hidden`, `client:load`);
 * - `literal`: a quoted string (`a="1"`, `a='1'`);
 * - `expression`: a `JSXExpressionContainer` value. That includes the
 *   shorthand `{title}`, and a backtick value ``a=`t${x}` ``, which the
 *   compiler gives as a container without braces;
 * - `spread`: `{...rest}`;
 * - `element`: a JSX element as the value (`slot=<b/>`), which is also in
 *   `elements`.
 */
export const ASTRO_TEMPLATE_ATTRIBUTE_KINDS = [
  "boolean",
  "literal",
  "expression",
  "spread",
  "element",
] as const;

export type AstroTemplateAttributeKind =
  (typeof ASTRO_TEMPLATE_ATTRIBUTE_KINDS)[number];

/**
 * One attribute, grouped by element in element order, in source order within
 * an element:
 *
 * - `element`: index into `elements`;
 * - `kind`: see `ASTRO_TEMPLATE_ATTRIBUTE_KINDS`;
 * - `name`: the name as source text, verbatim (`class:list`, `set:html`,
 *   `xlink:href`, `client:load`); `...` for a spread;
 * - `nameStart`, `nameEnd`: the name's range; null for a spread. In the
 *   shorthand `{title}` the name range lies inside the value range (the
 *   compiler reads the name from inside the braces);
 * - `valueStart`, `valueEnd`, by kind: null for `boolean`; the literal with
 *   its quotes for `literal`; the container for `expression` (braces
 *   included; for a backtick value, the template literal itself; for the
 *   shorthand, `{title}`, which is then the whole attribute); the spread's
 *   argument, without `{...` and `}`, for `spread`; the element for
 *   `element`.
 */
export type AstroTemplateAttribute = [
  element: number,
  kind: AstroTemplateAttributeKind,
  name: string,
  nameStart: number | null,
  nameEnd: number | null,
  valueStart: number | null,
  valueEnd: number | null,
];

/**
 * One expression in the template: every `JSXExpressionContainer`, as a child
 * or as an attribute value, and every spread attribute. Grouped by owning
 * element in element order (the top level of the template first), in source
 * order within one owner:
 *
 * - `start`, `end`: the container, braces included (`{...}`); for a backtick
 *   attribute value, the template literal (no braces); for a spread, the
 *   whole `{...rest}`;
 * - `expressionStart`, `expressionEnd`: the compiler's expression node inside
 *   it; for a spread, its argument; for a comment-only `{/* c *\/}`, the
 *   compiler's empty expression between the braces. A container without
 *   braces is one whose `start` equals its `expressionStart`;
 * - `owner`: index of the element the container sits in (as a child, or as
 *   one of its attributes), or -1 at the top of the template;
 * - `attribute`: index into `attributes` when the container is that
 *   attribute's value or a spread, else -1;
 * - `jsx`: indices into `elements` of the outermost JSX inside the
 *   expression, ascending. Their ranges are the nested JSX ranges; elements
 *   inside those belong to them, and JSX inside their own containers to
 *   those containers.
 */
export type AstroTemplateExpression = [
  start: number,
  end: number,
  expressionStart: number,
  expressionEnd: number,
  owner: number,
  attribute: number,
  jsx: number[],
];

/**
 * `mode=template`. `elementCount` and `maxDepth` count template elements
 * only (depth 0 at the top of the template).
 */
export interface AstroParseTemplate extends AstroParseCommon {
  mode: "template";
  /**
   * The `version` field of the compiler binding's own package.json
   * (`@astrojs/compiler-binding-wasm32-wasi`), bundled into the Worker with
   * the `.wasm` it loads, e.g. `0.5.1`. Not reported by the Wasm at runtime:
   * the binding exports no version. It changes exactly when the bundled
   * module's package does.
   */
  compiler: string;
  /**
   * The text strictly between the two `---` fences, so the opening line
   * break is inside it. Null without frontmatter. Null too, while
   * `frontmatter` is not, when the compiler's frontmatter range does not
   * have a `---` at each end with its program between them; that happens
   * only with diagnostics (for instance `----` fences).
   *
   * Not the compiler's Program range: that starts at the first statement,
   * after any leading comment.
   */
  frontmatterInner: [number, number] | null;
  tags: string[];
  elements: AstroTemplateElement[];
  attributes: AstroTemplateAttribute[];
  expressions: AstroTemplateExpression[];
}

export type AstroParseSuccess =
  AstroParseOutline | AstroParseAt | AstroParseTemplate;

export interface AstroParseFailure {
  v: typeof ASTRO_PARSER_CONTRACT_VERSION;
  ok: false;
  error: { code: AstroParserErrorCode; detail: string };
}

export type AstroParseResponse = AstroParseSuccess | AstroParseFailure;

export type AstroParseRequest =
  { mode: "outline" } | { mode: "at"; offset: number } | { mode: "template" };

export function astroParseRequestPath(request: AstroParseRequest): string {
  const query =
    request.mode === "at"
      ? `mode=at&offset=${request.offset}`
      : `mode=${request.mode}`;
  return `${ASTRO_PARSER_PARSE_PATH}?${query}`;
}

// ------------------------------------------------------------------ checking

/**
 * What a caller expects of an answer: the request it made and the source it
 * sent. A result is used only if all of it holds; the hash ties the result to
 * that source, the bounds catch a result that is not about it.
 */
export interface AstroParseExpectation {
  request: AstroParseRequest;
  sourceSha256: string;
  sourceBytes: number;
  sourceLength: number;
}

/**
 * `contract-version` is the one reason a caller may want to tell apart: the
 * payload is a JSON object from a Worker on another contract version.
 */
export const ASTRO_PARSE_CONTRACT_VERSION_REASON = "contract-version";

export type AstroParseCheck =
  { ok: true; response: AstroParseResponse } | { ok: false; reason: string };

const isCount = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 0;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function checkRange(
  start: unknown,
  end: unknown,
  length: number,
): start is number {
  // Zero-width ranges are real: error recovery makes them.
  return isCount(start) && isCount(end) && start <= end && end <= length;
}

const isPair = (value: unknown, length: number): value is [number, number] =>
  Array.isArray(value) &&
  value.length === 2 &&
  checkRange(value[0], value[1], length);

const within = (
  inner: readonly [number, number],
  outer: readonly [number, number],
) => inner[0] >= outer[0] && inner[1] <= outer[1];

/** `-1`, or an index below `limit`. */
const isRef = (value: unknown, limit: number): value is number =>
  value === -1 || (isCount(value) && value < limit);

function checkDiagnostics(value: unknown, bytes: number): string | null {
  if (!isRecord(value) || !isCount(value.total) || !Array.isArray(value.first))
    return "diagnostics";
  if (
    value.first.length > value.total ||
    value.first.length > ASTRO_PARSER_LIMITS.maxDiagnostics
  )
    return "diagnostics-count";
  for (const item of value.first) {
    if (
      !isRecord(item) ||
      typeof item.severity !== "string" ||
      typeof item.text !== "string"
    )
      return "diagnostic";
    for (const bound of [item.byteStart, item.byteEnd]) {
      if (bound !== null && (!isCount(bound) || bound > bytes))
        return "diagnostic-range";
    }
  }
  return null;
}

const ATTRIBUTE_KINDS: ReadonlySet<unknown> = new Set(
  ASTRO_TEMPLATE_ATTRIBUTE_KINDS,
);

/**
 * The template answer's own structure: every range inside the source, every
 * index pointing at an entry that exists, and the links between entries
 * consistent with each other (an attribute inside its element, an expression
 * inside its owner, a nested element inside its expression and owned by the
 * same element). Returns the first violation, or null.
 */
function checkTemplate(
  payload: Record<string, unknown>,
  length: number,
  diagnosticsTotal: number,
): string | null {
  if (typeof payload.compiler !== "string" || payload.compiler === "")
    return "compiler";

  const frontmatter = payload.frontmatter as [number, number] | null;
  const inner = payload.frontmatterInner;
  if (inner !== null) {
    if (!isPair(inner, length)) return "frontmatter-inner";
    if (frontmatter === null || !within(inner, frontmatter))
      return "frontmatter-inner";
  } else if (frontmatter !== null && diagnosticsTotal === 0) {
    return "frontmatter-inner";
  }

  const { tags, elements, attributes, expressions } = payload;
  if (
    !Array.isArray(tags) ||
    !Array.isArray(elements) ||
    !Array.isArray(attributes) ||
    !Array.isArray(expressions)
  )
    return "template";
  if (!tags.every((tag) => typeof tag === "string")) return "tags";
  if (elements.length !== payload.elementCount) return "element-count";

  const depths: number[] = [];
  for (let i = 0; i < elements.length; i++) {
    const element = elements[i] as unknown;
    if (!Array.isArray(element) || element.length !== 4) return `element-${i}`;
    const [start, end, tag, parent] = element;
    if (!checkRange(start, end, length)) return `element-range-${i}`;
    if (!isCount(tag) || tag >= tags.length) return `element-tag-${i}`;
    if (!isRef(parent, i)) return `element-parent-${i}`;
    if (parent >= 0) {
      const outer = elements[parent] as [number, number];
      if (!within([start, end as number], [outer[0], outer[1]]))
        return `element-nesting-${i}`;
    }
    const depth = parent >= 0 ? depths[parent] + 1 : 0;
    if (depth > (payload.maxDepth as number)) return `element-depth-${i}`;
    depths.push(depth);
  }

  let previousElement = 0;
  for (let i = 0; i < attributes.length; i++) {
    const attribute = attributes[i] as unknown;
    if (!Array.isArray(attribute) || attribute.length !== 7)
      return `attribute-${i}`;
    const [element, kind, name, nameStart, nameEnd, valueStart, valueEnd] =
      attribute;
    if (!isCount(element) || element >= elements.length)
      return `attribute-element-${i}`;
    if (element < previousElement) return `attribute-order-${i}`;
    previousElement = element;
    if (!ATTRIBUTE_KINDS.has(kind) || typeof name !== "string")
      return `attribute-${i}`;
    const owner = elements[element] as [number, number];
    const box: [number, number] = [owner[0], owner[1]];
    if (kind === "spread") {
      if (name !== "..." || nameStart !== null || nameEnd !== null)
        return `attribute-name-${i}`;
    } else {
      if (!checkRange(nameStart, nameEnd, length)) return `attribute-name-${i}`;
      if (!within([nameStart, nameEnd as number], box))
        return `attribute-name-${i}`;
    }
    if (kind === "boolean") {
      if (valueStart !== null || valueEnd !== null)
        return `attribute-value-${i}`;
    } else {
      if (!checkRange(valueStart, valueEnd, length))
        return `attribute-value-${i}`;
      if (!within([valueStart, valueEnd as number], box))
        return `attribute-value-${i}`;
    }
  }

  for (let i = 0; i < expressions.length; i++) {
    const expression = expressions[i] as unknown;
    if (!Array.isArray(expression) || expression.length !== 7)
      return `expression-${i}`;
    const [start, end, innerStart, innerEnd, owner, attribute, jsx] =
      expression;
    if (!checkRange(start, end, length)) return `expression-range-${i}`;
    const box: [number, number] = [start, end as number];
    if (
      !checkRange(innerStart, innerEnd, length) ||
      !within([innerStart, innerEnd as number], box)
    )
      return `expression-inner-${i}`;
    if (!isRef(owner, elements.length)) return `expression-owner-${i}`;
    if (owner >= 0) {
      const element = elements[owner] as [number, number];
      if (!within(box, [element[0], element[1]]))
        return `expression-owner-${i}`;
    }
    if (!isRef(attribute, attributes.length))
      return `expression-attribute-${i}`;
    if (attribute >= 0) {
      const entry = attributes[attribute] as AstroTemplateAttribute;
      if (entry[0] !== owner) return `expression-attribute-${i}`;
      const value: [number | null, number | null] =
        entry[1] === "spread" ? [innerStart, innerEnd] : [start, end];
      if (
        (entry[1] !== "expression" && entry[1] !== "spread") ||
        entry[5] !== value[0] ||
        entry[6] !== value[1]
      )
        return `expression-attribute-${i}`;
    }
    if (!Array.isArray(jsx)) return `expression-jsx-${i}`;
    let previous = -1;
    for (const index of jsx) {
      if (!isCount(index) || index >= elements.length || index <= previous)
        return `expression-jsx-${i}`;
      previous = index;
      const element = elements[index] as AstroTemplateElement;
      if (element[3] !== owner) return `expression-jsx-${i}`;
      if (!within([element[0], element[1]], [innerStart, innerEnd as number]))
        return `expression-jsx-${i}`;
    }
  }
  return null;
}

/**
 * Accepts a parsed JSON payload only if it is a well-formed answer to the
 * expected request about the expected source. A failure payload passes if its
 * code is known; it is still a failure for the caller to act on.
 *
 * It checks the contract only. Whether the answer's compiler is the one the
 * caller is pinned to, and whether a source with diagnostics can be used,
 * are the caller's decisions.
 */
export function checkAstroParseResponse(
  payload: unknown,
  expected: AstroParseExpectation,
): AstroParseCheck {
  const fail = (reason: string): AstroParseCheck => ({ ok: false, reason });
  if (!isRecord(payload)) return fail("shape");
  if (payload.v !== ASTRO_PARSER_CONTRACT_VERSION)
    return fail(ASTRO_PARSE_CONTRACT_VERSION_REASON);
  if (payload.ok === false) {
    const error = payload.error;
    if (!isRecord(error) || !isAstroParserErrorCode(error.code))
      return fail("error-code");
    return {
      ok: true,
      response: {
        v: ASTRO_PARSER_CONTRACT_VERSION,
        ok: false,
        error: {
          code: error.code,
          detail: typeof error.detail === "string" ? error.detail : "",
        },
      },
    };
  }
  if (payload.ok !== true) return fail("shape");
  if (payload.mode !== expected.request.mode) return fail("mode");

  const source = payload.source;
  if (
    !isRecord(source) ||
    source.sha256 !== expected.sourceSha256 ||
    source.bytes !== expected.sourceBytes ||
    source.length !== expected.sourceLength
  )
    return fail("source");
  const length = expected.sourceLength;

  if (!isCount(payload.elementCount) || !isCount(payload.maxDepth))
    return fail("counts");
  const frontmatter = payload.frontmatter;
  if (frontmatter !== null && !isPair(frontmatter, length))
    return fail("frontmatter");
  const diagnostics = checkDiagnostics(
    payload.diagnostics,
    expected.sourceBytes,
  );
  if (diagnostics) return fail(diagnostics);

  if (payload.mode === "outline") {
    const { nodes, tags } = payload;
    if (!Array.isArray(nodes) || !Array.isArray(tags)) return fail("outline");
    if (!tags.every((tag) => typeof tag === "string")) return fail("tags");
    if (nodes.length !== payload.elementCount * 5) return fail("node-count");
    for (let i = 0; i < nodes.length; i += 5) {
      const [start, end, tag, depth, attributes] = nodes.slice(i, i + 5);
      if (!checkRange(start, end, length)) return fail(`node-range-${i / 5}`);
      if (!isCount(tag) || tag >= tags.length) return fail(`node-tag-${i / 5}`);
      if (!isCount(depth) || depth > payload.maxDepth || !isCount(attributes))
        return fail(`node-${i / 5}`);
    }
  } else if (payload.mode === "template") {
    const total = (payload.diagnostics as AstroParseDiagnostics).total;
    const reason = checkTemplate(payload, length, total);
    if (reason) return fail(reason);
  } else {
    if (expected.request.mode !== "at") return fail("mode");
    if (payload.offset !== expected.request.offset) return fail("offset");
    const { path, fields } = payload;
    if (!Array.isArray(path) || !Array.isArray(fields)) return fail("at");
    let outer: [number, number] = [0, length];
    for (const entry of path) {
      if (!Array.isArray(entry) || entry.length !== 3) return fail("path");
      const [tag, start, end] = entry;
      if (typeof tag !== "string" || !checkRange(start, end, length))
        return fail("path-range");
      if (start < outer[0] || (end as number) > outer[1])
        return fail("path-nesting");
      outer = [start, end as number];
    }
    if (path.length === 0 && fields.length > 0) return fail("fields");
    for (const field of fields) {
      if (
        !isRecord(field) ||
        typeof field.name !== "string" ||
        typeof field.kind !== "string" ||
        !checkRange(field.start, field.end, length)
      )
        return fail("field");
      if (field.start < outer[0] || (field.end as number) > outer[1])
        return fail("field-range");
      const hasValue = field.valueStart !== null || field.valueEnd !== null;
      if (hasValue && !checkRange(field.valueStart, field.valueEnd, length))
        return fail("field-value");
    }
  }
  return { ok: true, response: payload as unknown as AstroParseSuccess };
}
