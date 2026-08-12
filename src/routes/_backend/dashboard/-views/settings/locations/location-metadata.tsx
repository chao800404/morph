import { stockLocationQueries } from "@queries/stock-location.queries";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { updateLocationMetadataAction } from "../commerce-actions";
import { MetadataEditorPage } from "@/routes/_backend/dashboard/-components/metadata-card/metadata-editor-page";

export default function LocationMetadata() {
  const { id } = useParams({ strict: false }) as { id: string };
  const { data: result, isPending } = useQuery(stockLocationQueries.detail(id));
  const location = result?.success ? result.data : undefined;
  return (
    <MetadataEditorPage
      id={id}
      description={location?.name}
      metadata={location?.metadata}
      isPending={isPending}
      errorMessage={result?.message}
      queryKey={stockLocationQueries.all()}
      action={updateLocationMetadataAction}
    />
  );
}
