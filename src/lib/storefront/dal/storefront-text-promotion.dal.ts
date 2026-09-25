import { env } from "cloudflare:workers";
import type { StorefrontPageDocument } from "@/db/storefront.schema";
import type { ThemeSourceRevisionManifest } from "@/lib/storefront/dto/storefront-theme-file.dto";
import type { ThemeSourceIndex } from "../theme-source-index";
import {
  prepareIncrementThemeSourceGeneration,
  prepareRevisionInsert,
  prepareThemeFileUpdate,
  prepareThemeOwnershipGuard,
} from "./storefront-theme-file.dal";
import { prepareTemplateDocumentWrite } from "./storefront-theme.dal";

/**
 * Writes a component's promoted source and the page's value for the new field
 * as one D1 batch.
 *
 * The two halves are useless apart: a source with the field but no value on
 * the page shows the old text with nothing to say it was meant to change, and
 * a value for a field the source does not declare is refused by every later
 * write of that section. So every precondition of both — the Theme's source
 * generation, the file's version, the template's draft generation — is
 * checked by an error-raising guard before either is written, and D1 rolls
 * the whole batch back when one of them fails. A zero-row `UPDATE` would not
 * do that, which is why the guards are statements of their own.
 */

export type TextPromotionConflict =
  "source-generation" | "file-version" | "draft-generation";

export class TextPromotionConflictError extends Error {
  constructor(readonly conflict: TextPromotionConflict) {
    super(`TEXT_PROMOTION_CONFLICT: ${conflict}`);
  }
}

export async function commitTextPromotion(args: {
  storefrontId: string;
  themeId: string;
  expectedSourceGeneration: number;
  file: {
    path: string;
    fileId: string;
    expectedVersion: number;
    content: string;
    mimeType?: string | null;
  };
  template: {
    templateId: string;
    document: StorefrontPageDocument;
    draftRevisionId: string | null;
    publishedRevisionId: string | null;
    expectedDraftGeneration: number;
  };
  createdBy: string;
  revision?: { message: string; sourceManifest?: ThemeSourceRevisionManifest };
  sourceIndex?: ThemeSourceIndex;
}) {
  const now = new Date().toISOString();
  const fileWrite = prepareThemeFileUpdate({
    storefrontId: args.storefrontId,
    themeId: args.themeId,
    path: args.file.path,
    fileId: args.file.fileId,
    expectedVersion: args.file.expectedVersion,
    content: args.file.content,
    mimeType: args.file.mimeType,
    now,
  });
  const documentWrite = await prepareTemplateDocumentWrite(
    {
      storefrontId: args.storefrontId,
      themeId: args.themeId,
      templateId: args.template.templateId,
      document: args.template.document,
      // The document guard reads the generation before this batch raises it.
      sourceGeneration: args.expectedSourceGeneration,
      draftRevisionId: args.template.draftRevisionId,
      publishedRevisionId: args.template.publishedRevisionId,
      expectedDraftGeneration: args.template.expectedDraftGeneration,
      createdBy: args.createdBy,
    },
    now,
  );

  const statements = [
    prepareThemeOwnershipGuard(
      args.storefrontId,
      args.themeId,
      args.expectedSourceGeneration,
    ),
    fileWrite.guard,
    documentWrite.guard,
    fileWrite.mutation,
    ...documentWrite.mutations,
  ];
  if (args.revision) {
    statements.push(
      prepareRevisionInsert({
        storefrontId: args.storefrontId,
        themeId: args.themeId,
        revisionId: crypto.randomUUID(),
        message: args.revision.message,
        source: "manual",
        createdBy: args.createdBy,
        now,
        sourceGeneration: args.expectedSourceGeneration + 1,
        sourceManifest: args.revision.sourceManifest,
        sourceIndex: args.sourceIndex,
      }),
    );
  }
  statements.push(
    prepareIncrementThemeSourceGeneration(
      args.storefrontId,
      args.themeId,
      now,
      args.sourceIndex,
    ),
  );
  const fileMutationIndex = 3;

  let results: unknown[];
  try {
    results = (await env.DATABASE.batch(statements)) as unknown[];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("malformed JSON") || message.includes("constraint")) {
      throw new TextPromotionConflictError(await diagnoseConflict(args));
    }
    throw error;
  }

  const fileResult = results[fileMutationIndex] as any;
  const row = fileResult?.results?.[0] ?? fileResult?.[0];
  return {
    file: {
      path: args.file.path,
      id: args.file.fileId,
      content: args.file.content,
      version: Number(row?.version ?? args.file.expectedVersion + 1),
      updatedAt: String(row?.updated_at ?? now),
    },
    sourceGeneration: args.expectedSourceGeneration + 1,
    ...documentWrite.result,
  };
}

/** Which precondition a rolled-back batch failed, read after the fact. */
async function diagnoseConflict(
  args: Parameters<typeof commitTextPromotion>[0],
): Promise<TextPromotionConflict> {
  const theme = await env.DATABASE.prepare(
    `SELECT source_generation AS generation FROM storefront_themes
     WHERE id = ?1 AND storefront_id = ?2 AND deleted_at IS NULL`,
  )
    .bind(args.themeId, args.storefrontId)
    .first<{ generation: number }>();
  if (!theme || theme.generation !== args.expectedSourceGeneration) {
    return "source-generation";
  }
  const file = await env.DATABASE.prepare(
    `SELECT version FROM storefront_theme_files
     WHERE storefront_id = ?1 AND theme_id = ?2 AND path = ?3 AND id = ?4
       AND deleted_at IS NULL`,
  )
    .bind(args.storefrontId, args.themeId, args.file.path, args.file.fileId)
    .first<{ version: number }>();
  if (!file || file.version !== args.file.expectedVersion) {
    return "file-version";
  }
  return "draft-generation";
}
