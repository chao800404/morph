import { describe, expect, it, vi } from "vitest";
import type { ShippingOptionTypeDTO } from "@/lib/shipping/dto/shipping-option-type.dto";
import type { ShippingProfileDTO } from "@/lib/shipping/dto/shipping-profile.dto";
import {
  handleAdminShippingConfigurationRequest,
  type AdminShippingConfigurationApiDependencies,
} from "./shipping-configuration";

const profileId = "6fa459ea-ee8a-3ca4-894e-db77e160355e";
const optionTypeId = "a4d7a769-5f1b-4adb-9f4f-c1b338ea3505";
const updatedAt = "2026-09-27T00:00:00.000Z";

const profile: ShippingProfileDTO = {
  id: profileId,
  name: "Standard parcels",
  type: "custom",
  productCount: 3,
  shippingOptionCount: 2,
  createdAt: updatedAt,
  updatedAt,
};

const optionType: ShippingOptionTypeDTO = {
  id: optionTypeId,
  label: "Home delivery",
  code: "home_delivery",
  description: null,
  shippingOptionCount: 2,
  createdAt: updatedAt,
  updatedAt,
};

const dependencies = (
  overrides: Partial<AdminShippingConfigurationApiDependencies> = {},
): AdminShippingConfigurationApiDependencies => ({
  authorize: vi.fn(async () => ({
    allowed: true as const,
    userId: "admin-user",
    role: "admin",
  })),
  listProfiles: vi.fn(async () => ({ profiles: [profile], total: 1 })),
  findProfile: vi.fn(async () => profile),
  createProfile: vi.fn(async () => ({
    success: true as const,
    message: "Shipping profile created successfully",
    data: { id: profileId },
  })),
  updateProfile: vi.fn(async () => ({
    success: true as const,
    message: "Shipping profile updated successfully",
    data: { id: profileId },
  })),
  deleteProfile: vi.fn(async () => ({
    success: true as const,
    message: "Shipping profile deleted",
    data: { id: profileId },
  })),
  listTypes: vi.fn(async () => ({ types: [optionType], total: 1 })),
  findType: vi.fn(async () => optionType),
  createType: vi.fn(async () => ({
    success: true as const,
    message: "Shipping option type created successfully",
    data: { id: optionTypeId },
  })),
  updateType: vi.fn(async () => ({
    success: true as const,
    message: "Shipping option type updated successfully",
    data: { id: optionTypeId },
  })),
  deleteType: vi.fn(async () => ({
    success: true as const,
    message: "Shipping option type deactivated",
    data: { id: optionTypeId },
  })),
  ...overrides,
});

const json = (response: Response) => response.json() as Promise<unknown>;

describe("Medusa-shaped Admin shipping configuration API", () => {
  it("lists shipping profiles with URL pagination and snake_case fields", async () => {
    const deps = dependencies();
    const response = await handleAdminShippingConfigurationRequest(
      new Request(
        "https://morph.test/api/admin/shipping-profiles?q=parcel&offset=20&limit=10&order=name",
      ),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.listProfiles).toHaveBeenCalledWith({
      query: "parcel",
      limit: 10,
      page: 3,
      sortBy: "name",
      sortOrder: "asc",
    });
    expect(await json(response)).toEqual({
      shipping_profiles: [
        {
          id: profileId,
          name: "Standard parcels",
          type: "custom",
          products_count: 3,
          shipping_options_count: 2,
          created_at: updatedAt,
          updated_at: updatedAt,
        },
      ],
      count: 1,
      offset: 20,
      limit: 10,
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("creates a custom shipping profile through the shared write service", async () => {
    const deps = dependencies();
    const response = await handleAdminShippingConfigurationRequest(
      new Request("https://morph.test/api/admin/shipping-profiles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Oversize", type: "custom" }),
      }),
      deps,
    );

    expect(response.status).toBe(201);
    expect(deps.createProfile).toHaveBeenCalledWith({
      name: "Oversize",
      type: "custom",
    });
    expect(await json(response)).toEqual({
      shipping_profile: { id: profileId },
    });
  });

  it("rejects malformed input before calling a shipping write", async () => {
    const deps = dependencies();
    const response = await handleAdminShippingConfigurationRequest(
      new Request(
        `https://morph.test/api/admin/shipping-profiles/${profileId}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "unexpected", ignored: true }),
        },
      ),
      deps,
    );

    expect(response.status).toBe(400);
    expect(deps.updateProfile).not.toHaveBeenCalled();
  });

  it("uses updated_at as the compare-and-set token when updating an option type", async () => {
    const deps = dependencies();
    const response = await handleAdminShippingConfigurationRequest(
      new Request(
        `https://morph.test/api/admin/shipping-option-types/${optionTypeId}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            label: "Home delivery TW",
            updated_at: updatedAt,
          }),
        },
      ),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.updateType).toHaveBeenCalledWith({
      id: optionTypeId,
      expectedUpdatedAt: updatedAt,
      label: "Home delivery TW",
      code: undefined,
      description: undefined,
    });
  });

  it("requires the current updated_at token before deactivating an option type", async () => {
    const deps = dependencies();
    const response = await handleAdminShippingConfigurationRequest(
      new Request(
        `https://morph.test/api/admin/shipping-option-types/${optionTypeId}`,
        { method: "DELETE" },
      ),
      deps,
    );

    expect(response.status).toBe(400);
    expect(deps.deleteType).not.toHaveBeenCalled();
  });

  it("maps stale writes and in-use profile deletes to conflicts", async () => {
    const stale = dependencies({
      updateType: vi.fn(async () => ({
        success: false as const,
        message: "Reload and try again",
        error: "CONFLICT",
      })),
      deleteProfile: vi.fn(async () => ({
        success: false as const,
        message: "The shipping profile is still in use",
        error: "PROFILE_IN_USE",
      })),
    });
    const updateResponse = await handleAdminShippingConfigurationRequest(
      new Request(
        `https://morph.test/api/admin/shipping-option-types/${optionTypeId}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            code: "home_delivery_tw",
            updated_at: updatedAt,
          }),
        },
      ),
      stale,
    );
    const deleteResponse = await handleAdminShippingConfigurationRequest(
      new Request(
        `https://morph.test/api/admin/shipping-profiles/${profileId}`,
        {
          method: "DELETE",
        },
      ),
      stale,
    );

    expect(updateResponse.status).toBe(409);
    expect(deleteResponse.status).toBe(409);
  });

  it("requires commerce authorization and rejects unknown routes", async () => {
    const denied = dependencies({
      authorize: vi.fn(async () => ({
        allowed: false as const,
        status: 403 as const,
        error: "FORBIDDEN" as const,
        message: "Forbidden",
      })),
    });
    const deniedResponse = await handleAdminShippingConfigurationRequest(
      new Request("https://morph.test/api/admin/shipping-profiles"),
      denied,
    );
    expect(deniedResponse.status).toBe(403);
    expect(denied.listProfiles).not.toHaveBeenCalled();

    const deps = dependencies();
    const missing = await handleAdminShippingConfigurationRequest(
      new Request("https://morph.test/api/admin/fulfillment-sets"),
      deps,
    );
    expect(missing.status).toBe(404);
  });
});
