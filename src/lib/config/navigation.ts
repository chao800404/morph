import type { CollectionGroup, CollectionItem } from "./create-config";

/**
 * Every addressable collection, in one flat list.
 *
 * `items` nests a collection under another in the sidebar only — every
 * collection, nested or not, is addressed at `/dashboard/<slug>`. Keeping URLs
 * flat is what lets `/dashboard/<slug>/<id>` exist without colliding with a
 * two-segment collection path, and it is what Medusa does: `collections` and
 * `categories` are top-level there too.
 *
 * Flat does not mean prefixed. This once said Medusa uses `product-categories`
 * and `product-tags`; those are its *API* routes. Its dashboard addresses them
 * as `/categories` and `/collections`, and a slug only has to be unique across
 * the whole config, not namespaced by the collection it is nested under.
 */
export const getAllCollections = (
  groups: CollectionGroup[],
): CollectionItem[] => {
  const result: CollectionItem[] = [];
  for (const group of groups ?? []) {
    for (const collection of group.collections ?? []) {
      result.push(collection);
      for (const item of collection.items ?? []) {
        result.push(item);
      }
    }
  }
  return result;
};

/**
 * Slugs the dashboard's own routes already occupy.
 *
 * A collection using one of these would be silently unreachable, because a
 * static segment outranks the dynamic `$slug` that resolves collections.
 */
export const RESERVED_COLLECTION_SLUGS = ["create", "settings"] as const;

/**
 * Segments already routed beneath a record.
 *
 * A detail sub-page using one of these would be shadowed by the static route
 * and never render.
 */
export const RESERVED_DETAIL_PAGE_KEYS = ["edit"] as const;

/**
 * Fail the config rather than let a collection be unreachable.
 *
 * Two failure modes are silent otherwise: a slug that collides with a static
 * route never renders, and two collections sharing a slug under the same parent
 * mean the second is unaddressable. Both surface as "the page is just blank",
 * which is expensive to diagnose, so they are rejected where the config is
 * built.
 */
export const assertCollectionsAreAddressable = (
  groups: CollectionGroup[],
): void => {
  const seen = new Set<string>();

  const check = (slug: string) => {
    if (
      RESERVED_COLLECTION_SLUGS.includes(
        slug as (typeof RESERVED_COLLECTION_SLUGS)[number],
      )
    ) {
      throw new Error(
        `CMS Config: "${slug}" is a reserved slug. The dashboard routes that segment itself, so the collection would never render.`,
      );
    }
    if (seen.has(slug)) {
      throw new Error(
        `CMS Config: two collections share the slug "${slug}". Every collection is addressed at /dashboard/<slug>, so only the first would be reachable — nesting one under another in the sidebar does not give it a separate namespace.`,
      );
    }
    seen.add(slug);
  };

  for (const collection of getAllCollections(groups)) {
    check(collection.slug);

    for (const key of Object.keys(collection.pages ?? {})) {
      if (RESERVED_DETAIL_PAGE_KEYS.includes(key as "edit")) {
        throw new Error(
          `CMS Config: "${collection.slug}" declares a detail page "${key}", which is already a route beneath a record. It would never render.`,
        );
      }
    }
  }
};

/** Resolve the collection a dashboard URL addresses. */
export const findCollection = (
  groups: CollectionGroup[],
  slug: string,
): CollectionItem | undefined =>
  getAllCollections(groups).find((collection) => collection.slug === slug);

export interface BreadcrumbItem {
  name: string;
  href: string;
}

/**
 * Breadcrumbs for a dashboard path.
 *
 * URLs are flat, so a nested collection produces its parent as a label only —
 * the trail reads Products › Options while the last crumb links to
 * /dashboard/product-options, not to a path under /dashboard/products.
 */
export function findBreadcrumbsFromCollections(
  groups: CollectionGroup[],
  slugs: string[],
): BreadcrumbItem[] {
  if (!slugs || slugs.length === 0) return [];

  for (const group of groups ?? []) {
    const isGlobal = group.slug === "/" || group.slug === "";
    const groupMatches = !isGlobal && group.slug === slugs[0];
    const remainingSlugs = groupMatches ? slugs.slice(1) : slugs;

    if (isGlobal && slugs[0] === "settings") continue;

    const groupCrumb: BreadcrumbItem[] =
      !isGlobal && groupMatches
        ? [
            {
              name: group.slug === "settings" ? "Settings" : group.title,
              href: `/dashboard/${group.slug}`,
            },
          ]
        : [];

    if (groupMatches && remainingSlugs.length === 0) return groupCrumb;

    const prefix = `/dashboard${isGlobal ? "" : `/${group.slug}`}`;
    const target = remainingSlugs[0];

    for (const collection of group.collections ?? []) {
      if (collection.slug === target) {
        return [
          ...groupCrumb,
          {
            name: collection.label || collection.title,
            href: `${prefix}/${collection.slug}`,
          },
        ];
      }

      const item = collection.items?.find((child) => child.slug === target);
      if (item) {
        return [
          ...groupCrumb,
          {
            name: collection.label || collection.title,
            href: `${prefix}/${collection.slug}`,
          },
          {
            name: item.label || item.title,
            href: `${prefix}/${item.slug}`,
          },
        ];
      }
    }
  }

  return [];
}
