import type { TaxRegionDTO } from "./dto/tax.dto";
import { describe, expect, it, vi } from "vitest";
import { calculateTaxLinesWithDependencies } from "./calculate-tax-lines";
import { TaxProviderRegistry } from "./providers/tax-provider-registry.server";
import type {
  TaxCalculationRegion,
  TaxProvider,
} from "./providers/tax-provider";

const country: TaxRegionDTO = {
  id: "country",
  countryCode: "us",
  countryName: "United States",
  provinceCode: null,
  parentId: null,
  providerId: "tp_test",
  metadata: {},
  createdAt: new Date(0),
  updatedAt: new Date(0),
};
const calculationRegion: TaxCalculationRegion = {
  countryRegion: country,
  provinceRegion: null,
  rates: [],
};

describe("calculateTaxLines", () => {
  it("normalizes and forwards the complete address to the selected provider", async () => {
    const getTaxLines = vi
      .fn<TaxProvider["getTaxLines"]>()
      .mockResolvedValue([]);
    const provider: TaxProvider = { id: "tp_test", getTaxLines };
    const findCalculationRegion = vi.fn().mockResolvedValue(calculationRegion);

    await calculateTaxLinesWithDependencies(
      {
        context: {
          address: {
            address1: "1 Market St",
            city: "San Francisco",
            countryCode: " US ",
            provinceCode: " ca ",
            postalCode: "94105",
          },
          currencyCode: "usd",
          customerId: "customer",
        },
        itemLines: [{ id: "item", unitAmount: 1000, quantity: 1 }],
      },
      {
        findCalculationRegion,
        isProviderEnabled: vi.fn().mockResolvedValue(true),
        providers: new TaxProviderRegistry([provider]),
      },
    );

    expect(findCalculationRegion).toHaveBeenCalledWith("us", "CA");
    expect(getTaxLines).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          address: expect.objectContaining({
            city: "San Francisco",
            countryCode: "us",
            provinceCode: "CA",
            postalCode: "94105",
          }),
        }),
      }),
    );
  });

  it("returns no lines when the address has no configured tax region", async () => {
    const providers = { get: vi.fn() };
    await expect(
      calculateTaxLinesWithDependencies(
        {
          context: {
            address: { countryCode: "tw" },
            currencyCode: "twd",
          },
        },
        {
          findCalculationRegion: vi.fn().mockResolvedValue(null),
          isProviderEnabled: vi.fn(),
          providers,
        },
      ),
    ).resolves.toEqual([]);
    expect(providers.get).not.toHaveBeenCalled();
  });

  it("rejects a disabled provider before executing it", async () => {
    await expect(
      calculateTaxLinesWithDependencies(
        {
          context: {
            address: { countryCode: "us" },
            currencyCode: "usd",
          },
        },
        {
          findCalculationRegion: vi.fn().mockResolvedValue(calculationRegion),
          isProviderEnabled: vi.fn().mockResolvedValue(false),
          providers: new TaxProviderRegistry([]),
        },
      ),
    ).rejects.toThrow("Tax provider is disabled: tp_test");
  });

  it("rejects a database provider that was not registered in the runtime", async () => {
    await expect(
      calculateTaxLinesWithDependencies(
        {
          context: {
            address: { countryCode: "us" },
            currencyCode: "usd",
          },
        },
        {
          findCalculationRegion: vi.fn().mockResolvedValue(calculationRegion),
          isProviderEnabled: vi.fn().mockResolvedValue(true),
          providers: new TaxProviderRegistry([]),
        },
      ),
    ).rejects.toThrow("Tax provider is not registered: tp_test");
  });
});

describe("TaxProviderRegistry", () => {
  it("rejects duplicate provider identifiers", () => {
    const provider: TaxProvider = {
      id: "tp_duplicate",
      getTaxLines: vi.fn().mockResolvedValue([]),
    };
    expect(() => new TaxProviderRegistry([provider, provider])).toThrow(
      "Tax provider is already registered: tp_duplicate",
    );
  });
});
