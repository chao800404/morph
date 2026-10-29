// @vitest-environment node
import { defaultSerovalPlugins } from "@tanstack/router-core";
import { toCrossJSONAsync, toCrossJSONStream } from "seroval";
import { describe, expect, it } from "vitest";
import {
  assertServerFnSuccess,
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

describe("assertServerFnSuccess", () => {
  it("returns a successful result", async () => {
    const body = await answer(succeeded);
    expect(assertServerFnSuccess(body)).toEqual(succeeded);
  });

  it("fails on a refusal, which the old text check let through", async () => {
    const body = await answer(refused);
    // The check this replaces: it passes on the refusal.
    expect(body).not.toMatch(/"success":\s*false/);
    expect(() => assertServerFnSuccess(body)).toThrow(
      /did not succeed.*NOT_FOUND/,
    );
    expect(decodeServerFnResult(body)).toEqual(refused);
  });

  it("fails on a result without success: true", async () => {
    const body = await answer({ message: "no flag" });
    expect(() => assertServerFnSuccess(body)).toThrow(/did not succeed/);
  });

  it("fails on a body that is not decodable", () => {
    expect(() => assertServerFnSuccess("<html>502</html>")).toThrow(
      /not decodable/,
    );
    expect(() => assertServerFnSuccess("")).toThrow(/not decodable/);
  });

  it("fails on an answer without the result wrapper", async () => {
    // A thrown error is sent bare, through toCrossJSONAsync.
    const thrown = JSON.stringify(
      await toCrossJSONAsync(succeeded, { refs: new Map(), plugins }),
    );
    expect(() => assertServerFnSuccess(thrown)).toThrow(/no "result" wrapper/);
  });

  it("fails on a wrapper that carries an error", async () => {
    const body = JSON.stringify(
      await toCrossJSONAsync(
        { result: succeeded, error: "boom", context: {} },
        { refs: new Map(), plugins },
      ),
    );
    expect(() => assertServerFnSuccess(body)).toThrow(/carries an error/);
  });
});
