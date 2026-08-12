import { Skeleton } from "@/components/ui/skeleton";
import {
  EditCard,
  type EditCardField,
} from "@/routes/_backend/dashboard/-components/edit-card/edit-card";
import { CardWrapper } from "@/routes/_backend/dashboard/-components/card-wrapper";

const fields: EditCardField[] = [
  "Name",
  "Role",
  "Status",
  "Email status",
  "Phone",
  "Language",
  "Created at",
  "Updated at",
].map((label) => ({
  key: label.toLowerCase().replaceAll(" ", "-"),
  label,
  displayValue: <Skeleton className="h-4 w-36" />,
}));

export const UserDetailPendingView = () => (
  <div className="flex flex-col gap-4">
    <EditCard
      id="user-general-pending"
      title={<Skeleton className="h-5 w-52" />}
      fields={fields}
    />
    <CardWrapper
      id="user-metadata-pending"
      label={<Skeleton className="h-5 w-32" />}
      headerButton={<Skeleton className="size-8 rounded-md" />}
    />
  </div>
);
