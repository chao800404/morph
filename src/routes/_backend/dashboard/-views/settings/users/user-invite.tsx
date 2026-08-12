import { DialogFooterActions } from "@/components/dialog/dialog-footer-actions";
import { createSurface } from "@/components/dialog/create-surface";
import {
  useCloseOnEscape,
  useRouteModalClose,
} from "@/components/dialog/route-form-modal";
import { RouteFullscreenSurface } from "@/components/dialog/route-fullscreen-surface";
import { FieldsRenderer } from "@/components/form/fields-renderer";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  DataTableCard,
  deleteActionIcon,
  type DataTableColumn,
} from "@/routes/_backend/dashboard/-components/data-table-card";
import { useInfoStore } from "@/routes/_backend/dashboard/-views/features/global-info/use-info-store";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import {
  inviteQueries,
  normalizeInviteListParams,
} from "@queries/invite.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { useActionState, useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import {
  createDashboardInviteAction,
  deleteDashboardInvitesAction,
} from "./user-actions";

interface InviteRow {
  id: string;
  email: string;
  accepted: boolean;
  expiresAt: string;
  createdAt: string;
}

interface InviteFormState {
  success?: boolean;
  message: string;
  errors?: Record<string, string[]>;
}

const initialState: InviteFormState = { message: "" };

export default function UserInvite() {
  const close = useRouteModalClose();
  useCloseOnEscape(close);
  const queryClient = useQueryClient();
  const search = useSearch({ strict: false }) as DashboardSearch;
  const params = normalizeInviteListParams(search);
  const { data: result, isPending } = useQuery(inviteQueries.list(params));
  const { setInfoData, setInfoOpen } = useInfoStore(
    useShallow((store) => ({
      setInfoData: store.setInfoData,
      setInfoOpen: store.setOpen,
    })),
  );
  const [formKey, setFormKey] = useState(0);
  const [state, formAction, sending] = useActionState(
    async (_state: InviteFormState, formData: FormData) => {
      const response = await createDashboardInviteAction(null, formData);
      if (response.success) {
        await queryClient.invalidateQueries({ queryKey: inviteQueries.all() });
        toast.success(response.message);
        setFormKey((key) => key + 1);
      }
      return response;
    },
    initialState,
  );

  const columns = useMemo<DataTableColumn<InviteRow>[]>(
    () => [
      { key: "email", header: "Email", cell: (invite) => invite.email },
      {
        key: "status",
        header: "Status",
        cell: (invite) => {
          const expired = new Date(invite.expiresAt) <= new Date();
          return (
            <StatusBadge
              color={invite.accepted ? "green" : expired ? "red" : "amber"}
            >
              {invite.accepted ? "Accepted" : expired ? "Expired" : "Pending"}
            </StatusBadge>
          );
        },
      },
      {
        key: "createdAt",
        header: "Created",
        cell: (invite) => new Date(invite.createdAt).toLocaleDateString(),
      },
      {
        key: "expiresAt",
        header: "Expires",
        cell: (invite) => new Date(invite.expiresAt).toLocaleDateString(),
      },
    ],
    [],
  );

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: inviteQueries.all() });
  }, [queryClient]);

  const remove = useCallback(
    (invite: InviteRow) => {
      setInfoData({
        title: "Delete Invitation",
        description: `Are you sure you want to delete the invitation for “${invite.email}”? The existing invitation link will no longer work.`,
        fields: [
          { type: "hidden", name: "ids", value: JSON.stringify([invite.id]) },
        ],
        action: deleteDashboardInvitesAction,
        confirmLabel: "Delete",
        confirmVariant: "destructive",
        onSuccess: invalidate,
      });
      setInfoOpen(true);
    },
    [invalidate, setInfoData, setInfoOpen],
  );

  const rows = result?.success ? result.data.invites : [];
  return (
    <form key={formKey} action={formAction} className="contents">
      <RouteFullscreenSurface
        onClose={close}
        bodyClassName="overflow-y-auto"
        footer={
          <DialogFooterActions
            isSheet={false}
            isLoading={sending}
            onCancel={close}
            submitLabel="Send invite"
            loadingLabel="Sending..."
          />
        }
      >
        <div className={`${createSurface.content} flex flex-col gap-8`}>
          <section className="flex flex-col gap-4">
            <div>
              <h1 className="text-lg font-semibold">Invite User</h1>
              <p className="text-muted-foreground text-sm">
                Send an invitation to join the dashboard. Links expire in seven
                days.
              </p>
            </div>
            <FieldsRenderer
              fields={[
                {
                  type: "input",
                  inputType: "email",
                  name: "email",
                  label: "Email",
                  placeholder: "john.doe@example.com",
                  required: true,
                  autoFocus: true,
                  error: state.errors?.email?.[0],
                },
              ]}
            />
            {!state.success && state.message && !state.errors?.email ? (
              <p className="text-destructive text-sm">{state.message}</p>
            ) : null}
          </section>

          <DataTableCard
            label="Pending Invites"
            description="Manage invitations that have been sent to dashboard users."
            searchPlaceholder="Search"
            sortOptions={[
              { value: "email", label: "Email" },
              { value: "createdAt", label: "Created" },
              { value: "updatedAt", label: "Updated" },
            ]}
            defaultSortBy="createdAt"
            columns={columns}
            rows={rows}
            getRowId={(invite) => invite.id}
            isPending={isPending}
            errorMessage={result && !result.success ? result.message : null}
            onRetry={invalidate}
            emptyTitle="No invitations"
            emptyDescription="Invitations you send will appear here."
            rowActions={(invite) => [
              {
                label: "Delete",
                icon: deleteActionIcon,
                destructive: true,
                onSelect: () => remove(invite),
              },
            ]}
            pagination={result?.success ? result.data.pagination : undefined}
          />
        </div>
      </RouteFullscreenSurface>
    </form>
  );
}
