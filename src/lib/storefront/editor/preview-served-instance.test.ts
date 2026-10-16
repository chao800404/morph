import { describe, expect, it } from "vitest";
import {
  formatPreviewServedInstance,
  parsePreviewServedInstance,
  parsePreviewToEditorMessage,
  previewServedInstanceFromEntries,
  type PreviewServedTiming,
} from "./preview-protocol";

const SESSION = "0b6c1d2e-aaaa-4bbb-8ccc-123456789abc";
const OTHER = "9f8e7d6c-aaaa-4bbb-8ccc-123456789abc";

const response = (
  overrides: Partial<PreviewServedTiming> = {},
): PreviewServedTiming => ({
  kind: "script",
  sameOrigin: true,
  transferSize: 300,
  instance: `${SESSION}.2`,
  ...overrides,
});

describe("preview served instance", () => {
  it("round-trips the header form and the JSON form", () => {
    const parsed = parsePreviewServedInstance(`${SESSION}.12`);
    expect(parsed).toEqual({ session: SESSION, serial: 12 });
    expect(formatPreviewServedInstance(parsed!)).toBe(`${SESSION}.12`);
    expect(parsePreviewServedInstance({ session: SESSION, serial: 12 })).toEqual(
      parsed,
    );
  });

  it.each([
    "",
    "no-serial",
    `${SESSION}.0`,
    `${SESSION}.-1`,
    `${SESSION}.1.5`,
    "short.1",
    `bad session!.1`,
    { session: SESSION, serial: "1" },
    { session: 1, serial: 1 },
    null,
    7,
  ])("refuses %j", (value) => {
    expect(parsePreviewServedInstance(value)).toBeNull();
  });

  it("names the instance every answered response agrees on", () => {
    expect(
      previewServedInstanceFromEntries([
        response({ kind: "navigation" }),
        response(),
        response(),
      ]),
    ).toEqual({ kind: "known", instance: { session: SESSION, serial: 2 } });
  });

  it("does not count responses read from the browser cache", () => {
    // An immutable dependency chunk first sent by an earlier instance.
    expect(
      previewServedInstanceFromEntries([
        response({ kind: "navigation" }),
        response({ transferSize: 0, instance: `${SESSION}.1` }),
        response({ transferSize: 0, instance: null }),
      ]),
    ).toEqual({ kind: "known", instance: { session: SESSION, serial: 2 } });
  });

  it("does not count other origins or other kinds of response", () => {
    expect(
      previewServedInstanceFromEntries([
        response({ kind: "navigation" }),
        response({ sameOrigin: false, instance: null }),
        response({ kind: "other", instance: `${OTHER}.1` }),
      ]),
    ).toEqual({ kind: "known", instance: { session: SESSION, serial: 2 } });
  });

  it("reports two instances as mixed", () => {
    expect(
      previewServedInstanceFromEntries([
        response({ kind: "navigation" }),
        response({ instance: `${SESSION}.3` }),
      ]),
    ).toEqual({ kind: "mixed" });
    expect(
      previewServedInstanceFromEntries([
        response({ kind: "navigation" }),
        response({ instance: `${OTHER}.2` }),
      ]),
    ).toEqual({ kind: "mixed" });
  });

  it("reports an answered response without a name as missing", () => {
    expect(
      previewServedInstanceFromEntries([
        response({ kind: "navigation" }),
        response({ instance: null }),
      ]),
    ).toEqual({ kind: "missing" });
    expect(
      previewServedInstanceFromEntries([
        response({ kind: "navigation" }),
        response({ instance: "garbled" }),
      ]),
    ).toEqual({ kind: "missing" });
  });

  it("says nothing when no response named an instance", () => {
    expect(
      previewServedInstanceFromEntries([
        response({ kind: "navigation", instance: null }),
        response({ instance: null }),
      ]),
    ).toBeNull();
    expect(previewServedInstanceFromEntries([])).toBeNull();
    // Named only by cached responses: nothing answered now.
    expect(
      previewServedInstanceFromEntries([
        response({ kind: "navigation", instance: null }),
        response({ transferSize: 0 }),
      ]),
    ).toBeNull();
  });

  it("carries a report on the ready message and drops a malformed one", () => {
    expect(
      parsePreviewToEditorMessage({
        type: "morph:storefront-preview-ready",
        servedInstance: {
          kind: "known",
          instance: { session: SESSION, serial: 4 },
        },
      }),
    ).toEqual({
      type: "morph:storefront-preview-ready",
      servedInstance: {
        kind: "known",
        instance: { session: SESSION, serial: 4 },
      },
    });
    expect(
      parsePreviewToEditorMessage({
        type: "morph:storefront-preview-ready",
        servedInstance: { kind: "mixed" },
      }),
    ).toEqual({
      type: "morph:storefront-preview-ready",
      servedInstance: { kind: "mixed" },
    });
    for (const servedInstance of [
      { kind: "known", instance: "garbled" },
      { kind: "other" },
      "known",
    ]) {
      expect(
        parsePreviewToEditorMessage({
          type: "morph:storefront-preview-ready",
          servedInstance,
        }),
      ).toEqual({ type: "morph:storefront-preview-ready" });
    }
  });
});
