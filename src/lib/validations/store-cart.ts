import { z } from "zod";

export const cartIdSchema = z.uuid("Invalid cart ID");
export const cartItemIdSchema = z.uuid("Invalid cart item ID");
export const promotionCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .transform((value) => value.toUpperCase());

export const applyStoreCartPromotionInputSchema = z.object({
  code: promotionCodeSchema,
});

export const createStoreCartInputSchema = z.object({
  email: z.email().max(320).optional(),
});

export const addStoreCartItemInputSchema = z.object({
  variantId: z.uuid("Invalid product variant ID"),
  quantity: z.number().int().min(1).max(999),
});

export const updateStoreCartItemInputSchema = z.object({
  quantity: z.number().int().min(1).max(999),
});

const cartAddressSchema = z.object({
  company: z
    .string()
    .trim()
    .max(200)
    .nullish()
    .transform((v) => v || null),
  firstName: z
    .string()
    .trim()
    .max(100)
    .nullish()
    .transform((v) => v || null),
  lastName: z
    .string()
    .trim()
    .max(100)
    .nullish()
    .transform((v) => v || null),
  address1: z
    .string()
    .trim()
    .max(255)
    .nullish()
    .transform((v) => v || null),
  address2: z
    .string()
    .trim()
    .max(255)
    .nullish()
    .transform((v) => v || null),
  city: z
    .string()
    .trim()
    .max(120)
    .nullish()
    .transform((v) => v || null),
  countryCode: z
    .string()
    .trim()
    .length(2)
    .transform((value) => value.toLowerCase()),
  province: z
    .string()
    .trim()
    .max(100)
    .nullish()
    .transform((v) => v || null),
  postalCode: z
    .string()
    .trim()
    .max(32)
    .nullish()
    .transform((v) => v || null),
  phone: z
    .string()
    .trim()
    .max(32)
    .nullish()
    .transform((v) => v || null),
});

export const updateStoreCartInputSchema = z.object({
  email: z.email().max(320).optional(),
  shippingAddress: cartAddressSchema.optional(),
  billingAddress: cartAddressSchema.optional(),
});

export const selectStoreShippingMethodInputSchema = z.object({
  optionId: z.uuid("Invalid shipping option ID"),
});

export const createStorePaymentSessionInputSchema = z.object({
  providerId: z.string().trim().min(1).max(200),
});

export const paymentSessionIdSchema = z.uuid("Invalid payment session ID");
