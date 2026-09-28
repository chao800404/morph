import type { FormField } from "@/lib/validations/form";
import type { InventoryListItemDTO } from "@/lib/inventory/dto/inventory.dto";

export const inventoryItemFormFields = (
  item?: InventoryListItemDTO,
): FormField[] => [
  {
    type: "input",
    name: "title",
    label: "Title",
    placeholder: "e.g. Blue cotton shirt",
    value: item?.title ?? "",
    required: true,
    autoFocus: !item,
    colSpan: 1,
  },
  {
    type: "input",
    name: "sku",
    label: "SKU",
    value: item?.sku ?? "",
    optional: true,
    colSpan: 1,
  },
  {
    type: "input",
    name: "unitOfMeasure",
    label: "Unit of measure",
    placeholder: "e.g. kg, m, L",
    value: item?.unitOfMeasure ?? "",
    optional: true,
    colSpan: 1,
  },
  {
    type: "textarea",
    name: "description",
    label: "Description",
    value: item?.description ?? "",
    optional: true,
    rows: 3,
    colSpan: 2,
  },
  {
    type: "input",
    name: "thumbnail",
    label: "Thumbnail URL",
    value: item?.thumbnail ?? "",
    optional: true,
    colSpan: 2,
  },
  {
    type: "switch",
    name: "requiresShipping",
    label: "Requires shipping",
    description:
      "Turn this off for inventory items that do not need physical fulfillment.",
    value: item?.requiresShipping ?? true,
    colSpan: 2,
  },
  ...(
    [
      ["weight", "Weight", item?.weight],
      ["length", "Length", item?.length],
      ["width", "Width", item?.width],
      ["height", "Height", item?.height],
    ] as const
  ).map(([name, label, value]) => ({
    type: "input" as const,
    name,
    label,
    inputType: "number",
    step: "any",
    value: value === null || value === undefined ? "" : String(value),
    optional: true,
    colSpan: 1,
  })),
  {
    type: "input",
    name: "originCountry",
    label: "Country of origin",
    value: item?.originCountry?.toUpperCase() ?? "",
    optional: true,
    colSpan: 1,
  },
  {
    type: "input",
    name: "hsCode",
    label: "HS code",
    value: item?.hsCode ?? "",
    optional: true,
    colSpan: 1,
  },
  {
    type: "input",
    name: "midCode",
    label: "MID code",
    value: item?.midCode ?? "",
    optional: true,
    colSpan: 1,
  },
  {
    type: "input",
    name: "material",
    label: "Material",
    value: item?.material ?? "",
    optional: true,
    colSpan: 1,
  },
];
