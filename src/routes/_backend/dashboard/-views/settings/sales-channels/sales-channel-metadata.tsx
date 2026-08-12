import { salesChannelQueries } from "@queries/sales-channel.queries";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { updateSalesChannelMetadataAction } from "../commerce-actions";
import { MetadataEditorPage } from "@/routes/_backend/dashboard/-components/metadata-card/metadata-editor-page";

export default function SalesChannelMetadata() {
  const { id } = useParams({ strict: false }) as { id: string };
  const { data: result, isPending } = useQuery(salesChannelQueries.detail(id));
  const channel = result?.success ? result.data : undefined;
  return (
    <MetadataEditorPage
      id={id}
      description={channel?.name}
      metadata={channel?.metadata}
      isPending={isPending}
      errorMessage={result?.message}
      queryKey={salesChannelQueries.all()}
      action={updateSalesChannelMetadataAction}
    />
  );
}
