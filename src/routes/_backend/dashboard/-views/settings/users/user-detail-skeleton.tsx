import { Skeleton } from "@/components/ui/skeleton";
import {
  EditCard,
  type EditCardField,
} from "@/routes/_backend/dashboard/-components/edit-card/edit-card";

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
  <EditCard
    id="user-general-pending"
    title={<Skeleton className="h-5 w-52" />}
    fields={fields}
  />
);
