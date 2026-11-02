/**
 * Core's side of the `.astro` parser Worker (packages/astro-parser-worker):
 * one call over the `ASTRO_PARSER` service binding, and an answer Core can
 * trust or a typed refusal. Never an exception.
 *
 * Fail-closed by construction. No binding, a binding that throws, a payload
 * that is not the contract's, a result about some other source: all of them
 * are `unavailable`, and an unavailable parse gives no Design capability. The
 * parser's own refusals arrive as codes in its payload, because an error that
 * crosses a binding keeps only its message.
 *
 * `parseAstroTemplate` is the entry for analysis (contract v2 `template`):
 * it accepts an answer only from the pinned compiler and only for a source
 * without diagnostics, and sorts every refusal into the M2 plan's failure
 * classes (`AstroParserFailureClass`). None of them is "controlled by code":
 * that is the analysis's verdict on a source it did read. The client gives
 * the class and a reason code; wording is the caller's. It never falls back
 * to any other reading of the source.
 *
 * Nothing calls this yet. Wiring it into field editing (L1.5b) is a separate
 * step, as is binding production Core to a deployed parser.
 */
import {
  ASTRO_PARSE_CONTRACT_VERSION_REASON,
  ASTRO_PARSER_ERROR_STATUS,
  ASTRO_PARSER_LIMITS,
  ASTRO_PARSER_REQUEST_ID_HEADER,
  ASTRO_PARSER_REQUEST_ID_PATTERN,
  astroParseRequestPath,
  checkAstroParseResponse,
  type AstroParseDiagnostics,
  type AstroParseRequest,
  type AstroParseSuccess,
  type AstroParseTemplate,
  type AstroParserErrorCode,
} from "@morph/astro-parser-worker/contract";

import { MORPH_ASTRO_COMPILER_RS_VERSION } from "./astro-compiler-version";

/** The service binding's name in Core's wrangler configuration. */
export const ASTRO_PARSER_BINDING = "ASTRO_PARSER";

/** The part of a service binding (`Fetcher`) this client uses. */
export interface AstroParserBinding {
  fetch(input: string, init: RequestInit): Promise<Response>;
}

export type AstroParserUnavailableCode =
  | AstroParserErrorCode
  /** The environment has no `ASTRO_PARSER` binding. */
  | "binding-missing"
  /** The call itself failed: nothing is running behind the binding, or the
   * connection broke. */
  | "binding-failed"
  /** An answer that is not the contract's, or not about the source sent. */
  | "invalid-response"
  /** An answer from a Worker on another contract version. */
  | "contract-mismatch";

export type AstroParseOutcome =
  | { status: "parsed"; result: AstroParseSuccess }
  | {
      status: "unavailable";
      code: AstroParserUnavailableCode;
      detail: string;
    };

/** Reads the binding from a Worker `env`, or null when it is not bound. */
export function astroParserBindingFrom(
  env: unknown,
): AstroParserBinding | null {
  if (typeof env !== "object" || env === null) return null;
  const candidate = (env as Record<string, unknown>)[ASTRO_PARSER_BINDING];
  if (
    typeof candidate === "object" &&
    candidate !== null &&
    typeof (candidate as { fetch?: unknown }).fetch === "function"
  ) {
    return candidate as AstroParserBinding;
  }
  return null;
}

const unavailable = (
  code: AstroParserUnavailableCode,
  detail: string,
): AstroParseOutcome => ({ status: "unavailable", code, detail });

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Reads the answer with the parser's own response cap: a well-behaved parser
 * never sends more, so more is not an answer. Null for that, or for bytes
 * that are not UTF-8.
 */
async function readCapped(
  response: Response,
  cap: number,
): Promise<string | null> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Parses one `.astro` source through the binding. `source` is the file as
 * Core read it from the Theme workspace; the answer is checked against it
 * (hash, size, every position in range) before it is returned.
 */
