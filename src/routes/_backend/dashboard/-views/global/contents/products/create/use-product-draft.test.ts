import { describe, expect, it } from "vitest";
import { createInitialProductDraft } from "./use-product-draft";

describe("createInitialProductDraft", () => {
  it("starts a product in only the store's default sales channel", () => {
    const draft = createInitialProductDraft(
      ["twd"],
      "00000000-0000-4000-8000-000000000001",
    );

    expect(draft.salesChannelIds).toEqual([
      "00000000-0000-4000-8000-000000000001",
    ]);
  });

  it("does not invent a channel when store settings are unavailable", () => {
    expect(createInitialProductDraft(["twd"]).salesChannelIds).toEqual([]);
  });
});
