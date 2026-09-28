import type {
  StockLocationDTO,
  StockLocationFulfillmentSetDTO,
} from "@/lib/stock-location/dto/stock-location.dto";
import type { SalesChannelDTO } from "@/lib/sales-channel/dto/sales-channel.dto";
import { describe, expect, it, vi } from "vitest";
import {
  handleAdminStockLocationsRequest,
  type AdminStockLocationsApiDependencies,
} from "./stock-locations";

const locationId = "6fa459ea-ee8a-3ca4-894e-db77e160355e";
const date = new Date("2026-09-27T00:00:00.000Z");
const location: StockLocationDTO = {
  id: locationId,
  name: "Taipei Warehouse",
  address: {
    id: "a4d7a769-5f1b-4adb-9f4f-c1b338ea3505",
    address1: "No. 1, Section 1",
    address2: null,
    company: "Morph",
    city: "Taipei",
    countryCode: "tw",
    province: null,
    postalCode: "100",
    phone: null,
    metadata: {},
  },
  metadata: { region: "north" },
  createdAt: date,
  updatedAt: date,
};
const channel: SalesChannelDTO = {
  id: "a4d7a769-5f1b-4adb-9f4f-c1b338ea3506",
  name: "Online",
  type: "storefront",
  description: null,
  isDisabled: false,
  metadata: {},
  createdAt: date,
  updatedAt: date,
};
const fulfillmentSet: StockLocationFulfillmentSetDTO = {
  id: "a4d7a769-5f1b-4adb-9f4f-c1b338ea3507",
  name: "Taiwan delivery",
  type: "shipping",
  metadata: { source: "manual" },
  createdAt: date,
  updatedAt: date,
};

const dependencies = (
  overrides: Partial<AdminStockLocationsApiDependencies> = {},
): AdminStockLocationsApiDependencies => ({
  authorize: vi.fn(async () => ({
    allowed: true as const,
    userId: "admin-user",
    role: "admin",
  })),
  listLocations: vi.fn(async () => ({ locations: [location], total: 1 })),
  findLocation: vi.fn(async () => location),
  listChannelIds: vi.fn(async () => [channel.id]),
  findSalesChannels: vi.fn(async () => [channel]),
  listFulfillmentProviderIds: vi.fn(async () => ["manual_manual"]),
  listFulfillmentSets: vi.fn(async () => [fulfillmentSet]),
  createLocation: vi.fn(async () => ({
    success: true as const,
    message: "Stock location created",
    data: { id: locationId },
  })),
  updateLocation: vi.fn(async () => ({
    success: true as const,
    message: "Stock location updated",
    data: { id: locationId },
  })),
  deleteLocations: vi.fn(async () => ({
    success: true as const,
    message: "Stock location deleted",
    data: { deleted: 1 },
  })),
  batchSalesChannels: vi.fn(async () => ({
    success: true as const,
    message: "Stock location sales channels updated",
    data: { id: locationId },
  })),
  createFulfillmentSet: vi.fn(async () => ({
    success: true as const,
    message: "Fulfillment set created",
    data: { id: locationId, fulfillmentSetId: fulfillmentSet.id },
  })),
  ...overrides,
});

const json = (response: Response) => response.json() as Promise<unknown>;

