import { describe, expect, it, vi } from "vitest";
import { handleAdminGiftCardsRequest } from "./gift-cards";

const giftCard = {
  id: "11111111-1111-4111-8111-111111111111",
  currencyCode: "usd",
  status: "active" as const,
  initialValue: 2500,
  balance: 2500,
  totalCredits: 2500,
  totalDebits: 0,
  expiresAt: null,
  note: null,
  createdAt: new Date("2026-09-28T00:00:00.000Z"),
  updatedAt: new Date("2026-09-28T00:00:00.000Z"),
};

const deps = () => ({
  authorize: vi.fn(async () => ({
    allowed: true as const,
    userId: "admin-1",
    role: "admin",
  })),
  list: vi.fn(async () => ({ giftCards: [giftCard], total: 1 })),
  find: vi.fn(async () => giftCard),
  listTransactions: vi.fn(async () => ({ transactions: [], total: 0 })),
  create: vi.fn(async () => ({
    success: true as const,
    message: "Created",
    data: { giftCard, code: "GIFT-ABCD-EFGH-JKLM-NPQR-STUV" },
  })),
  adjust: vi.fn(async () => ({
    success: true as const,
    message: "Updated",
    data: { giftCard },
  })),
  setStatus: vi.fn(async () => ({
    success: true as const,
    message: "Updated",
    data: { giftCard },
  })),
  updateDetails: vi.fn(async () => ({
    success: true as const,
    message: "Updated",
    data: { giftCard },
  })),
});

describe("Admin Gift Cards API", () => {
  it("returns a paginated Medusa-shaped gift card collection", async () => {
    const dependencies = deps();
    const response = await handleAdminGiftCardsRequest(
      new Request("https://morph.test/api/admin/gift-cards?limit=10"),
      "gift-cards",
      dependencies,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      count: 1,
      limit: 10,
      gift_cards: [
        {
          id: giftCard.id,
          value: 25,
          balance: 25,
          currency_code: "usd",
          status: "active",
        },
      ],
    });
  });

  it("creates a card from snake-case Medusa API fields and returns the code once", async () => {
    const dependencies = deps();
    const response = await handleAdminGiftCardsRequest(
      new Request("https://morph.test/api/admin/gift-cards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          currency_code: "USD",
          value: "25.00",
          expires_at: null,
          note: "Customer support credit",
        }),
      }),
      "gift-cards",
      dependencies,
    );

    expect(response.status).toBe(201);
    expect(dependencies.create).toHaveBeenCalledWith(
      expect.objectContaining({
        currencyCode: "usd",
        amount: "25.00",
        expiresAt: null,
        note: "Customer support credit",
        createdBy: "admin-1",
      }),
    );
    expect(await response.json()).toMatchObject({
      code: "GIFT-ABCD-EFGH-JKLM-NPQR-STUV",
      gift_card: { id: giftCard.id, value: 25 },
    });
  });

  it("requires an idempotency key for balance adjustments", async () => {
    const dependencies = deps();
    const response = await handleAdminGiftCardsRequest(
      new Request(
        `https://morph.test/api/admin/gift-cards/${giftCard.id}/transactions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "credit", amount: "5.00" }),
        },
      ),
      `gift-cards/${giftCard.id}/transactions`,
      dependencies,
    );

    expect(response.status).toBe(400);
    expect(dependencies.adjust).not.toHaveBeenCalled();
  });

  it("updates gift card details without treating the request as a status change", async () => {
    const dependencies = deps();
    const response = await handleAdminGiftCardsRequest(
      new Request(`https://morph.test/api/admin/gift-cards/${giftCard.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expires_at: "2027-01-01T00:00:00.000Z",
          note: "Updated note",
        }),
      }),
      `gift-cards/${giftCard.id}`,
      dependencies,
    );

    expect(response.status).toBe(200);
    expect(dependencies.updateDetails).toHaveBeenCalledWith({
      id: giftCard.id,
      expiresAt: "2027-01-01T00:00:00.000Z",
      note: "Updated note",
      actorId: "admin-1",
    });
    expect(dependencies.setStatus).not.toHaveBeenCalled();
  });

  it("updates gift card status on the dedicated status endpoint", async () => {
    const dependencies = deps();
    const response = await handleAdminGiftCardsRequest(
      new Request(
        `https://morph.test/api/admin/gift-cards/${giftCard.id}/status`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: "disabled" }),
        },
      ),
      `gift-cards/${giftCard.id}/status`,
      dependencies,
    );

    expect(response.status).toBe(200);
    expect(dependencies.setStatus).toHaveBeenCalledWith({
      id: giftCard.id,
      status: "disabled",
      actorId: "admin-1",
    });
    expect(dependencies.updateDetails).not.toHaveBeenCalled();
  });
});
