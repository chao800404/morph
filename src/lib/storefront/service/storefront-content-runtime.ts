import type { StorefrontTemplateType } from "@/db/storefront.schema";
import {
  MAX_THEME_CONTENT_SLOTS,
  isValidThemeContentSlotId,
  type ThemeContentSlotValues,
} from "../theme-content-slots";

/**
 * Template a request path resolves to.
 *
 * Only the paths a published Document can describe are mapped. A Theme route
 * with no Document simply has no slot values, which is not an error: the
 * component's own prop defaults are the correct result.
 */
export function templateTypeForPath(
  pathname: string,
): StorefrontTemplateType | null {
  const normalized = (pathname || "/").split("?")[0]!.replace(/\/+$/, "") || "/";
  if (normalized === "/") return "index";
  if (normalized.startsWith("/products/")) return "product";
  if (normalized.startsWith("/collections/")) return "collection";
  if (normalized.startsWith("/blogs/")) return "blog";
  if (normalized.startsWith("/pages/")) return "page";
  return null;
}

export type PublishedDocumentSection = Readonly<{
  id: string;
  enabled?: boolean;
  props?: Record<string, unknown> | null;
}>;

export type PublishedDocument = Readonly<{
  sections?: readonly PublishedDocumentSection[];
}>;

export type ContentRuntimePorts = Readonly<{
  /**
   * Published document for one template type inside a ContentPublication.
   *
   * Reads must be scoped to the publication the active release points at, so a
   * draft revision can never be served to the public runtime.
   */
  getPublishedDocument(args: {
    publicationId: string;
    templateType: StorefrontTemplateType;
  }): Promise<PublishedDocument | null>;
}>;

export type StorefrontContentResult = Readonly<{
  slots: ThemeContentSlotValues;
}>;

/**
 * Resolves the content a Theme route may render.
 *
 * Keyed by slot id, which is the Document section's own id, so the route's
 * `content("slot")` calls and the stored values meet without a registry in
 * between. Disabled sections contribute nothing, which is what lets an editor
 * hide a section without the Theme having to know about it.
 */
export async function resolveStorefrontContent(args: {
  publicationId: string | null;
  pathname: string;
  ports: ContentRuntimePorts;
}): Promise<StorefrontContentResult> {
  if (!args.publicationId) return { slots: {} };

  const templateType = templateTypeForPath(args.pathname);
  if (!templateType) return { slots: {} };

  const document = await args.ports.getPublishedDocument({
    publicationId: args.publicationId,
    templateType,
  });
  if (!document) return { slots: {} };

  const slots: Record<string, Record<string, unknown>> = {};
  let count = 0;
  for (const section of document.sections ?? []) {
    if (count >= MAX_THEME_CONTENT_SLOTS) break;
    if (!isValidThemeContentSlotId(section?.id)) continue;
    if (section.enabled === false) continue;
    const props = section.props;
    slots[section.id] =
      props && typeof props === "object" && !Array.isArray(props) ? props : {};
    count += 1;
  }

  return { slots };
}
