// @vitest-environment node
import { describe, expect, it } from "vitest";

import { themePublicSvgGate } from "./theme-public-svg-gate";

describe("themePublicSvgGate", () => {
  // Opened on 2026-09-28 after the local gate held (see
  // docs/evidence/svg-gate-local-2026-09-27.md). Changing it is a decision,
  // so it is written down here: a commit that closes the gate changes this
  // line too, and says why.
  it("is open in production", () => {
    expect(themePublicSvgGate()).toBe("open");
  });
});
