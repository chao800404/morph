/**
 * The dedicated `.astro` parser Worker (docs/astro-theme-plan.md 0.3, 3.1).
 *
 * Reached only through Core's service binding: no routes, no workers.dev or
 * preview URL, and no D1, R2, KV or deployment binding. It knows nothing about
 * users, Themes or storage; Core authorizes, reads the source from the Theme
 * workspace, checks the source version and does any write. This Worker only
 * answers "what is at these positions" about the bytes it was sent.
 *
 * The admission design is M1c's, verified on Cloudflare in M1c-C:
 *
 * 1. take the single processing slot before touching the request body, with a
 *    bounded line (`maxWaiters`) and a bounded wait (`maxWaitMs`);
 * 2. read the body as a stream and enforce the byte limit on every chunk;
 *    `Content-Length` is never consulted (a request claiming 16 bytes and
 *    sending 369 KB was refused at the limit);
 * 3. parse, walk and serialize inside the slot, with the answer's size capped
 *    while it is built;
 * 4. a compiler trap poisons the isolate: an explicit error now and for every
 *    later request, no rebuild.
 *
 * One slot bounds parses per isolate, not memory: garbage from the previous
 * request is collected when V8 decides, and M1c sampled more than 128 MB
 * before GC in several patterns. Only the cloud verification decides whether
 * a deployment stays inside the limit.
 */
import { answer, ResultTooLarge } from "./answer";
import {
  CompilerPoisoned,
  CompilerTrapped,
  compilerMemoryBytes,
  parse,
} from "./compiler";
import {
  ASTRO_PARSER_CONTRACT_VERSION,
  ASTRO_PARSER_ERROR_STATUS,
  ASTRO_PARSER_LIMITS,
  ASTRO_PARSER_PARSE_PATH,
  ASTRO_PARSER_REQUEST_ID_HEADER,
  ASTRO_PARSER_REQUEST_ID_PATTERN,
  type AstroParseFailure,
  type AstroParseRequest,
  type AstroParserErrorCode,
} from "./contract";

class Refusal extends Error {
  constructor(
    readonly code: AstroParserErrorCode,
    readonly detail: string,
  ) {
    super(code);
  }
}

interface Env {
  VERSION?: { id?: string };
}

// ----------------------------------------------------------------- admission

let active = 0;
const waiters: { admit: () => void; timer: ReturnType<typeof setTimeout> }[] =
  [];

function release() {
  active--;
  const next = waiters.shift();
  if (next) {
    clearTimeout(next.timer);
    active++;
    next.admit();
  }
}

/** Resolves with the slot held; the caller must `release()` exactly once. */
function acquire(): Promise<void> {
  if (active === 0) {
    active++;
    return Promise.resolve();
  }
  if (waiters.length >= ASTRO_PARSER_LIMITS.maxWaiters) {
    return Promise.reject(
      new Refusal(
        "parser-busy",
        `${ASTRO_PARSER_LIMITS.maxWaiters} requests already waiting`,
      ),
    );
  }
  return new Promise((resolve, reject) => {
    const waiter = {
      admit: resolve,
      timer: setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
        reject(
          new Refusal(
            "parser-wait-timeout",
            `waited ${ASTRO_PARSER_LIMITS.maxWaitMs} ms`,
          ),
        );
      }, ASTRO_PARSER_LIMITS.maxWaitMs),
    };
    waiters.push(waiter);
  });
}

// --------------------------------------------------------------- body reading

/**
 * Reads at most `limit` bytes. The limit is checked on every chunk, so at most
 * one chunk past it is ever held, and the whole read has a deadline because
 * the slot is already taken.
 */
async function readLimited(
  stream: ReadableStream<Uint8Array> | null,
  limit: number,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!stream) return new Uint8Array(0);
  const reader = stream.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Refusal(
            "source-read-timeout",
            `body not complete after ${ASTRO_PARSER_LIMITS.maxBodyReadMs} ms`,
          ),
        ),
      ASTRO_PARSER_LIMITS.maxBodyReadMs,
    );
  });
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        chunks.length = 0;
        throw new Refusal("source-too-large", `more than ${limit} bytes`);
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel("refused").catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function decode(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Refusal("source-not-utf8", "the body is not valid UTF-8");
  }
  // Adoption condition 3: a lone surrogate parses differently in the Wasm and
  // native builds. Decoded UTF-8 cannot contain one; this keeps it that way.
  const wellFormed = (text as { toWellFormed?: () => string }).toWellFormed;
  return typeof wellFormed === "function" ? wellFormed.call(text) : text;
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

