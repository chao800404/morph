import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { dashboardUserQueries } from "@queries/dashboard-user.queries";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { toast } from "sonner";
import { updateDashboardUserAction } from "./user-actions";
import { splitUserName } from "./user-name";

export default function UserEdit() {
  const { id } = useParams({ strict: false }) as { id: string };
  const close = useRouteModalClose();
  const queryClient = useQueryClient();
  const { data: result } = useSuspenseQuery(dashboardUserQueries.detail(id));
  const user = result.success ? result.data : null;
  const name = splitUserName(user?.name ?? "");

  const submit = async (
    _state: RouteFormState,
    formData: FormData,
  ): Promise<RouteFormState> => {
    const value = await updateDashboardUserAction(formData);
    if (!value.success) {
      toast.error(value.message, { position: "top-center" });
      return value;
    }
    await queryClient.invalidateQueries({
      queryKey: dashboardUserQueries.all(),
    });
    toast.success(value.message, { position: "top-center" });
    close();
    return value;
  };

  return (
    <RouteFormPage
      title="Edit User"
      description={user?.email}
      action={submit}
      submitLabel="Save"
      loadingLabel="Saving..."
      fields={[
        { type: "hidden", name: "id", value: id },
        {
          type: "input",
          name: "firstName",
          label: "First name",
          value: name.firstName,
          autoFocus: true,
        },
        {
          type: "input",
          name: "lastName",
          label: "Last name",
          value: name.lastName,
        },
      ]}
    />
  );
}
