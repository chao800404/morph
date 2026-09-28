import { describe, expect, it, vi } from "vitest";
import { handleAdminStoreCreditAccountsRequest } from "./store-credit-accounts";

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
  authorize: vi.fn(async () => ({
    allowed: true as const,
    userId: "admin-1",
    role: "admin",
  })),
  listAccounts: vi.fn(async () => ({ accounts: [account], total: 1 })),
  findAccount: vi.fn(async () => account),
  listTransactions: vi.fn(async () => ({ transactions: [], total: 0 })),
  createAccount: vi.fn(async () => ({
    success: true as const,
    message: "Created",
    data: { account, claimCode: "a".repeat(64) },
  })),
  adjust: vi.fn(async () => ({
    success: true as const,
    message: "Updated",
    data: { account },
  })),
  setStatus: vi.fn(async () => ({
    success: true as const,
    message: "Updated",
    data: { account },
  })),
});

describe("Admin Store Credit Accounts API", () => {
  it("returns a paginated Medusa-shaped account collection", async () => {
    const dependencies = deps();
    const response = await handleAdminStoreCreditAccountsRequest(
      new Request(
        "https://morph.test/api/admin/store-credit-accounts?limit=10",
      ),
      "store-credit-accounts",
      dependencies,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      count: 1,
      limit: 10,
      store_credit_accounts: [
        {
          id: account.id,
          customer_id: account.customerId,
          currency_code: "usd",
          balance: 25,
          total_credits: 30,
          total_debits: 5,
        },
      ],
    });
  });

  it("creates an account and returns the one-time claim code", async () => {
    const dependencies = deps();
    const response = await handleAdminStoreCreditAccountsRequest(
      new Request("https://morph.test/api/admin/store-credit-accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          customer_id: account.customerId,
          currency_code: "usd",
        }),
      }),
      "store-credit-accounts",
      dependencies,
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      claim_code: "a".repeat(64),
      store_credit_account: { id: account.id },
    });
  });

  it("requires idempotency keys for balance mutations", async () => {
    const dependencies = deps();
    const response = await handleAdminStoreCreditAccountsRequest(
      new Request(
        `https://morph.test/api/admin/store-credit-accounts/${account.id}/transactions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "credit", amount: "5.00" }),
        },
      ),
      `store-credit-accounts/${account.id}/transactions`,
      dependencies,
    );

    expect(response.status).toBe(400);
    expect(dependencies.adjust).not.toHaveBeenCalled();
  });

  it("records an authorized adjustment with its idempotency key", async () => {
    const dependencies = deps();
    const response = await handleAdminStoreCreditAccountsRequest(
      new Request(
        `https://morph.test/api/admin/store-credit-accounts/${account.id}/transactions`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": "credit-transaction-001",
          },
          body: JSON.stringify({
            type: "credit",
            amount: "5.00",
            note: "Adjustment",
          }),
        },
      ),
      `store-credit-accounts/${account.id}/transactions`,
      dependencies,
    );

    expect(response.status).toBe(200);
    expect(dependencies.adjust).toHaveBeenCalledWith(
      expect.objectContaining({
        id: account.id,
        type: "credit",
        amount: "5.00",
        actorId: "admin-1",
        idempotencyKey: "credit-transaction-001",
      }),
    );
  });
});
