import { fail, failure, ok, paginationOf } from "@/lib/db/server-result";
import { cloudflareDomainProvider } from "@/lib/storefront/cloudflare-domain.server";
import { storefrontDomainDal } from "@/lib/storefront/dal/storefront-domain.dal";
import {
  createStorefrontDomainInputSchema,
  deleteStorefrontDomainsInputSchema,
  listStorefrontDomainsInputSchema,
  setPrimaryStorefrontDomainInputSchema,
} from "@/lib/validations/storefront-domain";
import { createServerFn } from "@tanstack/react-start";
import { DB_FANOUT_CONCURRENCY } from "@/lib/db/concurrency";
import pLimit from "p-limit";
import { provisionStorefrontDomain } from "@/lib/storefront/domain-provisioning.server";
import {
  commerceAdminMiddleware,
  commerceReadMiddleware,
} from "../middleware/auth.middleware";

export const listStorefrontDomains = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    listStorefrontDomainsInputSchema.parse(data ?? {}),
  )
  .middleware([commerceReadMiddleware])
  .handler(async ({ data }) => {
    try {
      const page = await storefrontDomainDal.listPage(data);
      return ok("Domains fetched", {
        domains: page.domains,
        pagination: paginationOf(page.total, data.page, data.limit),
      });
    } catch (error) {
      return failure(
        "List storefront domains error",
        error,
        "LIST_FAILED",
        "Failed to fetch domains",
      );
    }
  });

export const createStorefrontDomain = createServerFn({ method: "POST" })
  .validator((data: unknown) => createStorefrontDomainInputSchema.parse(data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data }) => {
    try {
      const storefront = await storefrontDomainDal.activeStorefront();
      if (!storefront)
        return fail(
          "Create a storefront sales channel before connecting a domain",
          { error: "NOT_FOUND" },
        );
      if (await storefrontDomainDal.findByHostname(data.hostname)) {
        return fail("This domain is already connected", {
          errors: { hostname: ["This domain is already connected"] },
        });
      }
      const existing = await storefrontDomainDal.listPage({
        sortBy: "createdAt",
        sortOrder: "asc",
        page: 1,
        limit: 1,
      });
      const id = crypto.randomUUID();
      await storefrontDomainDal.createPending({
        id,
        storefrontId: storefront.id,
        hostname: data.hostname,
      });
      await provisionStorefrontDomain(data.hostname, {
        attach: cloudflareDomainProvider.attach,
        detach: cloudflareDomainProvider.detach,
        activate: (cloudflareDomainId) =>
          storefrontDomainDal.activate(
            id,
            storefront.id,
            data.hostname,
            cloudflareDomainId,
            existing.total === 0,
          ),
        markFailed: (message) => storefrontDomainDal.markFailed(id, message),
      });
      return ok(`Domain "${data.hostname}" connected`, { id });
    } catch (error) {
      return failure(
        "Create storefront domain error",
        error,
        "CREATE_FAILED",
        error instanceof Error ? error.message : "Failed to connect domain",
      );
    }
  });

export const setPrimaryStorefrontDomain = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    setPrimaryStorefrontDomainInputSchema.parse(data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data }) => {
    try {
      const domain = await storefrontDomainDal.findById(data.id);
      if (!domain) return fail("Domain not found", { error: "NOT_FOUND" });
      if (domain.status !== "active")
        return fail("Only an active domain can be primary", {
          error: "INVALID_STATE",
        });
      await storefrontDomainDal.setPrimary(
        domain.id,
        domain.storefrontId,
        domain.hostname,
      );
      return ok(`"${domain.hostname}" is now the primary domain`, {
        id: domain.id,
      });
    } catch (error) {
      return failure(
        "Set primary storefront domain error",
        error,
        "UPDATE_FAILED",
        "Failed to set primary domain",
      );
    }
  });

export const deleteStorefrontDomains = createServerFn({ method: "POST" })
  .validator((data: unknown) => deleteStorefrontDomainsInputSchema.parse(data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data }) => {
    try {
      const lookup = pLimit(DB_FANOUT_CONCURRENCY);
      const domains = (
        await Promise.all(
          data.ids.map((id) => lookup(() => storefrontDomainDal.findById(id))),
        )
      ).filter((value) => value !== null);
      if (!domains.length)
        return fail("Domain not found", { error: "NOT_FOUND" });
      if (domains.some((domain) => domain.isPrimary))
        return fail("Choose another primary domain before removing this one", {
          error: "INVALID_STATE",
        });
      const detach = pLimit(DB_FANOUT_CONCURRENCY);
      await Promise.all(
        domains.map((domain) =>
          domain.cloudflareDomainId
            ? detach(() =>
                cloudflareDomainProvider.detach(domain.cloudflareDomainId!),
              )
            : Promise.resolve(),
        ),
      );
      await storefrontDomainDal.softDelete(domains.map((domain) => domain.id));
      return ok(
        `${domains.length} domain${domains.length === 1 ? "" : "s"} removed`,
        { deleted: domains.length },
      );
    } catch (error) {
      return failure(
        "Delete storefront domains error",
        error,
        "DELETE_FAILED",
        error instanceof Error ? error.message : "Failed to remove domain",
      );
    }
  });
