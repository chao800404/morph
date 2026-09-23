import { describe, expect, it } from "vitest";
import {
  contentTargetForRoutePath,
  templateTypeForRoutePath,
} from "./theme-template-routes";
import { templateTypeForPath } from "./service/storefront-content-runtime";

describe("templateTypeForRoutePath", () => {
  it("covers exactly the paths the runtime reads through a type", () => {
    expect(templateTypeForRoutePath("/")).toBe("index");
    expect(templateTypeForRoutePath("/products/$slug")).toBe("product");
    expect(templateTypeForRoutePath("/products/shoe")).toBe("product");
    expect(templateTypeForRoutePath("/pages/$handle")).toBe("page");
    // The listing is under no type: the runtime never served it from one.
    expect(templateTypeForRoutePath("/products")).toBeNull();
    expect(templateTypeForRoutePath("/aboutus")).toBeNull();
  });

  it("is the rule the public runtime serves by", () => {
    for (const path of ["/", "/products", "/products/a", "/aboutus", "/pages/x", "/blogs/y/"]) {
      expect(templateTypeForPath(path)).toBe(templateTypeForRoutePath(path));
    }
  });
});

describe("contentTargetForRoutePath", () => {
  it("gives a static route no type covers a document of its own", () => {
    expect(contentTargetForRoutePath("/aboutus")).toEqual({
      kind: "route",
      routePath: "/aboutus",
    });
    expect(contentTargetForRoutePath("/company/team/")).toEqual({
      kind: "route",
      routePath: "/company/team",
    });
    expect(contentTargetForRoutePath("/products")).toEqual({
      kind: "route",
      routePath: "/products",
    });
  });

  it("keeps a typed route on its type's shared document", () => {
    expect(contentTargetForRoutePath("/products/$slug")).toEqual({
      kind: "template",
      type: "product",
    });
  });

  it("reports a parameterised route no type covers instead of guessing", () => {
    expect(contentTargetForRoutePath("/journal/$slug").kind).toBe("unsupported");
    expect(contentTargetForRoutePath("/docs/$").kind).toBe("unsupported");
  });
});
