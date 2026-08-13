import { Skeleton } from "@/components/ui/skeleton";
import { CardWrapper } from "@/routes/_backend/dashboard/-components/card-wrapper";
import {
  EditCard,
  type EditCardField,
} from "@/routes/_backend/dashboard/-components/edit-card/edit-card";

const fields: EditCardField[] = Array.from({ length: 3 }, (_, index) => ({
  key: `page-detail-${index}`,
  label: <Skeleton className="h-4 w-24" />,
  displayValue: <Skeleton className="h-4 w-36" />,
}));

export default function StorefrontPageDetailPending() {
  return (
    <div className="flex flex-col gap-4">
      <EditCard
        id="storefront-page-detail-pending"
        title={<Skeleton className="h-5 w-20" />}
        fields={fields}
        headerActions={<Skeleton className="size-8 rounded-md" />}
      />
      <CardWrapper
        label={<Skeleton className="h-5 w-32" />}
        description={<Skeleton className="h-4 w-72" />}
        headerButton={<Skeleton className="size-8 rounded-md" />}
      />
      <CardWrapper
        label={<Skeleton className="h-5 w-24" />}
        headerButton={<Skeleton className="size-8 rounded-md" />}
      />
    </div>
  );
}
