import type { storefrontDomains } from "@/db/storefront.schema";
import type { StorefrontDomainDTO } from "../dto/storefront-domain.dto";

export const toStorefrontDomainDTO = (
  row: typeof storefrontDomains.$inferSelect,
): StorefrontDomainDTO => ({
  id: row.id,
  hostname: row.hostname,
  isPrimary: row.isPrimary,
  status: row.status,
  errorMessage: row.errorMessage,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});
