import { afterEach, describe, expect, it } from "vitest";
import type { FulfillmentProvider } from "./fulfillment-provider";
import { fulfillmentProviderRegistry } from "./fulfillment-provider-registry.server";

const provider = (id: string, name = id): FulfillmentProvider => ({
  id,
  name,
  async create() {
    return { data: {}, labels: [] };
  },
  async cancel({ data }) {
    return data;
  },
});

afterEach(() => {
  fulfillmentProviderRegistry.configure([]);
});

describe("fulfillmentProviderRegistry", () => {
  it("keeps manual fulfillment available and lists configured providers", () => {
    fulfillmentProviderRegistry.configure([
      provider("carrier_tw", "Carrier TW"),
    ]);

    expect(fulfillmentProviderRegistry.get(null)?.id).toBe("manual_manual");
    expect(fulfillmentProviderRegistry.get("carrier_tw")?.id).toBe(
      "carrier_tw",
    );
    expect(fulfillmentProviderRegistry.list()).toEqual([
      { id: "manual_manual", name: "Manual fulfillment" },
      { id: "carrier_tw", name: "Carrier TW" },
    ]);
  });

  it("rejects duplicate and invalid provider IDs without replacing the active registry", () => {
    const carrier = provider("carrier_tw");
    fulfillmentProviderRegistry.configure([carrier]);

    expect(() =>
      fulfillmentProviderRegistry.configure([carrier, provider("carrier_tw")]),
    ).toThrow("Duplicate fulfillment provider: carrier_tw");
    expect(() =>
      fulfillmentProviderRegistry.configure([provider(" carrier_tw")]),
    ).toThrow("Fulfillment provider IDs must be 1 to 128 characters");
    expect(fulfillmentProviderRegistry.get("carrier_tw")).toBe(carrier);
  });
});
