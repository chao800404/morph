import type { StorefrontPageDocument } from "@/db/storefront.schema";
import {
  createStorefrontPage,
  restoreStorefrontPageRevision,
  updateStorefrontPage,
  updateStorefrontPageMetadata,
} from "@/server/storefront/storefront-pages.serverFn";
import { metadataInputSchema } from "@/lib/validations/product";
import { storefrontPageDocumentSchema } from "@/lib/validations/storefront-page";

const text = (data: FormData, key: string) => {
  const value = data.get(key);
  return typeof value === "string" ? value.trim() : "";
};

const checked = (data: FormData, key: string) => {
  const value = data.get(key);
  return value === "true" || value === "on";
};

/**
 * The draft revision `version` the form was loaded with. Every Page draft
 * write sends it, and the server refuses the write as `PAGE_DRAFT_CONFLICT`
 * when the draft has moved since (`page-write-errors.ts`).
 */
const draftVersion = (data: FormData) => {
  const value = Number(text(data, "expectedDraftVersion"));
  return Number.isSafeInteger(value) && value >= 1 ? value : null;
};

export const createPageAction = async ({ data }: { data: FormData }) => {
  const title = text(data, "title");
  if (!title)
    return {
      success: false,
      message: "Title is required",
      errors: { title: ["Title is required"] },
    };
  return createStorefrontPage({
    data: {
      title,
      handle: text(data, "handle") || undefined,
      publish: checked(data, "publish"),
    },
  });
};

export const updatePageAction = async ({ data }: { data: FormData }) => {
  const id = text(data, "id");
  const title = text(data, "title");
  const handle = text(data, "handle");
  const documentText = text(data, "document");
  const expectedDraftVersion = draftVersion(data);
  if (!id || !title || !handle || !documentText || !expectedDraftVersion)
    return { success: false, message: "Page data is incomplete" };
  let documentInput: unknown;
  try {
    documentInput = JSON.parse(documentText);
  } catch {
    return { success: false, message: "Page document is invalid" };
  }
  const parsedDocument = storefrontPageDocumentSchema.safeParse(documentInput);
  if (!parsedDocument.success)
    return { success: false, message: "Page document is invalid" };
  return updateStorefrontPage({
    data: {
      id,
      title,
      handle,
      document: parsedDocument.data satisfies StorefrontPageDocument,
      publish: checked(data, "publish"),
      expectedDraftVersion,
    },
  });
};

export const updatePageMetadataAction = async ({
  data,
}: {
  data: FormData;
}) => {
  const id = text(data, "id");
  const raw = data.get("metadata");
  const expectedDraftVersion = draftVersion(data);
  if (!id || typeof raw !== "string" || !expectedDraftVersion)
    return { success: false, message: "Page metadata is incomplete" };
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    return { success: false, message: "Page metadata is invalid" };
  }
  const parsed = metadataInputSchema.safeParse(input);
  if (!parsed.success)
    return { success: false, message: "Page metadata is invalid" };
  return updateStorefrontPageMetadata({
    data: { id, metadata: parsed.data, expectedDraftVersion },
  });
};

export const restorePageRevisionAction = async (
  id: string,
  revisionId: string,
  expectedDraftVersion: number,
) =>
  restoreStorefrontPageRevision({
    data: { id, revisionId, expectedDraftVersion },
  });
