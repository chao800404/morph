import { describe, expect, it } from "vitest";
import { parsePreviewServing } from "./preview-serving";

const BUILD_ID = "a".repeat(64);
const WITH_ACK = [
  "selection-field-section",
  "code-default-selection",
  "astro-identity-v2",
  "section-presentation-ack-v1",
];

describe("a transport's serving report, as it arrives", () => {
  it("passes a well-formed report through unchanged", () => {
    expect(
      parsePreviewServing({
        bridge: { buildId: BUILD_ID, capabilities: ["selection-field-section"] },
        instance: { session: "0f8c2a9e-session", serial: 3 },
      }),
    ).toEqual({
      bridge: { buildId: BUILD_ID, capabilities: ["selection-field-section"] },
      instance: { session: "0f8c2a9e-session", serial: 3 },
    });
  });

  it("keeps a report whose transport names no instance, with the instance unknown", () => {
    expect(
      parsePreviewServing({
        bridge: { buildId: BUILD_ID, capabilities: WITH_ACK },
        instance: null,
      }),
    ).toEqual({
      bridge: { buildId: BUILD_ID, capabilities: WITH_ACK },
      instance: null,
    });
    expect(
      parsePreviewServing({
        bridge: { buildId: BUILD_ID, capabilities: WITH_ACK },
        instance: "not an instance",
      })?.instance,
    ).toBeNull();
  });

  it.each([
    ["nothing", undefined],
    ["null", null],
    ["an empty object", {}],
    ["no bridge", { instance: null }],
    ["a short build id", { bridge: { buildId: "abc", capabilities: [] } }],
    [
      "an upper-case build id",
      { bridge: { buildId: "A".repeat(64), capabilities: [] } },
    ],
    ["no capability list", { bridge: { buildId: BUILD_ID } }],
    [
      "capabilities that are not a list",
      { bridge: { buildId: BUILD_ID, capabilities: "section-presentation-ack-v1" } },
    ],
    [
      "an unknown capability",
      {
        bridge: {
          buildId: BUILD_ID,
          capabilities: ["section-presentation-ack-v1", "future-capability"],
        },
      },
    ],
    [
      "a capability named twice",
      {
        bridge: {
          buildId: BUILD_ID,
          capabilities: ["section-presentation-ack-v1", "section-presentation-ack-v1"],
        },
      },
    ],
    ["a failed start's shape", { ok: false, stage: "x", errorMessage: "500" }],
  ])("is unknown for %s", (_label, value) => {
    expect(parsePreviewServing(value)).toBeNull();
  });
});
