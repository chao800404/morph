import type {
  storefrontPageRevisions,
  storefrontPages,
} from "@/db/storefront.schema";
import type {
  StorefrontPageDTO,
  StorefrontPageRevisionDTO,
  StorefrontPageSummaryDTO,
} from "../dto/storefront-page.dto";

type PageRow = typeof storefrontPages.$inferSelect;
type RevisionRow = typeof storefrontPageRevisions.$inferSelect;

export const toStorefrontPageSummaryDTO = (
  row: PageRow,
): StorefrontPageSummaryDTO => ({
  id: row.id,
  title: row.title,
  handle: row.handle,
  status: row.status,
  updatedAt: row.updatedAt,
});

export const toStorefrontPageDTO = (
  row: PageRow,
  revision: RevisionRow,
): StorefrontPageDTO => ({
  ...toStorefrontPageSummaryDTO(row),
  createdAt: row.createdAt,
  version: revision.version,
  document: revision.document,
  publishedRevisionId: row.publishedRevisionId,
  metadata: row.metadata ?? {},
});

export const toStorefrontPageRevisionDTO = (
  revision: RevisionRow,
  page: Pick<PageRow, "draftRevisionId" | "publishedRevisionId">,
): StorefrontPageRevisionDTO => ({
  id: revision.id,
  version: revision.version,
  createdAt: revision.createdAt,
  publishedAt: revision.publishedAt,
  isDraft: page.draftRevisionId === revision.id,
  isPublished: page.publishedRevisionId === revision.id,
});
