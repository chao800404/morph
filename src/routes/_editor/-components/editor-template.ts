import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import type { StorefrontThemeEditorSearch } from "@/lib/validations/storefront-theme";

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

export function toEditorTemplateSearch(
  template: StorefrontThemeEditorDTO["templates"][number],
): Pick<StorefrontThemeEditorSearch, "template" | "templateId" | "section"> {
  return {
    template: template.type,
    templateId: template.id,
    section: undefined,
  };
}
