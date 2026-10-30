import { defaultSerovalPlugins } from "@tanstack/router-core";
import { fromCrossJSON } from "seroval";

/**
 * Reading what a server function answered, for tests that only see the wire.
 *
 * TanStack Start does not reply with plain JSON. A server function's answer
 * is the seroval cross-JSON of `{ result, error, context }`
 * (`server-functions-handler.js` in start-server-core), so a refusal such as
 * `{ success: false, error: "NOT_FOUND" }` goes out as
 * `{"t":10,…,"p":{"k":["success","error"],"v":[{"t":2,"s":3},…]}}`. The text
 * `"success":false` never appears in it, and a regex for it passes on every
 * refusal. Refusals also answer HTTP 200, so `response.ok()` misses them too.
 *
 * Decoding ties these checks to that internal layout, so every way the layout
 * could drift is a loud failure here rather than a silent pass: a body that is
 * not JSON, not cross-JSON, or lacks the `result` wrapper throws.
 *
 * What a failure says is bounded on purpose. Test output ends up in CI logs
 * and reports, and an answer can carry anything the server returned, so a
 * failure names only which check failed, the type and value of `success`, and
 * the refusal's `error` when it is a short upper-case code. It never repeats
 * the body, a message, data, or a whole object.
 *
 * Only Start's default plugins are used, as `auth-failure.test.ts` does. The
 * app registers one adapter more (`authFailureSerializationAdapter`), and it
 * applies to thrown errors, which do not arrive wrapped in `result` anyway.
 */

/** What a server function's handler returned, once decoded. */
export type ServerFnResult = unknown;

/** A handler result that said it succeeded. */
export type ServerFnSuccess = { success: true } & Record<string, unknown>;

const PREFIX = "server function answer";

/** `typeof`, with `null` and arrays told apart. Never the value itself. */
function kindOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/** `success`, said only when it is a boolean or absent. */
function describeSuccess(value: unknown): string {
  return typeof value === "boolean" || value === undefined
    ? String(value)
    : `(${kindOf(value)})`;
}

const ERROR_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

/** A refusal's `error`, said only when it is a short code like `NOT_FOUND`. */
function describeErrorCode(value: unknown): string {
  if (value === undefined) return "(none)";
  return typeof value === "string" && ERROR_CODE.test(value)
    ? value
    : `(withheld ${kindOf(value)})`;
}

/**
 * The `result` a server function returned, decoded from the response body.
 *
 * Throws when the body cannot be decoded, when it is not the
 * `{ result, error, context }` wrapper, or when the wrapper carries an error.
 */
export function decodeServerFnResult(body: string): ServerFnResult {
  let decoded: unknown;
  try {
    decoded = fromCrossJSON(JSON.parse(body), {
      refs: new Map(),
      plugins: [...defaultSerovalPlugins],
    });
  } catch (cause) {
    // Not chained: a JSON parse error quotes the text it choked on.
    const name = cause instanceof Error ? cause.name : kindOf(cause);
    throw new Error(
      `${PREFIX} is not decodable seroval cross-JSON (${name}, body length ${body.length})`,
    );
  }
  if (
    typeof decoded !== "object" ||
    decoded === null ||
    !Object.prototype.hasOwnProperty.call(decoded, "result")
  ) {
    throw new Error(
      `${PREFIX} has no "result" wrapper (decoded ${kindOf(decoded)})`,
    );
  }
  const wrapper = decoded as { result: unknown; error?: unknown };
  if (wrapper.error !== undefined) {
    throw new Error(
      `${PREFIX} carries an error in its wrapper (${kindOf(wrapper.error)})`,
    );
  }
  return wrapper.result;
}

/**
 * The decoded result, when and only when it says `success: true`.
 *
 * A refusal (`success: false`, whatever its code), a missing `success`, or an
 * undecodable body throws, naming `success` and the refusal's code. The result
 * is returned so a caller can go on to check its data or message.
 */
export function assertServerFnSuccess(body: string): ServerFnSuccess {
  const result = decodeServerFnResult(body);
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    throw new Error(`${PREFIX}: result is not an object (${kindOf(result)})`);
  }
  const { success, error } = result as { success?: unknown; error?: unknown };
  if (success !== true) {
    throw new Error(
      `${PREFIX}: server function did not succeed (success=${describeSuccess(success)}, error=${describeErrorCode(error)})`,
    );
  }
  return result as ServerFnSuccess;
}
