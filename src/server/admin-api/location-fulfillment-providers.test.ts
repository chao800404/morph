import { describe, expect, it, vi } from "vitest";
import type { StockLocationDTO } from "@/lib/stock-location/dto/stock-location.dto";
import {
  handleAdminLocationFulfillmentProvidersRequest,
  type AdminLocationFulfillmentProvidersDependencies,
} from "./location-fulfillment-providers";

const locationId = "6fa459ea-ee8a-3ca4-894e-db77e160355e";
const updatedAt = new Date("2026-09-27T00:00:00.000Z");

const location: StockLocationDTO = {
  id: locationId,
  name: "Taipei Warehouse",
  address: {
    id: "a4d7a769-5f1b-4adb-9f4f-c1b338ea3505",
    address1: "No. 1, Section 1",
    address2: null,
    company: null,
    city: "Taipei",
    countryCode: "tw",
    province: null,
    postalCode: null,
    phone: null,
    metadata: {},
  },
  metadata: {},
  createdAt: updatedAt,
  updatedAt,
};

type BatchSuccess = Extract<
  Awaited<ReturnType<AdminLocationFulfillmentProvidersDependencies["batch"]>>,
  { success: true }
>;

const dependencies = (
  overrides: Partial<AdminLocationFulfillmentProvidersDependencies> = {},
): AdminLocationFulfillmentProvidersDependencies =>
  ({
    authorize: vi.fn(async () => ({
      allowed: true as const,
      userId: "admin-user",
      role: "admin",
    })),
    findLocation: vi.fn(async () => location),
    batch: vi.fn(
      async () =>
        ({
          success: true as const,
          message: "Fulfillment providers updated",
          data: {
            locationId,
            fulfillmentProviderIds: ["parcel_parcel"],
          },
        }) satisfies BatchSuccess,
    ),
    ...overrides,
  }) as AdminLocationFulfillmentProvidersDependencies;

const json = (response: Response) => response.json() as Promise<unknown>;

describe("Medusa-shaped stock location fulfillment provider API", () => {
  it("applies AdminBatchLink add/remove changes and returns the location", async () => {
    const deps = dependencies();
    const response = await handleAdminLocationFulfillmentProvidersRequest(
      new Request(
        `https://morph.test/api/admin/stock-locations/${locationId}/fulfillment-providers`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            add: ["parcel_parcel"],
            remove: ["manual_manual"],
          }),
        },
      ),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.batch).toHaveBeenCalledWith({
      locationId,
      add: ["parcel_parcel"],
      remove: ["manual_manual"],
    });
    expect(await json(response)).toMatchObject({
      stock_location: {
        id: locationId,
        name: "Taipei Warehouse",
        address_id: location.address?.id,
        fulfillment_providers: [{ id: "parcel_parcel", is_enabled: true }],
      },
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("rejects invalid links before invoking the write service", async () => {
    const deps = dependencies();
    const response = await handleAdminLocationFulfillmentProvidersRequest(
      new Request(
        `https://morph.test/api/admin/stock-locations/${locationId}/fulfillment-providers`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            add: ["manual_manual"],
            remove: ["manual_manual"],
          }),
        },
      ),
      deps,
    );

    expect(response.status).toBe(400);
    expect(deps.batch).not.toHaveBeenCalled();
  });

  it("returns unauthorized responses without reading or mutating the location", async () => {
    const deps = dependencies({
      authorize: vi.fn(async () => ({
        allowed: false as const,
        status: 403 as const,
        error: "FORBIDDEN" as const,
        message: "Commerce access is not assigned",
      })),
    });
    const response = await handleAdminLocationFulfillmentProvidersRequest(
      new Request(
        `https://morph.test/api/admin/stock-locations/${locationId}/fulfillment-providers`,
        { method: "POST", body: JSON.stringify({ add: ["manual_manual"] }) },
      ),
      deps,
    );

    expect(response.status).toBe(403);
    expect(deps.findLocation).not.toHaveBeenCalled();
    expect(deps.batch).not.toHaveBeenCalled();
  });

  it("reports a missing stock location and rejects unsupported methods", async () => {
    const deps = dependencies({ findLocation: vi.fn(async () => null) });
    const missing = await handleAdminLocationFulfillmentProvidersRequest(
      new Request(
        `https://morph.test/api/admin/stock-locations/${locationId}/fulfillment-providers`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ add: ["manual_manual"] }),
        },
      ),
      deps,
    );
    const methodNotAllowed =
      await handleAdminLocationFulfillmentProvidersRequest(
        new Request(
          `https://morph.test/api/admin/stock-locations/${locationId}/fulfillment-providers`,
          { method: "DELETE" },
        ),
        dependencies(),
      );

    expect(missing.status).toBe(404);
    expect(deps.batch).not.toHaveBeenCalled();
    expect(methodNotAllowed.status).toBe(405);
  });
});
