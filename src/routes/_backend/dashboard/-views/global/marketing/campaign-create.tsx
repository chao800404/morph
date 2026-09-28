import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import type { FormFieldValue } from "@/lib/validations/form";
import { createCampaignInputSchema } from "@/lib/validations/campaign";
import { createCampaign } from "@/server/marketing/campaigns.serverFn";
import { campaignQueries } from "@queries/campaign.queries";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  campaignFormFields,
  campaignFormValues,
  parseCampaignDate,
  parseCampaignLimit,
  type CampaignFormValues,
} from "./campaign-form-fields";

export default function CampaignCreate() {
  const close = useRouteModalClose();
  const queryClient = useQueryClient();
  const [values, setValues] = useState(campaignFormValues());
  const fields = campaignFormFields(values, "create");
  const onFieldChange = (name: string, value: FormFieldValue | File[]) => {
    if (typeof value !== "string") return;
    if (!(name in values)) return;
    setValues(
      (current) =>
        ({
          ...current,
          [name]: value,
        }) as CampaignFormValues,
    );
  };

  const submit = async (
    _state: RouteFormState,
    formData: FormData,
  ): Promise<RouteFormState> => {
    const budgetType = String(formData.get("budgetType") ?? "none");
    const budget =
      budgetType === "none"
        ? null
        : {
            type: budgetType as Exclude<
              CampaignFormValues["budgetType"],
              "none"
            >,
            limit: parseCampaignLimit(formData.get("budgetLimit")),
            ...(budgetType === "spend" || budgetType === "spend_by_attribute"
              ? {
                  currencyCode: String(
                    formData.get("currencyCode") ?? "",
                  ).trim(),
                }
              : {}),
            ...(budgetType === "use_by_attribute" ||
            budgetType === "spend_by_attribute"
              ? {
                  attribute: String(formData.get("attribute") ?? "customer_id"),
                }
              : {}),
          };
    const payload = {
      name: String(formData.get("name") ?? ""),
      identifier: String(formData.get("identifier") ?? ""),
      description: String(formData.get("description") ?? ""),
      startsAt: parseCampaignDate(formData.get("startsAt")) ?? "",
      endsAt: parseCampaignDate(formData.get("endsAt")) ?? "",
      budget,
    };
    const parsed = createCampaignInputSchema.safeParse(payload);
    if (!parsed.success) {
      const message =
        parsed.error.issues[0]?.message ??
        "Review the campaign details and try again.";
      toast.error(message, { position: "top-center" });
      return { success: false, message };
    }
    const response = await createCampaign({ data: parsed.data });
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
      title="Create Campaign"
      description="Set a campaign schedule and optional usage or spend budget."
      action={submit}
      fields={fields}
      onFieldChange={onFieldChange}
    />
  );
}
