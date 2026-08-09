import { describe, expect, it } from "vitest";
import { createUniqueSku, formatSku } from "./sku";

describe("product SKU", () => {
  it("formats configured product and option tokens", () => {
    expect(
      formatSku(
        { product: "classic-shirt", variant: "Red Large", options: ["Red", "Large"], index: 0 },
        {},
      ),
    ).toBe("CLASSIC-SHIRT-RED-LARGE");
  });

  it("adds a stable-width suffix when the base is taken", async () => {
    const sku = await createUniqueSku(
      { product: "shirt", variant: "Default", options: [], index: 0 },
      {},
      async (candidate) => candidate === "SHIRT",
    );
    expect(sku).toBe("SHIRT-02");
  });

  it("can disable generation", async () => {
    expect(
      await createUniqueSku(
        { product: "shirt", variant: "Default", options: [], index: 0 },
        { autoGenerate: false },
        async () => false,
      ),
    ).toBeNull();
  });
});
