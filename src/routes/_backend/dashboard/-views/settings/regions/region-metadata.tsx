import { regionQueries } from "@queries/region.queries";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { updateRegionMetadataAction } from "../commerce-actions";
import { MetadataEditorPage } from "@/routes/_backend/dashboard/-components/metadata-card/metadata-editor-page";

export default function RegionMetadata() {
  const { id } = useParams({ strict: false }) as { id: string };
  const { data: result, isPending } = useQuery(regionQueries.detail(id));
  const region = result?.success ? result.data : undefined;
  return (
    <MetadataEditorPage
      id={id}
      description={region?.name}
      metadata={region?.metadata}
      isPending={isPending}
      errorMessage={result?.message}
      queryKey={regionQueries.all()}
      action={updateRegionMetadataAction}
    />
  );
}
