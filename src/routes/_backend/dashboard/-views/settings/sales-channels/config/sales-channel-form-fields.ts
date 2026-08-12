import type { FormField } from "@/lib/validations/form";

type SalesChannelFormValues = {
  name: string;
  description?: string | null;
  isDisabled: boolean;
};

export const salesChannelFormFields = (
  values?: SalesChannelFormValues,
): FormField[] => [
  { type: "input", name: "name", label: "Name", value: values?.name, required: true, autoFocus: true },
  { type: "textarea", name: "description", label: "Description", value: values?.description ?? undefined, rows: 3 },
  {
    type: "switch",
    name: "enabled",
    label: "Enabled",
    description: "Specify whether the sales channel is enabled.",
    value: values ? !values.isDisabled : true,
  },
];
