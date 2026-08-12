import { AssetGrid } from "@/components/asset/asset-grid";
import { Skeleton } from "@/components/ui/skeleton";
import { CardWrapper } from "@/routes/_backend/dashboard/-components/card-wrapper";
import {
  EditCard,
  type EditCardField,
} from "@/routes/_backend/dashboard/-components/edit-card/edit-card";
import { PageSplitLayout } from "@/routes/_backend/dashboard/-components/layout/page-split-layout";
import { DataTableCardSkeleton } from "@/routes/_backend/dashboard/-components/loading/collection-page-skeletons";

/**
 * Placeholder for the product detail page.
 *
 * Used twice, and that is the point: as the route's Suspense fallback while the
 * view's chunk downloads, and inside the page while its query is in flight. One
 * component for both means the two waits look like a single state instead of a
 * spinner that swaps to a different-shaped skeleton.
 *
 * It draws both columns and all seven cards. Streaming SSR resolves the lazy
 * view and sends real markup, then hydration re-suspends until the chunk lands,
 * so this renders in the middle of an otherwise complete page — a fallback
 * missing a column makes that column appear, vanish and reappear.
 *
 * The three cards with a fixed heading reuse the real `EditCard` and only fake
 * the values, so the row height, dividers and label/value column split cannot
 * drift from the loaded page. The rest are cards `EditCard` does not model.
 *
 * Statically imported by the collection config, so nothing here may reach a
 * server function — that rules out `MetadataCard`, which reads `getConfig()`
 * and would close a cycle back into the config. Its header is redrawn below.
 */

/**
 * Rows fake the label as well as the value — the field names are as unknown
 * before the fetch as the values are.
 *
 * Widths alternate so the column does not read as a solid grey bar, which is
 * what a uniform width looks like once four of these stack up.
 */
const skeletonRows = (count: number): EditCardField[] =>
  Array.from({ length: count }, (_, index) => ({
    key: `row-${index}`,
    label: <Skeleton className={index % 2 ? "h-4 w-20" : "h-4 w-24"} />,
    displayValue: <Skeleton className={index % 2 ? "h-4 w-40" : "h-4 w-28"} />,
  }));

const SkeletonEditCard = ({ id, rows }: { id: string; rows: number }) => (
  <EditCard
    id={id}
    title={<Skeleton className="h-4 w-28" />}
    fields={skeletonRows(rows)}
    headerActions={<Skeleton className="size-7 rounded-md" />}
  />
);

export const ProductDetailSkeleton = () => (
  <PageSplitLayout
    sidebar={
      <div className="flex flex-col gap-4">
        {/* Organization: tags, type, collection, categories, sales channels. */}
        <SkeletonEditCard id="product-organization-skeleton" rows={5} />
        {/* Attributes: four measurements plus MID, HS and country of origin. */}
        <SkeletonEditCard id="product-attributes-skeleton" rows={7} />
        {/* Metadata is header-only on the real page too — there is no body to
            fake, only the badge and the open-editor button. */}
        <CardWrapper
          id="product-metadata-skeleton"
          label={
            <span className="flex items-center gap-3">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-5 w-14 rounded-full" />
            </span>
          }
          headerButton={<Skeleton className="size-9 rounded-md" />}
        />
      </div>
    }
  >
    <div className="flex flex-col gap-4">
      {/* General. Its heading is the product's own title, which is why this
          card cannot reuse a fixed one. */}
      <SkeletonEditCard id="product-general-skeleton" rows={5} />

      <CardWrapper
        id="product-media-skeleton"
        label={<Skeleton className="h-4 w-16" />}
        headerButton={<Skeleton className="size-9 rounded-md" />}
      >
        {/* `leadTile` and `p-6` match the real gallery, so the first tile keeps
            its 2×2 cell and the grid does not reflow when the images arrive. */}
        <AssetGrid leadTile className="p-6">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="aspect-square rounded-lg" />
          ))}
        </AssetGrid>
      </CardWrapper>

      {/* Options: one row per axis. Two is the common case — a wrong guess
          costs a small reflow, an absent card costs the whole column. */}
      <SkeletonEditCard id="product-options-skeleton" rows={2} />

      <div id="product-variants-skeleton">
        <DataTableCardSkeleton columnCount={4} />
      </div>
    </div>
  </PageSplitLayout>
);

export default ProductDetailSkeleton;
