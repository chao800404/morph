import { describe, expect, it } from "vitest";
import {
  findBreadcrumbsFromCollections,
  findCollection,
} from "@/lib/config/navigation";
import { Marketing } from "./index";

describe("Marketing navigation hierarchy", () => {
  it("nests campaign-related collections under Promotions without changing their routes", () => {
    const promotions = Marketing.collections.find(
      (collection) => collection.slug === "promotions",
    );

    expect(promotions?.items?.map(({ slug }) => slug)).toEqual([
      "campaigns",
      "store-credits",
      "gift-cards",
    ]);
    expect(Marketing.collections.map(({ slug }) => slug)).not.toEqual(
      expect.arrayContaining(["campaigns", "store-credits", "gift-cards"]),
    );

    for (const slug of ["campaigns", "store-credits", "gift-cards"]) {
      expect(findCollection([Marketing], slug)?.slug).toBe(slug);
    }

    const children = [
      { slug: "campaigns", name: "Campaigns" },
      { slug: "store-credits", name: "Store Credits" },
      { slug: "gift-cards", name: "Gift Cards" },
    ];

    for (const { slug, name } of children) {
      expect(findBreadcrumbsFromCollections([Marketing], [slug])).toEqual([
        { name: "Promotions", href: "/dashboard/promotions" },
        { name, href: `/dashboard/${slug}` },
      ]);
    }
  });
});
