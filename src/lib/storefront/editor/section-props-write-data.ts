/**
 * The body of one `updateStorefrontThemeSectionProps` call, as the editor
 * sends it. One place, so what a Start write sends and what an Astro write
 * adds are read side by side.
 *
 * `identity` and `componentDigest` (M2 P5/P6) are sent only together, and
 * only when the write is of a confirmed Astro Design selection
 * (`astroWriteIdentity`). They are claims: Core verifies both on the source
 * it writes against and refuses the write otherwise. A Start write carries
 * neither, so it is sent exactly as before.
 */
export type SectionPropsWriteVariables = Readonly<{
  sectionId: string;
  props: Record<string, unknown>;
  expectedDraftGeneration: number;
  expectedSourceGeneration: number;
  templateId?: string;
  routePath?: string;
  resetProps?: readonly string[];
  identity?: string;
  componentDigest?: string;
}>;

export type SectionPropsWriteData = {
  storefrontId: string;
  themeId: string;
  templateId: string;
  sectionId: string;
  props: Record<string, unknown>;
  expectedDraftGeneration: number;
  expectedSourceGeneration: number;
  routePath?: string;
  resetProps?: string[];
  identity?: string;
  componentDigest?: string;
};

export function sectionPropsWriteData(
  scope: Readonly<{
    storefrontId: string;
    themeId: string;
    /** The editor's active template, used when the write names none. */
    activeTemplateId: string;
  }>,
  variables: SectionPropsWriteVariables,
): SectionPropsWriteData {
  return {
    storefrontId: scope.storefrontId,
    themeId: scope.themeId,
    templateId: variables.templateId ?? scope.activeTemplateId,
    sectionId: variables.sectionId,
    props: variables.props,
    expectedDraftGeneration: variables.expectedDraftGeneration,
    expectedSourceGeneration: variables.expectedSourceGeneration,
    ...(variables.routePath ? { routePath: variables.routePath } : {}),
    ...(variables.resetProps?.length
      ? { resetProps: [...variables.resetProps] }
      : {}),
    ...(variables.identity && variables.componentDigest
      ? {
          identity: variables.identity,
          componentDigest: variables.componentDigest,
        }
      : {}),
  };
}
