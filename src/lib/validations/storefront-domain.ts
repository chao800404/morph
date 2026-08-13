import { z } from "zod";
import { idSchema, idsSchema, listParamsSchema } from "./commerce";

export const normalizeHostname = (value: string) =>
  value.trim().toLowerCase().replace(/\.$/, "");

const hostnamePattern =
  /^(?=.{1,253}$)(?!-)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export const hostnameSchema = z
  .string()
  .transform(normalizeHostname)
  .refine((value) => hostnamePattern.test(value), {
    message: "Enter a hostname such as shop.example.com",
  });

export const listStorefrontDomainsInputSchema = listParamsSchema(
  ["hostname", "createdAt", "updatedAt"],
  { sortBy: "createdAt" },
);
export const createStorefrontDomainInputSchema = z.object({
  hostname: hostnameSchema,
});
export const setPrimaryStorefrontDomainInputSchema = z.object({
  id: idSchema("storefront domain"),
});
export const deleteStorefrontDomainsInputSchema =
  idsSchema("storefront domain");
