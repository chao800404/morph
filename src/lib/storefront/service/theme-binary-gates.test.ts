import { describe, expect, it } from "vitest";
import {
  THEME_BINARY_BUILD_STOREFRONT_VAR,
  THEME_BINARY_UPLOAD_FLAG,
  themeBinaryBuildPolicy,
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

describe("the binary build policy", () => {
  const named = { [THEME_BINARY_BUILD_STOREFRONT_VAR]: "storefront-test" };

  it("includes binary files for the named storefront only", () => {
    expect(themeBinaryBuildPolicy(named, false, "storefront-test")).toBe(
      "include",
    );
    expect(themeBinaryBuildPolicy(named, false, "storefront-other")).toBe(
      "refuse",
    );
  });

  it("refuses when no storefront is named", () => {
    expect(themeBinaryBuildPolicy({}, false, "storefront-test")).toBe("refuse");
    expect(
      themeBinaryBuildPolicy(
        { [THEME_BINARY_BUILD_STOREFRONT_VAR]: "" },
        false,
        "",
      ),
    ).toBe("refuse");
  });

  it("refuses in production even for the named storefront", () => {
    expect(themeBinaryBuildPolicy(named, true, "storefront-test")).toBe(
      "refuse",
    );
  });
});
