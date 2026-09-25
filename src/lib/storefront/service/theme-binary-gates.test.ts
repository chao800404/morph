import { describe, expect, it } from "vitest";
import {
  THEME_BINARY_UPLOAD_FLAG,
  themeBinaryUploadRefusal,
} from "./theme-binary-gates";

describe("the binary upload gate", () => {
  it("answers only with the local flag set", () => {
    expect(themeBinaryUploadRefusal({}, false)).toMatch(/Disabled/);
    expect(
      themeBinaryUploadRefusal({ [THEME_BINARY_UPLOAD_FLAG]: "true" }, false),
    ).toMatch(/Disabled/);
    expect(
      themeBinaryUploadRefusal({ [THEME_BINARY_UPLOAD_FLAG]: "1" }, false),
    ).toBeNull();
  });

  it("stays closed in production with the flag set by mistake", () => {
    expect(
      themeBinaryUploadRefusal({ [THEME_BINARY_UPLOAD_FLAG]: "1" }, true),
    ).toBe("Never available in production.");
  });
});
