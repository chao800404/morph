// @vitest-environment node
import { defaultSerovalPlugins, makeSerovalPlugin } from "@tanstack/router-core";
import { fromCrossJSON, toCrossJSONAsync } from "seroval";
import { describe, expect, it } from "vitest";
import {
  AuthFailure,
  accessDenied,
  authRequired,
  classifyAuthFailure,
} from "./auth-failure";
import { authFailureSerializationAdapter } from "./auth-failure-serialization";

/**
 * Serializes a thrown value the way Start does for a server function's error:
 * registered adapters first, then Start's defaults, which include the
 * `ShallowErrorPlugin` that keeps only an error's message
 * (`getDefaultSerovalPlugins` in start-client-core).
 */
async function throughStart(
  error: unknown,
  adapters: readonly Parameters<typeof makeSerovalPlugin>[0][],
) {
  const plugins = [...adapters.map(makeSerovalPlugin), ...defaultSerovalPlugins];
  const wire = JSON.stringify(
    await toCrossJSONAsync(error, { refs: new Map(), plugins }),
  );
  return {
    wire,
    received: fromCrossJSON(JSON.parse(wire), { refs: new Map(), plugins }),
  };
}

describe("classifyAuthFailure", () => {
  it("names the two refusals", () => {
    expect(classifyAuthFailure(authRequired())).toBe("AUTH_REQUIRED");
    expect(classifyAuthFailure(accessDenied("Forbidden: nope"))).toBe(
      "ACCESS_DENIED",
    );
  });

  it("never guesses from text or shape", () => {
    expect(
      classifyAuthFailure(new Error("Unauthorized: Please sign in to continue")),
    ).toBeNull();
    expect(classifyAuthFailure({ code: "AUTH_REQUIRED" })).toBeNull();
    expect(
      classifyAuthFailure(
        Object.assign(new Error("x"), { code: "AUTH_REQUIRED" }),
      ),
    ).toBeNull();
    expect(classifyAuthFailure(null)).toBeNull();
  });

  it("does not accept a code it does not know", () => {
    const odd = new AuthFailure("AUTH_REQUIRED", "x");
    (odd as unknown as { code: string }).code = "SOMETHING_ELSE";
    expect(classifyAuthFailure(odd)).toBeNull();
  });
});

describe("authFailureSerializationAdapter, in Start's plugin order", () => {
  it("is needed: without it the code does not survive", async () => {
    const { received } = await throughStart(authRequired(), []);
    expect(received).toBeInstanceOf(Error);
    expect((received as Error).message).toBe(
      "Unauthorized: Please sign in to continue",
    );
    expect(classifyAuthFailure(received)).toBeNull();
  });

  it("carries both codes across intact", async () => {
    for (const failure of [
      authRequired(),
      accessDenied("Forbidden: Administrator access is required"),
    ]) {
      const { received } = await throughStart(failure, [
        authFailureSerializationAdapter,
      ]);
      expect(received).toBeInstanceOf(AuthFailure);
      expect(classifyAuthFailure(received)).toBe(failure.code);
      expect((received as Error).message).toBe(failure.message);
    }
  });

  it("sends only the code and the message", async () => {
    const failure = authRequired();
    Object.assign(failure, { session: { token: "secret-session-token" } });
    const serialized = authFailureSerializationAdapter.toSerializable(
      failure,
    ) as unknown as Record<string, unknown>;
    expect(Object.keys(serialized).sort()).toEqual(["code", "message"]);

    const { wire } = await throughStart(failure, [
      authFailureSerializationAdapter,
    ]);
    expect(wire).not.toContain("secret-session-token");
    expect(wire).not.toContain("auth-failure.test");
    expect(failure.stack).toBeTruthy();
    expect(wire).not.toContain(failure.stack!.split("\n")[1]!.trim());
  });

  it("turns an unknown code into an ordinary error", () => {
    const received = authFailureSerializationAdapter.fromSerializable({
      code: "SOMETHING_ELSE",
      message: "Refused",
    } as never);
    expect(received).toBeInstanceOf(Error);
    expect(received).not.toBeInstanceOf(AuthFailure);
    expect(classifyAuthFailure(received)).toBeNull();
  });

  it("leaves other errors to Start's own handling", async () => {
    const { received } = await throughStart(new Error("Boom"), [
      authFailureSerializationAdapter,
    ]);
    expect(received).not.toBeInstanceOf(AuthFailure);
    expect((received as Error).message).toBe("Boom");
  });
});
