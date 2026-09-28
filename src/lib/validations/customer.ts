import { z } from "zod";
import { metadataInputSchema } from "./product";

const page = z.coerce.number().int().min(1).default(1);
const limit = z.coerce.number().int().min(1).max(100).default(20);
const nullableText = (max: number) =>
  z.string().trim().max(max).optional().or(z.literal(""));
const customerEmail = z
  .email()
  .trim()
  .toLowerCase()
  .optional()
  .or(z.literal(""));

export const listCustomersInputSchema = z.object({
  query: z.string().trim().max(200).optional(),
  sortBy: z.enum(["createdAt", "email"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  page,
  limit,
});

export const customerIdInputSchema = z.object({ id: z.uuid() });
export const deleteCustomersInputSchema = z.object({
  ids: z.array(z.uuid()).min(1).max(100),
});

const customerFieldsSchema = z.object({
  email: customerEmail,
  firstName: nullableText(100),
  lastName: nullableText(100),
  companyName: nullableText(200),
  phone: nullableText(50),
});

export const createCustomerInputSchema = customerFieldsSchema.extend({
  metadata: metadataInputSchema.default({}),
});
export const updateCustomerInputSchema = customerFieldsSchema.extend({
  id: z.uuid(),
  metadata: metadataInputSchema.optional(),
});

export const listCustomerGroupsInputSchema = z.object({
  query: z.string().trim().max(200).optional(),
  sortBy: z.enum(["createdAt", "name"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  page,
  limit,
});

export const customerGroupIdInputSchema = z.object({ id: z.uuid() });

export const createCustomerGroupInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  metadata: metadataInputSchema.default({}),
});

export const updateCustomerGroupInputSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(200).optional(),
  metadata: metadataInputSchema.optional(),
});

export const addCustomersToGroupInputSchema = z.object({
  groupId: z.uuid(),
  customerIds: z
    .array(z.uuid())
    .min(1)
    .max(100)
    .refine(
      (ids) => new Set(ids).size === ids.length,
      "Customers must be unique",
    ),
});

export const removeCustomerFromGroupInputSchema = z.object({
  groupId: z.uuid(),
  customerId: z.uuid(),
});

export const listCustomerGroupMembersInputSchema = z.object({
  groupId: z.uuid(),
  query: z.string().trim().max(200).optional(),
  page,
  limit,
});

const addressFieldsSchema = z.object({
  addressName: nullableText(100),
  isDefaultShipping: z.boolean().optional(),
  isDefaultBilling: z.boolean().optional(),
  company: nullableText(200),
  firstName: nullableText(100),
  lastName: nullableText(100),
  address1: nullableText(300),
  address2: nullableText(300),
  city: nullableText(150),
  countryCode: z.string().trim().max(2).optional().or(z.literal("")),
  province: nullableText(150),
  postalCode: nullableText(40),
  phone: nullableText(50),
  metadata: metadataInputSchema.optional(),
});

export const createCustomerAddressInputSchema = addressFieldsSchema.extend({
  customerId: z.uuid(),
  isDefaultShipping: z.boolean().default(false),
  isDefaultBilling: z.boolean().default(false),
});

export const updateCustomerAddressInputSchema = addressFieldsSchema.extend({
  id: z.uuid(),
  customerId: z.uuid(),
});

export const deleteCustomerAddressInputSchema = z.object({
  id: z.uuid(),
  customerId: z.uuid(),
});
