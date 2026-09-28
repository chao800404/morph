import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { SecretApiKeyDTO } from "@/lib/api-key/dto/api-key.dto";
import type { DataTableColumn } from "@/routes/_backend/dashboard/-components/data-table-card";
import { DataTableCard } from "@/routes/_backend/dashboard/-components/data-table-card";
import {
  deleteActionIcon,
  editActionIcon,
} from "@/routes/_backend/dashboard/-components/data-table-card/row-actions-menu";
import type { RowAction } from "@/routes/_backend/dashboard/-components/data-table-card/row-actions-menu";
import { secretApiKeyQueries } from "@/routes/_backend/dashboard/-queries/secret-api-key.queries";
import { useInfoStore } from "@/routes/_backend/dashboard/-views/features/global-info/use-info-store";
import { createSecretApiKeyAction } from "@/server/api-key/secret-api-keys.serverFn";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState, type FormEvent } from "react";
import { useShallow } from "zustand/react/shallow";
import { toast } from "sonner";
import {
  deleteSecretApiKeyAction,
  revokeSecretApiKeyAction,
  updateSecretApiKeyTitleAction,
} from "./secret-api-key-actions";

export default function SecretApiKeys() {
  const client = useQueryClient();
  const { data: result, isPending } = useQuery(secretApiKeyQueries.list());
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const invalidate = useCallback(() => {
    void client.invalidateQueries({ queryKey: secretApiKeyQueries.all() });
  }, [client]);
  const create = useMutation({
    mutationFn: (value: string) => createSecretApiKeyAction({ data: { title: value } }),
    onSuccess: (response) => {
      if (!response.success) {
        setFormError(response.message);
        return;
      }
      setCreatedToken(response.data.token);
      setFormError(null);
      setTitle("");
      invalidate();
    },
    onError: () => setFormError("Secret API key could not be created"),
  });
  const { setInfoData, setInfoOpen } = useInfoStore(
    useShallow((state) => ({ setInfoData: state.setInfoData, setInfoOpen: state.setOpen })),
  );
  const rows = result?.success ? (result.data.keys as SecretApiKeyDTO[]) : [];

  const columns = useMemo<DataTableColumn<SecretApiKeyDTO>[]>(
    () => [
      { key: "title", header: "Title", className: "font-medium", cell: (row) => row.title },
      { key: "key", header: "Key", cell: (row) => <code>{row.redacted}</code> },
      {
        key: "status",
        header: "Status",
        cell: (row) => row.revokedAt ? "Revoked" : "Active",
      },
      {
        key: "last-used",
        header: "Last used",
        cell: (row) => row.lastUsedAt ? new Date(row.lastUsedAt).toLocaleString() : "Never",
      },
      {
        key: "created",
        header: "Created",
        cell: (row) => new Date(row.createdAt).toLocaleDateString(),
      },
    ],
    [],
  );

  const rowActions = useCallback(
    (row: SecretApiKeyDTO) => {
      const actions: RowAction[] = [
        {
          label: "Edit title",
          icon: editActionIcon,
          onSelect: () => {
            setInfoData({
              title: "Edit secret API key",
              description: "Change the label used to identify this key.",
              fields: [
                {
                  type: "input",
                  name: "title",
                  label: "Title",
                  value: row.title,
                  required: true,
                },
                { type: "hidden", name: "id", value: row.id },
              ],
              action: updateSecretApiKeyTitleAction,
              confirmLabel: "Save",
              onSuccess: invalidate,
            });
            setInfoOpen(true);
          },
        },
      ];
      if (row.revokedAt) {
        actions.push({
          label: "Delete",
          icon: deleteActionIcon,
          destructive: true,
          onSelect: () => {
            setInfoData({
              title: "Delete revoked API key",
              description:
                "This removes the key from the dashboard. It can no longer be used because it has already been revoked.",
              fields: [{ type: "hidden", name: "id", value: row.id }],
              action: deleteSecretApiKeyAction,
              confirmLabel: "Delete key",
              confirmVariant: "destructive",
              onSuccess: invalidate,
            });
            setInfoOpen(true);
          },
        });
      } else {
        actions.push({
          label: "Revoke",
          icon: deleteActionIcon,
          destructive: true,
          onSelect: () => {
            setInfoData({
              title: "Revoke secret API key",
              description:
                "This immediately disables the key. Revoking it cannot be undone.",
              fields: [{ type: "hidden", name: "id", value: row.id }],
              action: revokeSecretApiKeyAction,
              confirmLabel: "Revoke key",
              confirmVariant: "destructive",
              onSuccess: invalidate,
            });
            setInfoOpen(true);
          },
        });
      }
      return actions;
    },
    [invalidate, setInfoData, setInfoOpen],
  );

  const submitCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    create.mutate(title.trim());
  };

  return (
    <>
      <DataTableCard
        label="Secret API keys"
        description="Create credentials for trusted Admin API integrations. The full key is shown once, when it is created."
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        isPending={isPending}
        errorMessage={result && !result.success ? result.message : null}
        onRetry={invalidate}
        emptyTitle="No secret API keys yet"
        emptyDescription="Create a secret key for a trusted server-side integration."
        headerActions={
          <Button onClick={() => setCreateOpen(true)}>Create key</Button>
        }
        rowActions={rowActions}
      />
      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) {
            setCreatedToken(null);
            setFormError(null);
            setTitle("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {createdToken ? "Copy your secret API key" : "Create secret API key"}
            </DialogTitle>
            <DialogDescription>
              {createdToken
                ? "Store this key securely. It will not be shown again after you close this dialog."
                : "The key authenticates Admin API requests as your administrator account."}
            </DialogDescription>
          </DialogHeader>
          {createdToken ? (
            <div className="space-y-2">
              <label htmlFor="secret-api-key-token" className="text-sm font-medium">
                Secret key
              </label>
              <Input id="secret-api-key-token" value={createdToken} readOnly />
            </div>
          ) : (
            <form id="secret-api-key-create-form" onSubmit={submitCreate} className="space-y-2">
              <label htmlFor="secret-api-key-title" className="text-sm font-medium">
                Title
              </label>
              <Input
                id="secret-api-key-title"
                autoFocus
                maxLength={200}
                required
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Production integration"
              />
              {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
            </form>
          )}
          <DialogFooter>
            {createdToken ? (
              <>
                <Button
                  variant="outline"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(createdToken);
                      toast.success("Secret API key copied");
                    } catch {
                      toast.error("Copy failed. Select and copy the key manually.");
                    }
                  }}
                >
                  Copy key
                </Button>
                <Button onClick={() => setCreateOpen(false)}>Done</Button>
              </>
            ) : (
              <Button
                type="submit"
                form="secret-api-key-create-form"
                disabled={create.isPending || !title.trim()}
              >
                {create.isPending ? "Creating…" : "Create key"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
