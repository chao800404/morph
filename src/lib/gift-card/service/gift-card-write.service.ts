import type { Metadata } from "@/db/json";
import { cartDal } from "@/lib/cart/dal/cart.dal";
import type { CartDTO } from "@/lib/cart/dto/cart.dto";
import { findCurrency, toMinorUnits } from "@/lib/currency/catalog";
import { fail, ok, type ServerResult } from "@/lib/db/server-result";
import { hashInviteToken } from "@/lib/invite/token";
import { storeCreditDal } from "@/lib/store-credit/dal/store-credit.dal";
import type { StoreCreditTransactionDTO } from "@/lib/store-credit/dto/store-credit.dto";
import { createGiftCardCode, normalizeGiftCardCode } from "../code";
import { giftCardDal } from "../dal/gift-card.dal";
import type { GiftCardDTO } from "../dto/gift-card.dto";

export type GiftCardCreateResult = ServerResult<{
  giftCard: GiftCardDTO;
  code: string;
}>;

type GiftCardWriteDependencies = {
  create: typeof giftCardDal.create;
  findGiftCard: typeof giftCardDal.findById;
  findForRedemption: typeof giftCardDal.findForRedemption;
  listPage: typeof giftCardDal.listPage;
  listTransactions: typeof giftCardDal.listTransactions;
  setStatus: typeof giftCardDal.setStatus;
  updateDetails: typeof giftCardDal.updateDetails;
  adjustBalance: typeof storeCreditDal.adjustBalance;
  findCart: typeof cartDal.findById;
  setCartCredit: typeof cartDal.setStoreCredit;
  createId: () => string;
  createCode: () => string;
  hashCode: typeof hashInviteToken;
  now: () => string;
};

const toMinorAmount = (amount: string, currencyCode: string) => {
  const currency = findCurrency(currencyCode);
  if (!currency) return null;
  const decimalPlaces = amount.split(".")[1]?.length ?? 0;
  if (decimalPlaces > currency.decimalDigits) return null;
  const minor = toMinorUnits(amount, currency);
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
};

const noStoreMetadata: Metadata = {};

