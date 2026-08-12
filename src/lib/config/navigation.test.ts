import { describe, expect, it } from "vitest";
import type { CollectionGroup } from "./create-config";
import { findBreadcrumbsFromCollections } from "./navigation";

describe("findBreadcrumbsFromCollections", () => {
  it("identifies the dashboard root as the current location", () => {
    expect(findBreadcrumbsFromCollections([], [])).toEqual([
      { name: "Dashboard", href: "/dashboard" },
    ]);
  });

  it("starts settings breadcrumbs at the addressed collection", () => {
    const groups: CollectionGroup[] = [
      {
        slug: "settings",
        title: "General",
        collections: [
          {
            title: "Users",
            label: "Users",
            slug: "users",
          },
        ],
      },
    ];

    expect(
      findBreadcrumbsFromCollections(groups, ["settings", "users"]),
    ).toEqual([{ name: "Users", href: "/dashboard/settings/users" }]);
  });
});
