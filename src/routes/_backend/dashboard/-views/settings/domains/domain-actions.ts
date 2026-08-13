import type { AssetActionResult } from "@/lib/asset/action-result";
import {
  createStorefrontDomain,
  deleteStorefrontDomains,
} from "@/server/storefront/storefront-domains.serverFn";

const result = (value: {
  success: boolean;
  message: string;
  errors?: Partial<Record<string, string[]>>;
}): AssetActionResult => ({
  success: value.success,
  message: value.message,
  errors: value.errors
    ? Object.fromEntries(
        Object.entries(value.errors).filter(
          (entry): entry is [string, string[]] => Boolean(entry[1]),
        ),
      )
    : undefined,
});

export const createDomainAction = async (_: unknown, data: FormData) =>
  result(
    await createStorefrontDomain({
      data: { hostname: String(data.get("hostname") ?? "") },
    }),
  );

export const deleteDomainsAction = async ({ data }: { data: FormData }) => {
  let ids: string[] = [];
  try {
    const value: unknown = JSON.parse(String(data.get("ids") ?? "[]"));
    if (Array.isArray(value))
      ids = value.filter((id): id is string => typeof id === "string");
  } catch {
    /* validator returns the user-facing error */
  }
  return result(await deleteStorefrontDomains({ data: { ids } }));
};