export async function parseAstroSource(
  binding: AstroParserBinding | null | undefined,
  source: string,
  request: AstroParseRequest,
  options: { requestId?: string } = {},
): Promise<AstroParseOutcome> {
  if (!binding) {
    return unavailable(
      "binding-missing",
      `no ${ASTRO_PARSER_BINDING} service binding in this environment`,
    );
  }
  try {
    const bytes = new TextEncoder().encode(source);
    if (bytes.byteLength > ASTRO_PARSER_LIMITS.maxSourceBytes) {
      // The parser would refuse it the same way; no reason to send it.
      return unavailable(
        "source-too-large",
        `${bytes.byteLength} bytes; the parser takes at most ${ASTRO_PARSER_LIMITS.maxSourceBytes}`,
      );
    }
    const sourceSha256 = await sha256Hex(bytes);
    const headers: Record<string, string> = {
      "content-type": "text/plain; charset=utf-8",
    };
    if (
      options.requestId &&
      ASTRO_PARSER_REQUEST_ID_PATTERN.test(options.requestId)
    ) {
      headers[ASTRO_PARSER_REQUEST_ID_HEADER] = options.requestId;
    }

    let response: Response;
    try {
      response = await binding.fetch(
        `https://astro-parser${astroParseRequestPath(request)}`,
        { method: "POST", headers, body: bytes },
      );
    } catch (error) {
      return unavailable(
        "binding-failed",
        error instanceof Error ? error.message : String(error),
      );
    }

    const text = await readCapped(
      response,
      ASTRO_PARSER_LIMITS.maxResponseBytes,
    );
    if (text === null) {
      return unavailable(
        "invalid-response",
        "answer over the response cap, or not UTF-8",
      );
    }
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      return unavailable(
        "invalid-response",
        `not JSON (HTTP ${response.status})`,
      );
    }
    const check = checkAstroParseResponse(payload, {
      request,
      sourceSha256,
      sourceBytes: bytes.byteLength,
      sourceLength: source.length,
    });
    if (!check.ok) {
      return unavailable(
        check.reason === ASTRO_PARSE_CONTRACT_VERSION_REASON
          ? "contract-mismatch"
          : "invalid-response",
        check.reason,
      );
    }

    const answer = check.response;
    if (!answer.ok) {
      const { code, detail } = answer.error;
      if (response.status !== ASTRO_PARSER_ERROR_STATUS[code]) {
        return unavailable(
          "invalid-response",
          `${code} with HTTP ${response.status}`,
        );
      }
      return unavailable(code, detail);
    }
    if (response.status !== 200) {
      return unavailable(
        "invalid-response",
        `a result with HTTP ${response.status}`,
      );
    }
    return { status: "parsed", result: answer };
  } catch (error) {
    return unavailable(
      "binding-failed",
      error instanceof Error ? error.message : String(error),
    );
  }
}

// ------------------------------------------------------------------ template

/**
 * The M2 plan's failure classes (plan v2 6.2 with the review's point 3). All
 * of them refuse writes; they differ in what the author is told.
 *
 * - `temporarily-unconfirmable`: the platform could not confirm this source
 *   now; the source itself is not at fault.
 * - `capability-limit`: legal source this version cannot handle, such as a
 *   file or an answer over a size limit.
 * - `author-syntax`: the compiler reported diagnostics for this source.
 */
export type AstroParserFailureClass =
  "temporarily-unconfirmable" | "capability-limit" | "author-syntax";

/** The plan's reason codes for refusals that come from the parser call. */
export type AstroParserFailureReason =
  | "parser-binding-missing"
  | "parser-binding-failed"
  | "parser-invalid-response"
  | "parser-contract-mismatch"
  | "parser-version-mismatch"
  | "parser-busy"
  | "parser-wait-timeout"
  | "parser-trapped"
  | "parser-unavailable"
  /** The Worker reports a fault on its side: `internal`, `invalid-request`,
   * `not-found`, `source-not-utf8`, `source-read-timeout`. Core sends a
   * well-formed request with UTF-8 it encoded itself, so none of these is
   * the source's fault. */
  | "parser-fault"
  | "source-too-large"
  | "result-too-large"
  | "author-syntax";

