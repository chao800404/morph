import { describe, expect, it } from "vitest";
import {
  findBreadcrumbsFromCollections,
  findCollection,
} from "@/lib/config/navigation";
import { Marketing } from "./index";

describe("Marketing navigation hierarchy", () => {
  it("nests campaigns and gift cards under Promotions without changing their routes", () => {
    const promotions = Marketing.collections.find(
      (collection) => collection.slug === "promotions",
    );

    expect(promotions?.items?.map(({ slug }) => slug)).toEqual([
      "campaigns",
      "gift-cards",
    ]);
    expect(Marketing.collections.map(({ slug }) => slug)).not.toEqual(
      expect.arrayContaining(["campaigns", "gift-cards"]),
    );

    for (const slug of ["campaigns", "gift-cards"]) {
      expect(findCollection([Marketing], slug)?.slug).toBe(slug);
    }

    const children = [
      { slug: "campaigns", name: "Campaigns" },
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
