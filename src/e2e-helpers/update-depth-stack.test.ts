import { afterEach, describe, expect, it, vi } from "vitest";
import {
  editorOriginOf,
  installUpdateDepthStack,
  UPDATE_DEPTH_STACK_PREFIX,
} from "../../e2e/helpers/update-depth-stack";

const options = {
  editorOrigin: null,
  prefix: UPDATE_DEPTH_STACK_PREFIX,
  maxStacks: 2,
  maxFrames: 5,
};

describe("installUpdateDepthStack", () => {
  const realError = console.error;
  afterEach(() => {
    console.error = realError;
    vi.restoreAllMocks();
  });

  it("logs a bounded stack for the warning and still calls the original", () => {
    const original = vi.fn();
    console.error = original;
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    installUpdateDepthStack(options);
    for (let i = 0; i < 4; i += 1) {
      console.error("Maximum update depth exceeded. secret", { a: 1 });
    }
    console.error("unrelated");
    expect(original).toHaveBeenCalledTimes(5);
    expect(log).toHaveBeenCalledTimes(2);
    const line = String(log.mock.calls[0][0]);
    expect(line.startsWith(UPDATE_DEPTH_STACK_PREFIX)).toBe(true);
    expect(line).not.toContain("secret");
    expect(line.split("\n").length).toBeLessThanOrEqual(6);
  });

  it("stays out of a different origin", () => {
    const original = vi.fn();
    console.error = original;
    installUpdateDepthStack({ ...options, editorOrigin: "https://other.test" });
    expect(console.error).toBe(original);
  });
});

describe("editorOriginOf", () => {
  it("resolves against the base URL", () => {
    expect(editorOriginOf("/editor/x", "http://localhost:3100")).toBe(
      "http://localhost:3100",
    );
    expect(editorOriginOf("/editor/x", undefined)).toBeNull();
  });
});
