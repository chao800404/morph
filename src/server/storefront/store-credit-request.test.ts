import { describe, expect, it, vi } from "vitest";
import { handleStoreCreditRequest } from "./store-credit-request";

const account = {
  id: "11111111-1111-4111-8111-111111111111",
  customerId: "22222222-2222-4222-8222-222222222222",
  customerEmail: "buyer@example.test",
  customerName: "Buyer",
  currencyCode: "usd",
  status: "active" as const,
  balance: 2500,
  totalCredits: 3000,
  totalDebits: 500,
  createdAt: new Date("2026-09-27T00:00:00.000Z"),
  updatedAt: new Date("2026-09-27T00:00:00.000Z"),
};

const deps = () => ({
  resolveCustomer: vi.fn(async (): Promise<{ id: string } | null> => ({
    id: account.customerId!,
  })),
  listForCustomer: vi.fn(async () => [account]),
  listTransactions: vi.fn(async () => ({ transactions: [], total: 0 })),
  claim: vi.fn(async () => ({
    success: true as const,
    message: "Claimed",
    data: { account },
  })),
});

describe("storefront store-credit endpoints", () => {
  it("requires a verified customer to list accounts", async () => {
    const dependencies = deps();
    dependencies.resolveCustomer.mockResolvedValue(null);
    const response = await handleStoreCreditRequest(
      "GET",
      "customers/me/store-credit-accounts",
      new Request(
        "https://morph.test/api/store/customers/me/store-credit-accounts",
      ),
      dependencies,
    );

    expect(response?.status).toBe(401);
    expect(dependencies.listForCustomer).not.toHaveBeenCalled();
  });

  it("returns only the authenticated customer's account balances", async () => {
    const dependencies = deps();
    const response = await handleStoreCreditRequest(
      "GET",
      "customers/me/store-credit-accounts",
      new Request(
        "https://morph.test/api/store/customers/me/store-credit-accounts",
      ),
      dependencies,
    );

    expect(response?.status).toBe(200);
    expect(await response?.json()).toMatchObject({
      store_credit_accounts: [
        { id: account.id, balance: 25, currency_code: "usd" },
      ],
    });
    expect(dependencies.listForCustomer).toHaveBeenCalledWith(
      account.customerId,
    );
  });

  it("paginates transactions only after confirming account ownership", async () => {
    const dependencies = deps();
    dependencies.listTransactions.mockResolvedValue({
      transactions: [],
      total: 21,
    });
    const response = await handleStoreCreditRequest(
      "GET",
      `customers/me/store-credit-accounts/${account.id}/transactions`,
      new Request(
        `https://morph.test/api/store/customers/me/store-credit-accounts/${account.id}/transactions?offset=20&limit=10`,
      ),
      dependencies,
    );

    expect(response?.status).toBe(200);
    expect(dependencies.listTransactions).toHaveBeenCalledWith({
      accountId: account.id,
      offset: 20,
      limit: 10,
    });
    expect(await response?.json()).toMatchObject({
      count: 21,
      offset: 20,
      limit: 10,
      transactions: [],
    });
  });

  it("does not expose another customer's transaction ledger", async () => {
    const dependencies = deps();
    dependencies.listForCustomer.mockResolvedValue([]);
    const response = await handleStoreCreditRequest(
      "GET",
      `customers/me/store-credit-accounts/${account.id}/transactions`,
      new Request(
        `https://morph.test/api/store/customers/me/store-credit-accounts/${account.id}/transactions`,
      ),
      dependencies,
    );

    expect(response?.status).toBe(404);
    expect(dependencies.listTransactions).not.toHaveBeenCalled();
  });

  it("claims an account using only the verified customer ID", async () => {
    const dependencies = deps();
    const response = await handleStoreCreditRequest(
      "POST",
      "store-credit-accounts/claim",
      new Request("https://morph.test/api/store/store-credit-accounts/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "a".repeat(64) }),
      }),
      dependencies,
    );

    expect(response?.status).toBe(200);
    expect(dependencies.claim).toHaveBeenCalledWith({
      code: "a".repeat(64),
      customerId: account.customerId,
    });
    expect(await response?.json()).toMatchObject({
      store_credit_account: { id: account.id, balance: 25 },
    });
  });
});
