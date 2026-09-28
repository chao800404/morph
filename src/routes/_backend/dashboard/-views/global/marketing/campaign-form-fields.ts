import type { CampaignDTO } from "@/lib/promotion/dto/campaign.dto";
import type { FormField } from "@/lib/validations/form";

export type CampaignFormValues = {
  name: string;
  identifier: string;
  description: string;
  startsAt: string | null;
  endsAt: string | null;
  budgetType:
    "none" | "usage" | "spend" | "use_by_attribute" | "spend_by_attribute";
  budgetLimit: string;
  currencyCode: string;
  attribute: "customer_id" | "email";
};

const toLocalInputValue = (value: string | null | undefined) => {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
};

export const campaignFormValues = (
  campaign?: CampaignDTO,
): CampaignFormValues => ({
  name: campaign?.name ?? "",
  identifier: campaign?.identifier ?? "",
  description: campaign?.description ?? "",
  startsAt: campaign?.startsAt ?? null,
  endsAt: campaign?.endsAt ?? null,
  budgetType: campaign?.budget?.type ?? "none",
  budgetLimit:
    campaign?.budget?.limit === null || campaign?.budget?.limit === undefined
      ? ""
      : String(campaign.budget.limit),
  currencyCode: campaign?.budget?.currencyCode ?? "",
  attribute: campaign?.budget?.attribute === "email" ? "email" : "customer_id",
});

export const campaignFormFields = (
  values: CampaignFormValues = campaignFormValues(),
  mode: "create" | "edit" = "create",
): FormField[] => {
  const fields: FormField[] = [
    {
      type: "input",
      name: "name",
      label: "Name",
      value: values.name,
      placeholder: "Summer campaign",
      required: true,
      autoFocus: true,
    },
    {
      type: "input",
      name: "identifier",
      label: "Identifier",
      value: values.identifier,
      placeholder: "summer-2026",
      required: true,
      description: "A stable identifier used to reference this campaign.",
    },
    {
      type: "textarea",
      name: "description",
      label: "Description",
      value: values.description,
      optional: true,
    },
    {
      type: "input",
      name: "startsAt",
      label: "Starts at",
      inputType: "datetime-local",
      value: toLocalInputValue(values.startsAt),
      optional: true,
    },
    {
      type: "input",
      name: "endsAt",
      label: "Ends at",
      inputType: "datetime-local",
      value: toLocalInputValue(values.endsAt),
      optional: true,
    },
  ];

  if (mode === "edit") {
    if (values.budgetType !== "none") {
      fields.push({
        type: "input",
        name: "budgetLimit",
        label: "Budget limit",
        inputType: "number",
        step: 1,
        value: values.budgetLimit,
        optional: true,
        description:
          "Leave empty for no limit. The limit cannot be lower than the amount already used.",
      });
    }
    return fields;
  }

  fields.push({
    type: "select",
    name: "budgetType",
    label: "Budget",
    value: values.budgetType,
    options: [
      { value: "none", label: "No budget" },
      { value: "usage", label: "Total usage" },
      { value: "spend", label: "Total spend" },
      { value: "use_by_attribute", label: "Usage per customer or email" },
      { value: "spend_by_attribute", label: "Spend per customer or email" },
    ],
  });
  if (values.budgetType !== "none") {
    fields.push({
      type: "input",
      name: "budgetLimit",
      label: "Budget limit",
      inputType: "number",
      step: 1,
      value: values.budgetLimit,
      optional: true,
      description: "Leave empty for no limit.",
    });
  }
  if (
    values.budgetType === "spend" ||
    values.budgetType === "spend_by_attribute"
  ) {
    fields.push({
      type: "input",
      name: "currencyCode",
      label: "Currency code",
      value: values.currencyCode,
      placeholder: "twd",
      required: true,
      description: "Three-letter currency code, such as TWD or USD.",
    });
  }
  if (
    values.budgetType === "use_by_attribute" ||
    values.budgetType === "spend_by_attribute"
  ) {
    fields.push({
      type: "select",
      name: "attribute",
      label: "Track budget by",
      value: values.attribute,
      options: [
        { value: "customer_id", label: "Customer" },
        { value: "email", label: "Email" },
      ],
    });
  }
  return fields;
};

export const parseCampaignDate = (
  value: FormDataEntryValue | null,
): string | null => {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : value;
};

export const parseCampaignLimit = (
  value: FormDataEntryValue | null,
): number | null => {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : Number.NaN;
};
