import { Skeleton } from "@/components/ui/skeleton";
import { CardWrapper } from "@/routes/_backend/dashboard/-components/card-wrapper";

export default function OnlineStorePendingView() {
  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-5 py-2 sm:py-4">
      <div className="flex items-end justify-between gap-4 px-1">
        <div className="space-y-2">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="h-7 w-24 rounded-md" />
      </div>
      <CardWrapper
        customHeader={
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-2">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-4 w-80 max-w-full" />
            </div>
            <Skeleton className="size-8 rounded-md" />
          </div>
        }
        classNames={{ contentWrapper: "overflow-hidden" }}
      >
        <div className="relative border-t bg-muted/35 px-6 pt-10 sm:px-10">
          <Skeleton className="mx-auto aspect-[16/7] min-h-44 w-full max-w-4xl rounded-t-xl sm:min-h-52" />
          <Skeleton className="absolute bottom-0 right-10 hidden aspect-[4/5] w-[20%] min-w-36 rounded-t-xl sm:block" />
        </div>
        <div className="border-t bg-amber-500/8 px-5 py-3">
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <div className="flex items-end justify-between gap-4 border-t bg-component px-5 py-5">
          <div className="space-y-2">
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-4 w-44" />
          </div>
          <Skeleton className="h-7 w-28" />
        </div>
      </CardWrapper>
    </section>
  );
}
