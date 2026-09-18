// @vitest-environment node
import { describe, expect, it } from "vitest";
import { CloudflareSandboxVitePreviewServer } from "./cloudflare-sandbox-vite-preview-server";
import { LocalVitePreviewServer } from "./local-vite-preview-server";
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
 * The second declaration is the other half of the same question. An interface
 * one implementation satisfies says nothing about whether a second one can; a
 * local transport that needed the contract widened would have been a sign the
 * contract was invented rather than observed. Both are assigned with no cast
 * and no `@ts-expect-error`, which would make this vacuous.
 */
const sandboxSatisfiesTheContract: ThemePreviewServer =
  new CloudflareSandboxVitePreviewServer({});
const localSatisfiesTheContract: ThemePreviewServer =
  new LocalVitePreviewServer({});

describe("the Theme preview server contract", () => {
  it("is satisfied by the sandbox implementation without changing it", () => {
    expect(typeof sandboxSatisfiesTheContract.start).toBe("function");
    expect(typeof sandboxSatisfiesTheContract.isServing).toBe("function");
    expect(typeof sandboxSatisfiesTheContract.stop).toBe("function");
  });

  it("is satisfied by the local implementation without widening it", () => {
    expect(typeof localSatisfiesTheContract.start).toBe("function");
    expect(typeof localSatisfiesTheContract.isServing).toBe("function");
    expect(typeof localSatisfiesTheContract.stop).toBe("function");
  });
});
