import type { PromotionDetailDTO } from "@/lib/commerce/dto";
import type { FormField } from "@/lib/validations/form";

type PromotionCommonFieldOptions = {
  mode: "create" | "edit";
  code: string;
  status: "draft" | "active" | "inactive";
  isAutomatic: boolean;
  value: string;
  currencyCode: string;
  limit: string;
  maxQuantity: string;
  isTaxInclusive: boolean;
  valueLabel?: string;
  codeError?: string;
  valueError?: string;
  includeCurrency?: boolean;
  includeMaxQuantity?: boolean;
  includeTaxInclusive?: boolean;
};

const boundValue = (
  mode: PromotionCommonFieldOptions["mode"],
  value: FormField["value"],
) => (mode === "create" ? { value } : { defaultValue: value });

export const promotionCommonFields = ({
  mode,
  code,
  status,
  isAutomatic,
  value,
  currencyCode,
  limit,
  maxQuantity,
  isTaxInclusive,
  valueLabel = "Value",
  codeError,
  valueError,
  includeCurrency = true,
  includeMaxQuantity = true,
  includeTaxInclusive = true,
}: PromotionCommonFieldOptions): FormField[] => [
  {
    type: "input",
    name: "code",
    label: "Code",
    placeholder: "SUMMER20",
    required: true,
    autoFocus: true,
    error: codeError,
    colSpan: 1,
    ...boundValue(mode, code),
  },
  mode === "create"
    ? {
        type: "choice-cards",
        name: "status",
        label: "Status",
        value: status,
        options: [
          {
            label: "Draft",
            value: "draft",
            description: "Keep unavailable to customers.",
          },
          {
            label: "Active",
            value: "active",
            description: "Make available immediately.",
          },
        ],
      }
    : {
        type: "select",
        name: "status",
        label: "Status",
        required: true,
        colSpan: 1,
        defaultValue: status,
        options: [
          { label: "Draft", value: "draft" },
          { label: "Active", value: "active" },
          { label: "Inactive", value: "inactive" },
        ],
      },
  mode === "create"
    ? {
        type: "choice-cards",
        name: "isAutomatic",
        label: "Method",
        value: isAutomatic ? "automatic" : "code",
        options: [
          {
            label: "Promotion code",
            value: "code",
            description: "Customers enter a code at checkout.",
          },
          {
            label: "Automatic",
            value: "automatic",
            description: "Apply whenever all conditions match.",
          },
        ],
      }
    : {
        type: "switch",
        name: "isAutomatic",
        label: "Automatic promotion",
        description: "Apply without requiring a promotion code.",
        defaultValue: isAutomatic,
        colSpan: 1,
      },
  {
    type: "input",
    name: "value",
    label: valueLabel,
    inputType: "number",
    step: "any",
    required: true,
    error: valueError,
    colSpan: 1,
    ...boundValue(mode, value),
  },
  ...(includeCurrency
    ? [
        {
          type: "input" as const,
          name: "currencyCode",
          label: "Currency",
          placeholder: "USD",
          optional: true,
          colSpan: mode === "create" ? 2 : 1,
          ...boundValue(mode, currencyCode),
        },
      ]
    : []),
  {
    type: "input",
    name: "limit",
    label: "Usage limit",
    inputType: "number",
    optional: true,
    colSpan: 1,
    ...boundValue(mode, limit),
  },
  ...(includeMaxQuantity
    ? [
        {
          type: "input" as const,
          name: "maxQuantity",
          label: "Maximum quantity",
          inputType: "number" as const,
          optional: true,
          colSpan: 1,
          ...boundValue(mode, maxQuantity),
        },
      ]
    : []),
  ...(includeTaxInclusive
    ? [
        {
          type: "switch" as const,
          name: "isTaxInclusive",
          label: "Tax inclusive",
          description: "The discount value includes tax.",
          colSpan: mode === "create" ? 2 : 1,
          ...boundValue(mode, isTaxInclusive),
        },
      ]
    : []),
];

export const promotionFields = (
  promotion?: PromotionDetailDTO,
): FormField[] => {
  const common = promotionCommonFields({
    mode: "edit",
    code: promotion?.code ?? "",
    status: promotion?.status ?? "draft",
    isAutomatic: promotion?.isAutomatic ?? false,
    value: String(promotion?.value ?? 0),
    currencyCode: promotion?.currencyCode ?? "",
    limit: promotion?.limit ? String(promotion.limit) : "",
    maxQuantity: promotion?.maxQuantity ? String(promotion.maxQuantity) : "",
    isTaxInclusive: promotion?.isTaxInclusive ?? false,
  });
  const field = (name: string) => {
    const match = common.find((item) => item.name === name);
    if (!match) throw new Error(`Missing shared promotion field: ${name}`);
    return match;
  };

  return [
    field("code"),
    field("status"),
    {
      type: "select",
      name: "type",
      label: "Promotion type",
      required: true,
      colSpan: 1,
      defaultValue: promotion?.type ?? "standard",
      options: [
        { label: "Standard", value: "standard" },
        { label: "Buy X get Y", value: "buyget" },
      ],
    },
    {
      type: "select",
      name: "methodType",
      label: "Method",
      required: true,
      colSpan: 1,
      defaultValue: promotion?.methodType ?? "percentage",
      options: [
        { label: "Percentage", value: "percentage" },
        { label: "Fixed amount", value: "fixed" },
      ],
    },
    field("value"),
    field("currencyCode"),
    {
      type: "select",
      name: "targetType",
      label: "Target",
      required: true,
      colSpan: 1,
      defaultValue: promotion?.targetType ?? "order",
      options: [
        { label: "Entire order", value: "order" },
        { label: "Items", value: "items" },
        { label: "Shipping methods", value: "shipping_methods" },
      ],
    },
    {
      type: "select",
      name: "allocation",
      label: "Allocation",
      required: true,
      colSpan: 1,
      defaultValue: promotion?.allocation ?? "across",
      options: [
        { label: "Across", value: "across" },
        { label: "Each", value: "each" },
        { label: "Once", value: "once" },
      ],
    },
    field("limit"),
    field("maxQuantity"),
    field("isAutomatic"),
    field("isTaxInclusive"),
  ];
};

export const promotionFormData = (
  formData: FormData,
  promotion?: PromotionDetailDTO,
) => ({
  code: String(formData.get("code") ?? ""),
  type: String(formData.get("type") ?? "standard") as "standard" | "buyget",
  status: String(formData.get("status") ?? "draft") as
    | "draft"
    | "active"
    | "inactive",
  isAutomatic: formData.get("isAutomatic") === "on",
  isTaxInclusive: formData.get("isTaxInclusive") === "on",
  limit: formData.get("limit") ? Number(formData.get("limit")) : undefined,
  methodType: String(formData.get("methodType") ?? "percentage") as
    | "fixed"
    | "percentage",
  targetType: String(formData.get("targetType") ?? "order") as
    | "order"
    | "items"
    | "shipping_methods",
  allocation: String(formData.get("allocation") ?? "across") as
    | "each"
    | "across"
    | "once",
  value: Number(formData.get("value") ?? 0),
  currencyCode: String(formData.get("currencyCode") ?? "") || undefined,
  maxQuantity: formData.get("maxQuantity")
    ? Number(formData.get("maxQuantity"))
    : undefined,
  rules: promotion?.rules ?? [],
  targetRules: promotion?.targetRules ?? [],
  buyRules: promotion?.buyRules ?? [],
});
