import { describe, expect, it } from "vitest";

import {
  SECTION_SOURCE_UNCONFIRMABLE,
  SECTION_SOURCE_UNCONFIRMED,
  parseSectionSourceRefusal,
  sectionSourceRefusalMessage,
} from "./theme-write-errors";

describe("section-source refusals in an error message (C7)", () => {
  it("keeps the two codes apart: neither is a prefix of the other", () => {
    expect(SECTION_SOURCE_UNCONFIRMABLE.includes(SECTION_SOURCE_UNCONFIRMED)).toBe(false);
    expect(SECTION_SOURCE_UNCONFIRMED.includes(SECTION_SOURCE_UNCONFIRMABLE)).toBe(false);
  });

  it("reads a temporarily unconfirmable refusal with its reason code", () => {
    expect(
      parseSectionSourceRefusal(
        `Error: ${sectionSourceRefusalMessage(true, "parser-busy", "Design cannot confirm this section right now.")}`,
      ),
    ).toEqual({
      code: SECTION_SOURCE_UNCONFIRMABLE,
      reason: "parser-busy",
      text: "Design cannot confirm this section right now.",
    });
  });

  it("reads every other class as UNCONFIRMED with its reason code", () => {
    expect(
      parseSectionSourceRefusal(
        sectionSourceRefusalMessage(false, "dynamic-route", "Edit it in Code mode."),
      ),
    ).toEqual({
      code: SECTION_SOURCE_UNCONFIRMED,
      reason: "dynamic-route",
      text: "Edit it in Code mode.",
    });
  });

  it("reads Start's refusals, which carry no reason code, exactly as before", () => {
    for (const text of [
      "src/routes/index.tsx has errors: Unexpected token",
      'src/routes/index.tsx does not render section "hero".',
      "The layout has errors: x",
      "Route /about is no longer in the Theme.",
      "Design cannot change next Themes yet. Edit the source in Code mode.",
    ]) {
      expect(
        parseSectionSourceRefusal(`${SECTION_SOURCE_UNCONFIRMED}: ${text}`),
      ).toEqual({ code: SECTION_SOURCE_UNCONFIRMED, reason: null, text });
    }
  });

  it("is null for any other error", () => {
    expect(parseSectionSourceRefusal("CONFLICT_DRAFT_GENERATION_MISMATCH: x")).toBeNull();
    expect(parseSectionSourceRefusal("boom")).toBeNull();
  });
});
