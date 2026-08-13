import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/storefront/storefront-domains.serverFn", () => ({
  listStorefrontDomains: vi.fn(),
}));
import { normalizeStorefrontDomainListParams } from "./storefront-domain.queries";

describe("normalizeStorefrontDomainListParams", () => {
  it("maps the shared name sort key to hostname", () => {
    expect(
      normalizeStorefrontDomainListParams({
        sortBy: "name",
        sortOrder: "asc",
        page: 2,
        limit: 10,
      }),
    ).toEqual({
      query: undefined,
      sortBy: "hostname",
      sortOrder: "asc",
      page: 2,
      limit: 10,
    });
  });

  it("uses stable list defaults", () => {
    expect(normalizeStorefrontDomainListParams()).toEqual({
      query: undefined,
      sortBy: "createdAt",
      sortOrder: "desc",
      page: 1,
      limit: 20,
    });
  });
});
