import { giftCardWriteService } from "@/lib/gift-card/service/gift-card-write.service";
import {
  adjustGiftCardInputSchema,
  createGiftCardInputSchema,
  giftCardIdInputSchema,
  giftCardTransactionsQuerySchema,
  listGiftCardsQuerySchema,
  setGiftCardStatusInputSchema,
  updateGiftCardDetailsInputSchema,
} from "@/lib/validations/gift-card";
import {
  fail,
  failure,
  ok,
  paginationOf,
  parseInput,
} from "@/lib/db/server-result";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  commerceAdminMiddleware,
  commerceReadMiddleware,
} from "../middleware/auth.middleware";

const giftCardTransactionsInputSchema = giftCardIdInputSchema.extend(
  giftCardTransactionsQuerySchema.shape,
);
const adjustGiftCardDashboardInputSchema = giftCardIdInputSchema
  .extend(adjustGiftCardInputSchema.shape)
  .extend({ idempotencyKey: z.string().trim().min(1).max(200) });

export const listGiftCards = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(listGiftCardsQuerySchema, data ?? {}),
  )
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    try {
      const page = await giftCardWriteService.list(input.data);
      return ok("Gift cards fetched successfully", {
        giftCards: page.giftCards,
        pagination: paginationOf(
          page.total,
          Math.floor(input.data.offset / input.data.limit) + 1,
          input.data.limit,
        ),
      });
    } catch (error) {
      return failure(
        "List gift cards error",
        error,
        "LIST_FAILED",
        "Failed to fetch gift cards",
      );
    }
  });

export const getGiftCard = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(giftCardTransactionsInputSchema, data),
  )
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    try {
      const result = await giftCardWriteService.get(input.data.id, {
        offset: input.data.offset,
        limit: input.data.limit,
      });
      if (!result)
        return fail("Gift card not found", { error: "NOT_FOUND" });
      return ok("Gift card fetched successfully", {
        giftCard: result.giftCard,
        transactions: result.transactions,
        pagination: paginationOf(
          result.totalTransactions,
          Math.floor(input.data.offset / input.data.limit) + 1,
          input.data.limit,
        ),
      });
    } catch (error) {
      return failure(
        "Get gift card error",
        error,
        "GET_FAILED",
        "Failed to fetch gift card",
      );
    }
  });

export const createGiftCard = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(createGiftCardInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    if (!input.success) return input;
    const result = await giftCardWriteService.create({
      ...input.data,
      createdBy: context.user.id,
    });
    return result.success
      ? ok(result.message, result.data)
      : fail(result.message, { error: result.error, errors: result.errors });
  });

export const adjustGiftCard = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(adjustGiftCardDashboardInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    if (!input.success) return input;
    const { id, idempotencyKey, ...adjustment } = input.data;
    const result = await giftCardWriteService.adjust({
      id,
      ...adjustment,
      actorId: context.user.id,
      idempotencyKey,
    });
    return result.success
      ? ok(result.message, result.data)
      : fail(result.message, { error: result.error, errors: result.errors });
  });

export const setGiftCardStatus = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(setGiftCardStatusInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    if (!input.success) return input;
    const result = await giftCardWriteService.setStatus({
      ...input.data,
      actorId: context.user.id,
    });
    return result.success
      ? ok(result.message, result.data)
      : fail(result.message, { error: result.error, errors: result.errors });
  });

export const updateGiftCardDetails = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(updateGiftCardDetailsInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    if (!input.success) return input;
    const result = await giftCardWriteService.updateDetails({
      ...input.data,
      actorId: context.user.id,
    });
    return result.success
      ? ok(result.message, result.data)
      : fail(result.message, { error: result.error, errors: result.errors });
  });
