import { MetadataEditorPage } from "@/routes/_backend/dashboard/-components/metadata-card/metadata-editor-page";
import { storefrontPageQueries } from "@queries/storefront-page.queries";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { updatePageMetadataAction } from "./page-actions";

export default function StorefrontPageMetadata() {
  const { id } = useParams({ strict: false }) as { id: string };
  const query = useQuery(storefrontPageQueries.detail(id));
  const page = query.data?.success ? query.data.data : null;

  return (
    <MetadataEditorPage
      id={id}
      description={page?.title}
      metadata={page?.metadata}
      isPending={query.isPending}
      errorMessage={query.data?.message}
      queryKey={storefrontPageQueries.all()}
      action={updatePageMetadataAction}
    />
  );
}
