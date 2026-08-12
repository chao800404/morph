import type {
  ReferenceDataItemDTO,
  ReferenceDataKind,
} from "@/lib/commerce/reference-data";
import type { FormField } from "@/lib/validations/form";
import type { DataTableColumn } from "@/routes/_backend/dashboard/-components/data-table-card";
import { formatDate } from "@/lib/utils";

export const referenceDataConfig: Record<
  ReferenceDataKind,
  { label: string; singular: string; description: string }
> = {
  "product-types": {
    label: "Types",
    singular: "Type",
    description: "Classify products with a reusable type.",
  },
  "product-tags": {
    label: "Tags",
    singular: "Tag",
    description: "Manage reusable labels assigned to products.",
  },
  "return-reasons": {
    label: "Return Reasons",
    singular: "Return Reason",
    description: "Define the reasons available when merchandise is returned.",
  },
  "refund-reasons": {
    label: "Refund Reasons",
    singular: "Refund Reason",
    description: "Define the reasons available when a payment is refunded.",
  },
};

export const referenceDataColumns = (
  kind: ReferenceDataKind,
): DataTableColumn<ReferenceDataItemDTO>[] => [
  {
    key: "name",
    header: "Name",
    className: "font-medium",
    cell: (item) => item.name,
  },
  ...(kind === "return-reasons" || kind === "refund-reasons"
    ? [
        {
          key: "code",
          header: "Code",
          cell: (item: ReferenceDataItemDTO) => item.code ?? "—",
        },
      ]
    : []),
  ...(kind === "return-reasons"
    ? [
        {
          key: "parent",
          header: "Parent",
          cell: (item: ReferenceDataItemDTO) => item.parentName ?? "—",
        },
      ]
    : []),
  {
    key: "usage",
    header: "Used by",
    className: "w-32",
    cell: (item) =>
      `${item.usageCount} ${kind.startsWith("product-") ? "product" : "record"}${item.usageCount === 1 ? "" : "s"}`,
  },
  {
    key: "updatedAt",
    header: "Updated",
    className: "w-40",
    cell: (item) => formatDate(item.updatedAt),
  },
];

export const referenceDataFields = ({
  kind,
  item,
  parents = [],
}: {
  kind: ReferenceDataKind;
  item?: ReferenceDataItemDTO;
  parents?: ReferenceDataItemDTO[];
}): FormField[] => [
  {
    type: "input",
    name: "name",
    label: "Name",
    value: item?.name,
    required: true,
    autoFocus: true,
    colSpan: 2,
  },
  ...(kind === "return-reasons" || kind === "refund-reasons"
    ? [
        {
          type: "input" as const,
          name: "code",
          label: "Code",
          value: item?.code ?? undefined,
          required: true,
          colSpan: 2 as const,
        },
      ]
    : []),
  ...(kind === "return-reasons"
    ? [
        {
          type: "select" as const,
          name: "parentId",
          label: "Parent reason",
          value: item?.parentId ?? "none",
          options: [
            { label: "No parent", value: "none" },
            ...parents
              .filter(
                (parent) => parent.id !== item?.id && parent.parentId === null,
              )
              .map((parent) => ({ label: parent.name, value: parent.id })),
          ],
          colSpan: 2 as const,
        },
      ]
    : []),
  ...(kind === "return-reasons" || kind === "refund-reasons"
    ? [
        {
          type: "textarea" as const,
          name: "description",
          label: "Description",
          value: item?.description ?? undefined,
          rows: 4,
          colSpan: 2 as const,
        },
      ]
    : []),
];

export const toReferenceDataKind = (
  slug: string | undefined,
): ReferenceDataKind | null =>
  slug && slug in referenceDataConfig ? (slug as ReferenceDataKind) : null;
