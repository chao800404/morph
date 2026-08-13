import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { DASHBOARD_PRODUCT_CARD_TRANSFORMS } from "./dashboard-home.config";

export function DashboardHomePending() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-8 py-8 sm:py-12">
      <div className="relative flex w-full max-w-lg justify-center pb-[3.75rem] pt-2 [perspective:900px]">
        <Card className="aspect-[16/9] w-full gap-0 overflow-hidden p-0 [transform:rotateX(5deg)] [transform-origin:center_bottom]">
          <div className="flex h-8 items-center gap-1.5 border-b px-2">
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="h-5 flex-1 rounded-full" />
          </div>
          <div className="grid flex-1 grid-rows-[1.05fr_1fr] gap-2 p-2">
            <Skeleton className="rounded-md" />
            <div className="grid grid-cols-4 gap-2">
              {Array.from({ length: 4 }, (_, index) => (
                <Skeleton key={index} className="rounded-md" />
              ))}
            </div>
          </div>
        </Card>
        <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 -space-x-6">
          {Array.from({ length: 3 }, (_, index) => (
            <Card
              key={index}
              className={`size-[5.25rem] gap-0 overflow-hidden p-0 sm:size-[6.75rem] ${DASHBOARD_PRODUCT_CARD_TRANSFORMS[index]}`}
            >
              <Skeleton className="size-full rounded-none" />
            </Card>
          ))}
        </div>
      </div>

      <div className="flex w-full max-w-2xl flex-col items-center gap-3">
        <Skeleton className="h-6 w-64" />
        <Skeleton className="h-4 w-80 max-w-full" />
        <Skeleton className="mt-3 h-11 w-full rounded-lg" />
      </div>

      <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }, (_, index) => (
          <Card key={index} className="gap-3 p-5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-56 max-w-full" />
          </Card>
        ))}
      </div>
    </div>
  );
}