describe("Medusa-shaped stock location read API", () => {
  it("returns list pagination and preserves an arbitrary offset", async () => {
    const deps = dependencies();
    const response = await handleAdminStockLocationsRequest(
      new Request(
        "https://morph.test/api/admin/stock-locations?q=Taipei&offset=3&limit=2&order=name",
      ),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.listLocations).toHaveBeenCalledWith({
      query: "Taipei",
      offset: 3,
      limit: 2,
      page: 2,
      sortBy: "name",
      sortOrder: "asc",
    });
    expect(await json(response)).toMatchObject({
      stock_locations: [
        {
          id: locationId,
          name: "Taipei Warehouse",
          address_id: location.address?.id,
          address: { address_1: "No. 1, Section 1", country_code: "tw" },
          metadata: { region: "north" },
        },
      ],
      count: 1,
      offset: 3,
      limit: 2,
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("returns location detail with live channel, provider, and fulfillment-set links", async () => {
    const deps = dependencies();
    const response = await handleAdminStockLocationsRequest(
      new Request(`https://morph.test/api/admin/stock-locations/${locationId}`),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.listChannelIds).toHaveBeenCalledWith(locationId);
    expect(deps.findSalesChannels).toHaveBeenCalledWith([channel.id]);
    expect(await json(response)).toMatchObject({
      stock_location: {
        id: locationId,
        sales_channels: [{ id: channel.id, name: "Online" }],
        fulfillment_providers: [{ id: "manual_manual", is_enabled: true }],
        fulfillment_sets: [
          {
            id: fulfillmentSet.id,
            name: fulfillmentSet.name,
            type: "shipping",
            metadata: { source: "manual" },
            created_at: date.toISOString(),
            updated_at: date.toISOString(),
          },
        ],
      },
    });
  });

  it("rejects invalid queries and IDs without querying storage", async () => {
    const deps = dependencies();
    const invalidList = await handleAdminStockLocationsRequest(
      new Request("https://morph.test/api/admin/stock-locations?limit=500"),
      deps,
    );
    const invalidId = await handleAdminStockLocationsRequest(
      new Request("https://morph.test/api/admin/stock-locations/not-a-uuid"),
      deps,
    );

    expect(invalidList.status).toBe(400);
    expect(invalidId.status).toBe(400);
    expect(deps.listLocations).not.toHaveBeenCalled();
    expect(deps.findLocation).not.toHaveBeenCalled();
  });

  it("requires authorization before any location read", async () => {
    const deps = dependencies({
      authorize: vi.fn(async () => ({
        allowed: false as const,
        status: 403 as const,
        error: "FORBIDDEN" as const,
        message: "Commerce access is not assigned",
      })),
    });
    const response = await handleAdminStockLocationsRequest(
      new Request("https://morph.test/api/admin/stock-locations"),
      deps,
    );

    expect(response.status).toBe(403);
    expect(deps.listLocations).not.toHaveBeenCalled();
    expect(deps.findLocation).not.toHaveBeenCalled();
  });

  it("returns 404 for absent locations and 405 for unsupported methods", async () => {
    const deps = dependencies({ findLocation: vi.fn(async () => null) });
    const missing = await handleAdminStockLocationsRequest(
      new Request(`https://morph.test/api/admin/stock-locations/${locationId}`),
      deps,
    );
    const methodNotAllowed = await handleAdminStockLocationsRequest(
      new Request("https://morph.test/api/admin/stock-locations", {
        method: "PATCH",
      }),
      dependencies(),
    );

    expect(missing.status).toBe(404);
    expect(methodNotAllowed.status).toBe(405);
  });

  it("creates a location using Medusa address fields and returns the resource", async () => {
    const deps = dependencies();
    const response = await handleAdminStockLocationsRequest(
      new Request("https://morph.test/api/admin/stock-locations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Taipei Warehouse",
          address: {
            address_1: "No. 1, Section 1",
            country_code: "TW",
            city: "Taipei",
            metadata: { source: "erp" },
          },
          metadata: { region: "north" },
        }),
      }),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.createLocation).toHaveBeenCalledWith({
      name: "Taipei Warehouse",
      address: {
        address1: "No. 1, Section 1",
        address2: null,
        company: null,
        city: "Taipei",
        countryCode: "tw",
        province: null,
        postalCode: null,
        phone: null,
        metadata: { source: "erp" },
      },
      metadata: { region: "north" },
    });
    expect(await json(response)).toMatchObject({
      stock_location: {
        id: locationId,
        sales_channels: [{ id: channel.id, name: "Online" }],
      },
    });
  });

  it("batches sales-channel links through the Medusa stock-location route", async () => {
    const deps = dependencies();
    const response = await handleAdminStockLocationsRequest(
      new Request(
        `https://morph.test/api/admin/stock-locations/${locationId}/sales-channels`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ add: [channel.id], remove: [] }),
        },
      ),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.batchSalesChannels).toHaveBeenCalledWith({
      locationId,
      add: [channel.id],
      remove: [],
    });
    expect(await json(response)).toMatchObject({
      stock_location: {
        id: locationId,
        sales_channels: [{ id: channel.id, name: "Online" }],
      },
    });
  });

  it("requires administrator access and rejects overlapping channel changes", async () => {
    const deps = dependencies({
      authorize: vi.fn(async () => ({
        allowed: true as const,
        userId: "staff-user",
        role: "staff",
      })),
    });
    const forbidden = await handleAdminStockLocationsRequest(
      new Request(
        `https://morph.test/api/admin/stock-locations/${locationId}/sales-channels`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ add: [channel.id], remove: [] }),
        },
      ),
      deps,
    );
    const invalid = await handleAdminStockLocationsRequest(
      new Request(
        `https://morph.test/api/admin/stock-locations/${locationId}/sales-channels`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ add: [channel.id], remove: [channel.id] }),
        },
      ),
      dependencies(),
    );

    expect(forbidden.status).toBe(403);
    expect(invalid.status).toBe(400);
    expect(deps.batchSalesChannels).not.toHaveBeenCalled();
  });

  it("creates and associates a fulfillment set using the Medusa route shape", async () => {
    const deps = dependencies();
    const response = await handleAdminStockLocationsRequest(
      new Request(
        `https://morph.test/api/admin/stock-locations/${locationId}/fulfillment-sets`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: fulfillmentSet.name,
            type: "shipping",
            metadata: { source: "manual" },
          }),
        },
      ),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.createFulfillmentSet).toHaveBeenCalledWith(locationId, {
      name: fulfillmentSet.name,
      type: "shipping",
      metadata: { source: "manual" },
    });
    expect(await json(response)).toMatchObject({
      stock_location: {
        id: locationId,
        fulfillment_sets: [{ id: fulfillmentSet.id, type: "shipping" }],
      },
    });
  });

  it("requires administrator access and validates fulfillment-set input", async () => {
    const deps = dependencies({
      authorize: vi.fn(async () => ({
        allowed: true as const,
        userId: "staff-user",
        role: "staff",
      })),
    });
    const forbidden = await handleAdminStockLocationsRequest(
      new Request(
        `https://morph.test/api/admin/stock-locations/${locationId}/fulfillment-sets`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Pickup", type: "pickup" }),
        },
      ),
      deps,
    );
    const invalid = await handleAdminStockLocationsRequest(
      new Request(
        `https://morph.test/api/admin/stock-locations/${locationId}/fulfillment-sets`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Pickup", type: "parcel" }),
        },
      ),
      dependencies(),
    );

    expect(forbidden.status).toBe(403);
    expect(invalid.status).toBe(400);
    expect(deps.createFulfillmentSet).not.toHaveBeenCalled();
  });

  it("updates with a partial address patch and deletes using Medusa response shapes", async () => {
    const deps = dependencies();
    const update = await handleAdminStockLocationsRequest(
      new Request(
        `https://morph.test/api/admin/stock-locations/${locationId}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ address: { city: "New Taipei" } }),
        },
      ),
      deps,
    );
    const deletion = await handleAdminStockLocationsRequest(
      new Request(
        `https://morph.test/api/admin/stock-locations/${locationId}`,
        { method: "DELETE" },
      ),
      deps,
    );

    expect(update.status).toBe(200);
    expect(deps.updateLocation).toHaveBeenCalledWith({
      id: locationId,
      address: { city: "New Taipei" },
    });
    expect(await json(deletion)).toEqual({
      id: locationId,
      object: "stock_location",
      deleted: true,
    });
    expect(deps.deleteLocations).toHaveBeenCalledWith([locationId]);
  });

  it("requires an administrator for mutations", async () => {
    const deps = dependencies({
      authorize: vi.fn(async () => ({
        allowed: true as const,
        userId: "staff-user",
        role: "user",
      })),
    });
    const response = await handleAdminStockLocationsRequest(
      new Request("https://morph.test/api/admin/stock-locations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Branch" }),
      }),
      deps,
    );

    expect(response.status).toBe(403);
    expect(deps.createLocation).not.toHaveBeenCalled();
  });
});
