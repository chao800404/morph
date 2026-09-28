import { describe, expect, it, vi } from "vitest";
import type { CartDTO } from "@/lib/cart/dto/cart.dto";
import { createStoreCreditWriteService } from "./store-credit-write.service";

const account = {
  id: "11111111-1111-4111-8111-111111111111",
  customerId: "22222222-2222-4222-8222-222222222222",
  customerEmail: "buyer@example.test",
  customerName: "Buyer",
  currencyCode: "usd",
  status: "active" as const,
  balance: 12550,
  totalCredits: 15000,
  totalDebits: 2450,
  createdAt: new Date("2026-09-27T00:00:00.000Z"),
  updatedAt: new Date("2026-09-27T00:00:00.000Z"),
};

const cart: CartDTO = {
  id: "33333333-3333-4333-8333-333333333333",
  regionId: "region_1",
  salesChannelId: "channel_1",
  currencyCode: "usd",
  locale: "en-US",
  email: "buyer@example.test",
  shippingAddress: null,
  billingAddress: null,
  completedAt: null,
  items: [],
  shippingMethods: [],
  promotions: [],
  itemSubtotal: 10_000,
  itemDiscountTotal: 0,
  itemTaxTotal: 0,
  shippingSubtotal: 0,
  shippingDiscountTotal: 0,
  shippingTaxTotal: 0,
  creditTotal: 0,
  subtotal: 10_000,
  discountTotal: 0,
  taxTotal: 0,
  totalBeforeCredits: 10_000,
  total: 10_000,
  createdAt: "2026-09-27T00:00:00.000Z",
  updatedAt: "2026-09-27T00:00:00.000Z",
};

const dependencies = (overrides: Record<string, unknown> = {}) => ({
  findCustomer: vi.fn(async () => ({ id: account.customerId })),
  findAccount: vi.fn(async () => account),
  createAccount: vi.fn(async () => "created" as const),
  adjustBalance: vi.fn(async () => "updated" as const),
  claimAccount: vi.fn(async () => ({
    status: "claimed" as const,
    accountId: account.id,
  })),
  listForCustomer: vi.fn(async () => [account]),
  findCart: vi.fn(async () => cart),
  setCartStoreCredit: vi.fn(async () => ({
    success: true as const,
    cart,
    appliedAmount: 10_000,
  })),
  createId: vi.fn(() => account.id),
  createCode: vi.fn(() => "a".repeat(64)),
  hashCode: vi.fn(async (code: string) => `hash:${code}`),
  now: vi.fn(() => "2026-09-27T00:00:00.000Z"),
  ...overrides,
});

describe("store credit write service", () => {
  it("creates an account and returns its claim code only at creation", async () => {
    const deps = dependencies();
    const service = createStoreCreditWriteService(deps);
    const result = await service.create({
      customerId: account.customerId,
      currencyCode: "USD",
      createdBy: "admin-1",
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected account creation");
    expect(result.data.account).toEqual(account);
    expect(result.data.claimCode).toBe("a".repeat(64));
    expect(deps.createAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        codeHash: `hash:${"a".repeat(64)}`,
        currencyCode: "usd",
        customerId: account.customerId,
      }),
    );
  });

  it("converts a human amount to the account currency's minor units", async () => {
    const deps = dependencies();
    const service = createStoreCreditWriteService(deps);
    const result = await service.adjust({
      id: account.id,
      type: "credit",
      amount: "125.50",
      note: "Goodwill credit",
      actorId: "admin-1",
      idempotencyKey: "credit-1",
    });

    expect(result.success).toBe(true);
    expect(deps.adjustBalance).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 12550, type: "credit" }),
    );
  });

  it("rejects amounts with more precision than the account currency", async () => {
    const deps = dependencies({
      findAccount: vi.fn(async () => ({ ...account, currencyCode: "jpy" })),
    });
    const service = createStoreCreditWriteService(deps);
    const result = await service.adjust({
      id: account.id,
      type: "credit",
      amount: "1.25",
      actorId: "admin-1",
      idempotencyKey: "credit-2",
    });

    expect(result).toMatchObject({ success: false, error: "INVALID_AMOUNT" });
    expect(deps.adjustBalance).not.toHaveBeenCalled();
  });

  it("claims by the verified customer identity and returns only that account", async () => {
    const deps = dependencies();
    const service = createStoreCreditWriteService(deps);
    const result = await service.claim({
      code: "A".repeat(64),
      customerId: account.customerId!,
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected claim success");
    expect(result.data.account).toEqual(account);
    expect(deps.claimAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        codeHash: `hash:${"a".repeat(64)}`,
        customerId: account.customerId,
      }),
    );
  });

  it("applies only a matching customer's store credit to their cart", async () => {
    const deps = dependencies();
    const service = createStoreCreditWriteService(deps);
    const result = await service.applyToCart({
      cartId: cart.id,
      salesChannelId: cart.salesChannelId,
      accountId: account.id,
      customerId: account.customerId!,
    });

    expect(result).toMatchObject({
      success: true,
      data: { appliedAmount: 10_000, currencyCode: "usd" },
    });
    expect(deps.setCartStoreCredit).toHaveBeenCalledWith({
      cartId: cart.id,
      salesChannelId: cart.salesChannelId,
      customerId: account.customerId,
      accountId: account.id,
      availableBalance: account.balance,
    });
  });

  it("rejects store credit whose currency differs from the cart", async () => {
    const deps = dependencies({
      findCart: vi.fn(async () => ({ ...cart, currencyCode: "twd" })),
    });
    const service = createStoreCreditWriteService(deps);
    const result = await service.applyToCart({
      cartId: cart.id,
      salesChannelId: cart.salesChannelId,
      accountId: account.id,
      customerId: account.customerId!,
    });

    expect(result).toMatchObject({
      success: false,
      error: "CURRENCY_MISMATCH",
    });
    expect(deps.setCartStoreCredit).not.toHaveBeenCalled();
  });
});
