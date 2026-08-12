import { DataTableCardSkeleton } from "@/routes/_backend/dashboard/-components/loading/collection-page-skeletons";

/** One stable frame for both the route chunk and the first Products query. */
export const ProductIndexSkeleton = () => (
  <DataTableCardSkeleton
    columnCount={7}
    label="Products"
    description="Manage your products and catalogue."
  />
);
