import type { CollectionGroup, CollectionItem } from "@/lib/config/create-config";
import { describe, expect, it } from "vitest";
import { Account } from "./account";
import { Contents } from "./contents";
import { General } from "./general";
import { Marketing } from "./marketing";

const collections = (groups: CollectionGroup[]) =>
  groups.flatMap((group) =>
    group.collections.flatMap((collection) => [
      collection,
      ...(collection.items ?? []),
    ]),
  );

describe("dashboard breadcrumb contract", () => {
  const items = collections([Marketing, Contents, General, Account]);

  it("gives every record detail a loader-resolved label", () => {
    const missing = items
      .filter((item) => item.detail && !item.detail.breadcrumb)
      .map((item) => item.slug);

    expect(missing).toEqual([]);
  });

  it("gives every replacing child page its own loader-resolved label", () => {
    const missing = items.flatMap((item: CollectionItem) =>
      Object.entries(item.pages ?? {})
        .filter(
          ([, page]) =>
            page.presentation === "replace" && !page.breadcrumb,
        )
        .map(([key]) => `${item.slug}/${key}`),
    );

    expect(missing).toEqual([]);
  });
});
