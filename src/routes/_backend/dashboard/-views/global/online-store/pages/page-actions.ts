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
  if (!id || !title || !handle || !documentText)
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
  if (!id || typeof raw !== "string")
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
  return updateStorefrontPageMetadata({ data: { id, metadata: parsed.data } });
};

export const restorePageRevisionAction = async (
  id: string,
  revisionId: string,
) => restoreStorefrontPageRevision({ data: { id, revisionId } });
