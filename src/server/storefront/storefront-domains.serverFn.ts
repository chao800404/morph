import { fail, failure, ok, paginationOf, parseInput } from "@/lib/db/server-result";
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
import { isReservedPlatformHostname } from "@/lib/storefront/service/storefront-request-routing";
import { selectStorefrontDomainProvider } from "@/lib/storefront/service/storefront-domain-provider";
import { env as cloudflareEnv } from "cloudflare:workers";
import {
  commerceAdminMiddleware,
  commerceReadMiddleware,
} from "../middleware/auth.middleware";

export const listStorefrontDomains = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(listStorefrontDomainsInputSchema, data ?? {}))
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

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
  .validator((data: unknown) => parseInput(createStorefrontDomainInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const storefront = await storefrontDomainDal.activeStorefront();
      if (!storefront)
        return fail(
          "Create a storefront sales channel before connecting a domain",
          { error: "NOT_FOUND" },
        );
      if (
        isReservedPlatformHostname(
          data.hostname,
          cloudflareEnv as unknown as Record<string, unknown>,
        )
      ) {
        // Routing classifies platform hosts first, so connecting one would
        // produce a domain that reports as active yet can never be reached.
        return fail("This domain is reserved for the Morph dashboard", {
          errors: {
            hostname: [
              "This hostname serves the Morph dashboard and cannot be used as a storefront domain",
            ],
          },
        });
      }
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
      // Selected before any row is written so an unconfigured environment does
      // not leave a permanently failed domain record behind.
      const selection = selectStorefrontDomainProvider({
        env: cloudflareEnv as unknown as Record<string, unknown>,
        cloudflareProvider: {
          kind: "cloudflare",
          attach: cloudflareDomainProvider.attach,
          detach: cloudflareDomainProvider.detach,
        },
      });
      if (!selection.available) {
        return fail(selection.reason, { error: "NOT_CONFIGURED" });
      }

      const id = crypto.randomUUID();
      await storefrontDomainDal.createPending({
        id,
        storefrontId: storefront.id,
        hostname: data.hostname,
      });
      await provisionStorefrontDomain(data.hostname, {
        attach: (hostname) => selection.provider.attach(hostname),
        detach: (domainId) => selection.provider.detach(domainId),
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
  .validator((data: unknown) => parseInput(setPrimaryStorefrontDomainInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

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
  .validator((data: unknown) => parseInput(deleteStorefrontDomainsInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

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
