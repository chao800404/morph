import type { InventoryListItemDTO } from "@/lib/inventory/dto/inventory.dto";
import { describe, expect, it, vi } from "vitest";
import {
  handleAdminInventoryItemsRequest,
  type AdminInventoryItemsApiDependencies,
} from "./inventory-items";

const itemId = "c31f09f6-8d9b-4f3e-94d8-047bb63376e2";
const locationId = "ab09cb0e-89bb-4b48-83d0-e634ad6a6bda";
const secondItemId = "6c9019aa-85d8-47d7-a877-8c762493aa94";
const secondLocationId = "d5a6517d-2ecf-461d-a0aa-f6d3eb7edbce";
const now = new Date("2026-09-01T00:00:00.000Z");

const item: InventoryListItemDTO = {
  id: itemId,
  description: "Soft cotton shirt",
  thumbnail: "https://cdn.example.test/shirt.png",
  unitOfMeasure: "kg",
  requiresShipping: true,
  weight: 250,
  length: null,
  height: null,
  width: null,
  originCountry: "TW",
  hsCode: null,
  midCode: null,
  material: "cotton",
  metadata: { source: "erp" },
  productId: null,
  variantId: null,
  title: "Shirt",
  sku: "SHIRT-1",
  variantCount: 0,
  stockedQuantity: 12,
  reservedQuantity: 3,
  incomingQuantity: 4,
  availableQuantity: 9,
  locationLevels: [
    {
      id: "a7d52c3e-aeeb-4388-9a66-23ebd83a08cc",
      locationId,
      locationName: "Taipei",
      unitOfMeasure: "kg",
      stockedQuantity: 12,
      reservedQuantity: 3,
      incomingQuantity: 4,
      availableQuantity: 9,
      metadata: {},
      createdAt: now,
      updatedAt: now,
    },
  ],
  createdAt: now,
  updatedAt: now,
};

const dependencies = (
  overrides: Partial<AdminInventoryItemsApiDependencies> = {},
): AdminInventoryItemsApiDependencies => ({
  authorize: vi.fn(async () => ({
    allowed: true as const,
    userId: "admin-1",
    role: "admin",
  })),
  listItems: vi.fn(async () => ({ items: [item], total: 1 })),
  findItem: vi.fn(async () => item),
  createItem: vi.fn(async () => ({ success: true as const, id: itemId })),
  updateItem: vi.fn(async () => ({ success: true as const, id: itemId })),
  setLocationLevels: vi.fn(async () => ({
    success: true as const,
    id: itemId,
  })),
  removeLocationLevels: vi.fn(async () => ({
    success: true as const,
    id: itemId,
  })),
  createLocationLevel: vi.fn(async () => ({
    success: true as const,
    id: itemId,
  })),
  updateLocationLevel: vi.fn(async () => ({
    success: true as const,
    id: itemId,
  })),
  batchLocationLevels: vi.fn(async () => ({ success: true as const })),
  archiveItem: vi.fn(async () => "archived" as const),
  ...overrides,
});

