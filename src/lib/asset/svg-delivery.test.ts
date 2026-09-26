import { describe, expect, it } from "vitest";
import { SVG_VALIDATOR_VERSION } from "@/lib/security/svg-validation";
import { SVG_ISOLATION_HEADERS } from "@/lib/storefront/theme-svg-isolation";
import {
  applyLibrarySvgHeaders,
  passedCurrentSvgRules,
  SVG_VALIDATOR_METADATA_KEY,
  svgValidationMetadata,
} from "./svg-delivery";

const current = svgValidationMetadata(SVG_VALIDATOR_VERSION);

describe("passedCurrentSvgRules", () => {
  it("holds only for the version of the rules in force", () => {
    expect(passedCurrentSvgRules(current)).toBe(true);
    // The string checks before the parser recorded this, and it proves nothing now.
    expect(passedCurrentSvgRules({ svgValidated: "true" })).toBe(false);
    expect(
      passedCurrentSvgRules({
        [SVG_VALIDATOR_METADATA_KEY]: String(SVG_VALIDATOR_VERSION - 1),
      }),
    ).toBe(false);
    expect(
      passedCurrentSvgRules({
        [SVG_VALIDATOR_METADATA_KEY]: String(SVG_VALIDATOR_VERSION + 1),
      }),
    ).toBe(false);
    expect(passedCurrentSvgRules({})).toBe(false);
    expect(passedCurrentSvgRules(undefined)).toBe(false);
  });
});

describe("applyLibrarySvgHeaders", () => {
  const headersFor = (
    metadata: Record<string, string> | null,
    inlineAllowed: boolean,
  ) => {
    const headers = new Headers({
      "content-security-policy": "default-src *",
    });
    applyLibrarySvgHeaders(headers, metadata, { inlineAllowed });
    return headers;
  };

  it("shows inline only a file that passed the current rules, where the route allows it", () => {
    expect(headersFor(current, true).get("content-disposition")).toBe("inline");
    expect(headersFor(current, false).get("content-disposition")).toBe(
      "attachment",
    );
    expect(
      headersFor({ svgValidated: "true" }, true).get("content-disposition"),
    ).toBe("attachment");
    expect(headersFor(null, true).get("content-disposition")).toBe(
      "attachment",
    );
  });

  it("isolates every SVG, over any policy it had, whatever its verdict", () => {
    for (const [metadata, inline] of [
      [current, true],
      [{ svgValidated: "true" }, true],
      [null, false],
    ] as const) {
      const headers = headersFor(metadata, inline);
      for (const [name, value] of Object.entries(SVG_ISOLATION_HEADERS)) {
        expect(headers.get(name)).toBe(value);
      }
    }
  });
});
