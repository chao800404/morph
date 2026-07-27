import type { ProductOptionCreatedWithin } from "@/lib/product/config/product-option-list";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import { DataTableFilter } from "@/routes/_backend/dashboard/-components/data-table-card";
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
    toolbarLeading: (
      <DataTableFilter
        label={PRODUCT_OPTION_CREATED_FILTER.label}
        filterLabel={PRODUCT_OPTION_CREATED_FILTER.filterLabel}
        options={[...PRODUCT_OPTION_CREATED_FILTER.options]}
        value={search.optionCreatedWithin}
        onValueChange={setCreatedWithin}
      />
    ),
  };
};
