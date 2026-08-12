import { MetadataEditorPage } from "@/routes/_backend/dashboard/-components/metadata-card/metadata-editor-page";
import { orderQueries } from "@queries/marketing.queries";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { updateOrderMetadataAction } from "../marketing-actions";

export default function OrderMetadata() {
  const { id } = useParams({ strict: false }) as { id: string };
  const { data: result, isPending } = useQuery(orderQueries.detail(id));
  const order = result?.success ? result.data : undefined;
  return (
    <MetadataEditorPage
      id={id}
      description={order ? `Order #${order.displayId}` : undefined}
      metadata={order?.metadata}
      isPending={isPending}
      errorMessage={result?.message}
      queryKey={orderQueries.all()}
      action={updateOrderMetadataAction}
    />
  );
}
