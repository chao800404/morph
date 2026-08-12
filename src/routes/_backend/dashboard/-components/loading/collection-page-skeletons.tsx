import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CardWrapper } from "../card-wrapper";
import { EditCard, type EditCardField } from "../edit-card/edit-card";
import { PageSplitLayout } from "../layout/page-split-layout";
import type { ReactNode } from "react";

/** Default full-card fallback for collection chunks and first list queries. */
export const DataTableCardSkeleton = ({
  columnCount = 5,
  label = <Skeleton className="h-5 w-32" />,
  description = <Skeleton className="mt-1 h-4 w-56" />,
}: {
  columnCount?: number;
  label?: ReactNode;
  description?: ReactNode;
}) => {
  const columns = Array.from({
    length: Math.max(1, Math.min(columnCount, 8)),
  });
  return (
    <CardWrapper
      label={label}
      description={description}
      headerButton={<Skeleton className="h-8 w-24 rounded-md" />}
      classNames={{ cardWrapper: "h-auto", contentWrapper: "flex flex-col" }}
    >
      <div className="flex items-center justify-between border-t px-6 py-4">
        <Skeleton className="h-7 w-20 rounded-md" />
        <div className="flex gap-2">
          <Skeleton className="h-7 w-60 rounded-md" />
          <Skeleton className="size-7 rounded-md" />
        </div>
      </div>
      <div className="overflow-hidden">
        <Table aria-label="Loading table data">
          <TableHeader>
            <TableRow>
              {columns.map((_, index) => (
                <TableHead key={index}>
                  <Skeleton className={index === 0 ? "h-4 w-24" : "h-4 w-16"} />
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 5 }, (_, rowIndex) => (
              <TableRow key={rowIndex}>
                {columns.map((_, columnIndex) => (
                  <TableCell key={columnIndex}>
                    <Skeleton
                      className={columnIndex === 0 ? "h-4 w-36" : "h-4 w-24"}
                    />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-between border-t px-6 py-4">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-7 w-40" />
      </div>
    </CardWrapper>
  );
};

export const CollectionIndexSkeleton = () => <DataTableCardSkeleton />;

/** Creates a collection-owned table skeleton with its real column count. */
export const createCollectionIndexPendingView = (columnCount: number) => {
  const PendingView = () => <DataTableCardSkeleton columnCount={columnCount} />;
  return PendingView;
};

const rows = (count: number): EditCardField[] =>
  Array.from({ length: count }, (_, index) => ({
    key: `row-${index}`,
    label: <Skeleton className={index % 2 ? "h-4 w-20" : "h-4 w-28"} />,
    displayValue: <Skeleton className={index % 2 ? "h-4 w-32" : "h-4 w-44"} />,
  }));

const PendingEditCard = ({ id, count = 5 }: { id: string; count?: number }) => (
  <EditCard
    id={id}
    title={<Skeleton className="h-5 w-40" />}
    fields={rows(count)}
    headerActions={<Skeleton className="h-7 w-20 rounded-md" />}
  />
);

const PendingMetadataCard = ({
  id = "detail-metadata-pending",
}: {
  id?: string;
}) => (
  <CardWrapper
    id={id}
    label={<Skeleton className="h-5 w-32" />}
    headerButton={<Skeleton className="size-8 rounded-md" />}
  />
);

const PendingTableCard = ({ id = "detail-table-pending" }: { id?: string }) => (
  <CardWrapper id={id} label={<Skeleton className="h-5 w-28" />}>
    <div className="border-t">
      {Array.from({ length: 3 }, (_, index) => (
        <div
          className="flex gap-6 border-b px-6 py-4 last:border-b-0"
          key={index}
        >
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="ml-auto h-4 w-20" />
        </div>
      ))}
    </div>
  </CardWrapper>
);

export const StoreIndexSkeleton = () => (
  <div className="mx-auto flex h-auto w-full flex-col gap-3">
    <PendingEditCard id="store-general-pending" count={5} />
    <CollectionIndexSkeleton />
  </div>
);

export const ProfileIndexSkeleton = () => (
  <section className="space-y-4">
    <PendingEditCard id="profile-information-pending" count={4} />
    <PendingEditCard id="profile-password-pending" count={2} />
    <PendingEditCard id="profile-sessions-pending" count={3} />
  </section>
);

export const SimpleDetailSkeleton = () => (
  <div className="flex flex-col gap-4">
    <PendingEditCard id="detail-general-pending" />
    <PendingMetadataCard />
  </div>
);

export const TableDetailSkeleton = () => (
  <div className="flex flex-col gap-4">
    <PendingEditCard id="detail-general-pending" />
    <PendingTableCard />
    <PendingMetadataCard />
  </div>
);

export const OrderDetailSkeleton = () => (
  <PageSplitLayout
    sidebar={
      <div className="flex flex-col gap-4">
        <PendingEditCard id="order-customer-pending" count={2} />
        <PendingEditCard id="order-addresses-pending" count={2} />
      </div>
    }
  >
    <TableDetailSkeleton />
  </PageSplitLayout>
);

/** Safe default for detail destinations; feature-specific skeletons may override it. */
export const CollectionDetailSkeleton = () => (
  <PageSplitLayout
    sidebar={
      <div className="flex flex-col gap-4">
        <PendingEditCard id="detail-sidebar-pending" count={3} />
      </div>
    }
  >
    <div className="flex flex-col gap-4">
      <PendingEditCard id="detail-general-pending" />
      <PendingTableCard />
      <PendingMetadataCard />
    </div>
  </PageSplitLayout>
);
