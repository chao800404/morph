import { Skeleton } from "@/components/ui/skeleton";

export function VisualEditorPending() {
  return (
    <div className="grid h-svh grid-rows-[3.5rem_minmax(0,1fr)]">
      <div className="flex items-center justify-between border-b px-4">
        <Skeleton className="h-8 w-44" />
        <Skeleton className="h-7 w-40" />
      </div>
      <div className="grid min-h-0 grid-cols-[17rem_minmax(0,1fr)_25rem] bg-muted/40 max-lg:grid-cols-[15rem_minmax(0,1fr)_21rem] max-md:grid-cols-1">
        <aside className="grid min-h-0 grid-rows-[3.25rem_auto_minmax(0,1fr)_auto] border-r bg-component max-md:hidden">
          <div className="flex items-center border-b px-3">
            <Skeleton className="h-5 w-24" />
          </div>
          <div className="border-b p-3">
            <Skeleton className="h-8 w-full" />
          </div>
          <div className="space-y-2 p-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
          <div className="border-t p-3">
            <Skeleton className="h-8 w-full" />
          </div>
        </aside>
        <main className="relative flex min-h-0 flex-col">
          <div className="flex min-h-0 flex-1 p-7 pb-24">
            <Skeleton className="size-full" />
          </div>
          <Skeleton className="absolute bottom-5 left-1/2 h-11 w-96 max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-lg" />
        </main>
        <aside className="m-3 ml-0 grid min-h-0 grid-rows-[3.25rem_minmax(0,1fr)_auto] overflow-hidden rounded-xl border bg-component shadow-lg max-md:hidden">
          <div className="flex items-center justify-between border-b px-3">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-7 w-24" />
          </div>
          <div className="space-y-5 p-4">
            <Skeleton className="ml-auto h-14 w-4/5 rounded-xl" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
          <div className="p-3">
            <Skeleton className="h-24 w-full rounded-lg" />
          </div>
        </aside>
      </div>
    </div>
  );
}
