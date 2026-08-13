import { handleField } from "@/components/form/handle-field";
import type { FormField } from "@/lib/validations/form";

export const NO_PRODUCT_COLLECTION = "__none__";

export const productGeneralFields = ({
  title,
  subtitle,
  handle,
  description,
  titleError,
  mode,
}: {
  title: string;
  subtitle: string;
  handle: string;
  description: string;
  titleError?: string;
  mode: "create" | "edit";
}): FormField[] => {
  const isCreate = mode === "create";
  return [
    {
      type: "input",
      name: "title",
      label: "Title",
      placeholder: "e.g. Summer T-Shirt",
      value: title,
      autoFocus: true,
      required: true,
      error: titleError,
      colSpan: isCreate ? 1 : undefined,
    },
    {
      type: "input",
      name: "subtitle",
      label: "Subtitle",
      optional: true,
      value: subtitle,
      colSpan: isCreate ? 1 : undefined,
    },
    handleField({
      derivedFrom: "title",
      value: handle,
      colSpan: isCreate ? 1 : undefined,
    }),
    {
      type: "textarea",
      name: "description",
      label: "Description",
      optional: true,
      value: description,
      rows: 4,
      colSpan: isCreate ? 2 : undefined,
    },
  ];
};

export const productOrganizationFields = ({
  collectionId,
  collections,
  typeValue,
  types,
  tagValues,
  tags,
  categoryIds,
  categories,
  salesChannelIds,
  salesChannels,
  discountable,
}: {
  collectionId: string | null;
  collections: Array<{ id: string; title: string }>;
  typeValue: string | null;
  types: Array<{ value: string }>;
  tagValues: string[];
  tags: Array<{ value: string }>;
  categoryIds: string[];
  categories: Array<{ id: string; name: string; mpath: string | null }>;
  salesChannelIds: string[];
  salesChannels: Array<{ id: string; name: string }>;
  discountable?: boolean;
}): FormField[] => [
  ...(discountable === undefined
    ? []
    : [
        {
          type: "switch" as const,
          name: "discountable",
          label: "Discountable",
          description: "When off, promotions and discounts never apply.",
          value: discountable,
          colSpan: 2,
        },
      ]),
  {
    type: "select",
    name: "collectionId",
    label: "Collection",
    optional: true,
    value: collectionId || NO_PRODUCT_COLLECTION,
    options: [
      { value: NO_PRODUCT_COLLECTION, label: "No collection" },
      ...collections.map((collection) => ({
        value: collection.id,
        label: collection.title,
      })),
    ],
    colSpan: 1,
  },
  {
    type: "option-values",
    name: "typeValue",
    label: "Type",
    optional: true,
    choices: types.map(({ value }) => ({ id: value, value })),
    remoteSource: "product-types",
    value: typeValue ? [typeValue] : [],
    allowCreate: true,
    maxSelected: 1,
    placeholder: "Select or create a type...",
    searchPlaceholder: "Search types...",
    emptyMessage: "No type found.",
    colSpan: 1,
  },
  {
    type: "option-values",
    name: "tagValues",
    label: "Tags",
    optional: true,
    choices: tags.map(({ value }) => ({ id: value, value })),
    remoteSource: "product-tags",
    value: tagValues,
    allowCreate: true,
    placeholder: "Select or create tags...",
    searchPlaceholder: "Search tags...",
    emptyMessage: "No tag found.",
    colSpan: 1,
  },
  {
    type: "option-values",
    name: "categoryIds",
    label: "Categories",
    optional: true,
    choices: categories.map((category) => ({
      id: category.id,
      value: category.name,
    })),
    remoteSource: "product-categories",
    value: categoryIds,
    placeholder: "Select categories...",
    searchPlaceholder: "Search categories...",
    emptyMessage: "No category found.",
    colSpan: 1,
  },
  {
    type: "option-values",
    name: "salesChannelIds",
    label: "Sales Channels",
    optional: true,
    choices: salesChannels.map((channel) => ({
      id: channel.id,
      value: channel.name,
    })),
    value: salesChannelIds,
    placeholder: "Select sales channels...",
    searchPlaceholder: "Search sales channels...",
    emptyMessage: "No sales channel found.",
    colSpan: 1,
  },
];
