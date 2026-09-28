import { afterEach, describe, expect, it } from "vitest";
import type { ShippingRateProvider } from "./shipping-rate-provider";
import { shippingRateProviderRegistry } from "./shipping-rate-provider-registry.server";

const provider = (id: string, name = id): ShippingRateProvider => ({
  id,
  name,
  async calculate() {
    return 120;
  },
});

afterEach(() => {
  shippingRateProviderRegistry.configure([]);
});

describe("shippingRateProviderRegistry", () => {
  it("keeps manual rates available and lists configured providers", () => {
    shippingRateProviderRegistry.configure([
      provider("carrier_tw", "Carrier TW"),
    ]);

    expect(shippingRateProviderRegistry.get("manual_manual")?.id).toBe(
      "manual_manual",
    );
    expect(shippingRateProviderRegistry.get("carrier_tw")?.id).toBe(
      "carrier_tw",
    );
    expect(shippingRateProviderRegistry.list()).toEqual([
      { id: "manual_manual", name: "Manual rate" },
      { id: "carrier_tw", name: "Carrier TW" },
    ]);
  });

  it("rejects duplicate and invalid provider IDs without replacing the active registry", () => {
    const carrier = provider("carrier_tw");
    shippingRateProviderRegistry.configure([carrier]);

    expect(() =>
      shippingRateProviderRegistry.configure([carrier, provider("carrier_tw")]),
    ).toThrow("Duplicate shipping rate provider: carrier_tw");
    expect(() =>
      shippingRateProviderRegistry.configure([provider(" carrier_tw")]),
    ).toThrow("Shipping rate provider IDs must be 1 to 128 characters");
    expect(shippingRateProviderRegistry.get("carrier_tw")).toBe(carrier);
  });
});
