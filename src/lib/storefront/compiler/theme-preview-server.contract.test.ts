import { describe, expect, it } from "vitest";
import { CloudflareSandboxVitePreviewServer } from "./cloudflare-sandbox-vite-preview-server";
import type { ThemePreviewServer } from "./theme-preview-server.types";

/**
 * The contract's acceptance criterion, as a compile error waiting to happen.
 *
 * This round's rule is the previous round's in a different costume: the
 * existing implementation may not be changed to fit the interface. So the check
 * is that the sandbox server — as it is — *is* a `ThemePreviewServer`. Delete or
 * narrow a member and this file stops compiling, which is louder than any
 * assertion below could be.
 *
 * A `@ts-expect-error` on the wrong line, or an `as` cast, would make this
 * vacuous; there is deliberately neither.
 */
const sandboxSatisfiesTheContract: ThemePreviewServer =
  new CloudflareSandboxVitePreviewServer({});

describe("the Theme preview server contract", () => {
  it("is satisfied by the sandbox implementation without changing it", () => {
    expect(typeof sandboxSatisfiesTheContract.start).toBe("function");
    expect(typeof sandboxSatisfiesTheContract.isServing).toBe("function");
    expect(typeof sandboxSatisfiesTheContract.stop).toBe("function");
  });
});
