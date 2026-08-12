import { describe, expect, it } from "vitest";
import {
  parseDeleteItemsInput,
  parseUpdateItemsInput,
} from "./input-validation";

const itemId = "11111111-1111-4111-8111-111111111111";
const folderId = "22222222-2222-4222-8222-222222222222";

const parseItem = (locationId: string | null) => {
  const data = new FormData();
  data.set(
    "itemsData",
    JSON.stringify([{ id: itemId, type: "asset", name: "Asset", locationId }]),
  );
  return parseUpdateItemsInput(data);
};

describe("parseUpdateItemsInput item location contract", () => {
  it("accepts an item-specific folder", () => {
    const result = parseItem(folderId);

    expect(result.formError).toBeUndefined();
    expect(result.itemsData[0]?.locationId).toBe(folderId);
  });

  it("represents the root location as null", () => {
    const result = parseItem(null);

    expect(result.formError).toBeUndefined();
    expect(result.itemsData[0]?.locationId).toBeNull();
  });

  it("rejects an invalid item location", () => {
    const result = parseItem("not-a-folder-id");

    expect(result.formError).toBeDefined();
    expect(result.itemsData).toEqual([]);
  });
});

describe("parseDeleteItemsInput reference cleanup confirmation", () => {
  it("defaults to preserving product references until explicitly confirmed", () => {
    const data = new FormData();
    data.set("assetIds", JSON.stringify([itemId]));

    const result = parseDeleteItemsInput(data);

    expect(result.formError).toBeUndefined();
    expect(result.detachReferences).toBe(false);
  });

  it("accepts the explicit second-step confirmation", () => {
    const data = new FormData();
    data.set("assetIds", JSON.stringify([itemId]));
    data.set("detachReferences", "true");

    const result = parseDeleteItemsInput(data);

    expect(result.formError).toBeUndefined();
    expect(result.detachReferences).toBe(true);
  });
});
