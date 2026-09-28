import { describe, expect, it, vi } from "vitest";
import type { CartDTO } from "@/lib/cart/dto/cart.dto";
import { createGiftCardWriteService } from "./gift-card-write.service";

const cart = {
  currencyCode: "twd",
  completedAt: null,
} as CartDTO;

describe("gift card write service", () => {
  it("creates a one-time code with the initial balance and expiration", async () => {
    const create = vi.fn().mockResolvedValue("created");
    const findGiftCard = vi.fn().mockResolvedValue({ id: "gift-card-1" });
    const hashCode = vi.fn().mockResolvedValue("hashed-code");
    const service = createGiftCardWriteService({
      create,
      findGiftCard,
      createId: () => "gift-card-1",
      createCode: () => "GIFT-ABCD-EFGH-JKLM-NPQR-STUV",
      hashCode,
      now: () => "2026-09-28T00:00:00.000Z",
    });

    const result = await service.create({
      currencyCode: "TWD",
      amount: "12.50",
      expiresAt: "2027-09-28T00:00:00.000Z",
      createdBy: "admin-1",
    });

    expect(result.success).toBe(true);
    expect(hashCode).toHaveBeenCalledWith("GIFT-ABCD-EFGH-JKLM-NPQR-STUV");
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "gift-card-1",
        codeHash: "hashed-code",
        currencyCode: "twd",
        amount: 1250,
        expiresAt: "2027-09-28T00:00:00.000Z",
        createdBy: "admin-1",
      }),
    );
    expect(result.success && result.data.code).toBe(
      "GIFT-ABCD-EFGH-JKLM-NPQR-STUV",
    );
  });

  it("rejects expiration dates that are not in the future", async () => {
    const create = vi.fn();
    const service = createGiftCardWriteService({
      create,
      now: () => "2026-09-28T00:00:00.000Z",
    });

    const result = await service.create({
      currencyCode: "twd",
      amount: "100",
      expiresAt: "2026-09-28T00:00:00.000Z",
      createdBy: "admin-1",
    });

    if (result.success) throw new Error("Expected the expiry to be rejected");
    expect(result.error).toBe("INVALID_EXPIRATION");
    expect(create).not.toHaveBeenCalled();
  });

  it("applies a valid gift card to a guest cart using the card reference", async () => {
    const findForRedemption = vi.fn().mockResolvedValue({
      id: "gift-card-1",
      currencyCode: "twd",
      status: "active",
      balance: 800,
      expiresAt: null,
    });
    const setCartCredit = vi.fn().mockResolvedValue({
      success: true,
      cart,
      appliedAmount: 800,
    });
    const service = createGiftCardWriteService({
      findForRedemption,
      findCart: vi.fn().mockResolvedValue(cart),
      setCartCredit,
      hashCode: vi.fn().mockResolvedValue("hashed-code"),
      now: () => "2026-09-28T00:00:00.000Z",
    });

    const result = await service.applyToCart({
      cartId: "cart-1",
      salesChannelId: "channel-1",
      code: " gift-abcd-efgh-jklm-npqr-stuv ",
    });

    expect(result.success).toBe(true);
    expect(findForRedemption).toHaveBeenCalledWith("hashed-code");
    expect(setCartCredit).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "gift-card-1",
        availableBalance: 800,
        reference: "gift_card_account",
        metadata: { _morph_resource_type: "gift_card" },
      }),
    );
  });

  it("does not apply an expired card, but still permits removing it from a cart", async () => {
    const giftCard = {
      id: "gift-card-1",
      currencyCode: "twd",
      status: "active" as const,
      balance: 800,
      expiresAt: "2026-09-27T23:59:59.000Z",
    };
    const findForRedemption = vi.fn().mockResolvedValue(giftCard);
    const setCartCredit = vi.fn().mockResolvedValue({ success: true, cart });
    const service = createGiftCardWriteService({
      findForRedemption,
      findCart: vi.fn().mockResolvedValue(cart),
      setCartCredit,
      hashCode: vi.fn().mockResolvedValue("hashed-code"),
      now: () => "2026-09-28T00:00:00.000Z",
    });

    const apply = await service.applyToCart({
      cartId: "cart-1",
      salesChannelId: "channel-1",
      code: "GIFT-ABCD-EFGH-JKLM-NPQR-STUV",
    });
    const remove = await service.removeFromCart({
      cartId: "cart-1",
      salesChannelId: "channel-1",
      code: "GIFT-ABCD-EFGH-JKLM-NPQR-STUV",
    });

    if (apply.success) throw new Error("Expected the expired card to fail");
    expect(apply.error).toBe("EXPIRED");
    expect(remove.success).toBe(true);
    expect(setCartCredit).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: null,
        targetAccountId: "gift-card-1",
        availableBalance: 0,
        reference: "gift_card_account",
      }),
    );
  });
});
