import type { ReservationDTO } from "@/lib/inventory/dto/reservation.dto";
import { describe, expect, it, vi } from "vitest";
import {
  handleAdminReservationsRequest,
  type AdminReservationsApiDependencies,
} from "./reservations";

const reservationId = "c31f09f6-8d9b-4f3e-94d8-047bb63376e2";
const itemId = "a1e2d1f5-24bd-4775-b4e6-4404b14eb3fe";
const locationId = "ab09cb0e-89bb-4b48-83d0-e634ad6a6bda";
const now = new Date("2026-09-01T00:00:00.000Z");

const reservation: ReservationDTO = {
  id: reservationId,
  inventoryItemId: itemId,
  inventoryItemTitle: "Shirt",
  inventoryItemSku: "SHIRT-1",
  inventoryItemUnitOfMeasure: "kg",
  locationId,
  locationName: "Taipei",
  quantity: 0.75,
  allowBackorder: false,
  description: "Replacement hold",
  externalId: "RMA-1",
  lineItemId: null,
  cartId: null,
  createdBy: "admin-1",
  expiresAt: null,
  metadata: {},
  createdAt: now,
  updatedAt: now,
  isManual: true,
};

const dependencies = (
  overrides: Partial<AdminReservationsApiDependencies> = {},
): AdminReservationsApiDependencies => ({
  authorize: vi.fn(async () => ({
    allowed: true as const,
    userId: "admin-1",
    role: "admin",
  })),
  listReservations: vi.fn(async () => ({
    reservations: [reservation],
    total: 1,
  })),
  findReservation: vi.fn(async () => reservation),
  createReservation: vi.fn(async () => ({
    success: true as const,
    id: reservationId,
  })),
  updateReservation: vi.fn(async () => ({
    success: true as const,
    id: reservationId,
  })),
  deleteReservation: vi.fn(async () => "deleted" as const),
  ...overrides,
});

describe("Admin reservations API", () => {
  it("lists reservations using Medusa-style names and pagination", async () => {
    const deps = dependencies();
    const response = await handleAdminReservationsRequest(
      new Request(
        "https://shop.test/api/admin/reservations?inventory_item_id=" +
          itemId +
          "&offset=5&limit=10&order=created_at",
      ),
      deps,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      reservations: [
        {
          id: reservationId,
          inventory_item_id: itemId,
          location_id: locationId,
          allow_backorder: false,
          inventory_item: { sku: "SHIRT-1" },
          quantity: 0.75,
          location: { name: "Taipei" },
        },
      ],
      count: 1,
      offset: 5,
      limit: 10,
    });
    expect(deps.listReservations).toHaveBeenCalledWith({
      query: undefined,
      inventoryItemId: itemId,
      locationId: undefined,
      offset: 5,
      limit: 10,
      page: 1,
      sortBy: "createdAt",
      sortOrder: "asc",
    });
  });

  it("creates a manual reservation using snake-case request fields", async () => {
    const deps = dependencies();
    const response = await handleAdminReservationsRequest(
      new Request("https://shop.test/api/admin/reservations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          inventory_item_id: itemId,
          location_id: locationId,
          quantity: 0.5,
          description: "Hold for an exchange",
          external_id: "EX-22",
        }),
      }),
      deps,
    );

    expect(response.status).toBe(201);
    expect(deps.createReservation).toHaveBeenCalledWith(
      expect.objectContaining({
        inventoryItemId: itemId,
        locationId,
        quantity: 0.5,
        description: "Hold for an exchange",
        externalId: "EX-22",
        allowBackorder: false,
      }),
      "admin-1",
    );
  });

  it("updates only supplied reservation fields", async () => {
    const deps = dependencies();
    const response = await handleAdminReservationsRequest(
      new Request(`https://shop.test/api/admin/reservations/${reservationId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ description: "Changed" }),
      }),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.updateReservation).toHaveBeenCalledWith({
      id: reservationId,
      description: "Changed",
    });
  });

  it("does not allow staff accounts to create or delete reservations", async () => {
    const deps = dependencies({
      authorize: vi.fn(async () => ({
        allowed: true as const,
        userId: "staff-1",
        role: "user",
      })),
    });
    const createResponse = await handleAdminReservationsRequest(
      new Request("https://shop.test/api/admin/reservations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          inventory_item_id: itemId,
          location_id: locationId,
          quantity: 1,
        }),
      }),
      deps,
    );
    const deleteResponse = await handleAdminReservationsRequest(
      new Request(`https://shop.test/api/admin/reservations/${reservationId}`, {
        method: "DELETE",
      }),
      deps,
    );

    expect(createResponse.status).toBe(403);
    expect(deleteResponse.status).toBe(403);
    expect(deps.createReservation).not.toHaveBeenCalled();
    expect(deps.deleteReservation).not.toHaveBeenCalled();
  });

  it("does not allow manual edits to cart or order holds", async () => {
    const deps = dependencies({
      updateReservation: vi.fn(async () => ({
        success: false as const,
        reason: "NOT_MANUAL",
      })),
    });
    const response = await handleAdminReservationsRequest(
      new Request(`https://shop.test/api/admin/reservations/${reservationId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quantity: 4 }),
      }),
      deps,
    );

    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: string }).error).toBe(
      "NOT_MANUAL",
    );
  });
});
