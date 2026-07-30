import { handleField } from "@/components/form/handle-field";
import type { FormField } from "@/lib/validations/form";
import type { ProductCategoryDTO } from "@/lib/product/dto/product-taxonomy.dto";
import { categoryDepth } from "@/lib/product/category-tree";

/**
 * The fields Medusa's category form exposes, in its order.
 *
 * Shared by create and edit so the two forms cannot drift; `parents` is only
 * passed on create, because moving a category would have to rewrite every
 * descendant's materialised path and Medusa's edit form cannot do it either.
 */

export const CATEGORY_STATUS = { active: "active", inactive: "inactive" } as const;
export const CATEGORY_VISIBILITY = { public: "public", internal: "internal" } as const;

export type CategoryStatus =
  (typeof CATEGORY_STATUS)[keyof typeof CATEGORY_STATUS];
export type CategoryVisibility =
  (typeof CATEGORY_VISIBILITY)[keyof typeof CATEGORY_VISIBILITY];

export const NO_PARENT = "__root__";


export const toCategoryStatus = (value: string): CategoryStatus =>
  value === CATEGORY_STATUS.active
    ? CATEGORY_STATUS.active
    : CATEGORY_STATUS.inactive;

export const toCategoryVisibility = (value: string): CategoryVisibility =>
  value === CATEGORY_VISIBILITY.internal
    ? CATEGORY_VISIBILITY.internal
    : CATEGORY_VISIBILITY.public;

export interface CategoryFormValues {
  name: string;
  handle: string;
  description: string;
  status: CategoryStatus;
  visibility: CategoryVisibility;
  parentCategoryId: string;
}

export const emptyCategoryForm = (): CategoryFormValues => ({
  name: "",
  handle: "",
  description: "",
  status: CATEGORY_STATUS.inactive,
  visibility: CATEGORY_VISIBILITY.public,
  parentCategoryId: NO_PARENT,
});

export const toCategoryForm = (
  category: ProductCategoryDTO,
): CategoryFormValues => ({
  name: category.name,
  handle: category.handle,
  description: category.description,
  status: category.isActive
    ? CATEGORY_STATUS.active
    : CATEGORY_STATUS.inactive,
  visibility: category.isInternal
    ? CATEGORY_VISIBILITY.internal
    : CATEGORY_VISIBILITY.public,
  parentCategoryId: category.parentCategoryId ?? NO_PARENT,
});

export const categoryFormFields = (
  values: CategoryFormValues,
  options: {
    errors?: Partial<Record<keyof CategoryFormValues, string>>;
    parents?: ProductCategoryDTO[];
  } = {},
): FormField[] => [
  {
    type: "input",
    name: "name",
    label: "Name",
    placeholder: "e.g. Shirts",
    value: values.name,
    required: true,
    autoFocus: true,
    error: options.errors?.name,
    colSpan: 1,
  },
  handleField({
    derivedFrom: "name",
    value: values.handle,
    error: options.errors?.handle,
    colSpan: 1,
  }),
  {
    type: "textarea",
    name: "description",
    label: "Description",
    optional: true,
    placeholder: "Short category description...",
    rows: 3,
    value: values.description,
    colSpan: 2,
  },
  {
    type: "select",
    name: "status",
    label: "Status",
    value: values.status,
    options: [
      { value: CATEGORY_STATUS.active, label: "Active" },
      { value: CATEGORY_STATUS.inactive, label: "Inactive" },
    ],
    colSpan: 1,
  },
  {
    type: "select",
    name: "visibility",
    label: "Visibility",
    value: values.visibility,
    options: [
      { value: CATEGORY_VISIBILITY.public, label: "Public" },
      { value: CATEGORY_VISIBILITY.internal, label: "Internal" },
    ],
    colSpan: 1,
  },
  ...(options.parents
    ? ([
        {
          type: "select",
          name: "parentCategoryId",
          label: "Parent category",
          optional: true,
          value: values.parentCategoryId,
          options: [
            { value: NO_PARENT, label: "No parent (top level)" },
            ...options.parents.map((parent) => ({
              value: parent.id,
              label: `${"— ".repeat(categoryDepth(parent.mpath))}${parent.name}`,
            })),
          ],
          colSpan: 2,
        },
      ] satisfies FormField[])
    : []),
];
