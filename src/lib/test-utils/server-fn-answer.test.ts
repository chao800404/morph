// @vitest-environment node
import { defaultSerovalPlugins } from "@tanstack/router-core";
import { toCrossJSONAsync, toCrossJSONStream, toJSONAsync } from "seroval";
import { describe, expect, it } from "vitest";
import {
  assertServerFnSuccess,
  decodeServerFnRequestData,
  decodeServerFnResult,
} from "./server-fn-answer";

const plugins = [...defaultSerovalPlugins];

/**
 * A handler result as start-server-core sends it: the function middleware's
 * `{ result, error, context }` wrapper through `toCrossJSONStream`, the
 * parsed node `JSON.stringify`'d into the body (server-functions-handler.js).
 */
function answer(result: unknown): Promise<string> {
  return new Promise((resolve, reject) => {
    let body: unknown;
    toCrossJSONStream(
      { result, error: undefined, context: {} },
      {
        refs: new Map(),
        plugins,
        onParse(value) {
          body = value;
        },
        onDone() {
          resolve(JSON.stringify(body));
        },
        onError: reject,
      },
    );
  });
}

const succeeded = {
  success: true,
  message: "Theme section props updated",
  data: { ticket: 3 },
};
const refused = {
  success: false,
  message: "Theme template or section not found",
  error: "NOT_FOUND",
};

/** The message `run` throws; fails the test if it does not throw. */
function thrown(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return (error as Error).message;
  }
  throw new Error("expected a throw");
}

/** Looks like a credential; must never reach a failure message. */
// Built at run time, so the source holds no literal a secret scanner would
// flag; it still looks like a live key to anything reading the message.
const TOKEN = ["sk", "live", "Morph0TestOnly0NotAKey0Leak0Probe"].join("_");

describe("assertServerFnSuccess", () => {
  it("returns a successful result", async () => {
    const body = await answer(succeeded);
    expect(assertServerFnSuccess(body)).toEqual(succeeded);
  });

  it("fails on a refusal, which the old text check let through", async () => {
    const body = await answer(refused);
    // The check this replaces: it passes on the refusal.
    expect(body).not.toMatch(/"success":\s*false/);
    expect(thrown(() => assertServerFnSuccess(body))).toBe(
      "server function answer: server function did not succeed (success=false, error=NOT_FOUND)",
    );
    expect(decodeServerFnResult(body)).toEqual(refused);
  });

  it("fails on a result without success: true", async () => {
    const body = await answer({ message: "no flag" });
    expect(thrown(() => assertServerFnSuccess(body))).toMatch(
      /did not succeed \(success=undefined, error=\(none\)\)/,
    );
    const truthy = await answer({ success: "yes" });
    expect(thrown(() => assertServerFnSuccess(truthy))).toMatch(
      /success=\(string\)/,
    );
  });

  it("fails on a result that is not an object", async () => {
    const body = await answer(TOKEN);
    const message = thrown(() => assertServerFnSuccess(body));
    expect(message).toMatch(/result is not an object \(string\)/);
    expect(message).not.toContain(TOKEN);
  });

  it("fails on a body that is not decodable", () => {
    expect(thrown(() => assertServerFnSuccess("<html>502</html>"))).toMatch(
      /not decodable/,
    );
    expect(thrown(() => assertServerFnSuccess(""))).toMatch(/not decodable/);
    // A parse error quotes the text it choked on; the failure must not.
    const message = thrown(() =>
      assertServerFnSuccess(`{"token":"${TOKEN}" oops`),
    );
    expect(message).toMatch(/not decodable .*body length \d+/);
    expect(message).not.toContain(TOKEN);
  });

  it("fails on an answer without the result wrapper", async () => {
    // A thrown error is sent bare, through toCrossJSONAsync.
    const thrownAnswer = JSON.stringify(
      await toCrossJSONAsync(
        { ...succeeded, token: TOKEN },
        { refs: new Map(), plugins },
      ),
    );
    const message = thrown(() => assertServerFnSuccess(thrownAnswer));
    expect(message).toMatch(/no "result" wrapper \(decoded object\)/);
    expect(message).not.toContain(TOKEN);
  });

  it("fails on a wrapper that carries an error", async () => {
    const body = JSON.stringify(
      await toCrossJSONAsync(
        { result: succeeded, error: TOKEN, context: {} },
        { refs: new Map(), plugins },
      ),
    );
    const message = thrown(() => assertServerFnSuccess(body));
    expect(message).toMatch(/carries an error in its wrapper \(string\)/);
    expect(message).not.toContain(TOKEN);
  });

  it("says no message, data or odd error value of a refusal", async () => {
    const body = await answer({
      success: false,
      message: `Bearer ${TOKEN}`,
      data: { token: TOKEN },
      error: TOKEN,
    });
    // The body carries the token verbatim; the failure does not.
    expect(body).toContain(TOKEN);
    const message = thrown(() => assertServerFnSuccess(body));
    expect(message).toBe(
      "server function answer: server function did not succeed (success=false, error=(withheld string))",
    );
    const longCode = await answer({ success: false, error: "A".repeat(65) });
    expect(thrown(() => assertServerFnSuccess(longCode))).toMatch(
      /error=\(withheld string\)/,
    );
    const objectError = await answer({
      success: false,
      error: { code: "NOT_FOUND", token: TOKEN },
    });
    const objectMessage = thrown(() => assertServerFnSuccess(objectError));
    expect(objectMessage).toMatch(/error=\(withheld object\)/);
    expect(objectMessage).not.toContain(TOKEN);
  });
});

describe("decodeServerFnRequestData", () => {
  /** A call's body as start-client-core's `serverFnFetcher` posts it. */
  const request = async (payload: unknown) =>
    JSON.stringify(await toJSONAsync(payload, { plugins }));

  it("returns the data sent, null and an absent field told apart", async () => {
    const data = {
      templateId: "tpl-home",
      expectedDraftGeneration: 3,
      expectedSharedLayoutRevisionId: null,
      note: undefined,
    };
    const body = await request({ data });
    // The text check a reader might write does not see the null.
    expect(body).not.toContain('"expectedSharedLayoutRevisionId":null');
    const decoded = decodeServerFnRequestData(body) as Record<string, unknown>;
    expect(decoded).toEqual(data);
    expect(decoded.expectedSharedLayoutRevisionId).toBeNull();
    expect("expectedSharedLayoutRevisionId" in decoded).toBe(true);
    expect(
      decodeServerFnRequestData(
        await request({ data: { expectedSharedLayoutRevisionId: "rev-1" } }),
      ),
    ).toEqual({ expectedSharedLayoutRevisionId: "rev-1" });
  });

  it("fails on a body that is not decodable or has no data", async () => {
    const message = thrown(() =>
      decodeServerFnRequestData(`{"token":"${TOKEN}" oops`),
    );
    expect(message).toMatch(/not decodable .*body length \d+/);
    expect(message).not.toContain(TOKEN);
    const noData = await request({ context: { token: TOKEN } });
    const missing = thrown(() => decodeServerFnRequestData(noData));
    expect(missing).toMatch(/no "data" payload \(decoded object\)/);
    expect(missing).not.toContain(TOKEN);
  });
});
