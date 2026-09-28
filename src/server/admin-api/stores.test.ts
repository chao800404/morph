import type {
  StoreAdminDTO,
  StoreAdminUpdateInput,
} from "@/lib/currency/dto/currency.dto";
import { StoreSettingsError } from "@/lib/currency/store-settings-error";
import type { AdminApiAccess } from "./orders";
import type { AdminStoresApiDependencies } from "./stores";
import { handleAdminStoresRequest } from "./stores";
import { describe, expect, it, vi } from "vitest";

const storeId = "default";
const channelId = "550e8400-e29b-41d4-a716-446655440000";
const regionId = "8d5b2394-10bb-4d8b-9a76-4d5bcdba6ea4";
const locationId = "c74a1a31-49d6-4c3f-8ea7-8063a93baf12";

const store: StoreAdminDTO = {
  id: storeId,
  name: "Morph store",
  supportedCurrencies: [
    {
      id: "default_twd",
      currencyCode: "twd",
      storeId,
      isDefault: true,
      isTaxInclusive: false,
      currency: {
        code: "twd",
        symbol: "NT$",
        symbolNative: "NT$",
        name: "New Taiwan Dollar",
        decimalDigits: 0,
        rounding: 0,
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  defaultSalesChannelId: channelId,
  defaultRegionId: null,
  defaultLocationId: null,
  metadata: { origin: "test" },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  supportedLocales: [],
};

const makeDependencies = () => {
  const dependencies = {
    authorize: vi.fn(async (_request: Request): Promise<AdminApiAccess> => ({
      allowed: true,
      userId: "admin-1",
      role: "admin",
    })),
    listStores: vi.fn(async (_input: { offset: number; limit: number }) => ({
      stores: [store],
      count: 1,
    })),
    findStore: vi.fn(
      async (_id: string): Promise<StoreAdminDTO | null> => store,
    ),
    updateStore: vi.fn(async (_id: string, input: StoreAdminUpdateInput) => ({
      ...store,
      ...(input.name !== undefined ? { name: input.name } : {}),
    })),
  } satisfies AdminStoresApiDependencies;
  return dependencies;
};

const jsonRequest = (url: string, body: unknown) =>
  new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("handleAdminStoresRequest", () => {
  it("lists and retrieves the configured store in Medusa response shapes", async () => {
    const dependencies = makeDependencies();
    const listed = await handleAdminStoresRequest(
      new Request("https://morph.test/api/admin/stores?offset=0&limit=5"),
      "stores",
      dependencies,
    );
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toMatchObject({
      count: 1,
      offset: 0,
      limit: 5,
      stores: [
        {
          id: storeId,
          supported_currencies: [
            {
              currency_code: "twd",
              is_default: true,
              currency: { code: "twd", symbol_native: "NT$" },
            },
          ],
          default_sales_channel_id: channelId,
        },
      ],
    });

    const detail = await handleAdminStoresRequest(
      new Request(`https://morph.test/api/admin/stores/${storeId}`),
      `stores/${storeId}`,
      dependencies,
    );
    expect(detail.status).toBe(200);
    await expect(detail.json()).resolves.toMatchObject({
      store: { id: storeId, metadata: { origin: "test" } },
    });
  });

  it("updates store configuration through the shared settings DAL contract", async () => {
    const dependencies = makeDependencies();
    const response = await handleAdminStoresRequest(
      jsonRequest(`https://morph.test/api/admin/stores/${storeId}`, {
        name: "Morph Taiwan",
        supported_currencies: [
          { currency_code: "twd", is_default: true, is_tax_inclusive: true },
        ],
        default_sales_channel_id: channelId,
        default_region_id: regionId,
        default_location_id: locationId,
        metadata: { note: "Taiwan" },
        supported_locales: [
          { locale_code: "zh-TW", is_default: true },
          { locale_code: "en", is_default: false },
        ],
      }),
      `stores/${storeId}`,
      dependencies,
    );

    expect(response.status).toBe(200);
    expect(dependencies.updateStore).toHaveBeenCalledWith(storeId, {
      name: "Morph Taiwan",
      defaultSalesChannelId: channelId,
      defaultRegionId: regionId,
      defaultLocationId: locationId,
      metadata: { note: "Taiwan" },
      supportedCurrencies: [
        { currencyCode: "twd", isDefault: true, isTaxInclusive: true },
      ],
      supportedLocales: [
        { localeCode: "zh-TW", isDefault: true },
        { localeCode: "en", isDefault: false },
      ],
    });
  });

  it("preserves not-found and invalid-state errors and validates the route", async () => {
    const dependencies = makeDependencies();
    dependencies.findStore.mockResolvedValue(null);
    const missing = await handleAdminStoresRequest(
      new Request("https://morph.test/api/admin/stores/missing"),
      "stores/missing",
      dependencies,
    );
    expect(missing.status).toBe(404);

    dependencies.updateStore.mockRejectedValueOnce(
      new StoreSettingsError("CURRENCY_IN_USE", "Currency is in use"),
    );
    const conflict = await handleAdminStoresRequest(
      jsonRequest(`https://morph.test/api/admin/stores/${storeId}`, {
        name: "Morph Taiwan",
      }),
      `stores/${storeId}`,
      dependencies,
    );
    expect(conflict.status).toBe(409);

    const invalid = await handleAdminStoresRequest(
      jsonRequest(`https://morph.test/api/admin/stores/${storeId}`, {
        supported_currencies: [],
      }),
      `stores/${storeId}`,
      dependencies,
    );
    expect(invalid.status).toBe(400);
    expect(dependencies.updateStore).toHaveBeenCalledTimes(1);
  });
});
