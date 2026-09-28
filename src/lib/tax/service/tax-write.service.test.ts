import type { TaxRateDTO, TaxRegionDTO } from "@/lib/tax/dto/tax.dto";
import { updateTaxRateInputSchema } from "@/lib/validations/tax";
import { createTaxWriteService } from "./tax-write.service";
import { describe, expect, it, vi } from "vitest";

const regionId = "550e8400-e29b-41d4-a716-446655440000";
const rateId = "8d5b2394-10bb-4d8b-9a76-4d5bcdba6ea4";
const region: TaxRegionDTO = {
  id: regionId,
  countryCode: "tw",
  countryName: "TAIWAN",
  provinceCode: null,
  parentId: null,
  providerId: "tp_system",
  metadata: {},
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
};
const rate: TaxRateDTO = {
  id: rateId,
  taxRegionId: regionId,
  rate: 5,
  code: "vat",
  name: "VAT",
  isDefault: false,
  isCombinable: false,
  metadata: {},
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
  rules: [
    {
      id: "17efef25-816a-4a4b-90c6-644db9688938",
      taxRateId: rateId,
      reference: "product",
      referenceId: "c49f0eb4-a93b-4c0d-97ec-98aa67caf09a",
      label: "Product",
    },
  ],
};

const makeService = () => {
  const dependencies = {
    prepareProviders: vi.fn(async () => undefined),
    listAvailableCountries: vi.fn(async () => [{ code: "tw", name: "TAIWAN" }]),
    listProviders: vi.fn(async () => [{ id: "tp_system" }]),
    findRegion: vi.fn(async () => region),
    findRegions: vi.fn(async () => [region]),
    provinceCodeExists: vi.fn(async () => false),
    createRegion: vi.fn(async () => undefined),
    updateRegion: vi.fn(async () => undefined),
    softDeleteRegions: vi.fn(async () => undefined),
    findRate: vi.fn(async () => rate),
    findRates: vi.fn(async () => [rate]),
    ruleTargetsExist: vi.fn(async () => true),
    createRate: vi.fn(async () => undefined),
    updateRate: vi.fn(async () => undefined),
    softDeleteRates: vi.fn(async () => undefined),
  } satisfies Parameters<typeof createTaxWriteService>[0];
  const service = createTaxWriteService(dependencies, () => "new-id");
  return { service, dependencies };
};

describe("taxWriteService", () => {
  it("rejects a tax region when the country is already assigned", async () => {
    const { service, dependencies } = makeService();
    dependencies.listAvailableCountries.mockResolvedValue([]);

    const result = await service.createRegion({
      countryCode: "tw",
      providerId: "tp_system",
    });

    expect(result).toMatchObject({
      success: false,
      error: "COUNTRY_UNAVAILABLE",
    });
    expect(dependencies.createRegion).not.toHaveBeenCalled();
  });

  it("clears old override rules when an override becomes the default rate", async () => {
    const { service, dependencies } = makeService();
    const input = updateTaxRateInputSchema.parse({
      id: rateId,
      taxRegionId: regionId,
      isDefault: true,
    });

    const result = await service.updateRate(input);

    expect(result).toEqual({ success: true, data: { id: rateId } });
    expect(dependencies.updateRate).toHaveBeenCalledWith(
      rateId,
      regionId,
      expect.objectContaining({ isDefault: true, rules: [] }),
    );
  });

  it("rejects an override with no target rules", async () => {
    const { service, dependencies } = makeService();
    dependencies.findRate.mockResolvedValue({ ...rate, rules: [] });
    const input = updateTaxRateInputSchema.parse({
      id: rateId,
      taxRegionId: regionId,
      isDefault: false,
    });

    await expect(service.updateRate(input)).resolves.toMatchObject({
      success: false,
      error: "INVALID_RULES",
    });
  });
});
