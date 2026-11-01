/**
 * Core's side of the `.astro` parser Worker (packages/astro-parser-worker):
 * one call over the `ASTRO_PARSER` service binding, and an answer Core can
 * trust or a typed refusal. Never an exception.
 *
 * Fail-closed by construction. No binding, a binding that throws, a payload
 * that is not the contract's, a result about some other source: all of them
 * are `unavailable`, and an unavailable parse gives no Design capability (a
 * file the parser cannot answer for stays "controlled by code"; plan 3.1 and
 * 3.6.4.2). The parser's own refusals arrive as codes in its payload, because
 * an error that crosses a binding keeps only its message.
 *
 * Nothing calls this yet. Wiring it into field editing (L1.5b) is a separate
 * step, as is binding production Core to a deployed parser.
 */
import {
  ASTRO_PARSER_ERROR_STATUS,
  ASTRO_PARSER_LIMITS,
  ASTRO_PARSER_REQUEST_ID_HEADER,
  ASTRO_PARSER_REQUEST_ID_PATTERN,
  astroParseRequestPath,
  checkAstroParseResponse,
  type AstroParseRequest,
  type AstroParseSuccess,
  type AstroParserErrorCode,
} from "@morph/astro-parser-worker/contract";

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
  | "invalid-response";

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
    if (!check.ok) return unavailable("invalid-response", check.reason);

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
