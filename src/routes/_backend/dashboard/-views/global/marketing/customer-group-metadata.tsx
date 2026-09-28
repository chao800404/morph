import { MetadataEditorPage } from "@/routes/_backend/dashboard/-components/metadata-card/metadata-editor-page";
import { customerGroupQueries } from "@queries/customer.queries";
import { useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { updateCustomerGroupMetadataAction } from "./customer-group-actions";

export default function CustomerGroupMetadata() {
  const { id } = useParams({ strict: false }) as { id: string };
  const { data: result, isPending } = useQuery(customerGroupQueries.detail(id));
  const group = result?.success ? result.data : null;
  return (
    <MetadataEditorPage
      id={id}
      description={group?.name}
      metadata={group?.metadata ?? undefined}
      isPending={isPending}
      errorMessage={result && !result.success ? result.message : undefined}
      queryKey={customerGroupQueries.all()}
      action={updateCustomerGroupMetadataAction}
    />
  );
}
