import { storeCreditDal } from "@/lib/store-credit/dal/store-credit.dal";
import { customerDal } from "@/lib/customer/dal/customer.dal";
import { createInviteToken, hashInviteToken } from "@/lib/invite/token";
import { fail, ok, type ServerResult } from "@/lib/db/server-result";
import { findCurrency, toMinorUnits } from "@/lib/currency/catalog";
import { cartDal } from "@/lib/cart/dal/cart.dal";
import type { Metadata } from "@/db/json";
import type { StoreCreditAccountDTO } from "../dto/store-credit.dto";
import type { CartDTO } from "@/lib/cart/dto/cart.dto";

export type StoreCreditCreateResult = ServerResult<{
  account: StoreCreditAccountDTO;
  claimCode: string;
}>;

export type StoreCreditWriteDependencies = {
  findCustomer: (id: string) => Promise<{ id: string } | null>;
  findAccount: typeof storeCreditDal.findById;
  setAccountStatus: typeof storeCreditDal.setStatus;
  createAccount: typeof storeCreditDal.createAccount;
  adjustBalance: typeof storeCreditDal.adjustBalance;
  claimAccount: typeof storeCreditDal.claimAccount;
  listForCustomer: typeof storeCreditDal.listForCustomer;
  findCart: typeof cartDal.findById;
  setCartStoreCredit: typeof cartDal.setStoreCredit;
  createId: () => string;
  createCode: () => string;
  hashCode: typeof hashInviteToken;
  now: () => string;
};

const defaultDependencies: StoreCreditWriteDependencies = {
  findCustomer: customerDal.findById,
  findAccount: storeCreditDal.findById,
  setAccountStatus: storeCreditDal.setStatus,
  createAccount: storeCreditDal.createAccount,
  adjustBalance: storeCreditDal.adjustBalance,
  claimAccount: storeCreditDal.claimAccount,
  listForCustomer: storeCreditDal.listForCustomer,
  findCart: cartDal.findById,
  setCartStoreCredit: cartDal.setStoreCredit,
  createId: () => crypto.randomUUID(),
  createCode: createInviteToken,
  hashCode: hashInviteToken,
  now: () => new Date().toISOString(),
};

const minorAmount = (amount: string, currencyCode: string) => {
  const currency = findCurrency(currencyCode);
  if (!currency) return null;
  const decimalPlaces = amount.split(".")[1]?.length ?? 0;
  if (decimalPlaces > currency.decimalDigits) return null;
  const minor = toMinorUnits(amount, currency);
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
};

