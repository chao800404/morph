import type { StorefrontThemeDependencyStatus } from "@/db/storefront.schema";

export type StorefrontThemeDependencyDTO = {
  id: string;
  storefrontId: string;
  themeId: string;
  packageName: string;
  packageVersion: string;
  status: StorefrontThemeDependencyStatus;
  buildId: string | null;
  requestedBy: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};
