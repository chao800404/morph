import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import {
  CollectionCreateButton,
  DataTableCard,
  editActionIcon,
  type DataTableColumn,
} from "@/routes/_backend/dashboard/-components/data-table-card";
import { useCollectionDetailPreload } from "@/routes/_backend/dashboard/-components/data-table-card/use-collection-detail-preload";
import { findCollection } from "@/lib/config/navigation";
import { viewPreloader } from "@/lib/config/lazy-view";
import { getConfig } from "@/server/get-config";
import {
  dashboardUserQueries,
  normalizeDashboardUserListParams,
} from "@queries/dashboard-user.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouter, useSearch } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { splitUserName } from "./user-name";

interface UserRow {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
  updatedAt: Date;
}

export default function Users() {
  const search = useSearch({ strict: false }) as DashboardSearch;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const router = useRouter();
  const preloadDetailRoute = useCollectionDetailPreload("users", "settings");
  const editView = useMemo(
    () =>
      findCollection(getConfig().client.collections.settings, "users")?.edit
        ?.view,
    [],
  );
  const params = normalizeDashboardUserListParams(search);
  const { data: result, isPending } = useQuery(
    dashboardUserQueries.list(params),
  );
  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: dashboardUserQueries.all(),
    });
  }, [queryClient]);

  const columns = useMemo<DataTableColumn<UserRow>[]>(
    () => [
      {
        key: "email",
        header: "Email",
        className: "min-w-64 font-medium",
        cell: (user) => user.email,
      },
      {
        key: "firstName",
        header: "First name",
        className: "min-w-40",
        cell: (user) => splitUserName(user.name).firstName || "—",
      },
      {
        key: "lastName",
        header: "Last name",
        className: "min-w-40",
        cell: (user) => splitUserName(user.name).lastName || "—",
      },
      {
        key: "createdAt",
        header: "Created at",
        className: "w-40 text-muted-foreground",
        cell: (user) => new Date(user.createdAt).toLocaleDateString(),
      },
      {
        key: "updatedAt",
        header: "Updated at",
        className: "w-40 text-muted-foreground",
        cell: (user) => new Date(user.updatedAt).toLocaleDateString(),
      },
    ],
    [],
  );

  const preloadDetail = useCallback(
    (id: string) => {
      void queryClient.prefetchQuery(dashboardUserQueries.detail(id));
      preloadDetailRoute(id);
    },
    [preloadDetailRoute, queryClient],
  );

  const preloadEdit = useCallback(
    (id: string) => {
      void queryClient.prefetchQuery(dashboardUserQueries.detail(id));
      void viewPreloader(editView)?.();
      void router.preloadRoute({
        to: "/dashboard/settings/$slug/$id/edit",
        params: { slug: "users", id },
      });
    },
    [editView, queryClient, router],
  );

  const rows = result?.success ? result.data.users : [];

  return (
    <DataTableCard
      label="Users"
      headerActions={<CollectionCreateButton slug="users" scope="settings" />}
      columns={columns}
      rows={rows}
      getRowId={(user) => user.id}
      isPending={isPending}
      errorMessage={result && !result.success ? result.message : null}
      onRetry={invalidate}
      emptyTitle="No users yet"
      emptyDescription="Invite a user to start collaborating in the dashboard."
      searchPlaceholder="Search"
      sortOptions={[
        { value: "email", label: "Email" },
        { value: "firstName", label: "First name" },
        { value: "lastName", label: "Last name" },
        { value: "createdAt", label: "Created at" },
        { value: "updatedAt", label: "Updated at" },
      ]}
      rowActions={(user) => [
        {
          label: "Edit",
          icon: editActionIcon,
          onSelect: () =>
            void navigate({
              to: "/dashboard/settings/$slug/$id/edit",
              params: { slug: "users", id: user.id },
            }),
          preload: () => preloadEdit(user.id),
        },
      ]}
      onRowClick={(user) =>
        void navigate({
          to: "/dashboard/settings/$slug/$id",
          params: { slug: "users", id: user.id },
        })
      }
      onRowPreload={(user) => preloadDetail(user.id)}
      pagination={result?.success ? result.data.pagination : undefined}
    />
  );
}
