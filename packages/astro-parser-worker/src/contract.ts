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
 *     body: the source file, UTF-8, nothing else
 *
 * and every answer, success or failure, is a JSON payload that says what it
 * is. The HTTP status repeats the error class for logs and dashboards; Core
 * reads the payload's `code`, not the status, and never an exception message
 * (an error crossing a binding keeps its message only, see the RPC note in
 * the plan's 3.1 and memory "RPC errors lose fields").
 *
 * The answer never carries the AST. A 100 KB page's AST is 2.4 M characters of
 * JSON; the outline of it is 35 KB and one position's field info is 390 bytes
 * (M1c report 3.9).
 *
 * Pure TypeScript with no imports, so Core can depend on it without pulling
 * in the parser.
 */

/** The deployment unit's name; Core's service binding targets it. */
export const ASTRO_PARSER_WORKER_NAME = "morph-astro-parser";

/** Bumped on any change a caller could observe. */
export const ASTRO_PARSER_CONTRACT_VERSION = 1;

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

export type AstroParseMode = "outline" | "at";

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
  /** UTF-16 length of the decoded source: every position is below it. */
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
  /** `[start, end]` of the frontmatter, UTF-16 offsets; null without one. */
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

export type AstroParseSuccess = AstroParseOutline | AstroParseAt;

export interface AstroParseFailure {
  v: typeof ASTRO_PARSER_CONTRACT_VERSION;
  ok: false;
  error: { code: AstroParserErrorCode; detail: string };
}

export type AstroParseResponse = AstroParseSuccess | AstroParseFailure;

export type AstroParseRequest =
  { mode: "outline" } | { mode: "at"; offset: number };

export function astroParseRequestPath(request: AstroParseRequest): string {
  const query =
    request.mode === "at" ? `mode=at&offset=${request.offset}` : "mode=outline";
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

/**
 * Accepts a parsed JSON payload only if it is a well-formed answer to the
 * expected request about the expected source. A failure payload passes if its
 * code is known; it is still a failure for the caller to act on.
 */
export function checkAstroParseResponse(
  payload: unknown,
  expected: AstroParseExpectation,
): AstroParseCheck {
  const fail = (reason: string): AstroParseCheck => ({ ok: false, reason });
  if (!isRecord(payload) || payload.v !== ASTRO_PARSER_CONTRACT_VERSION)
    return fail("version");
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
  if (
    frontmatter !== null &&
    (!Array.isArray(frontmatter) ||
      frontmatter.length !== 2 ||
      !checkRange(frontmatter[0], frontmatter[1], length))
  )
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
