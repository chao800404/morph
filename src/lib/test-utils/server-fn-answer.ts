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
 * Only Start's default plugins are used, as `auth-failure.test.ts` does. The
 * app registers one adapter more (`authFailureSerializationAdapter`), and it
 * applies to thrown errors, which do not arrive wrapped in `result` anyway.
 */

/** What a server function's handler returned, once decoded. */
export type ServerFnResult = unknown;

/** A handler result that said it succeeded. */
export type ServerFnSuccess = { success: true } & Record<string, unknown>;

const describe = (value: unknown) => {
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
};

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
    throw new Error(
      `server function answer is not decodable seroval cross-JSON: ${body.slice(0, 400)}`,
      { cause },
    );
  }
  if (
    typeof decoded !== "object" ||
    decoded === null ||
    !Object.prototype.hasOwnProperty.call(decoded, "result")
  ) {
    throw new Error(
      `server function answer has no "result" wrapper: ${describe(decoded)}`,
    );
  }
  const wrapper = decoded as { result: unknown; error?: unknown };
  if (wrapper.error !== undefined) {
    throw new Error(
      `server function answer carries an error: ${describe(wrapper.error)}`,
    );
  }
  return wrapper.result;
}

/**
 * The decoded result, when and only when it says `success: true`.
 *
 * A refusal (`success: false`, whatever its code), a missing `success`, or an
 * undecodable body throws with what the server actually said. The result is
 * returned so a caller can go on to check its data or message.
 */
export function assertServerFnSuccess(body: string): ServerFnSuccess {
  const result = decodeServerFnResult(body);
  if (
    typeof result !== "object" ||
    result === null ||
    (result as { success?: unknown }).success !== true
  ) {
    throw new Error(`server function did not succeed: ${describe(result)}`);
  }
  return result as ServerFnSuccess;
}
