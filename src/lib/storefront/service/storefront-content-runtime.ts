import type { StorefrontTemplateType } from "@/db/storefront.schema";
import {
  MAX_THEME_CONTENT_SLOTS,
  isValidThemeContentSlotId,
  type ThemeContentSlotValues,
} from "../theme-content-slots";
import { resolveThemeLinksInSlotValues } from "../theme-link";
import {
  resolvePublishedThemeMediaUrl,
  resolveThemeMediaInSlotValues,
} from "../theme-media";

/**
 * Template a request path resolves to.
 *
 * Only the paths a published Document can describe are mapped. A Theme route
 * with no Document simply has no slot values, which is not an error: the
 * component's own prop defaults are the correct result.
 */
/**
 * The Page handle a path addresses, or `null`.
 *
 * Only the first segment after `/pages/` counts: a deeper path is not a Page
 * this can resolve, and treating it as one would answer with the wrong Page.
 */
export function pageHandleForPath(pathname: string): string | null {
  const normalized =
    (pathname || "/").split("?")[0]!.replace(/\/+$/, "") || "/";
  if (!normalized.startsWith("/pages/")) return null;

  const handle = normalized.slice("/pages/".length);
  if (!handle || handle.includes("/")) return null;
  return decodeURIComponent(handle);
}

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
  /**
   * Published document for one Page, by its handle.
   *
   * A Page is addressed by handle, not by template type, so it cannot be found
   * through the port above. Optional so a caller with no Pages is not forced
   * to implement it; without it a Page request falls back to the page template.
   */
  getPublishedPageDocument?(args: {
    publicationId: string;
    handle: string;
  }): Promise<PublishedDocument | null>;
}>;

export type StorefrontContentResult = Readonly<{
  slots: ThemeContentSlotValues;
  /**
   * Sections the author hid, named rather than omitted.
   *
   * An absent slot means "no stored values", for which a component's own
   * defaults are correct. A hidden section means "do not render this", and the
   * two cannot share a representation or hiding a section shows the defaults.
   */
  hiddenSlots: readonly string[];
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
  if (!args.publicationId) return { slots: {}, hiddenSlots: [] };

  const templateType = templateTypeForPath(args.pathname);
  if (!templateType) return { slots: {}, hiddenSlots: [] };

  // `/pages/<handle>` names a specific Page. Resolving it as the generic page
  // *template* made every Page render the same content, which is why two
  // published Pages were indistinguishable.
  const pageHandle = pageHandleForPath(args.pathname);
  const document =
    pageHandle && args.ports.getPublishedPageDocument
      ? ((await args.ports.getPublishedPageDocument({
          publicationId: args.publicationId,
          handle: pageHandle,
        })) ??
        // A handle with no published Page still has the template to fall back
        // on, which is what a Theme-only route relies on.
        (await args.ports.getPublishedDocument({
          publicationId: args.publicationId,
          templateType,
        })))
      : await args.ports.getPublishedDocument({
          publicationId: args.publicationId,
          templateType,
        });
  if (!document) return { slots: {}, hiddenSlots: [] };

  const slots: Record<string, Record<string, unknown>> = {};
  // Named rather than omitted. A slot that is simply absent is indistinguishable
  // from a route the Document never described, and the theme answers both the
  // same way: it renders the component with its own defaults. Hiding a section
  // in the editor therefore left it visible on the published site, wearing the
  // starter copy instead of the author's.
  const hiddenSlots: string[] = [];
  let count = 0;
  for (const section of document.sections ?? []) {
    if (count >= MAX_THEME_CONTENT_SLOTS) break;
    if (!isValidThemeContentSlotId(section?.id)) continue;
    if (section.enabled === false) {
      hiddenSlots.push(section.id);
      continue;
    }
    const props = section.props;
    slots[section.id] =
      props && typeof props === "object" && !Array.isArray(props)
        ? resolveThemeMediaInSlotValues(
            resolveThemeLinksInSlotValues(props as Record<string, unknown>),
            // Published content is read by anonymous visitors, so a library
            // asset cannot be delivered through the session-gated CMS URL.
            resolvePublishedThemeMediaUrl,
          )
        : {};
    count += 1;
  }

  return { slots, hiddenSlots };
}
