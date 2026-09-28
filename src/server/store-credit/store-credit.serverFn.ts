import { storeCreditDal } from "@/lib/store-credit/dal/store-credit.dal";
import { storeCreditWriteService } from "@/lib/store-credit/service/store-credit-write.service";
import {
  fail,
  failure,
  ok,
  paginationOf,
  parseInput,
} from "@/lib/db/server-result";
import {
  adjustStoreCreditInputSchema,
  createStoreCreditAccountInputSchema,
  listStoreCreditAccountsQuerySchema,
  setStoreCreditAccountStatusInputSchema,
  storeCreditTransactionsQuerySchema,
} from "@/lib/validations/store-credit";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  commerceAdminMiddleware,
  commerceReadMiddleware,
} from "../middleware/auth.middleware";

const storeCreditAccountIdInputSchema = z.object({ id: z.uuid() });
const storeCreditTransactionsInputSchema =
  storeCreditAccountIdInputSchema.extend(
    storeCreditTransactionsQuerySchema.shape,
  );
const adjustStoreCreditDashboardInputSchema = storeCreditAccountIdInputSchema
  .extend(adjustStoreCreditInputSchema.shape)
  .extend({ idempotencyKey: z.string().trim().min(1).max(200) });

export const listStoreCreditAccounts = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(listStoreCreditAccountsQuerySchema, data ?? {}),
  )
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    try {
      const page = await storeCreditDal.listPage(input.data);
      return ok("Store credit accounts fetched successfully", {
        accounts: page.accounts,
        pagination: paginationOf(
          page.total,
          Math.floor(input.data.offset / input.data.limit) + 1,
          input.data.limit,
        ),
      });
    } catch (error) {
      return failure(
        "List store credit accounts error",
        error,
        "LIST_FAILED",
        "Failed to fetch store credit accounts",
      );
    }
  });

export const getStoreCreditAccount = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(storeCreditAccountIdInputSchema, data),
  )
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    try {
      const account = await storeCreditDal.findById(input.data.id);
      if (!account)
        return fail("Store credit account not found", { error: "NOT_FOUND" });
      const page = await storeCreditDal.listTransactions({
        accountId: account.id,
        offset: 0,
        limit: 20,
      });
      return ok("Store credit account fetched successfully", {
        account,
        transactions: page.transactions,
        pagination: paginationOf(page.total, 1, 20),
      });
    } catch (error) {
      return failure(
        "Get store credit account error",
        error,
        "GET_FAILED",
        "Failed to fetch store credit account",
      );
    }
  });

export const listStoreCreditTransactions = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(storeCreditTransactionsInputSchema, data),
  )
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    try {
      const account = await storeCreditDal.findById(input.data.id);
      if (!account)
        return fail("Store credit account not found", { error: "NOT_FOUND" });
      const page = await storeCreditDal.listTransactions({
        accountId: input.data.id,
        offset: input.data.offset,
        limit: input.data.limit,
      });
      return ok("Store credit transactions fetched successfully", {
        transactions: page.transactions,
        pagination: paginationOf(
          page.total,
          Math.floor(input.data.offset / input.data.limit) + 1,
          input.data.limit,
        ),
      });
    } catch (error) {
      return failure(
        "List store credit transactions error",
        error,
        "LIST_FAILED",
        "Failed to fetch store credit transactions",
      );
    }
  });

export const createStoreCreditAccount = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(createStoreCreditAccountInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    if (!input.success) return input;
    const result = await storeCreditWriteService.create({
      ...input.data,
      createdBy: context.user.id,
    });
    return result.success
      ? ok(result.message, result.data)
      : fail(result.message, { error: result.error, errors: result.errors });
  });

export const adjustStoreCreditAccount = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(adjustStoreCreditDashboardInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    if (!input.success) return input;
    const { id, idempotencyKey, ...adjustment } = input.data;
    const result = await storeCreditWriteService.adjust({
      id,
      ...adjustment,
      actorId: context.user.id,
      idempotencyKey,
    });
    return result.success
      ? ok(result.message, result.data)
      : fail(result.message, { error: result.error, errors: result.errors });
  });

export const setStoreCreditAccountStatus = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(setStoreCreditAccountStatusInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    if (!input.success) return input;
    const result = await storeCreditWriteService.setStatus({
      ...input.data,
      actorId: context.user.id,
    });
    return result.success
      ? ok(result.message, result.data)
      : fail(result.message, { error: result.error, errors: result.errors });
  });
