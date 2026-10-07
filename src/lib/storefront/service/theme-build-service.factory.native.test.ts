import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ env: {} }));

import { nativeStartBuildEnabled } from "./theme-build-service.factory";

describe("whether native Start builds are enabled", () => {
  it("is off unless the server sets it", () => {
    expect(nativeStartBuildEnabled({})).toBe(false);
    expect(nativeStartBuildEnabled({ MORPH_NATIVE_START_BUILD: "true" })).toBe(
      false,
    );
    expect(nativeStartBuildEnabled({ MORPH_NATIVE_START_BUILD: "1" })).toBe(
      true,
    );
  });

  it("is never on in production, whatever is set", () => {
    expect(
      nativeStartBuildEnabled({
        MORPH_NATIVE_START_BUILD: "1",
        ENVIRONMENT: "production",
      }),
    ).toBe(false);
  });
});
