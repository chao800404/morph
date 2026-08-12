import { dashboardUserQueries } from "@queries/dashboard-user.queries";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { updateUserMetadataAction } from "../commerce-actions";
import { MetadataEditorPage } from "@/routes/_backend/dashboard/-components/metadata-card/metadata-editor-page";

export default function UserMetadata() {
  const { id } = useParams({ strict: false }) as { id: string };
  const { data: result, isPending } = useQuery(dashboardUserQueries.detail(id));
  const user = result?.success ? result.data : undefined;
  return (
    <MetadataEditorPage
      id={id}
      description={user?.email}
      metadata={user?.metadata}
      isPending={isPending}
      errorMessage={result?.message}
      queryKey={dashboardUserQueries.all()}
      action={updateUserMetadataAction}
    />
  );
}
