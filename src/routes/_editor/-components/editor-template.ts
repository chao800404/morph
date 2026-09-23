import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import type { StorefrontThemeEditorSearch } from "@/lib/validations/storefront-theme";
import {
  contentTargetForRoutePath,
  templateTypeForRoutePath,
} from "@/lib/storefront/theme-template-routes";
import { GLOBAL_LAYOUT_LABEL } from "./editor-layout-labels";

type EditorTemplate = StorefrontThemeEditorDTO["templates"][number];

const templatePaths: Record<EditorTemplate["type"], string> = {
  index: "/",
  product: "/products/:handle",
  collection: "/collections/:handle",
  page: "/pages/:handle",
  blog: "/blogs/:handle",
  // No URL resolves to the layout; it is the shell every path renders inside.
  layout: GLOBAL_LAYOUT_LABEL,
};

/**
 * The kind of page a source-authored URL is, for display and navigation.
 *
 * A static route no type covers (`/aboutus`) is a page; its content lives in a
 * document of its own, which {@link templateForRoute} finds.
 */
export function templateTypeForRoute(path: string): EditorTemplate["type"] {
  return templateTypeForRoutePath(path) ?? "page";
}

/**
 * The template that stores this route's content, if it exists yet.
 *
 * A route a type covers shares that type's document; a static route no type
 * covers has one of its own, bound by path. The two never stand in for each
 * other: a route's own document answers for no other path, and a type's
 * document is not where a route of its own keeps its values.
 */
export function templateForRoute(
  templates: readonly EditorTemplate[],
  routePath: string,
): EditorTemplate | undefined {
  const target = contentTargetForRoutePath(routePath);
  if (target.kind === "template") {
    return templates.find(
      (template) => template.type === target.type && !template.routePath,
    );
  }
  if (target.kind === "route") {
    return templates.find(
      (template) => template.routePath === target.routePath,
    );
  }
  return undefined;
}

/** Placeholder binding for a route whose own document is created on first write. */
const ROUTE_TEMPLATE_PLACEHOLDER_PREFIX = "route-template:";

export function routeTemplatePlaceholderId(routePath: string): string {
  return `${ROUTE_TEMPLATE_PLACEHOLDER_PREFIX}${routePath}`;
}

/** The route a placeholder binding stands for, or null for a real template id. */
export function routePathFromTemplatePlaceholder(
  templateId: string,
): string | null {
  return templateId.startsWith(ROUTE_TEMPLATE_PLACEHOLDER_PREFIX)
    ? templateId.slice(ROUTE_TEMPLATE_PLACEHOLDER_PREFIX.length)
    : null;
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
  // The shell is not a page. It is stored as a template because it is a
  // versioned content document, but no URL resolves to it, so opening the
  // editor "on" it would present the header as the content of the page on the
  // canvas — and route every page edit into the wrong document.
  const pages = context.templates.filter(
    (template) => template.type !== "layout",
  );
  // The route decides, when there is one: a URL can carry a template id that
  // was borrowed before this route's own document existed.
  const routeTemplate = search.routePath
    ? templateForRoute(pages, search.routePath)
    : undefined;
  // A route's own document is never a fallback for a type, for "any page",
  // or — when a route is named — for a different route.
  const shared = pages.filter((template) => !template.routePath);
  const byId = (search.routePath ? shared : pages).find(
    (template) => template.id === search.templateId,
  );
  return (
    routeTemplate ??
    byId ??
    shared.find((template) => template.type === search.template) ??
    shared[0] ??
    pages[0]
  );
}

/**
 * Give the editor a complete template identity before it creates the preview
 * iframe. Shared/bookmarked URLs may omit `templateId`; letting the shell add
 * it in an effect starts one preview session and immediately navigates the
 * route underneath it, which can strand the initial preview handshake.
 */
export function normalizeEditorTemplateSearch(
  context: StorefrontThemeEditorDTO,
  search: StorefrontThemeEditorSearch,
): StorefrontThemeEditorSearch {
  const template = resolveEditorTemplate(context, search);
  if (
    !template ||
    (search.templateId === template.id && search.template === template.type)
  ) {
    return search;
  }

  return {
    ...search,
    template: template.type,
    templateId: template.id,
  };
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
  if (!routePath) return !template.routePath;
  const target = contentTargetForRoutePath(routePath);
  if (target.kind === "template") {
    return template.type === target.type && !template.routePath;
  }
  if (target.kind === "route") return template.routePath === target.routePath;
  return false;
}

/**
 * Whether this route keeps its content in a document of its own.
 *
 * True before that document exists, too: the route's sections are its own
 * either way, and the first write creates the document they are stored in.
 */
export function routeOwnsDocument(routePath: string | undefined): boolean {
  return Boolean(
    routePath && contentTargetForRoutePath(routePath).kind === "route",
  );
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
