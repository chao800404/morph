import type { StorefrontDomainStatus } from "@/db/storefront.schema";

export interface StorefrontDomainDTO {
  id: string;
  hostname: string;
  isPrimary: boolean;
  status: StorefrontDomainStatus;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}