export const createGiftCardWriteService = (
  overrides: Partial<GiftCardWriteDependencies> = {},
) => {
  const deps: GiftCardWriteDependencies = {
    create: giftCardDal.create,
    findGiftCard: giftCardDal.findById,
    findForRedemption: giftCardDal.findForRedemption,
    listPage: giftCardDal.listPage,
    listTransactions: giftCardDal.listTransactions,
    setStatus: giftCardDal.setStatus,
    updateDetails: giftCardDal.updateDetails,
    adjustBalance: storeCreditDal.adjustBalance,
    findCart: cartDal.findById,
    setCartCredit: cartDal.setStoreCredit,
    createId: () => crypto.randomUUID(),
    createCode: createGiftCardCode,
    hashCode: hashInviteToken,
    now: () => new Date().toISOString(),
    ...overrides,
  };

  return {
    async create(input: {
      currencyCode: string;
      amount: string;
      expiresAt?: string | null;
      note?: string | null;
      createdBy: string;
    }): Promise<GiftCardCreateResult> {
      const currencyCode = input.currencyCode.trim().toLowerCase();
      if (!findCurrency(currencyCode))
        return fail("Choose a supported currency", {
          error: "INVALID_CURRENCY",
          errors: { currencyCode: ["Choose a supported currency"] },
        });
      const amount = toMinorAmount(input.amount, currencyCode);
      if (amount === null)
        return fail("Enter a positive amount using the currency's precision", {
          error: "INVALID_AMOUNT",
          errors: {
            amount: ["Enter a positive amount using the currency's precision"],
          },
        });

      const now = deps.now();
      let expiresAt: string | null = null;
      if (input.expiresAt) {
        const parsedExpiry = Date.parse(input.expiresAt);
        if (!Number.isFinite(parsedExpiry) || parsedExpiry <= Date.parse(now))
          return fail("Choose an expiration date in the future", {
            error: "INVALID_EXPIRATION",
            errors: {
              expiresAt: ["Choose an expiration date in the future"],
            },
          });
        expiresAt = new Date(parsedExpiry).toISOString();
      }

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const id = deps.createId();
        const code = deps.createCode();
        const created = await deps.create({
          id,
          code,
          codeHash: await deps.hashCode(normalizeGiftCardCode(code)),
          currencyCode,
          amount,
          expiresAt,
          note: input.note?.trim() || null,
          createdBy: input.createdBy,
          now,
        });
        if (created === "duplicate-code") continue;
        const giftCard = await deps.findGiftCard(id);
        return giftCard
          ? ok("Gift card created", { giftCard, code })
          : fail("Gift card could not be loaded", {
              error: "GIFT_CARD_UNAVAILABLE",
            });
      }
      return fail("A unique gift card code could not be generated", {
        error: "CODE_COLLISION",
      });
    },

    async list(input: {
      query?: string;
      currencyCode?: string;
      status?: "active" | "disabled";
      sortBy: "createdAt" | "balance";
      sortOrder: "asc" | "desc";
      offset: number;
      limit: number;
    }) {
      return deps.listPage(input);
    },

    async get(
      id: string,
      pagination: { offset: number; limit: number } = { offset: 0, limit: 20 },
    ): Promise<{
      giftCard: GiftCardDTO;
      transactions: StoreCreditTransactionDTO[];
      totalTransactions: number;
    } | null> {
      const giftCard = await deps.findGiftCard(id);
      if (!giftCard) return null;
      const transactions = await deps.listTransactions({
        accountId: id,
        offset: pagination.offset,
        limit: pagination.limit,
      });
      return {
        giftCard,
        transactions: transactions.transactions,
        totalTransactions: transactions.total,
      };
    },

    async adjust(input: {
      id: string;
      type: "credit" | "debit";
      amount: string;
      note?: string | null;
      actorId: string;
      idempotencyKey: string;
    }): Promise<ServerResult<{ giftCard: GiftCardDTO }>> {
      const giftCard = await deps.findGiftCard(input.id);
      if (!giftCard) return fail("Gift card not found", { error: "NOT_FOUND" });
      if (giftCard.status === "disabled")
        return fail("This gift card is disabled", { error: "DISABLED" });
      const amount = toMinorAmount(input.amount, giftCard.currencyCode);
      if (amount === null)
        return fail("Enter a positive amount using the currency's precision", {
          error: "INVALID_AMOUNT",
          errors: {
            amount: ["Enter a positive amount using the currency's precision"],
          },
        });
      const transactionId = deps.createId();
      const result = await deps.adjustBalance({
        id: input.id,
        transactionId,
        idempotencyKey: input.idempotencyKey,
        type: input.type,
        amount,
        note: input.note?.trim() || null,
        reference: "gift_card_adjustment",
        referenceId: transactionId,
        createdBy: input.actorId,
        now: deps.now(),
      });
      if (result === "not-found")
        return fail("Gift card not found", { error: "NOT_FOUND" });
      if (result === "disabled")
        return fail("This gift card is disabled", { error: "DISABLED" });
      if (result === "insufficient")
        return fail("The gift card does not have enough available balance", {
          error: "INSUFFICIENT_BALANCE",
        });
      if (result === "conflict")
        return fail("This transaction has already been submitted", {
          error: "IDEMPOTENCY_CONFLICT",
        });
      const updated = await deps.findGiftCard(input.id);
      return updated
        ? ok("Gift card updated", { giftCard: updated })
        : fail("Gift card not found", { error: "NOT_FOUND" });
    },

    async setStatus(input: {
      id: string;
      status: "active" | "disabled";
      actorId: string;
    }): Promise<ServerResult<{ giftCard: GiftCardDTO }>> {
      const updated = await deps.setStatus({
        id: input.id,
        status: input.status,
        updatedBy: input.actorId,
        now: deps.now(),
      });
      if (!updated) return fail("Gift card not found", { error: "NOT_FOUND" });
      const giftCard = await deps.findGiftCard(input.id);
      return giftCard
        ? ok("Gift card status updated", { giftCard })
        : fail("Gift card not found", { error: "NOT_FOUND" });
    },

    async updateDetails(input: {
      id: string;
      expiresAt?: string | null;
      note?: string | null;
      actorId: string;
    }): Promise<ServerResult<{ giftCard: GiftCardDTO }>> {
      const current = await deps.findGiftCard(input.id);
      if (!current) return fail("Gift card not found", { error: "NOT_FOUND" });
      if (input.expiresAt !== undefined && input.expiresAt !== null) {
        const expiresAt = Date.parse(input.expiresAt);
        if (!Number.isFinite(expiresAt) || expiresAt <= Date.parse(deps.now()))
          return fail("Choose an expiration date in the future", {
            error: "INVALID_EXPIRATION",
          });
      }
      const result = await deps.updateDetails({
        id: input.id,
        ...(input.expiresAt !== undefined
          ? {
              expiresAt: input.expiresAt
                ? new Date(input.expiresAt).toISOString()
                : null,
            }
          : {}),
        ...(input.note !== undefined
          ? { note: input.note?.trim() || null }
          : {}),
        updatedBy: input.actorId,
        now: deps.now(),
      });
      if (result === "not-found")
        return fail("Gift card not found", { error: "NOT_FOUND" });
      if (result === "conflict")
        return fail("Gift card changed while its details were being updated", {
          error: "CONFLICT",
        });
      const giftCard = await deps.findGiftCard(input.id);
      return giftCard
        ? ok("Gift card details updated", { giftCard })
        : fail("Gift card not found", { error: "NOT_FOUND" });
    },

    async applyToCart(input: {
      cartId: string;
      salesChannelId: string;
      code: string;
    }): Promise<
      ServerResult<{
        cart: CartDTO;
        appliedAmount: number;
        currencyCode: string;
      }>
    > {
      const codeHash = await deps.hashCode(normalizeGiftCardCode(input.code));
      const giftCard = await deps.findForRedemption(codeHash);
      if (!giftCard)
        return fail("Gift card code is invalid", { error: "INVALID_CODE" });
      if (giftCard.status !== "active")
        return fail("This gift card is disabled", { error: "DISABLED" });
      if (
        giftCard.expiresAt &&
        Date.parse(giftCard.expiresAt) <= Date.parse(deps.now())
      )
        return fail("This gift card has expired", { error: "EXPIRED" });
      if (giftCard.balance <= 0)
        return fail("This gift card has no remaining balance", {
          error: "DEPLETED",
        });
      const cart = await deps.findCart(input.cartId, input.salesChannelId);
      if (!cart || cart.completedAt)
        return fail("Cart not found or already completed", {
          error: "CART_NOT_FOUND",
        });
      if (giftCard.currencyCode !== cart.currencyCode)
        return fail("Gift card currency does not match the cart", {
          error: "CURRENCY_MISMATCH",
        });
      const result = await deps.setCartCredit({
        cartId: input.cartId,
        salesChannelId: input.salesChannelId,
        accountId: giftCard.id,
        availableBalance: giftCard.balance,
        reference: "gift_card_account",
        metadata: { _morph_resource_type: "gift_card" },
      });
      if (!result.success)
        return fail(
          result.reason === "COMPLETED"
            ? "A completed cart cannot be changed"
            : result.reason === "CONFLICT"
              ? "Cart changed while the gift card was being applied"
              : "Cart not found",
          { error: result.reason },
        );
      if (result.appliedAmount <= 0)
        return fail("The gift card cannot be applied to this cart", {
          error: "CART_ALREADY_COVERED",
        });
      return ok("Gift card applied to cart", {
        cart: result.cart,
        appliedAmount: result.appliedAmount,
        currencyCode: giftCard.currencyCode,
      });
    },

    async removeFromCart(input: {
      cartId: string;
      salesChannelId: string;
      code: string;
    }): Promise<ServerResult<{ cart: CartDTO }>> {
      const giftCard = await deps.findForRedemption(
        await deps.hashCode(normalizeGiftCardCode(input.code)),
      );
      if (!giftCard)
        return fail("Gift card code is invalid", { error: "INVALID_CODE" });
      const cart = await deps.findCart(input.cartId, input.salesChannelId);
      if (!cart || cart.completedAt)
        return fail("Cart not found or already completed", {
          error: "CART_NOT_FOUND",
        });
      const result = await deps.setCartCredit({
        cartId: input.cartId,
        salesChannelId: input.salesChannelId,
        accountId: null,
        targetAccountId: giftCard.id,
        availableBalance: 0,
        reference: "gift_card_account",
        metadata: noStoreMetadata,
      });
      if (!result.success)
        return fail(
          result.reason === "COMPLETED"
            ? "A completed cart cannot be changed"
            : result.reason === "CONFLICT"
              ? "Cart changed while the gift card was being removed"
              : "Cart not found",
          { error: result.reason },
        );
      return ok("Gift card removed from cart", { cart: result.cart });
    },
  };
};

export const giftCardWriteService = createGiftCardWriteService();
