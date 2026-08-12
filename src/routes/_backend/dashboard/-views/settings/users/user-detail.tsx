import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { findCollection } from "@/lib/config/navigation";
import { viewPreloader } from "@/lib/config/lazy-view";
import { getConfig } from "@/server/get-config";
import {
  EditCard,
  type EditCardField,
} from "@/routes/_backend/dashboard/-components/edit-card/edit-card";
import { dashboardUserQueries } from "@queries/dashboard-user.queries";
import { MetadataCard } from "@/routes/_backend/dashboard/-components/metadata-card/metadata-card";
import { useSuspenseQuery } from "@tanstack/react-query";
import {
  Link,
  useNavigate,
  useParams,
  useRouter,
} from "@tanstack/react-router";
import { useCallback, useMemo } from "react";

export default function UserDetail() {
  const { id } = useParams({ strict: false }) as { id: string };
  const navigate = useNavigate();
  const router = useRouter();
  const { data: result } = useSuspenseQuery(dashboardUserQueries.detail(id));
  const user = result?.success ? result.data : null;
  const openEdit = useCallback(
    () =>
      void navigate({
        to: "/dashboard/settings/$slug/$id/edit",
        params: { slug: "users", id },
      }),
    [id, navigate],
  );
  const editView = useMemo(
    () =>
      findCollection(getConfig().client.collections.settings, "users")?.edit
        ?.view,
    [],
  );
  const preloadEdit = useCallback(() => {
    void viewPreloader(editView)?.();
    void router.preloadRoute({
      to: "/dashboard/settings/$slug/$id/edit",
      params: { slug: "users", id },
    });
  }, [editView, id, router]);

  if (!user) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
        <p className="text-sm text-muted-foreground">
          {result?.message ?? "User not found"}
        </p>
        <Button variant="outline" size="sm" asChild>
          <Link to="/dashboard/settings/$slug" params={{ slug: "users" }}>
            Back to users
          </Link>
        </Button>
      </div>
    );
  }

  const fields: EditCardField[] = [
    { key: "name", label: "Name", value: user.name },
    {
      key: "role",
      label: "Role",
      value: user.role ?? "user",
      displayValue: <span className="capitalize">{user.role ?? "user"}</span>,
    },
    {
      key: "status",
      label: "Status",
      value: user.banned ? "Suspended" : "Active",
      displayValue: (
        <StatusBadge color={user.banned ? "red" : "green"}>
          {user.banned ? "Suspended" : "Active"}
        </StatusBadge>
      ),
    },
    {
      key: "emailVerified",
      label: "Email status",
      value: user.emailVerified ? "Verified" : "Unverified",
      displayValue: (
        <StatusBadge color={user.emailVerified ? "green" : "amber"}>
          {user.emailVerified ? "Verified" : "Unverified"}
        </StatusBadge>
      ),
    },
    { key: "phoneNumber", label: "Phone", value: user.phoneNumber ?? "" },
    { key: "language", label: "Language", value: user.language ?? "" },
    {
      key: "createdAt",
      label: "Created at",
      value: new Date(user.createdAt).toLocaleString(),
    },
    {
      key: "updatedAt",
      label: "Updated at",
      value: new Date(user.updatedAt).toLocaleString(),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <EditCard
        id="user-general"
        title={user.email}
        editLabel="User"
        fields={fields}
        onEdit={openEdit}
        onEditPreload={preloadEdit}
      />
      <MetadataCard
        slug="users"
        id={id}
        keyCount={Object.keys(user.metadata).length}
        scope="settings"
      />
    </div>
  );
}
