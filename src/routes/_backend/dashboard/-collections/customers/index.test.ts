import { describe, expect, it } from "vitest";
import {
  findBreadcrumbsFromCollections,
  findCollection,
} from "@/lib/config/navigation";
import { CustomerManagement } from "./index";

describe("Customer navigation hierarchy", () => {
  it("nests Store Credits under Customers without changing its route", () => {
    const customers = CustomerManagement.collections.find(
      (collection) => collection.slug === "customers",
    );

    expect(customers?.items?.map(({ slug }) => slug)).toEqual([
      "customer-groups",
      "store-credits",
    ]);
    expect(CustomerManagement.collections.map(({ slug }) => slug)).not.toEqual(
      expect.arrayContaining(["store-credits"]),
    );
    expect(findCollection([CustomerManagement], "store-credits")?.slug).toBe(
      "store-credits",
    );
    expect(
      findBreadcrumbsFromCollections([CustomerManagement], ["store-credits"]),
    ).toEqual([
      { name: "Customers", href: "/dashboard/customers" },
      { name: "Store Credits", href: "/dashboard/store-credits" },
    ]);
  });
});
