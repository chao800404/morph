import { storefrontPageDocumentSchema } from "@/lib/validations/storefront-page";
import {
  commitTextPromotion,
  TextPromotionConflictError,
  type TextPromotionConflict,
} from "../dal/storefront-text-promotion.dal";
import { storefrontThemeFileDal } from "../dal/storefront-theme-file.dal";
import {
  resolveSectionSourceComponent,
  storefrontThemeDal,
} from "../dal/storefront-theme.dal";
import {
  rewriteTextPromotion,
  type TextPromotionRewriteRefusal,
} from "../editor/text-promotion-rewrite";
import {
  confirmsTextPromotionImpact,
  textPromotionSharedImpact,
} from "../editor/text-promotion-impact";
import { recordsForWorkspaceSave } from "../storage/d1-theme-storage";

/**
 * The first Design edit of fixed text: the component gains a field whose
 * default is the text, and this page stores the edit as its value.
 *
 * Everything the editor saw is decided again here from what is saved — the
 * section, the component that renders it, whether the text can be promoted,
 * the name, and what else the component reaches — because the editor's view
 * may be stale and is the client's word. Then the source and the document are
 * written together or not at all (`commitTextPromotion`). After this, edits of
 * the field are ordinary content writes and never touch the source again.
 */

/** Longest value a promoted field takes in one edit. */
export const MAX_PROMOTED_TEXT_LENGTH = 10_000;

export type TextPromotionWriteInput = Readonly<{
  storefrontId: string;
  themeId: string;
  templateId: string;
  sectionId: string;
  /** The route the editor is showing; the layout's writes name none. */
  routePath?: string;
  componentSourcePath: string;
  targetKey: string;
  fieldName: string;
  value: string;
  expectedSourceGeneration: number;
  expectedFileVersion: number;
  expectedDraftGeneration: number;
  /** What the author confirmed the change reaches besides this section. */
  confirmedImpact?: readonly string[];
  createdBy: string;
}>;

export type TextPromotionWriteFailure =
  | Readonly<{ ok: false; error: "NOT_FOUND"; message: string }>
  | Readonly<{
      ok: false;
      error: "SECTION_SOURCE_UNCONFIRMED";
      message: string;
    }>
  | Readonly<{
      ok: false;
      error: "NOT_PROMOTABLE";
      reason: TextPromotionRewriteRefusal;
      message: string;
    }>
  | Readonly<{ ok: false; error: "INVALID_VALUE"; message: string }>
  | Readonly<{
      ok: false;
      error: "SHARED_IMPACT_UNCONFIRMED";
      impact: readonly string[];
      message: string;
    }>
  | Readonly<{
      ok: false;
      error: "CONFLICT";
      conflict: TextPromotionConflict;
      message: string;
    }>;

const CONFLICT_MESSAGES: Record<TextPromotionConflict, string> = {
  "source-generation":
    "The Theme source changed since this page was loaded. Refresh and try again.",
  "file-version":
    "The component changed since this page was loaded. Refresh and try again.",
  "draft-generation":
    "This page's content changed since it was loaded. Refresh and try again.",
};

function conflict(kind: TextPromotionConflict): TextPromotionWriteFailure {
  return {
    ok: false,
    error: "CONFLICT",
    conflict: kind,
    message: CONFLICT_MESSAGES[kind],
  };
}

