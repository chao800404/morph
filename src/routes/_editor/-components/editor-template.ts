import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import type { StorefrontThemeEditorSearch } from "@/lib/validations/storefront-theme";

type EditorTemplate = StorefrontThemeEditorDTO["templates"][number];

const templatePaths: Record<EditorTemplate["type"], string> = {
  index: "/",
  product: "/products/:handle",
  collection: "/collections/:handle",
  page: "/pages/:handle",
  blog: "/blogs/:handle",
};

/** Map a source-authored URL to the template document used for its content. */
export function templateTypeForRoute(path: string): EditorTemplate["type"] {
  if (path === "/") return "index";
  if (path === "/products" || path.startsWith("/products/")) {
    return "product";
  }
  if (path === "/collections" || path.startsWith("/collections/")) {
    return "collection";
  }
  if (path === "/blogs" || path.startsWith("/blogs/")) return "blog";
  return "page";
}

/**
 * The template the editor is loaded against.
 *
 * Always resolves to something: the editor context is fetched per template and
 * cannot load without one, so a route with no template of its own still has to
 * borrow an id. Use {@link templateAppliesToRoute} before treating the result
 * as the content behind the previewed page.
 */
export function resolveEditorTemplate(
  context: StorefrontThemeEditorDTO,
  search: StorefrontThemeEditorSearch,
) {
  return (
    context.templates.find((template) => template.id === search.templateId) ??
    context.templates.find((template) => template.type === search.template) ??
    context.templates[0]
  );
}

/**
 * Whether the loaded template is actually the one behind this route.
 *
 * `/aboutus` resolves to kind `page`, and a theme with only `index` and
 * `product` templates has none. The borrowed template keeps the editor
 * loading, but presenting its sections as the page's content is how the panel
 * came to offer the product template for editing while an About page was on
 * the canvas.
 */
export function templateAppliesToRoute(
  template: EditorTemplate | undefined,
  routePath: string | undefined,
): boolean {
  if (!template) return false;
  if (!routePath) return true;
  return template.type === templateTypeForRoute(routePath);
}

export function toEditorTemplateSearch(
  template: EditorTemplate,
): Pick<
  StorefrontThemeEditorSearch,
  "template" | "templateId" | "section" | "routePath"
> {
  return {
    template: template.type,
    templateId: template.id,
    section: undefined,
    routePath: undefined,
  };
}

export function toEditorRouteSearch(
  template: EditorTemplate,
  routePath: string,
): Pick<
  StorefrontThemeEditorSearch,
  "template" | "templateId" | "section" | "routePath"
> {
  return {
    ...toEditorTemplateSearch(template),
    routePath,
  };
}

export function resolveEditorTemplateDescriptor(
  template: EditorTemplate | undefined,
) {
  if (!template) return { name: "No template", path: "—" };

  return {
    name: template.type === "index" ? "Home" : template.name,
    path: templatePaths[template.type],
  };
}
