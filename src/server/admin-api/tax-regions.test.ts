import type {
  TaxRateDTO,
  TaxRegionDTO,
  TaxRegionSummaryDTO,
} from "@/lib/tax/dto/tax.dto";
import type { AdminTaxRegionsApiDependencies } from "./tax-regions";
import type { AdminApiAccess } from "./orders";
import { handleAdminTaxRegionsRequest } from "./tax-regions";
import { describe, expect, it, vi } from "vitest";

const regionId = "550e8400-e29b-41d4-a716-446655440000";
const rateId = "8d5b2394-10bb-4d8b-9a76-4d5bcdba6ea4";
const taxRegion: TaxRegionDTO = {
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
const taxRate: TaxRateDTO = {
  id: rateId,
  taxRegionId: regionId,
  rate: 5,
  code: "vat",
  name: "VAT",
  isDefault: true,
  isCombinable: false,
  metadata: {},
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
  rules: [],
};

const makeDependencies = () => {
  const summary: TaxRegionSummaryDTO = {
    ...taxRegion,
    provinceCount: 0,
    taxRateCount: 1,
  };
  const dependencies = {
    authorize: vi.fn(async (_request: Request): Promise<AdminApiAccess> => ({
      allowed: true,
      userId: "admin-1",
      role: "admin",
    })),
    listProviders: vi.fn(async () => [{ id: "tp_system" }]),
    listRegions: vi.fn(
      async (
        _input: Parameters<AdminTaxRegionsApiDependencies["listRegions"]>[0],
      ) => ({
        taxRegions: [summary],
        total: 1,
      }),
    ),
    findRegion: vi.fn(async () => taxRegion),
    listRatesForRegionIds: vi.fn(async () => [taxRate]),
    listRates: vi.fn(
      async (
        _input: Parameters<AdminTaxRegionsApiDependencies["listRates"]>[0],
      ) => ({
        taxRates: [taxRate],
        total: 1,
      }),
    ),
    findRate: vi.fn(async () => taxRate),
    createRegion: vi.fn(async () => ({
      success: true as const,
      data: { id: regionId },
    })),
    createProvince: vi.fn(async () => ({
      success: true as const,
      data: { id: regionId },
    })),
    updateRegion: vi.fn(async () => ({
      success: true as const,
      data: { id: regionId },
    })),
    deleteRegions: vi.fn(async () => ({
      success: true as const,
      data: { deleted: 1 },
    })),
    createRate: vi.fn(async () => ({
      success: true as const,
      data: { id: rateId },
    })),
    updateRate: vi.fn(async () => ({
      success: true as const,
      data: { id: rateId },
    })),
    deleteRates: vi.fn(async () => ({
      success: true as const,
      data: { deleted: 1 },
    })),
  } satisfies AdminTaxRegionsApiDependencies;
  return dependencies;
};

describe("handleAdminTaxRegionsRequest", () => {
  it("lists registered tax providers as read-only API resources", async () => {
    const dependencies = makeDependencies();
    const response = await handleAdminTaxRegionsRequest(
      new Request("https://morph.test/api/admin/tax-providers?limit=1"),
      "tax-providers",
      dependencies,
    );

    expect(response.status).toBe(200);
    expect(dependencies.listProviders).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toMatchObject({
      count: 1,
      limit: 1,
      tax_providers: [{ id: "tp_system", is_enabled: true }],
    });
  });

  it("lists regions with Medusa pagination and snake_case fields", async () => {
    const dependencies = makeDependencies();
    const response = await handleAdminTaxRegionsRequest(
      new Request(
        "https://morph.test/api/admin/tax-regions?country_code=tw&offset=2&limit=5",
      ),
      "tax-regions",
      dependencies,
    );

    expect(response.status).toBe(200);
    expect(dependencies.listRegions).toHaveBeenCalledWith(
      expect.objectContaining({
        countryCode: "tw",
        offset: 2,
        limit: 5,
        page: 1,
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      count: 1,
      offset: 2,
      limit: 5,
      tax_regions: [
        { id: regionId, country_code: "tw", provider_id: "tp_system" },
      ],
    });
  });

  it("creates a province tax region from Medusa-shaped fields", async () => {
    const dependencies = makeDependencies();
    const response = await handleAdminTaxRegionsRequest(
      new Request("https://morph.test/api/admin/tax-regions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          parent_id: regionId,
          province_code: "tn",
          default_tax_rate: {
            name: "Provincial tax",
            code: "province",
            rate: 2,
          },
        }),
      }),
      "tax-regions",
      dependencies,
    );

    expect(response.status).toBe(201);
    expect(dependencies.createProvince).toHaveBeenCalledWith(
      {
        parentId: regionId,
        provinceCode: "TN",
        defaultTaxRate: {
          name: "Provincial tax",
          code: "province",
          rate: 2,
          isCombinable: false,
        },
      },
      "admin-1",
    );
    await expect(response.json()).resolves.toMatchObject({
      tax_region: {
        id: regionId,
        country_code: "tw",
        tax_rates: [{ is_default: true }],
      },
    });
  });

  it("creates and lists tax rates with rule references converted to snake_case", async () => {
    const dependencies = makeDependencies();
    const createResponse = await handleAdminTaxRegionsRequest(
      new Request("https://morph.test/api/admin/tax-rates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tax_region_id: regionId,
          name: "VAT",
          code: "vat",
          rate: 5,
          is_default: true,
        }),
      }),
      "tax-rates",
      dependencies,
    );
    expect(createResponse.status).toBe(201);
    await expect(createResponse.json()).resolves.toMatchObject({
      tax_rate: { id: rateId, tax_region_id: regionId, is_default: true },
    });

    const listResponse = await handleAdminTaxRegionsRequest(
      new Request(
        `https://morph.test/api/admin/tax-rates?tax_region_id=${regionId}`,
      ),
      "tax-rates",
      dependencies,
    );
    await expect(listResponse.json()).resolves.toMatchObject({
      count: 1,
      tax_rates: [{ id: rateId, tax_region_id: regionId, is_default: true }],
    });
  });

  it("updates and deletes only after admin authorization", async () => {
    const dependencies = makeDependencies();
    const updateResponse = await handleAdminTaxRegionsRequest(
      new Request(`https://morph.test/api/admin/tax-regions/${regionId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider_id: "tp_system" }),
      }),
      `tax-regions/${regionId}`,
      dependencies,
    );
    expect(updateResponse.status).toBe(200);
    expect(dependencies.updateRegion).toHaveBeenCalledWith({
      id: regionId,
      providerId: "tp_system",
      metadata: undefined,
    });

    const deleteResponse = await handleAdminTaxRegionsRequest(
      new Request(`https://morph.test/api/admin/tax-rates/${rateId}`, {
        method: "DELETE",
      }),
      `tax-rates/${rateId}`,
      dependencies,
    );
    expect(deleteResponse.status).toBe(200);
    await expect(deleteResponse.json()).resolves.toEqual({
      id: rateId,
      object: "tax_rate",
      deleted: true,
    });
  });

  it("rejects non-admin access before reading or mutating tax data", async () => {
    const dependencies = makeDependencies();
    dependencies.authorize.mockResolvedValue({
      allowed: true,
      userId: "staff-1",
      role: "staff",
    });
    const response = await handleAdminTaxRegionsRequest(
      new Request("https://morph.test/api/admin/tax-regions"),
      "tax-regions",
      dependencies,
    );

    expect(response.status).toBe(403);
    expect(dependencies.listRegions).not.toHaveBeenCalled();
  });
});