export async function promoteTextToField(input: TextPromotionWriteInput) {
  if (input.value.length > MAX_PROMOTED_TEXT_LENGTH) {
    return {
      ok: false,
      error: "INVALID_VALUE",
      message: `Text is limited to ${MAX_PROMOTED_TEXT_LENGTH} characters.`,
    } satisfies TextPromotionWriteFailure;
  }

  const context = await storefrontThemeDal.findEditorContext(
    input.storefrontId,
    input.themeId,
  );
  const template = context?.templates.find(
    (candidate) => candidate.id === input.templateId,
  );
  const section = template?.document.sections.find(
    (candidate) => candidate.id === input.sectionId,
  );
  if (!context || !template || !section) {
    return {
      ok: false,
      error: "NOT_FOUND",
      message: "This section is no longer on the page. Refresh the editor.",
    } satisfies TextPromotionWriteFailure;
  }
  if (template.draftGeneration !== input.expectedDraftGeneration) {
    return conflict("draft-generation");
  }

  const sourceGeneration = await storefrontThemeFileDal.getSourceGeneration(
    input.storefrontId,
    input.themeId,
  );
  if (sourceGeneration !== input.expectedSourceGeneration) {
    return conflict("source-generation");
  }
  const files = await storefrontThemeFileDal.listFiles(
    input.storefrontId,
    input.themeId,
  );
  const file = files.find((item) => item.path === input.componentSourcePath);
  if (!file || file.version !== input.expectedFileVersion) {
    return conflict("file-version");
  }

  const source = resolveSectionSourceComponent({
    templateType: template.type,
    templateRoutePath: template.routePath,
    sectionId: input.sectionId,
    files,
    routePath: input.routePath,
  });
  if (source.kind !== "confirmed") {
    return {
      ok: false,
      error: "SECTION_SOURCE_UNCONFIRMED",
      message:
        source.kind === "unconfirmed"
          ? source.reason
          : "This Theme does not say which component renders the section.",
    } satisfies TextPromotionWriteFailure;
  }

  const rewrite = rewriteTextPromotion({
    files,
    componentSourcePath: input.componentSourcePath,
    sectionSourcePath: source.componentSourcePath,
    targetKey: input.targetKey,
    slotId: input.sectionId,
    routeSourcePath: template.type === "layout" ? null : source.callSitePath,
    fieldName: input.fieldName,
  });
  if (rewrite.status === "refused") {
    return {
      ok: false,
      error: "NOT_PROMOTABLE",
      reason: rewrite.reason,
      message: `This text cannot become a field (${rewrite.reason.replace(/-/g, " ")}).`,
    } satisfies TextPromotionWriteFailure;
  }

  const impact = textPromotionSharedImpact({
    files,
    componentSourcePath: input.componentSourcePath,
    callSitePath: source.callSitePath,
    templateId: template.id,
    slotId: input.sectionId,
    documents: context.templates.map((candidate) => ({
      templateId: candidate.id,
      label: candidate.routePath ?? candidate.name,
      sections: candidate.document.sections,
    })),
  });
  if (!confirmsTextPromotionImpact(impact, input.confirmedImpact)) {
    return {
      ok: false,
      error: "SHARED_IMPACT_UNCONFIRMED",
      impact,
      message:
        "This component is shared. Confirm everything the change reaches, or make a copy for this page first.",
    } satisfies TextPromotionWriteFailure;
  }

  const document = storefrontPageDocumentSchema.parse({
    ...template.document,
    sections: template.document.sections.map((candidate) =>
      candidate.id === input.sectionId
        ? {
            ...candidate,
            props: {
              ...((candidate.props as Record<string, unknown>) ?? {}),
              [rewrite.fieldName]: input.value,
            },
          }
        : candidate,
    ),
  });

  const records = await recordsForWorkspaceSave({
    storefrontId: input.storefrontId,
    themeId: input.themeId,
    expectedSourceGeneration: input.expectedSourceGeneration,
    files: [
      {
        path: file.path,
        content: rewrite.content,
        mimeType: file.mimeType ?? undefined,
      },
    ],
  });

  try {
    const committed = await commitTextPromotion({
      storefrontId: input.storefrontId,
      themeId: input.themeId,
      expectedSourceGeneration: input.expectedSourceGeneration,
      file: {
        path: file.path,
        fileId: file.id,
        expectedVersion: file.version,
        content: rewrite.content,
        mimeType: file.mimeType,
      },
      template: {
        templateId: template.id,
        document,
        draftRevisionId: template.draftRevisionId,
        publishedRevisionId: template.publishedRevisionId,
        expectedDraftGeneration: input.expectedDraftGeneration,
      },
      createdBy: input.createdBy,
      revision: records.createRevision
        ? {
            message: `Made "${rewrite.text.slice(0, 40)}" editable as ${rewrite.fieldName}`,
            sourceManifest: records.sourceManifest,
          }
        : undefined,
      sourceIndex: records.sourceIndex,
    });
    return { ok: true as const, fieldName: rewrite.fieldName, ...committed };
  } catch (error) {
    if (error instanceof TextPromotionConflictError) {
      return conflict(error.conflict);
    }
    throw error;
  }
}
