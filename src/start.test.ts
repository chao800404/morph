// @vitest-environment node
import { describe, expect, it } from "vitest";
import { authFailureSerializationAdapter } from "@/lib/auth/auth-failure-serialization";
import { editorWriterMiddleware } from "@/lib/auth/editor-writer";
import { startCsrfMiddleware, startInstance } from "./start";

/** How Start itself recognises its CSRF middleware (`csrfSymbol`). */
const CSRF_MARK = Symbol.for("tanstack-start:csrf-middleware");

describe("start instance", () => {
  it("keeps Start's CSRF protection for server functions", async () => {
    // With a start instance, Start uses exactly this list in place of its
    // default CSRF middleware, so leaving it out would drop the protection.
    const options = await startInstance.getOptions();
    const middlewares = (options.requestMiddleware ?? []) as object[];
    expect(middlewares).toContain(startCsrfMiddleware);
    expect(middlewares.some((middleware) => CSRF_MARK in middleware)).toBe(
      true,
    );
  });

  it("sends the open editor's account with every server function call", async () => {
    const options = await startInstance.getOptions();
    expect(options.functionMiddleware).toContain(editorWriterMiddleware);
  });

  it("registers the auth failure adapter", async () => {
    const options = await startInstance.getOptions();
    expect(options.serializationAdapters).toContain(
      authFailureSerializationAdapter,
    );
  });
});
