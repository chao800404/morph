import type { StorefrontTemplateType } from "@/db/storefront.schema";

/**
 * The template document a source-authored URL stores its content in.
 *
 * Shared by the editor, which decides where a write goes, and the server,
 * which decides what that write is allowed to contain. Two copies of this rule
 * would let them disagree about which route a template belongs to — and the
 * server would then check an edit against a component the author never saw.
 *
 * The layout is never the answer: no URL resolves to it.
 */
export function templateTypeForRoutePath(
  path: string,
): Exclude<StorefrontTemplateType, "layout"> {
  if (path === "/") return "index";
  if (path === "/products" || path.startsWith("/products/")) return "product";
  if (path === "/collections" || path.startsWith("/collections/")) {
    return "collection";
  }
  if (path === "/blogs" || path.startsWith("/blogs/")) return "blog";
  return "page";
}
