import { createRegionWriteService } from "./region-write.service";
import type { RegionWriteResult } from "./region-write.service";
import { describe, expect, it, vi } from "vitest";

const availableCountry = {
  iso2: "us",
  iso3: null,
  numCode: null,
  name: "United States",
  displayName: "United States",
  regionId: null,
};

const existingRegion = {
  id: "region-1",
  name: "North America",
  currencyCode: "usd",
  automaticTaxes: true,
  isTaxInclusive: false,
  metadata: {},
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

const makeDependencies = () => ({
  ensureCountryCatalog: vi.fn(async () => {}),
  listAssignableCountries: vi.fn(async () => [availableCountry]),
  listEnabledPaymentProviders: vi.fn(async () => [{ id: "manual" }]),
  findById: vi.fn(async () => existingRegion),
  findByIds: vi.fn(async () => [existingRegion]),
  createWithAssociations: vi.fn(async () => {}),
  updateWithAssociations: vi.fn(async () => {}),
  softDelete: vi.fn(async () => {}),
});

describe("regionWriteService", () => {
  it("creates a region and its associations through one shared write path", async () => {
    const dependencies = makeDependencies();
    const service = createRegionWriteService(dependencies, () => "region-new");

    const result = await service.create({
      name: "United States",
      currencyCode: "usd",
      countries: ["us", "us"],
      paymentProviderIds: ["manual", "manual"],
      automaticTaxes: true,
      isTaxInclusive: false,
      metadata: { source: "api" },
    });

    expect(result).toEqual<RegionWriteResult<{ id: string }>>({
      success: true,
      data: { id: "region-new" },
    });
    expect(dependencies.createWithAssociations).toHaveBeenCalledWith({
      id: "region-new",
      name: "United States",
      currencyCode: "usd",
      automaticTaxes: true,
      isTaxInclusive: false,
      metadata: { source: "api" },
      countries: ["us"],
      paymentProviderIds: ["manual"],
    });
  });

  it("does not create a region when a country already belongs to another region", async () => {
    const dependencies = makeDependencies();
    dependencies.listAssignableCountries.mockResolvedValue([]);
    const service = createRegionWriteService(dependencies, () => "region-new");

    const result = await service.create({
      name: "United States",
      currencyCode: "usd",
      countries: ["us"],
      paymentProviderIds: ["manual"],
    });

    expect(result).toMatchObject({
      success: false,
      error: "COUNTRY_TAKEN",
      errors: { countries: ["Already served by another region"] },
    });
    expect(dependencies.createWithAssociations).not.toHaveBeenCalled();
  });

  it("validates provider changes before updating any region fields", async () => {
    const dependencies = makeDependencies();
    dependencies.listEnabledPaymentProviders.mockResolvedValue([]);
    const service = createRegionWriteService(dependencies);

    const result = await service.update({
      id: "region-1",
      name: "Updated name",
      paymentProviderIds: ["unavailable"],
    });

    expect(result).toMatchObject({
      success: false,
      error: "PROVIDER_UNAVAILABLE",
    });
    expect(dependencies.updateWithAssociations).not.toHaveBeenCalled();
  });

  it("writes region fields and association replacements as one aggregate mutation", async () => {
    const dependencies = makeDependencies();
    const service = createRegionWriteService(dependencies);

    const result = await service.update({
      id: "region-1",
      name: "United States",
      countries: ["us"],
      paymentProviderIds: ["manual"],
    });

    expect(result).toEqual({ success: true, data: { id: "region-1" } });
    expect(dependencies.updateWithAssociations).toHaveBeenCalledWith(
      "region-1",
      expect.objectContaining({
        region: expect.objectContaining({ name: "United States" }),
        countries: ["us"],
        paymentProviderIds: ["manual"],
      }),
    );
  });

  it("archives only active matching regions and releases their countries", async () => {
    const dependencies = makeDependencies();
    const service = createRegionWriteService(dependencies);

    const result = await service.deleteMany(["region-1", "missing"]);

    expect(result).toEqual({ success: true, data: { deleted: 1 } });
    expect(dependencies.softDelete).toHaveBeenCalledWith(["region-1"]);
  });
});