// ------------------------------------------------------------------- request

function readRequest(url: URL): AstroParseRequest {
  const mode = url.searchParams.get("mode");
  if (mode === "outline") return { mode };
  if (mode === "at") {
    const raw = url.searchParams.get("offset") ?? "";
    const offset = /^\d{1,7}$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isInteger(offset) || offset > ASTRO_PARSER_LIMITS.maxOffset)
      throw new Refusal("invalid-request", "offset must be a small integer");
    return { mode, offset };
  }
  throw new Refusal("invalid-request", 'mode must be "outline" or "at"');
}

function respond(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function failure(code: AstroParserErrorCode, detail: string): Response {
  const payload: AstroParseFailure = {
    v: ASTRO_PARSER_CONTRACT_VERSION,
    ok: false,
    error: { code, detail: detail.slice(0, 300) },
  };
  return respond(JSON.stringify(payload), ASTRO_PARSER_ERROR_STATUS[code]);
}

/** Changes when the platform starts a new isolate; made on first use. */
let isolateId: string | undefined;

async function handleParse(request: Request, env: Env): Promise<Response> {
  const header = request.headers.get(ASTRO_PARSER_REQUEST_ID_HEADER);
  const requestId =
    header && ASTRO_PARSER_REQUEST_ID_PATTERN.test(header) ? header : null;
  const started = Date.now();
  const log = (fields: Record<string, unknown>) =>
    console.log(
      JSON.stringify({
        astroParser: "parse",
        requestId,
        version: env.VERSION?.id ?? null,
        isolate: (isolateId ??= crypto.randomUUID()),
        wasmBytes: compilerMemoryBytes(),
        totalMs: Date.now() - started,
        ...fields,
      }),
    );

  let parseRequest: AstroParseRequest;
  let held = false;
  try {
    parseRequest = readRequest(new URL(request.url));
    await acquire();
    held = true;
    const queuedMs = Date.now() - started;
    const bytes = await readLimited(
      request.body,
      ASTRO_PARSER_LIMITS.maxSourceBytes,
    );
    const text = decode(bytes);
    const source = {
      sha256: await sha256Hex(bytes),
      bytes: bytes.byteLength,
      length: text.length,
    };
    const parseStarted = Date.now();
    const parsed = parse(text);
    const parseMs = Date.now() - parseStarted;
    const body = answer(parsed, parseRequest, source);
    log({
      status: 200,
      mode: parseRequest.mode,
      queuedMs,
      parseMs,
      sourceBytes: source.bytes,
    });
    return respond(body, 200);
  } catch (error) {
    // A refused request's body was never read; cancel it so the sender is not
    // left blocked on it.
    request.body?.cancel().catch(() => {});
    let code: AstroParserErrorCode;
    let detail: string;
    if (error instanceof Refusal) {
      ({ code, detail } = error);
    } else if (error instanceof CompilerTrapped) {
      code = "parser-trapped";
      detail = error.message;
    } else if (error instanceof CompilerPoisoned) {
      code = "parser-unavailable";
      detail = `poisoned by an earlier trap (${error.message})`;
    } else if (error instanceof ResultTooLarge) {
      code = "result-too-large";
      detail = error.message;
    } else {
      code = "internal";
      detail = error instanceof Error ? error.message : String(error);
    }
    log({ status: ASTRO_PARSER_ERROR_STATUS[code], error: code });
    return failure(code, detail);
  } finally {
    if (held) release();
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === ASTRO_PARSER_PARSE_PATH)
      return handleParse(request, env);
    request.body?.cancel().catch(() => {});
    return failure("not-found", `${request.method} ${url.pathname}`);
  },
};
