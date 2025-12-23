import { CollectionGroup } from "./create-config";

export interface BreadcrumbItem {
  name: string;
  href: string;
}

/**
 * Find breadcrumb path from collections
 */
export function findBreadcrumbsFromCollections(
  groups: CollectionGroup[],
  slugs: string[],
): BreadcrumbItem[] {
  if (!slugs || slugs.length === 0) {
    return [];
  }

  const breadcrumbs: BreadcrumbItem[] = [];

  for (const group of groups ?? []) {
    const isGlobal = group.slug === "/" || group.slug === "";
    const groupMatches = !isGlobal && group.slug === slugs[0];

    // If the group matches (e.g., 'settings'), the collections are searched using the next slug
    const remainingSlugs = groupMatches ? slugs.slice(1) : slugs;

    // If we're in a global group but the first slug isn't found in its collections,
    // it might be meant for another group (like 'settings')
    if (isGlobal && slugs[0] === "settings") continue;

    if (groupMatches && remainingSlugs.length === 0) {
      return [
        {
          name: group.slug === "settings" ? "Settings" : group.title,
          href: `/dashboard/${group.slug}`,
        },
      ];
    }

    for (const collection of group.collections ?? []) {
      if (collection.slug === remainingSlugs[0]) {
        // Add group to breadcrumbs if it's not global
        if (!isGlobal && groupMatches) {
          breadcrumbs.push({
            name: group.slug === "settings" ? "Settings" : group.title,
            href: `/dashboard/${group.slug}`,
          });
        }

        breadcrumbs.push({
          name: collection.label || collection.title,
          href: `/dashboard${isGlobal ? "" : `/${group.slug}`}/${collection.slug}`,
        });

        if (remainingSlugs.length > 1 && collection.items) {
          for (let i = 1; i < remainingSlugs.length; i++) {
            const item = collection.items.find(
              (item) => item.slug === remainingSlugs[i],
            );
            if (item) {
              const prevHref = breadcrumbs[breadcrumbs.length - 1].href;
              breadcrumbs.push({
                name: item.label || item.title,
                href: `${prevHref}/${item.slug}`,
              });
            }
          }
        }
        return breadcrumbs;
      }
    }
  }

  return breadcrumbs;
}
