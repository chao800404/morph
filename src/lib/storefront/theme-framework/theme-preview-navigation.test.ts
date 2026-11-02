import { describe, expect, it } from "vitest";
import { previewNavigationFor } from "./theme-preview-navigation";

describe("how a Theme's preview navigates, from its recorded framework", () => {
  it("is the router for TanStack Start, recorded or NULL", () => {
    expect(previewNavigationFor("tanstack-start")).toBe("router");
    expect(previewNavigationFor(null)).toBe("router");
    expect(previewNavigationFor(undefined)).toBe("router");
  });

  it("is documents for Astro", () => {
    expect(previewNavigationFor("astro")).toBe("document");
  });

  it("is unknown for a framework Morph does not know, never Start's", () => {
    expect(previewNavigationFor("next")).toBeNull();
  });
});
