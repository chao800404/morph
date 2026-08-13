import { describe, expect, it } from "vitest";
import {
  storefrontPageDocumentSchema,
  updateStorefrontPageMetadataInputSchema,
} from "./storefront-page";

describe("storefront page validation", () => {
  it("rejects executable or unregistered document-shaped input", () => {
    expect(
      storefrontPageDocumentSchema.safeParse({
        version: 1,
        sections: [
          {
            id: "hero",
            type: "hero",
            enabled: true,
            props: { render: () => "unsafe" },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects metadata beyond the shared key limit", () => {
    const metadata = Object.fromEntries(
      Array.from({ length: 51 }, (_, index) => [`key-${index}`, "value"]),
    );
    expect(
      updateStorefrontPageMetadataInputSchema.safeParse({
        id: crypto.randomUUID(),
        metadata,
      }).success,
    ).toBe(false);
  });
});
