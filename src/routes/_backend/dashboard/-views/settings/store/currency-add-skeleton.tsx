import { DialogFooterActions } from "@/components/dialog/dialog-footer-actions";
import {
  useCloseOnEscape,
  useRouteModalClose,
} from "@/components/dialog/route-form-modal";
import { RouteFullscreenSurface } from "@/components/dialog/route-fullscreen-surface";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DataTableToolbar } from "@/routes/_backend/dashboard/-components/data-table-card";

const SKELETON_ROW_COUNT = 16;
const NAME_WIDTHS = [
  "w-44",
  "w-32",
  "w-28",
  "w-36",
  "w-48",
  "w-32",
] as const;

interface CurrencyAddSkeletonProps {
  onClose: () => void;
}

/**
 * Full-page loading frame shared by the route chunk fallback and the currency
 * queries. It deliberately composes the real fullscreen, toolbar, table and
 * footer primitives so loading cannot introduce a second visual system.
 */
export const CurrencyAddSkeleton = ({
  onClose,
}: CurrencyAddSkeletonProps) => (
  <RouteFullscreenSurface
    onClose={onClose}
    bodyClassName="flex min-h-0 flex-col overflow-hidden"
    footer={
      <DialogFooterActions
        isSheet={false}
        isDisabled
        onCancel={onClose}
        onSubmit={() => undefined}
      />
    }
  >
    <div
      className="flex min-h-0 flex-1 flex-col"
      aria-label="Loading currencies"
      aria-busy="true"
    >
      <DataTableToolbar
        className="border-t-0"
        trailing={<Skeleton className="h-7 w-60 max-md:w-full" />}
      />

      <div className="min-h-0 flex-1 overflow-hidden">
        <Table className="min-w-[640px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-14 pl-6">
                <Skeleton className="size-4 rounded-[4px]" />
              </TableHead>
              <TableHead className="w-36">Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead className="w-52 pr-6 text-right">
                Tax inclusive pricing
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: SKELETON_ROW_COUNT }, (_, index) => (
              <TableRow key={index}>
                <TableCell className="pl-6">
                  <Skeleton className="size-4 rounded-[4px]" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-3 w-10" />
                </TableCell>
                <TableCell>
                  <Skeleton
                    className={`h-3 ${NAME_WIDTHS[index % NAME_WIDTHS.length]}`}
                  />
                </TableCell>
                <TableCell className="pr-6">
                  <Skeleton className="ml-auto h-[1.15rem] w-8 rounded-full" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex shrink-0 items-center justify-between border-t px-6 py-4">
        <Skeleton className="h-3 w-32" />
        <div className="flex items-center gap-6">
          <Skeleton className="h-3 w-20" />
          <div className="flex gap-1">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="size-7" />
            ))}
          </div>
        </div>
      </div>
    </div>
  </RouteFullscreenSurface>
);

export const CurrencyAddPendingView = () => {
  const close = useRouteModalClose();
  useCloseOnEscape(close);

  return <CurrencyAddSkeleton onClose={close} />;
};