export const createStoreCreditWriteService = (
  overrides: Partial<StoreCreditWriteDependencies> = {},
) => {
  const deps = { ...defaultDependencies, ...overrides };

  return {
    async create(input: {
      customerId?: string | null;
      currencyCode: string;
      metadata?: Metadata;
      createdBy: string;
    }): Promise<StoreCreditCreateResult> {
      const currencyCode = input.currencyCode.trim().toLowerCase();
      if (!findCurrency(currencyCode))
        return fail("Choose a supported currency", {
          error: "INVALID_CURRENCY",
          errors: { currencyCode: ["Choose a supported currency"] },
        });
      if (input.customerId && !(await deps.findCustomer(input.customerId)))
        return fail("Customer not found", { error: "CUSTOMER_NOT_FOUND" });

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const id = deps.createId();
        const claimCode = deps.createCode();
        const created = await deps.createAccount({
          id,
          customerId: input.customerId ?? null,
          codeHash: await deps.hashCode(claimCode),
          currencyCode,
          metadata: input.metadata ?? {},
          createdBy: input.createdBy,
          now: deps.now(),
        });
        if (created === "created") {
          const account = await deps.findAccount(id);
          if (!account)
            return fail("Store credit account could not be loaded", {
              error: "ACCOUNT_UNAVAILABLE",
            });
          return ok("Store credit account created", { account, claimCode });
        }
      }
      return fail("A unique claim code could not be generated", {
        error: "CODE_COLLISION",
      });
    },

    async adjust(input: {
      id: string;
      type: "credit" | "debit";
      amount: string;
      note?: string | null;
      actorId: string;
      idempotencyKey: string;
    }): Promise<ServerResult<{ account: StoreCreditAccountDTO }>> {
      const account = await deps.findAccount(input.id);
      if (!account)
        return fail("Store credit account not found", { error: "NOT_FOUND" });
      if (account.status !== "active")
        return fail("This store credit account is disabled", {
          error: "DISABLED",
        });
      const amount = minorAmount(input.amount, account.currencyCode);
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
        reference: "admin_adjustment",
        referenceId: transactionId,
        createdBy: input.actorId,
        now: deps.now(),
      });
      if (result === "not-found")
        return fail("Store credit account not found", { error: "NOT_FOUND" });
      if (result === "disabled")
        return fail("This store credit account is disabled", {
          error: "DISABLED",
        });
      if (result === "insufficient")
        return fail("The account does not have enough available balance", {
          error: "INSUFFICIENT_BALANCE",
        });
      if (result === "conflict")
        return fail("This transaction has already been submitted", {
          error: "IDEMPOTENCY_CONFLICT",
        });
      const updated = await deps.findAccount(input.id);
      return updated
        ? ok("Store credit account updated", { account: updated })
        : fail("Store credit account not found", { error: "NOT_FOUND" });
    },

    async setStatus(input: {
      id: string;
      status: "active" | "disabled";
      actorId: string;
    }): Promise<ServerResult<{ account: StoreCreditAccountDTO }>> {
      const updated = await deps.setAccountStatus({
        id: input.id,
        status: input.status,
        updatedBy: input.actorId,
        now: deps.now(),
      });
      if (!updated)
        return fail("Store credit account not found", { error: "NOT_FOUND" });
      const account = await deps.findAccount(input.id);
      return account
        ? ok("Store credit account status updated", { account })
        : fail("Store credit account not found", { error: "NOT_FOUND" });
    },

    async claim(input: {
      code: string;
      customerId: string;
    }): Promise<ServerResult<{ account: StoreCreditAccountDTO }>> {
      const result = await deps.claimAccount({
        codeHash: await deps.hashCode(input.code.trim().toLowerCase()),
        customerId: input.customerId,
        now: deps.now(),
      });
      if (result === "invalid-code")
        return fail("Store credit claim code is invalid", {
          error: "INVALID_CODE",
        });
      if (result === "claimed-by-another")
        return fail("This store credit account is already claimed", {
          error: "ALREADY_CLAIMED",
        });
      const accounts = await deps.listForCustomer(input.customerId);
      const account = accounts.find(
        (candidate) => candidate.id === result.accountId,
      );
      return account
        ? ok("Store credit account claimed", { account })
        : fail("Claimed store credit account could not be loaded", {
            error: "ACCOUNT_UNAVAILABLE",
          });
    },

    async applyToCart(input: {
      cartId: string;
      salesChannelId: string;
      accountId: string;
      customerId: string;
    }): Promise<
      ServerResult<{
        cart: CartDTO;
        appliedAmount: number;
        currencyCode: string;
      }>
    > {
      const [cart, account] = await Promise.all([
        deps.findCart(input.cartId, input.salesChannelId),
        deps.findAccount(input.accountId),
      ]);
      if (!cart) return fail("Cart not found", { error: "CART_NOT_FOUND" });
      if (!account)
        return fail("Store credit account not found", { error: "NOT_FOUND" });
      if (account.status !== "active")
        return fail("This store credit account is disabled", {
          error: "DISABLED",
        });
      if (account.customerId !== input.customerId)
        return fail("Store credit account not found", { error: "NOT_FOUND" });
      if (account.currencyCode !== cart.currencyCode)
        return fail("Store credit currency does not match the cart", {
          error: "CURRENCY_MISMATCH",
        });

      const result = await deps.setCartStoreCredit({
        cartId: input.cartId,
        salesChannelId: input.salesChannelId,
        customerId: input.customerId,
        accountId: account.id,
        availableBalance: account.balance,
      });
      if (!result.success)
        return fail(
          result.reason === "CUSTOMER_MISMATCH"
            ? "Cart not found"
            : result.reason === "COMPLETED"
              ? "A completed cart cannot be changed"
              : result.reason === "CONFLICT"
                ? "Cart changed while store credit was being applied"
                : "Cart not found",
          {
            error:
              result.reason === "CUSTOMER_MISMATCH"
                ? "CART_NOT_FOUND"
                : result.reason,
          },
        );
      return ok("Store credit applied to cart", {
        cart: result.cart,
        appliedAmount: result.appliedAmount,
        currencyCode: account.currencyCode,
      });
    },

    async removeFromCart(input: {
      cartId: string;
      salesChannelId: string;
      customerId: string;
    }): Promise<ServerResult<{ cart: CartDTO }>> {
      const result = await deps.setCartStoreCredit({
        cartId: input.cartId,
        salesChannelId: input.salesChannelId,
        customerId: input.customerId,
        accountId: null,
        availableBalance: 0,
      });
      if (!result.success)
        return fail(
          result.reason === "CUSTOMER_MISMATCH"
            ? "Cart not found"
            : result.reason === "COMPLETED"
              ? "A completed cart cannot be changed"
              : result.reason === "CONFLICT"
                ? "Cart changed while store credit was being removed"
                : "Cart not found",
          {
            error:
              result.reason === "CUSTOMER_MISMATCH"
                ? "CART_NOT_FOUND"
                : result.reason,
          },
        );
      return ok("Store credit removed from cart", { cart: result.cart });
    },
  };
};

export const storeCreditWriteService = createStoreCreditWriteService();
