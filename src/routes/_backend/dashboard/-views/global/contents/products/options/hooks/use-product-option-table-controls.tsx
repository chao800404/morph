import type { ProductOptionCreatedWithin } from "@/lib/product/config/product-option-list";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import type { DataTableFilterDefinition } from "@/routes/_backend/dashboard/-components/data-table-card";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { PRODUCT_OPTION_CREATED_FILTER } from "../config/product-option-table.config";

export const useProductOptionTableControls = () => {
  const search = useSearch({ strict: false }) as DashboardSearch;
  const navigate = useNavigate();

  const setCreatedWithin = (
    optionCreatedWithin: ProductOptionCreatedWithin | undefined,
  ) => {
    void navigate({
      to: ".",
      search: (previous: DashboardSearch) => ({
        ...previous,
        optionCreatedWithin,
        page: undefined,
      }),
      replace: true,
    });
  };

  return {
    search,
    filters: [
      {
        key: "created",
        label: PRODUCT_OPTION_CREATED_FILTER.label,
        options: [...PRODUCT_OPTION_CREATED_FILTER.options],
        values: search.optionCreatedWithin
          ? [search.optionCreatedWithin]
          : [],
        multiple: false,
        onValuesChange: (values) =>
          setCreatedWithin(
            values.at(-1) as ProductOptionCreatedWithin | undefined,
          ),
      },
    ] satisfies DataTableFilterDefinition[],
  };
};
