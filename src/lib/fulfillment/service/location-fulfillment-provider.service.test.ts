import { describe, expect, it, vi } from "vitest";
import {
  createLocationFulfillmentProviderService,
  type LocationFulfillmentProviderDependencies,
} from "./location-fulfillment-provider.service";

const providers = [
  { id: "manual_manual", name: "Manual" },
  { id: "parcel_parcel", name: "Parcel" },
];

const dependencies = (
  overrides: Partial<LocationFulfillmentProviderDependencies> = {},
) => ({
  assertConfig: vi.fn(),
  findLocation: vi.fn(async (id: string) => ({ id })),
  listInstalledProviders: vi.fn(() => providers),
  listAssignedProviderIds: vi.fn(async () => ["manual_manual"]),
  setProviderIds: vi.fn(async () => undefined),
  batchProviderIds: vi.fn(async () => undefined),
  ...overrides,
});

describe("location fulfillment provider service", () => {
  it("lists installed providers with their location assignment state", async () => {
    const service = createLocationFulfillmentProviderService(dependencies());
    const result = await service.list("location-1");

    expect(result).toMatchObject({
      success: true,
      data: {
        fulfillmentProviderIds: ["manual_manual"],
        providers: [
          { id: "manual_manual", isAssigned: true },
          { id: "parcel_parcel", isAssigned: false },
        ],
      },
    });
  });

  it("rejects providers that are not installed before writing", async () => {
    const deps = dependencies();
    const service = createLocationFulfillmentProviderService(deps);
    const result = await service.set({
      locationId: "location-1",
      fulfillmentProviderIds: ["uninstalled_provider"],
    });

    expect(result).toMatchObject({ success: false, error: "NOT_FOUND" });
    expect(deps.setProviderIds).not.toHaveBeenCalled();
  });

  it("replaces assignments only after validating the location and installed providers", async () => {
    const deps = dependencies();
    const service = createLocationFulfillmentProviderService(deps);
    const result = await service.set({
      locationId: "location-1",
      fulfillmentProviderIds: ["manual_manual", "parcel_parcel"],
    });

    expect(result).toMatchObject({ success: true, data: { count: 2 } });
    expect(deps.setProviderIds).toHaveBeenCalledWith("location-1", [
      "manual_manual",
      "parcel_parcel",
    ]);
  });

  it("does not write when the location no longer exists", async () => {
    const deps = dependencies({ findLocation: vi.fn(async () => null) });
    const service = createLocationFulfillmentProviderService(deps);
    const result = await service.set({
      locationId: "missing",
      fulfillmentProviderIds: [],
    });

    expect(result).toMatchObject({ success: false, error: "NOT_FOUND" });
    expect(deps.setProviderIds).not.toHaveBeenCalled();
  });

  it("batches provider additions and removals without replacing unrelated links", async () => {
    const deps = dependencies({
      listAssignedProviderIds: vi.fn(async () => ["parcel_parcel"]),
    });
    const service = createLocationFulfillmentProviderService(deps);
    const result = await service.batch({
      locationId: "location-1",
      add: ["parcel_parcel"],
      remove: ["manual_manual"],
    });

    expect(result).toMatchObject({
      success: true,
      data: {
        locationId: "location-1",
        fulfillmentProviderIds: ["parcel_parcel"],
      },
    });
    expect(deps.batchProviderIds).toHaveBeenCalledWith("location-1", {
      add: ["parcel_parcel"],
      remove: ["manual_manual"],
    });
  });

  it("rejects uninstalled providers and overlapping changes before writing", async () => {
    const deps = dependencies();
    const service = createLocationFulfillmentProviderService(deps);

    const unknown = await service.batch({
      locationId: "location-1",
      add: ["uninstalled_provider"],
      remove: [],
    });
    const overlap = await service.batch({
      locationId: "location-1",
      add: ["manual_manual"],
      remove: ["manual_manual"],
    });

    expect(unknown).toMatchObject({ success: false, error: "NOT_FOUND" });
    expect(overlap).toMatchObject({ success: false, error: "INVALID_INPUT" });
    expect(deps.batchProviderIds).not.toHaveBeenCalled();
  });
});
