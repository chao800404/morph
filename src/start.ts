import { createCsrfMiddleware, createStart } from "@tanstack/react-start";
import { authFailureSerializationAdapter } from "@/lib/auth/auth-failure-serialization";

/**
 * Start's own configuration for this app.
 *
 * Having this file at all replaces Start's defaults rather than adding to
 * them: with no start instance, Start protects server functions with its CSRF
 * middleware; with one, it uses exactly the `requestMiddleware` given here
 * (`createStartHandler`, `@tanstack/start-server-core` 1.169). So the CSRF
 * middleware is restated with the same filter Start uses by default, and
 * `start.test.ts` fails if it goes missing.
 */
export const startCsrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  requestMiddleware: [startCsrfMiddleware],
  // Lets a server function's refusal reach the browser with its code; see
  // auth-failure.ts.
  serializationAdapters: [authFailureSerializationAdapter],
}));
