import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Placeholder for the assets explorer.
 *
 * Used both as the route's Suspense fallback (while the view's chunk loads) and
 * inside the card while its query is in flight, so the two waits look like one
 * continuous state instead of a spinner followed by a different skeleton.
 */
export const AssetsCardSkeleton = ({ className }: { className?: string }) => (
  <div className={cn("flex h-full flex-col gap-4 p-6", className)}>
    <div className="grid grid-cols-4 gap-3">
      <Skeleton className="h-16 rounded-lg" />
      <Skeleton className="h-16 rounded-lg" />
      <Skeleton className="h-16 rounded-lg" />
      <Skeleton className="h-16 rounded-lg" />
    </div>
    <Skeleton className="h-6 w-24" />
    <div className="flex flex-1 flex-col gap-2">
      <Skeleton className="h-10 rounded" />
      <Skeleton className="h-10 rounded" />
      <Skeleton className="h-10 rounded" />
      <Skeleton className="h-10 rounded" />
    </div>
  </div>
);

/**
 * Full-page variant for the route fallback: matches the card's outer frame so
 * the layout does not shift when the real card takes over.
 */
export const AssetsPageSkeleton = () => (
  <div className="min-h-content bg-component ring-muted-foreground/10 dark:ring-muted-foreground/20 flex flex-col rounded-xl ring">
    <div className="flex items-center justify-between gap-2 px-6 py-4">
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-3 w-48" />
      </div>
      <div className="flex items-center gap-2">
        <Skeleton className="h-7 w-52" />
        <Skeleton className="h-7 w-7" />
        <Skeleton className="h-7 w-20" />
      </div>
    </div>
    <div className="flex-1 border-t">
      <AssetsCardSkeleton />
    </div>
  </div>
);
