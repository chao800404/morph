import { createSerializationAdapter } from "@tanstack/react-router";
import { AuthFailure, isAuthFailureCode } from "./auth-failure";

/**
 * Carries an `AuthFailure` from a server function to the browser intact.
 *
 * TanStack Start serializes a thrown error with its `ShallowErrorPlugin`, which
 * keeps only the message, so the code would not survive the trip. Start applies
 * registered adapters before that plugin (see `src/start.ts`).
 *
 * Kept apart from `auth-failure.ts` so the middlewares that throw an
 * `AuthFailure` do not load the router to do it.
 *
 * Only the code and the fixed message cross — never the stack, the session or
 * anything else on the error. A code this build does not know arrives as an
 * ordinary error rather than as a guess at one of the two.
 */
export const authFailureSerializationAdapter = createSerializationAdapter({
  key: "morph-auth-failure",
  test: (value): value is AuthFailure => value instanceof AuthFailure,
  toSerializable: (failure) => ({
    code: failure.code as string,
    message: failure.message,
  }),
  fromSerializable: ({ code, message }) => {
    const text = typeof message === "string" ? message : "Request refused";
    return isAuthFailureCode(code)
      ? new AuthFailure(code, text)
      : // Not an AuthFailure, so classifyAuthFailure reads it as ordinary.
        (new Error(text) as AuthFailure);
  },
});
