import type { StorefrontPageDocument } from "@/db/storefront.schema";
import type { ThemeRouteSectionResult } from "../compiler/theme-route-sections";
import {
  isSourceAnalysisRouteStructure,
  type SourceAnalysisRouteStructure,
} from "../dto/storefront-theme.dto";

/**
 * A slot declared by source may have no stored content yet. Its first edit
 * creates only that slot; the rest of the document always stays as stored.
 * Never persist the route projection, which can omit unbound stored content
 * and materialize unrelated slots. Callers still enforce their existing
 * source/capability checks and atomic source/draft generation guards.
 *
 * A template whose structure is left to source analysis (Astro) has no
 * projection here, so nothing is materialized from it.
 */
export function templateSectionWriteBase(
  template: Readonly<{
    document: StorefrontPageDocument;
    routeStructure?:
      ThemeRouteSectionResult | SourceAnalysisRouteStructure | null;
  }>,
  sectionId: string,
): StorefrontPageDocument {
  if (template.document.sections.some((section) => section.id === sectionId)) {
    return template.document;
  }
  const structure = template.routeStructure;
  if (
    !structure ||
    isSourceAnalysisRouteStructure(structure) ||
    structure.diagnostics.length > 0
  ) {
    return template.document;
  }
  const section = structure.sections.find(
    (candidate) => candidate.slotId === sectionId,
  );
  if (!section || section.missingComponentSourcePath) return template.document;
  return {
    ...template.document,
    sections: [
      ...template.document.sections,
      {
        id: section.slotId,
        type: section.sectionType,
        componentRef: section.componentRef,
        enabled: true,
        props: {},
      },
    ],
  };
}
