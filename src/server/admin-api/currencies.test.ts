import type { CurrencyDTO } from "@/lib/currency/dto/currency.dto";
import type { AdminApiAccess } from "./orders";
import type { AdminCurrenciesApiDependencies } from "./currencies";
import { handleAdminCurrenciesRequest } from "./currencies";
import { describe, expect, it, vi } from "vitest";

const catalog: CurrencyDTO[] = [
  {
    code: "jpy",
    symbol: "¥",
    symbolNative: "￥",
    name: "Japanese Yen",
    decimalDigits: 0,
    rounding: 0,
  },
  {
    code: "twd",
    symbol: "NT$",
    symbolNative: "NT$",
    name: "New Taiwan Dollar",
    decimalDigits: 0,
    rounding: 0,
  },
];

const makeDependencies = () =>
  ({
    authorize: vi.fn(async (_request: Request): Promise<AdminApiAccess> => ({
      allowed: true,
      userId: "admin-1",
      role: "admin",
    })),
    listCurrencies: vi.fn(async () => catalog),
  }) satisfies AdminCurrenciesApiDependencies;

describe("handleAdminCurrenciesRequest", () => {
  it("filters and paginates the ISO currency catalogue with Medusa field names", async () => {
    const dependencies = makeDependencies();
    const response = await handleAdminCurrenciesRequest(
      new Request(
        "https://morph.test/api/admin/currencies?q=dollar&offset=0&limit=1&order=-code",
      ),
      "currencies",
      dependencies,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      currencies: [
        {
          code: "twd",
          symbol: "NT$",
          symbol_native: "NT$",
          name: "New Taiwan Dollar",
          decimal_digits: 0,
          rounding: 0,
        },
      ],
      count: 1,
      offset: 0,
      limit: 1,
    });
  });

  it("retrieves one currency, requires admin access, and rejects writes", async () => {
    const dependencies = makeDependencies();
    const detail = await handleAdminCurrenciesRequest(
      new Request("https://morph.test/api/admin/currencies/TWD"),
      "currencies/TWD",
      dependencies,
    );
    expect(detail.status).toBe(200);
    await expect(detail.json()).resolves.toMatchObject({
      currency: { code: "twd", decimal_digits: 0 },
    });

    dependencies.authorize.mockResolvedValue({
      allowed: true,
      userId: "staff-1",
      role: "user",
    });
    const forbidden = await handleAdminCurrenciesRequest(
      new Request("https://morph.test/api/admin/currencies"),
      "currencies",
      dependencies,
    );
    expect(forbidden.status).toBe(403);

    dependencies.authorize.mockResolvedValue({
      allowed: true,
      userId: "admin-1",
      role: "admin",
    });
    const unsupported = await handleAdminCurrenciesRequest(
      new Request("https://morph.test/api/admin/currencies", {
        method: "POST",
      }),
      "currencies",
      dependencies,
    );
    expect(unsupported.status).toBe(405);
  });
});
