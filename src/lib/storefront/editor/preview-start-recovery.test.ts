// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  previewStartAcceptanceLabel,
  readPreviewStartRecovery,
} from "./preview-start-recovery";

/**
 * A start answer that recovered from an interrupted first attempt (preview
 * auto-retry v2, §4-§5): the shape the server sends, and how M1 acceptance
 * reads it. A recovered start is the product working, and still evidence
 * that a container died, so acceptance never counts it as passed.
 */
const RECOVERED = {
  stage: "preview-server-start",
  reason: "sandbox-interrupted",
  signal: "runtime-connection-closing",
  step: "stage",
  attempts: 2,
  traceId: "3ae0cc4e",
};

const PASSING = "ok/cloudflare-sandbox/start";

const answered = (extra: Record<string, unknown> = {}) => ({
  test: "a spec",
  success: true,
  undecodable: null,
  kind: "cloudflare-sandbox",
  previewRuntime: "start",
  ...extra,
});

describe("reading a start answer's recoveredFrom", () => {
  it("reads an answer without one as not recovered", () => {
    expect(readPreviewStartRecovery({ url: "https://x" })).toEqual({
      recovered: false,
    });
    expect(readPreviewStartRecovery({ recoveredFrom: null })).toEqual({
      recovered: false,
    });
    expect(readPreviewStartRecovery(null)).toEqual({ recovered: false });
  });

  it("reads a complete one, and nothing beyond its fields", () => {
    expect(
      readPreviewStartRecovery({
        recoveredFrom: { ...RECOVERED, errorMessage: "never sent" },
      }),
    ).toEqual({ recovered: true, recoveredFrom: RECOVERED, problem: null });
  });

  it("requires the signal: one without it is still recovered, and unreadable", () => {
    const { signal: _signal, ...withoutSignal } = RECOVERED;
    const reading = readPreviewStartRecovery({ recoveredFrom: withoutSignal });
    expect(reading.recovered).toBe(true);
    if (!reading.recovered) return;
    expect(reading.recoveredFrom).toBeNull();
    expect(reading.problem).toContain("signal");
  });

  it("refuses a signal that is not on the allow-list", () => {
    const reading = readPreviewStartRecovery({
      recoveredFrom: { ...RECOVERED, signal: "container-failed-to-start" },
    });
    expect(reading).toMatchObject({ recovered: true, recoveredFrom: null });
  });

  it("reads anything else under recoveredFrom as recovered and unreadable", () => {
    expect(readPreviewStartRecovery({ recoveredFrom: "yes" })).toMatchObject({
      recovered: true,
      recoveredFrom: null,
    });
    expect(readPreviewStartRecovery({ recoveredFrom: false })).toMatchObject({
      recovered: true,
      recoveredFrom: null,
    });
  });
});

describe("M1 acceptance's reading of a start", () => {
  it("passes a clean start as before", () => {
    expect(previewStartAcceptanceLabel(answered())).toBe(PASSING);
    // An older ledger row without the field reads as not recovered.
    expect(previewStartAcceptanceLabel(answered({ recovered: undefined }))).toBe(
      PASSING,
    );
  });

  it("labels a failed and an undecodable answer as before", () => {
    expect(
      previewStartAcceptanceLabel(
        answered({ success: false, kind: null, previewRuntime: null }),
      ),
    ).toBe("failed/null/null");
    expect(
      previewStartAcceptanceLabel(
        answered({ success: null, undecodable: "no boolean success" }),
      ),
    ).toBe("undecodable (no boolean success) in a spec");
  });

  it("never passes a recovered start, and names its trace, step and class", () => {
    const label = previewStartAcceptanceLabel(
      answered({ recovered: true, recoveredFrom: RECOVERED }),
    );
    expect(label).not.toBe(PASSING);
    expect(label).toContain("traceId 3ae0cc4e");
    expect(label).toContain("step stage");
    expect(label).toContain("class sandbox-interrupted/runtime-connection-closing");
    expect(label).toContain("container-exit.ndjson");
    expect(label).toContain("a spec");
  });

  it("never passes a recovered start whose recoveredFrom could not be read", () => {
    const label = previewStartAcceptanceLabel(
      answered({
        recovered: true,
        recoveredFrom: null,
        recoveryProblem: "recoveredFrom.signal is missing",
      }),
    );
    expect(label).not.toBe(PASSING);
    expect(label).toContain("recoveredFrom.signal is missing");
  });
});
