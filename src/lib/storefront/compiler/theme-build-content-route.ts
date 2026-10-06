import type { StorefrontContentPublicationItemDTO } from "../dto/storefront-content-publication.dto";

/** Route evidence from the publication only; never a current template/Page. */
export function frozenContentRoute(
  item: StorefrontContentPublicationItemDTO,
): string | undefined {
  if (item.itemType === "page" && item.metadata?.handle) {
    const path = `/pages/${encodeURIComponent(item.metadata.handle)}`;
    if (item.metadata.routePath && item.metadata.routePath !== path)
      throw new Error("SSG_CONTENT_ROUTE_MISMATCH");
    return path;
  }
  return (
    item.metadata?.routePath ??
    (item.metadata?.templateType === "index" ? "/" : undefined)
  );
}
