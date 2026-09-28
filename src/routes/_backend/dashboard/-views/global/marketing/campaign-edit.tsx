import { RouteSurfaceMessage } from "@/components/dialog/route-surface-message";
import { RouteSurfacePending } from "@/components/dialog/route-surface-pending";
import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { updateCampaignInputSchema } from "@/lib/validations/campaign";
import { updateCampaign } from "@/server/marketing/campaigns.serverFn";
import { campaignQueries } from "@queries/campaign.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useMemo } from "react";
import { toast } from "sonner";
import {
  campaignFormFields,
  campaignFormValues,
  parseCampaignDate,
  parseCampaignLimit,
} from "./campaign-form-fields";

export default function CampaignEdit() {
  const { id } = useParams({ strict: false }) as { id: string };
  const close = useRouteModalClose();
  const queryClient = useQueryClient();
  const campaignQuery = useQuery(campaignQueries.detail(id));
  const campaign = campaignQuery.data?.success ? campaignQuery.data.data : null;
  const values = useMemo(
    () => campaignFormValues(campaign ?? undefined),
    [campaign],
  );

  if (campaignQuery.isPending) return <RouteSurfacePending />;
  if (!campaign)
    return (
      <RouteSurfaceMessage>
        {campaignQuery.data?.message ?? "Campaign not found"}
      </RouteSurfaceMessage>
    );

  const submit = async (
    _state: RouteFormState,
    formData: FormData,
  ): Promise<RouteFormState> => {
    const payload = {
      id,
      name: String(formData.get("name") ?? ""),
      identifier: String(formData.get("identifier") ?? ""),
      description: String(formData.get("description") ?? ""),
      startsAt: parseCampaignDate(formData.get("startsAt")) ?? "",
      endsAt: parseCampaignDate(formData.get("endsAt")) ?? "",
      ...(campaign.budget
        ? { budgetLimit: parseCampaignLimit(formData.get("budgetLimit")) }
        : {}),
    };
    const parsed = updateCampaignInputSchema.safeParse(payload);
    if (!parsed.success) {
      const message =
        parsed.error.issues[0]?.message ?? "Invalid campaign details";
      toast.error(message, { position: "top-center" });
      return { success: false, message };
    }
    const response = await updateCampaign({ data: parsed.data });
    if (!response.success) {
      toast.error(response.message, { position: "top-center" });
      return response;
    }
    await queryClient.invalidateQueries({ queryKey: campaignQueries.all() });
    toast.success(response.message, { position: "top-center" });
    close();
    return response;
  };

  return (
    <RouteFormPage
      title="Edit Campaign"
      description={campaign.name}
      action={submit}
      submitLabel="Save"
      loadingLabel="Saving..."
      fields={campaignFormFields(values, "edit")}
    />
  );
}
