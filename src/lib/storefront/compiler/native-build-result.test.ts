import { describe, expect, it } from "vitest";
import { nativeBuildFailureMessage } from "./native-build-result";

describe("a failed native build's message", () => {
  it("is what the build printed, when that is short", () => {
    expect(nativeBuildFailureMessage("✘ [ERROR] Could not resolve")).toBe(
      "NATIVE_BUILD_FAILED: ✘ [ERROR] Could not resolve",
    );
  });

  it("keeps the cause printed first as well as the error printed last", () => {
    // The shape of a prerender that failed: the server's own error, then the
    // Response Start threw on, dumped at length.
    const cause =
      "PRERENDER_SERVER_ERROR: GET /landing/: Error: listen EADDRINUSE";
    const consequence = "Error: Failed to fetch /landing: Internal Server Error";
    const output = `${cause}\n${"x".repeat(20_000)}\n${consequence}`;

    const message = nativeBuildFailureMessage(output);
    expect(message).toContain(cause);
    expect(message).toContain(consequence);
    expect(message).toContain("characters omitted");
    expect(message.length).toBeLessThan(9_000);
  });
});
