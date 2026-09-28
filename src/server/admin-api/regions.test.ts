import type {
  RegionDetailDTO,
  RegionSummaryDTO,
} from "@/lib/region/dto/region.dto";
import type { AdminRegionsApiDependencies } from "./regions";
import type { AdminApiAccess } from "./orders";
import { handleAdminRegionsRequest } from "./regions";
import { describe, expect, it, vi } from "vitest";

const regionId = "550e8400-e29b-41d4-a716-446655440000";
const region: RegionDetailDTO = {
  id: regionId,
  name: "United States",
  currencyCode: "usd",
  automaticTaxes: true,
  isTaxInclusive: false,
  metadata: {},
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
  countries: [
    {
      iso2: "us",
      iso3: "usa",
      numCode: "840",
      name: "United States",
      displayName: "United States",
      regionId,
    },
  ],
  paymentProviderIds: ["manual"],
};

const makeDependencies = () => {
  const summary: RegionSummaryDTO = { ...region, countryCount: 1 };
  const dependencies = {
    authorize: vi.fn(async (_request: Request): Promise<AdminApiAccess> => ({
      allowed: true,
      userId: "admin-1",
      role: "admin",
    })),
    listRegions: vi.fn(
      async (
        _input: Parameters<AdminRegionsApiDependencies["listRegions"]>[0],
      ) => ({ regions: [summary], total: 1 }),
    ),
    findRegion: vi.fn(async () => region),
    findRegions: vi.fn(async () => [region]),
    createRegion: vi.fn(async () => ({
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
  } satisfies AdminRegionsApiDependencies;
  return dependencies;
};

describe("handleAdminRegionsRequest", () => {
  it("returns Medusa-style pagination and snake_case relations", async () => {
    const dependencies = makeDependencies();
    const response = await handleAdminRegionsRequest(
      new Request("https://morph.test/api/admin/regions?offset=3&limit=5"),
      "regions",
      dependencies,
    );

    expect(response.status).toBe(200);
    expect(dependencies.listRegions).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 3, limit: 5, page: 1 }),
    );
    await expect(response.json()).resolves.toMatchObject({
      count: 1,
      offset: 3,
      limit: 5,
      regions: [
        {
          id: regionId,
          currency_code: "usd",
          countries: [{ iso_2: "us", iso_3: "usa", region_id: regionId }],
          payment_providers: [{ id: "manual" }],
        },
      ],
    });
  });

  it("creates a region from Medusa-shaped fields and returns 201", async () => {
    const dependencies = makeDependencies();
    const response = await handleAdminRegionsRequest(
      new Request("https://morph.test/api/admin/regions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "United States",
          currency_code: "usd",
          countries: ["us"],
          payment_providers: ["manual"],
          automatic_taxes: true,
          is_tax_inclusive: false,
        }),
      }),
      "regions",
      dependencies,
    );

    expect(response.status).toBe(201);
    expect(dependencies.createRegion).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "United States",
        currencyCode: "usd",
        countries: ["us"],
        paymentProviderIds: ["manual"],
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      region: { id: regionId, currency_code: "usd" },
    });
  });

  it("updates and deletes only after admin authorization", async () => {
    const dependencies = makeDependencies();
    const updateResponse = await handleAdminRegionsRequest(
      new Request(`https://morph.test/api/admin/regions/${regionId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ automatic_taxes: false }),
      }),
      `regions/${regionId}`,
      dependencies,
    );
    expect(updateResponse.status).toBe(200);
    expect(dependencies.updateRegion).toHaveBeenCalledWith({
      id: regionId,
      automaticTaxes: false,
    });

    const deleteResponse = await handleAdminRegionsRequest(
      new Request(`https://morph.test/api/admin/regions/${regionId}`, {
        method: "DELETE",
      }),
      `regions/${regionId}`,
      dependencies,
    );
    expect(deleteResponse.status).toBe(200);
    await expect(deleteResponse.json()).resolves.toEqual({
      id: regionId,
      object: "region",
      deleted: true,
    });
  });

  it("rejects non-admin access before reading region data", async () => {
    const dependencies = makeDependencies();
    dependencies.authorize.mockResolvedValue({
      allowed: true,
      userId: "staff-1",
      role: "staff",
    });
    const response = await handleAdminRegionsRequest(
      new Request("https://morph.test/api/admin/regions"),
      "regions",
      dependencies,
    );

    expect(response.status).toBe(403);
    expect(dependencies.listRegions).not.toHaveBeenCalled();
  });
});
