import { MetadataEditorPage } from "@/routes/_backend/dashboard/-components/metadata-card/metadata-editor-page";
import { promotionQueries } from "@queries/marketing.queries";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { updatePromotionMetadataAction } from "./marketing-actions";

export default function PromotionMetadata() {
  const { id } = useParams({ strict: false }) as { id: string };
  const { data: result, isPending } = useQuery(promotionQueries.detail(id));
  const promotion = result?.success ? result.data : undefined;
  return (
    <MetadataEditorPage
      id={id}
      description={promotion?.code}
      metadata={promotion?.metadata}
      isPending={isPending}
      errorMessage={result?.message}
      queryKey={promotionQueries.all()}
      action={updatePromotionMetadataAction}
    />
  );
}