describe("Admin inventory items API", () => {
  it("lists inventory items with Medusa field names and location levels", async () => {
    const deps = dependencies();
    const response = await handleAdminInventoryItemsRequest(
      new Request(
        "https://shop.test/api/admin/inventory-items?q=shirt&offset=3&limit=5&order=title",
      ),
      deps,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      inventory_items: [
        {
          id: itemId,
          sku: "SHIRT-1",
          requires_shipping: true,
          unit_of_measure: "kg",
          origin_country: "TW",
          stocked_quantity: 12,
          reserved_quantity: 3,
          available_quantity: 9,
          location_levels: [
            {
              inventory_item_id: itemId,
              location_id: locationId,
              location: { name: "Taipei" },
              incoming_quantity: 4,
            },
          ],
        },
      ],
      count: 1,
      offset: 3,
      limit: 5,
    });
    expect(deps.listItems).toHaveBeenCalledWith({
      query: "shirt",
      offset: 3,
      limit: 5,
      page: 1,
      sortBy: "name",
      sortOrder: "asc",
    });
  });

  it("accepts repeated Medusa filters, nested location filters, and field sorting", async () => {
    const deps = dependencies();
    const params = new URLSearchParams();
    params.append("id", itemId);
    params.append("id[]", secondItemId);
    params.append("sku[]", "SHIRT-1");
    params.append("sku[]", "SHIRT-2");
    params.append("origin_country", "TW");
    params.append("mid_code", "MID-1");
    params.append("hs_code[]", "HS-1");
    params.append("material", "cotton");
    params.append("requires_shipping", "true");
    params.append("location_levels.location_id[]", locationId);
    params.append("location_levels.location_id[]", secondLocationId);
    params.append("order", "-sku");

    const response = await handleAdminInventoryItemsRequest(
      new Request(
        `https://shop.test/api/admin/inventory-items?${params.toString()}`,
      ),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.listItems).toHaveBeenCalledWith({
      ids: [itemId, secondItemId],
      skus: ["SHIRT-1", "SHIRT-2"],
      originCountries: ["TW"],
      midCodes: ["MID-1"],
      hsCodes: ["HS-1"],
      materials: ["cotton"],
      requiresShipping: true,
      locationIds: [locationId, secondLocationId],
      offset: 0,
      limit: 20,
      page: 1,
      sortBy: "sku",
      sortOrder: "desc",
    });
  });

  it("includes soft-deleted inventory items when requested", async () => {
    const deletedAt = new Date("2026-09-15T10:30:00.000Z");
    const deps = dependencies({
      listItems: vi.fn(async () => ({
        items: [{ ...item, deletedAt }],
        total: 1,
      })),
    });
    const response = await handleAdminInventoryItemsRequest(
      new Request(
        "https://shop.test/api/admin/inventory-items?with_deleted=true",
      ),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.listItems).toHaveBeenCalledWith(
      expect.objectContaining({ withDeleted: true }),
    );
    expect(await response.json()).toMatchObject({
      inventory_items: [{ id: itemId, deleted_at: deletedAt.toISOString() }],
    });
  });

  it("retrieves a single inventory item", async () => {
    const deps = dependencies();
    const response = await handleAdminInventoryItemsRequest(
      new Request(`https://shop.test/api/admin/inventory-items/${itemId}`),
      deps,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      inventory_item: { id: itemId, metadata: { source: "erp" } },
    });
    expect(deps.findItem).toHaveBeenCalledWith(itemId);
  });

  it("lists an item's location levels with the Medusa response and pagination shape", async () => {
    const deps = dependencies();
    const response = await handleAdminInventoryItemsRequest(
      new Request(
        `https://shop.test/api/admin/inventory-items/${itemId}/location-levels?location_id=${locationId}&offset=0&limit=10`,
      ),
      deps,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      inventory_levels: [
        {
          id: item.locationLevels[0]?.id,
          inventory_item_id: itemId,
          location_id: locationId,
          stocked_quantity: 12,
          reserved_quantity: 3,
          available_quantity: 9,
        },
      ],
      count: 1,
      offset: 0,
      limit: 10,
    });
  });

  it("filters location levels by multiple locations and sorts by update time", async () => {
    const baseLevel = item.locationLevels[0];
    const newerLevel = {
      ...baseLevel,
      id: "ee9caa77-11ea-46ce-9011-0f4a6a77a8f6",
      locationId: secondLocationId,
      locationName: "Kaohsiung",
      updatedAt: new Date("2026-09-02T00:00:00.000Z"),
    };
    const deps = dependencies({
      findItem: vi.fn(async () => ({
        ...item,
        locationLevels: [baseLevel, newerLevel],
      })),
    });
    const params = new URLSearchParams();
    params.append("location_id", locationId);
    params.append("location_id[]", secondLocationId);
    params.set("order", "-updated_at");

    const response = await handleAdminInventoryItemsRequest(
      new Request(
        `https://shop.test/api/admin/inventory-items/${itemId}/location-levels?${params.toString()}`,
      ),
      deps,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      inventory_levels: [
        { id: newerLevel.id, location_id: secondLocationId },
        { id: baseLevel.id, location_id: locationId },
      ],
      count: 2,
    });
  });

  it("includes deleted location levels when requested", async () => {
    const baseLevel = item.locationLevels[0];
    const deletedAt = new Date("2026-09-20T10:30:00.000Z");
    const deletedLevel = {
      ...baseLevel,
      id: "1a5ef1ec-99c0-4635-8650-e57bf9521a3f",
      createdAt: new Date("2026-09-02T00:00:00.000Z"),
      deletedAt,
    };
    const deps = dependencies({
      findItem: vi.fn(async (_id, options) => ({
        ...item,
        locationLevels: options?.withDeletedLocationLevels
          ? [baseLevel, deletedLevel]
          : [baseLevel],
      })),
    });
    const response = await handleAdminInventoryItemsRequest(
      new Request(
        `https://shop.test/api/admin/inventory-items/${itemId}/location-levels?with_deleted=true`,
      ),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.findItem).toHaveBeenCalledWith(itemId, {
      withDeletedLocationLevels: true,
    });
    expect(await response.json()).toMatchObject({
      inventory_levels: [
        { id: baseLevel.id },
        { id: deletedLevel.id, deleted_at: deletedAt.toISOString() },
      ],
    });
  });

  it("validates location-level filters and returns not found for an absent item", async () => {
    const invalid = await handleAdminInventoryItemsRequest(
      new Request(
        `https://shop.test/api/admin/inventory-items/${itemId}/location-levels?location_id=bad`,
      ),
      dependencies(),
    );
    const missing = await handleAdminInventoryItemsRequest(
      new Request(
        `https://shop.test/api/admin/inventory-items/${itemId}/location-levels`,
      ),
      dependencies({ findItem: vi.fn(async () => null) }),
    );

    expect(invalid.status).toBe(400);
    expect(missing.status).toBe(404);
  });

  it("returns 404 for an item that does not exist", async () => {
    const deps = dependencies({ findItem: vi.fn(async () => null) });
    const response = await handleAdminInventoryItemsRequest(
      new Request(`https://shop.test/api/admin/inventory-items/${itemId}`),
      deps,
    );

    expect(response.status).toBe(404);
  });

  it("requires server-side admin authorization before reading inventory", async () => {
    const deps = dependencies({
      authorize: vi.fn(async () => ({
        allowed: false as const,
        status: 403 as const,
        error: "FORBIDDEN" as const,
        message: "Forbidden",
      })),
    });
    const response = await handleAdminInventoryItemsRequest(
      new Request("https://shop.test/api/admin/inventory-items"),
      deps,
    );

    expect(response.status).toBe(403);
    expect(deps.listItems).not.toHaveBeenCalled();
  });

  it("creates inventory items and accepts Medusa-style field names", async () => {
    const deps = dependencies();
    const response = await handleAdminInventoryItemsRequest(
      new Request("https://shop.test/api/admin/inventory-items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Standalone item",
          sku: "STANDALONE-1",
          unit_of_measure: "kg",
          requires_shipping: false,
          origin_country: "TW",
          location_levels: [
            {
              location_id: locationId,
              stocked_quantity: 7.25,
              incoming_quantity: 2.5,
            },
          ],
        }),
      }),
      deps,
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      inventory_item: { id: itemId, sku: "SHIRT-1" },
    });
    expect(deps.createItem).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Standalone item",
        sku: "STANDALONE-1",
        unitOfMeasure: "kg",
        requiresShipping: false,
        originCountry: "tw",
        locationLevels: [
          {
            locationId,
            stockedQuantity: 7.25,
            incomingQuantity: 2.5,
          },
        ],
      }),
    );
  });

  it("updates inventory item details and reports a stale SKU conflict", async () => {
    const deps = dependencies({
      updateItem: vi.fn(async () => ({
        success: false as const,
        reason: "SKU_CONFLICT" as const,
      })),
    });
    const response = await handleAdminInventoryItemsRequest(
      new Request(`https://shop.test/api/admin/inventory-items/${itemId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ description: "Updated description" }),
      }),
      deps,
    );

    expect(response.status).toBe(409);
    expect(deps.updateItem).toHaveBeenCalledWith(itemId, {
      description: "Updated description",
    });
  });

  it("manages location levels without replacing omitted locations", async () => {
    const deps = dependencies();
    const response = await handleAdminInventoryItemsRequest(
      new Request(
        `https://shop.test/api/admin/inventory-items/${itemId}/location-levels`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            location_levels: [
              { location_id: locationId, stocked_quantity: 15.25 },
            ],
          }),
        },
      ),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.setLocationLevels).toHaveBeenCalledWith(itemId, [
      { locationId, stockedQuantity: 15.25 },
    ]);
  });

  it("creates one location level through the Medusa-shaped endpoint", async () => {
    const deps = dependencies();
    const response = await handleAdminInventoryItemsRequest(
      new Request(
        `https://shop.test/api/admin/inventory-items/${itemId}/location-levels`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            location_id: locationId,
            stocked_quantity: 8,
            incoming_quantity: 2,
          }),
        },
      ),
      deps,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      inventory_item: { id: itemId },
    });
    expect(deps.createLocationLevel).toHaveBeenCalledWith({
      inventoryItemId: itemId,
      locationId,
      stockedQuantity: 8,
      incomingQuantity: 2,
    });
    expect(deps.setLocationLevels).not.toHaveBeenCalled();
  });

  it("updates a location level using only the supplied quantities", async () => {
    const deps = dependencies();
    const response = await handleAdminInventoryItemsRequest(
      new Request(
        `https://shop.test/api/admin/inventory-items/${itemId}/location-levels/${locationId}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ incoming_quantity: 6 }),
        },
      ),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.updateLocationLevel).toHaveBeenCalledWith(itemId, locationId, {
      incomingQuantity: 6,
    });
  });

  it("deletes a location level with the Medusa deletion response shape", async () => {
    const deps = dependencies();
    const response = await handleAdminInventoryItemsRequest(
      new Request(
        `https://shop.test/api/admin/inventory-items/${itemId}/location-levels/${locationId}`,
        { method: "DELETE" },
      ),
      deps,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: item.locationLevels[0]?.id,
      object: "inventory_level",
      deleted: true,
      parent: { id: itemId },
    });
    expect(deps.removeLocationLevels).toHaveBeenCalledWith(itemId, [
      locationId,
    ]);
  });

  it("batches create, update, and delete for one inventory item", async () => {
    const deps = dependencies();
    const newLocationId = "de9fcce3-4ab3-40f8-994a-2d13f801a5a2";
    const levelId = item.locationLevels[0]?.id ?? "";
    const response = await handleAdminInventoryItemsRequest(
      new Request(
        `https://shop.test/api/admin/inventory-items/${itemId}/location-levels/batch`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            create: [{ location_id: newLocationId, stocked_quantity: 4 }],
            update: [{ id: levelId, incoming_quantity: 7 }],
            delete: ["bc9923e1-0541-4fb1-a299-91360472346b"],
          }),
        },
      ),
      deps,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
    expect(deps.batchLocationLevels).toHaveBeenCalledWith({
      inventoryItemId: itemId,
      creates: [
        {
          locationId: newLocationId,
          stockedQuantity: 4,
          incomingQuantity: 0,
        },
      ],
      updates: [{ id: levelId, incomingQuantity: 7 }],
      deleteIds: ["bc9923e1-0541-4fb1-a299-91360472346b"],
      force: false,
    });
  });

  it("batches location levels across inventory items", async () => {
    const deps = dependencies();
    const response = await handleAdminInventoryItemsRequest(
      new Request(
        "https://shop.test/api/admin/inventory-items/location-levels/batch",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            create: [
              {
                inventory_item_id: itemId,
                location_id: locationId,
                stocked_quantity: 9,
              },
            ],
          }),
        },
      ),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.batchLocationLevels).toHaveBeenCalledWith({
      creates: [
        {
          inventoryItemId: itemId,
          locationId,
          stockedQuantity: 9,
          incomingQuantity: 0,
        },
      ],
      updates: [],
      deleteIds: [],
      force: false,
    });
  });

  it("removes empty location levels and deletes unused inventory items", async () => {
    const deps = dependencies();
    const removeResponse = await handleAdminInventoryItemsRequest(
      new Request(
        `https://shop.test/api/admin/inventory-items/${itemId}/location-levels`,
        {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ location_ids: [locationId] }),
        },
      ),
      deps,
    );
    const deleteResponse = await handleAdminInventoryItemsRequest(
      new Request(`https://shop.test/api/admin/inventory-items/${itemId}`, {
        method: "DELETE",
      }),
      deps,
    );

    expect(removeResponse.status).toBe(200);
    expect(deps.removeLocationLevels).toHaveBeenCalledWith(itemId, [
      locationId,
    ]);
    expect(deleteResponse.status).toBe(200);
    expect(await deleteResponse.json()).toMatchObject({ deleted: true });
    expect(deps.archiveItem).toHaveBeenCalledWith(itemId);
  });

  it("restricts inventory writes to administrators", async () => {
    const deps = dependencies({
      authorize: vi.fn(async () => ({
        allowed: true as const,
        userId: "staff-1",
        role: "user",
      })),
    });
    const response = await handleAdminInventoryItemsRequest(
      new Request("https://shop.test/api/admin/inventory-items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "No permission" }),
      }),
      deps,
    );

    expect(response.status).toBe(403);
    expect(deps.createItem).not.toHaveBeenCalled();
  });

  it("rejects unsupported query parameters and methods", async () => {
    const deps = dependencies();
    const invalidQuery = await handleAdminInventoryItemsRequest(
      new Request("https://shop.test/api/admin/inventory-items?limit=1000"),
      deps,
    );
    const unsupportedMethod = await handleAdminInventoryItemsRequest(
      new Request("https://shop.test/api/admin/inventory-items", {
        method: "PUT",
      }),
      deps,
    );

    expect(invalidQuery.status).toBe(400);
    expect(unsupportedMethod.status).toBe(405);
    expect(deps.listItems).not.toHaveBeenCalled();
  });
});
