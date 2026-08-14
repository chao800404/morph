import { Skeleton } from "@/components/ui/skeleton";
import { CardWrapper } from "@/routes/_backend/dashboard/-components/card-wrapper";
import {
  EditCard,
  type EditCardField,
} from "@/routes/_backend/dashboard/-components/edit-card/edit-card";
import { PageSplitLayout } from "@/routes/_backend/dashboard/-components/layout/page-split-layout";
import { Store } from "lucide-react";

const websiteFields: EditCardField[] = Array.from(
  { length: 5 },
  (_, index) => ({
    key: `website-information-${index}`,
    label: <Skeleton className="h-4 w-24" />,
    displayValue: <Skeleton className="h-4 w-full max-w-40" />,
  }),
);

export default function OnlineStorePendingView() {
  return (
    <PageSplitLayout
      sidebar={
        <div className="flex flex-col gap-4">
          <EditCard
            id="storefront-website-information-pending"
            title={<Skeleton className="h-5 w-36" />}
            description="Identity and default storefront metadata"
            fields={websiteFields}
          />
          <CardWrapper
            label={<Skeleton className="h-6 w-36" />}
            headerButton={<Skeleton className="size-8 rounded-md" />}
            classNames={{
              cardHeader: "py-5 [.border-b]:pb-5",
              contentWrapper: "border-t-0",
            }}
          >
            <div className="px-3 pb-2">
              <div className="flex items-center gap-3 rounded-lg border border-border/80 bg-component-secondary py-3 pl-3 pr-4 shadow-resource-link">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border/80 bg-muted/50 shadow-sm ring-1 ring-inset ring-foreground/5">
                  <Store className="size-4 text-muted-foreground" />
                </span>
                <span className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-24" />
                </span>
                <Skeleton className="size-4" />
              </div>
            </div>
          </CardWrapper>
        </div>
      }
    >
      <CardWrapper
        classNames={{ cardWrapper: "overflow-hidden" }}
        customHeader={
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-2">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-4 w-80 max-w-full" />
            </div>
            <Skeleton className="size-8 rounded-md" />
          </div>
        }
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
    </PageSplitLayout>
  );
}
