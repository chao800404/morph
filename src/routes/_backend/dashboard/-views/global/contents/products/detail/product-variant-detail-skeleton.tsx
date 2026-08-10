import { AssetGrid } from "@/components/asset/asset-grid";
import { Skeleton } from "@/components/ui/skeleton";
import { CardWrapper } from "@/routes/_backend/dashboard/-components/card-wrapper";
import {
  EditCard,
  type EditCardField,
} from "@/routes/_backend/dashboard/-components/edit-card/edit-card";
import { PageSplitLayout } from "@/routes/_backend/dashboard/-components/layout/page-split-layout";

const skeletonRows = (count: number): EditCardField[] =>
  Array.from({ length: count }, (_, index) => ({
    key: `row-${index}`,
    label: <Skeleton className={index % 2 ? "h-4 w-20" : "h-4 w-28"} />,
    displayValue: <Skeleton className={index % 2 ? "h-4 w-32" : "h-4 w-24"} />,
  }));

const SkeletonEditCard = ({ id, rows }: { id: string; rows: number }) => (
  <EditCard
    id={id}
    title={<Skeleton className="h-4 w-28" />}
    fields={skeletonRows(rows)}
    headerActions={<Skeleton className="size-7 rounded-md" />}
  />
);

const SkeletonListCard = ({ id, rows = 3 }: { id: string; rows?: number }) => (
  <CardWrapper
    id={id}
    label={<Skeleton className="h-4 w-24" />}
    description={<Skeleton className="mt-2 h-4 w-56 max-w-full" />}
  >
    <div className="divide-y border-t">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="grid grid-cols-2 items-center px-6 py-3">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-28" />
        </div>
      ))}
    </div>
  </CardWrapper>
);

/**
 * Full-geometry fallback for both lazy-route and query loading. Keeping the
 * same split layout and card order prevents the sidebar and lower cards from
 * jumping when the variant data arrives.
 */
export const ProductVariantDetailSkeleton = () => (
  <PageSplitLayout
    sidebar={
      <div className="flex min-w-0 flex-col gap-4">
        <SkeletonEditCard id="variant-inventory-skeleton" rows={3} />
        <SkeletonEditCard id="variant-attributes-skeleton" rows={4} />
        <SkeletonEditCard id="variant-metadata-skeleton" rows={1} />
      </div>
    }
  >
    <div className="flex min-w-0 flex-col gap-4">
      <SkeletonEditCard id="variant-general-skeleton" rows={4} />
      <CardWrapper
        id="variant-media-skeleton"
        label={<Skeleton className="h-4 w-16" />}
        description={<Skeleton className="mt-2 h-4 w-52 max-w-full" />}
        headerButton={<Skeleton className="size-9 rounded-md" />}
      >
        <AssetGrid leadTile className="border-t p-6">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="aspect-square rounded-lg" />
          ))}
        </AssetGrid>
      </CardWrapper>
      <SkeletonListCard id="variant-pricing-skeleton" />
      <SkeletonListCard id="variant-price-lists-skeleton" rows={1} />
      <SkeletonListCard id="variant-price-history-skeleton" />
    </div>
  </PageSplitLayout>
);

export default ProductVariantDetailSkeleton;
