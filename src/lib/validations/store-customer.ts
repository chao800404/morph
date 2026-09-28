import { z } from "zod";

const optionalText = (max: number) =>
  z.string().trim().max(max).optional().or(z.literal(""));

export const storeCustomerProfileInputSchema = z
  .object({
    firstName: optionalText(100),
    lastName: optionalText(100),
    companyName: optionalText(200),
    phone: optionalText(50),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one profile field is required",
  });

const storeCustomerAddressFieldsSchema = z.object({
  addressName: optionalText(100),
  isDefaultShipping: z.boolean().optional(),
  isDefaultBilling: z.boolean().optional(),
  company: optionalText(200),
  firstName: optionalText(100),
  lastName: optionalText(100),
  address1: optionalText(300),
  address2: optionalText(300),
  city: optionalText(150),
  countryCode: z.string().trim().max(2).optional().or(z.literal("")),
  province: optionalText(150),
  postalCode: optionalText(40),
  phone: optionalText(50),
});

export const createStoreCustomerAddressInputSchema =
  storeCustomerAddressFieldsSchema
    .extend({
      isDefaultShipping: z.boolean().default(false),
      isDefaultBilling: z.boolean().default(false),
    })
    .strict();

export const updateStoreCustomerAddressInputSchema =
  storeCustomerAddressFieldsSchema.strict().refine(
    (value) => Object.keys(value).length > 0,
    { message: "At least one address field is required" },
  );

export const storeCustomerOrderPageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export const createStoreReturnInputSchema = z.object({
  orderId: z.uuid(),
  items: z
    .array(
      z.object({
        itemId: z.uuid(),
        quantity: z.number().int().min(1),
        reasonId: z.uuid().optional(),
        note: z.string().trim().max(1_000).optional(),
      }),
    )
    .min(1)
    .max(100)
    .refine(
      (items) => new Set(items.map((item) => item.itemId)).size === items.length,
      "An order item can only appear once in a return",
    ),
});

export const createCustomerOrderReturnInputSchema = z.object({
  items: createStoreReturnInputSchema.shape.items,
});

export const storeOrderTransferTokenSchema = z
  .object({ token: z.string().regex(/^[0-9a-f]{64}$/i) })
  .strict();

export const storeOrderTransferRequestSchema = z
  .object({
    description: optionalText(1_000),
    update_order_email: z.boolean().optional(),
    updateOrderEmail: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.update_order_email === undefined ||
      value.updateOrderEmail === undefined,
    { message: "Provide update_order_email only once" },
  )
  .transform((value) => ({
    description: value.description,
    updateOrderEmail:
      value.update_order_email ?? value.updateOrderEmail ?? false,
  }));
