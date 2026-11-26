import { MetadataEditorPage } from "@/routes/_backend/dashboard/-components/metadata-card/metadata-editor-page";
import { PAGE_DRAFT_CONFLICT } from "@/lib/storefront/page-write-errors";
import { storefrontPageQueries } from "@queries/storefront-page.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useRef } from "react";
import { updatePageMetadataAction } from "./page-actions";

export default function StorefrontPageMetadata() {
  const { id } = useParams({ strict: false }) as { id: string };
  const client = useQueryClient();
  const query = useQuery(storefrontPageQueries.detail(id));
  const page = query.data?.success ? query.data.data : null;
  // The draft version the metadata form was loaded with; see page-edit.tsx.
  const latest = useRef(page);
  latest.current = page;

  return (
    <MetadataEditorPage
      id={id}
      description={page?.title}
      metadata={page?.metadata}
      isPending={query.isPending}
      errorMessage={query.data?.message}
      queryKey={storefrontPageQueries.all()}
      action={async ({ data }) => {
        if (latest.current) {
          data.set("expectedDraftVersion", String(latest.current.version));
        }
        const result = await updatePageMetadataAction({ data });
        // Changed elsewhere: the latest Page is loaded and the editor stays
        // open with what was typed; saving again applies it.
        if ((result as { error?: string }).error === PAGE_DRAFT_CONFLICT) {
          await client.invalidateQueries({
            queryKey: storefrontPageQueries.detail(id).queryKey,
          });
        }
        return result;
      }}
    />
  );
}