/** Why a template answer was refused: the transport codes plus two of its own. */
export type AstroTemplateRefusalCode =
  | AstroParserUnavailableCode
  /** The answer names a compiler other than `MORPH_ASTRO_COMPILER_RS_VERSION`. */
  | "version-mismatch"
  /** The compiler reported diagnostics for the source. */
  | "author-syntax";

export interface AstroParserFailure {
  class: AstroParserFailureClass;
  reason: AstroParserFailureReason;
}

/** Sorts a refusal code into its class and the plan's reason code. */
export function classifyAstroParserRefusal(
  code: AstroTemplateRefusalCode,
): AstroParserFailure {
  const temporarily = (
    reason: AstroParserFailureReason,
  ): AstroParserFailure => ({
    class: "temporarily-unconfirmable",
    reason,
  });
  switch (code) {
    case "binding-missing":
      return temporarily("parser-binding-missing");
    case "binding-failed":
      return temporarily("parser-binding-failed");
    case "invalid-response":
      return temporarily("parser-invalid-response");
    case "contract-mismatch":
      return temporarily("parser-contract-mismatch");
    case "version-mismatch":
      return temporarily("parser-version-mismatch");
    case "parser-busy":
    case "parser-wait-timeout":
    case "parser-trapped":
    case "parser-unavailable":
      return temporarily(code);
    case "internal":
    case "invalid-request":
    case "not-found":
    case "source-not-utf8":
    case "source-read-timeout":
      return temporarily("parser-fault");
    case "source-too-large":
    case "result-too-large":
      return { class: "capability-limit", reason: code };
    case "author-syntax":
      return { class: "author-syntax", reason: "author-syntax" };
  }
}

export type AstroTemplateOutcome =
  | { status: "confirmed"; result: AstroParseTemplate }
  | ({
      status: "refused";
      code: AstroTemplateRefusalCode;
      detail: string;
      /** The compiler's diagnostics, for `author-syntax` only. */
      diagnostics?: AstroParseDiagnostics;
    } & AstroParserFailure);

function refused(
  code: AstroTemplateRefusalCode,
  detail: string,
  diagnostics?: AstroParseDiagnostics,
): AstroTemplateOutcome {
  return {
    status: "refused",
    code,
    detail,
    ...classifyAstroParserRefusal(code),
    ...(diagnostics ? { diagnostics } : {}),
  };
}

/**
 * Asks the parser for the template ranges of one `.astro` source (contract
 * v2 `template`) and accepts the answer only if all of this holds:
 *
 * 1. it passes every check `parseAstroSource` makes: the contract version,
 *    the source's hash, byte size and length, every range inside the source
 *    and every index consistent;
 * 2. its `compiler` is `MORPH_ASTRO_COMPILER_RS_VERSION`, the version the
 *    Astro toolchain compiles with, since ranges from another compiler need
 *    not match what is built;
 * 3. `diagnostics.total` is 0.
 *
 * In that order: an answer from another compiler is not trusted for its
 * diagnostics either. Anything else is `refused`, with its class.
 */
export async function parseAstroTemplate(
  binding: AstroParserBinding | null | undefined,
  source: string,
  options: { requestId?: string } = {},
): Promise<AstroTemplateOutcome> {
  const outcome = await parseAstroSource(
    binding,
    source,
    { mode: "template" },
    options,
  );
  if (outcome.status === "unavailable")
    return refused(outcome.code, outcome.detail);
  const result = outcome.result;
  if (result.mode !== "template") {
    // `checkAstroParseResponse` already holds the mode to the request.
    return refused("invalid-response", `a ${result.mode} answer`);
  }
  if (result.compiler !== MORPH_ASTRO_COMPILER_RS_VERSION) {
    return refused(
      "version-mismatch",
      `compiler ${result.compiler}; Morph is pinned to ${MORPH_ASTRO_COMPILER_RS_VERSION}`,
    );
  }
  if (result.diagnostics.total > 0) {
    return refused(
      "author-syntax",
      `${result.diagnostics.total} diagnostic(s)`,
      result.diagnostics,
    );
  }
  return { status: "confirmed", result };
}
