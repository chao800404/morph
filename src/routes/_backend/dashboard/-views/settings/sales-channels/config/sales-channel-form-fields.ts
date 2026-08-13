import type { FormField } from "@/lib/validations/form";
import {
  SALES_CHANNEL_TYPE_OPTIONS,
  type SalesChannelType,
} from "@/lib/sales-channel/types";

type SalesChannelFormValues = {
  name: string;
  type: SalesChannelType;
  description?: string | null;
  isDisabled: boolean;
};

export const salesChannelFormFields = (
  values?: SalesChannelFormValues,
): FormField[] => [
  {
    type: "input",
    name: "name",
    label: "Name",
    value: values?.name,
    required: true,
    autoFocus: true,
  },
  {
    type: "select",
    name: "type",
    label: "Type",
    description: values
      ? "The channel type is fixed after creation."
      : "Choose how this channel delivers products to customers.",
    value: values?.type ?? "custom",
    options: SALES_CHANNEL_TYPE_OPTIONS,
    disabled: Boolean(values),
  },
  {
    type: "textarea",
    name: "description",
    label: "Description",
    value: values?.description ?? undefined,
    rows: 3,
  },
  {
    type: "switch",
    name: "enabled",
    label: "Enabled",
    description: "Specify whether the sales channel is enabled.",
    value: values ? !values.isDisabled : true,
  },
];
