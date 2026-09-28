import type { StockLocationDTO } from "@/lib/stock-location/dto/stock-location.dto";
import { StockLocationShippingInUseError } from "@/lib/stock-location/dal/stock-location.dal";
import { stockLocationDal } from "@/lib/stock-location/dal/stock-location.dal";
import { updateStockLocationInputSchema } from "@/lib/validations/stock-location";
import { describe, expect, it, vi } from "vitest";
import { createStockLocationWriteService } from "./stock-location-write.service";

const locationId = "6fa459ea-ee8a-3ca4-894e-db77e160355e";
const addressId = "a4d7a769-5f1b-4adb-9f4f-c1b338ea3505";
const oldDate = new Date("2026-09-27T00:00:00.000Z");
const location: StockLocationDTO = {
  id: locationId,
  name: "Taipei Warehouse",
  address: {
    id: addressId,
    address1: "No. 1, Section 1",
    address2: null,
    company: "Morph",
    city: "Taipei",
    countryCode: "tw",
    province: null,
    postalCode: "100",
    phone: null,
    metadata: { source: "manual", legacy: "keep" },
  },
  metadata: { old: "remove", keep: "yes" },
  createdAt: oldDate,
  updatedAt: oldDate,
};

const dependencies = (
  overrides: Partial<
    Parameters<typeof createStockLocationWriteService>[0]
  > = {},
) => {
  const dal = {
    findById: vi.fn(async () => location),
    findByName: vi.fn(async () => null),
    findByIds: vi.fn(async () => [location]),
    create: vi.fn(async () => undefined),
    update: vi.fn(async () => true),
    batchChannels: vi.fn(async () => true),
    findFulfillmentSetByName: vi.fn(async () => null),
    createFulfillmentSet: vi.fn(async () => true),
    softDelete: vi.fn(async () => undefined),
  };
  return {
    dal: dal as unknown as typeof stockLocationDal,
    createId: vi.fn(() => locationId),
    ...overrides,
  };
};

describe("stock location write service", () => {
  it("merges metadata patches and address fields before an OCC update", async () => {
    const deps = dependencies();
    const service = createStockLocationWriteService(deps);
    const result = await service.update(
      updateStockLocationInputSchema.parse({
        id: locationId,
        address: { city: "New Taipei", metadata: { source: "erp" } },
        metadata: { old: "", added: "value" },
      }),
    );

    expect(result).toMatchObject({ success: true, data: { id: locationId } });
    expect(deps.dal.update).toHaveBeenCalledWith(
      locationId,
      {
        address: {
          address1: "No. 1, Section 1",
          address2: null,
          company: "Morph",
          city: "New Taipei",
          countryCode: "tw",
          province: null,
          postalCode: "100",
          phone: null,
          metadata: { source: "erp", legacy: "keep" },
        },
        metadata: { keep: "yes", added: "value" },
      },
      oldDate.toISOString(),
    );
  });

  it("returns conflict when the DAL rejects a stale update revision", async () => {
    const newer = { ...location, updatedAt: new Date(oldDate.getTime() + 1) };
    const deps = dependencies();
    const dal = deps.dal as unknown as {
      findById: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    dal.findById.mockResolvedValueOnce(location).mockResolvedValueOnce(newer);
    dal.update.mockResolvedValueOnce(false);

    const result = await createStockLocationWriteService(deps).update(
      updateStockLocationInputSchema.parse({ id: locationId, name: "Updated" }),
    );

    expect(result).toMatchObject({ success: false, error: "CONFLICT" });
  });

  it("rejects adding an address without its required street and country", async () => {
    const noAddress = { ...location, address: null };
    const deps = dependencies();
    const dal = deps.dal as unknown as { findById: ReturnType<typeof vi.fn> };
    dal.findById.mockResolvedValue(noAddress);

    const result = await createStockLocationWriteService(deps).update(
      updateStockLocationInputSchema.parse({
        id: locationId,
        address: { city: "Taipei" },
      }),
    );

    expect(result).toMatchObject({ success: false, error: "INVALID_INPUT" });
    expect(deps.dal.update).not.toHaveBeenCalled();
  });

  it("returns a conflict when an active cart uses this location's shipping", async () => {
    const deps = dependencies();
    const dal = deps.dal as unknown as {
      softDelete: ReturnType<typeof vi.fn>;
    };
    dal.softDelete.mockRejectedValue(new StockLocationShippingInUseError());

    const result = await createStockLocationWriteService(deps).deleteMany([
      locationId,
    ]);

    expect(result).toMatchObject({ success: false, error: "CONFLICT" });
    expect(result.message).toContain("active carts");
  });

  it("uses the DAL batch link operation for sales-channel changes", async () => {
    const deps = dependencies();
    const result = await createStockLocationWriteService(
      deps,
    ).batchSalesChannels({
      locationId,
      add: ["sales-channel-1"],
      remove: ["sales-channel-2"],
    });

    expect(result).toMatchObject({ success: true, data: { id: locationId } });
    expect(deps.dal.batchChannels).toHaveBeenCalledWith(
      locationId,
      ["sales-channel-1"],
      ["sales-channel-2"],
    );
  });

  it("creates a fulfillment set through the DAL and reports its ID", async () => {
    const deps = dependencies();
    const service = createStockLocationWriteService(deps);
    const result = await service.createFulfillmentSet(locationId, {
      name: "Taiwan delivery",
      type: "shipping",
      metadata: { source: "manual" },
    });

    expect(result).toMatchObject({
      success: true,
      data: { id: locationId, fulfillmentSetId: locationId },
    });
    expect(deps.dal.createFulfillmentSet).toHaveBeenCalledWith({
      id: locationId,
      locationId,
      name: "Taiwan delivery",
      type: "shipping",
      metadata: { source: "manual" },
    });
  });

  it("rejects duplicate fulfillment set names before writing", async () => {
    const deps = dependencies();
    const dal = deps.dal as unknown as {
      findFulfillmentSetByName: ReturnType<typeof vi.fn>;
      createFulfillmentSet: ReturnType<typeof vi.fn>;
    };
    dal.findFulfillmentSetByName.mockResolvedValue({ id: "existing-set" });
    const result = await createStockLocationWriteService(
      deps,
    ).createFulfillmentSet(locationId, {
      name: "Taiwan delivery",
      type: "shipping",
    });

    expect(result).toMatchObject({ success: false, error: "DUPLICATE_NAME" });
    expect(dal.createFulfillmentSet).not.toHaveBeenCalled();
  });

  it("reports a missing stock location when the DAL guard rejects the write", async () => {
    const deps = dependencies();
    const dal = deps.dal as unknown as {
      createFulfillmentSet: ReturnType<typeof vi.fn>;
      findById: ReturnType<typeof vi.fn>;
    };
    dal.createFulfillmentSet.mockResolvedValue(false);

    const result = await createStockLocationWriteService(
      deps,
    ).createFulfillmentSet(locationId, { name: "Pickup", type: "pickup" });

    expect(result).toMatchObject({ success: false, error: "NOT_FOUND" });
  });
});
