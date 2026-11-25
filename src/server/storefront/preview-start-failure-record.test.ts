// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  recordPreviewStartFailure,
  recordPreviewStartRecovery,
} from "./preview-start-failure-record";

const INTERRUPTED_MKDIR =
  "OperationInterruptedError: Sandbox operation files.mkdir was interrupted while the runtime connection was closing";

const logged = (run: () => void) => {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "error").mockImplementation((line: unknown) => {
    lines.push(String(line));
  });
  try {
    run();
  } finally {
    spy.mockRestore();
  }
  return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
};

describe("recording a start that recovered on its retry (auto-retry v2, §4)", () => {
  it("logs the failed first attempt with its message, and answers without it", () => {
    let answer: unknown;
    const [record] = logged(() => {
      answer = recordPreviewStartRecovery({
        recoveredFrom: {
          attemptId: "first111",
          stage: "preview-server-start",
          reason: "sandbox-interrupted",
          signal: "runtime-connection-closing",
          step: "stage",
          attempts: 2,
          errorMessage: INTERRUPTED_MKDIR,
        },
        attemptId: "second22",
        logs: ["/workspace/internal/path"],
        storefrontId: "storefront",
        themeId: "theme",
        previewId: "preview",
      });
    });

    expect(answer).toEqual({
      stage: "preview-server-start",
      reason: "sandbox-interrupted",
      signal: "runtime-connection-closing",
      step: "stage",
      attempts: 2,
      traceId: expect.stringMatching(/^[0-9a-f]{8}$/),
    });
    // Nothing from the container reaches the browser.
    expect(JSON.stringify(answer)).not.toContain("OperationInterruptedError");
    expect(JSON.stringify(answer)).not.toContain("/workspace");

    // The server log keeps the failure as if it had been answered.
    expect(record).toMatchObject({
      scope: "storefront.preview.start",
      traceId: (answer as { traceId: string }).traceId,
      stage: "preview-server-start",
      errorMessage: INTERRUPTED_MKDIR,
      attemptId: "first111",
      recovered: true,
      recoveredBy: "second22",
      signal: "runtime-connection-closing",
      step: "stage",
    });
  });

  it("names the retried attempt on a final failure, and leaves other failures' lines as they were", () => {
    const [retried, plain] = logged(() => {
      recordPreviewStartFailure({
        stage: "preview-server-start",
        errorMessage: INTERRUPTED_MKDIR,
        attemptId: "second22",
        retryOf: "first111",
        storefrontId: "storefront",
        themeId: "theme",
        previewId: "preview",
      });
      recordPreviewStartFailure({
        stage: "preview-server-start",
        errorMessage: "listen EADDRINUSE :::5173",
        storefrontId: "storefront",
        themeId: "theme",
        previewId: "preview",
      });
    });

    expect(retried).toMatchObject({ attemptId: "second22", retryOf: "first111" });
    expect(retried).not.toHaveProperty("recovered");
    expect(plain).not.toHaveProperty("retryOf");
    expect(plain).not.toHaveProperty("recovered");
  });
});
