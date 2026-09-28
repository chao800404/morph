import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, FileDown, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";

type ExportKind = "inventory-items" | "products" | "orders";
type WorkflowStatus =
  "pending" | "running" | "succeeded" | "failed" | "expired";

type ExportExecution = {
  workflow_execution: {
    status: WorkflowStatus;
    filters: {
      q?: string | null;
      status?: string | null;
      created_within?: string | null;
      updated_within?: string | null;
      sort_by?: string | null;
      sort_order?: string | null;
    };
    progress: { processed_items: number; total_items: number | null };
    errors: Array<{ message: string }>;
    result: { download_url: string } | null;
  };
};

const endpoints: Record<
  ExportKind,
  { start: string; workflow: string; key: string }
> = {
  "inventory-items": {
    start: "/api/admin/inventory-items/export",
    workflow: "export-inventory-items",
    key: "morph.inventory-export.last-transaction",
  },
  products: {
    start: "/api/admin/products/export",
    workflow: "export-products",
    key: "morph.product-export.last-transaction",
  },
  orders: {
    start: "/api/admin/orders/export",
    workflow: "export-orders",
    key: "morph.order-export.last-transaction",
  },
};

const errorMessage = async (response: Response) => {
  try {
    const body = (await response.json()) as { message?: string };
    return body.message ?? `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
};

const filterSummary = (
  filters: ExportExecution["workflow_execution"]["filters"] | undefined,
  fallback: Record<string, string | undefined>,
) => {
  const values = [
    ["Search", filters?.q ?? fallback.q],
    ["Status", filters?.status ?? fallback.status],
    ["Created", filters?.created_within ?? fallback.created_within],
    ["Updated", filters?.updated_within ?? fallback.updated_within],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));
  return values.length
    ? values.map(([label, value]) => `${label}: ${value}`).join(" · ")
    : "No filters; all matching records will be exported";
};

export function AsyncCsvExportAction({
  kind,
  resourceLabel,
  description,
  filters,
}: {
  kind: ExportKind;
  resourceLabel: string;
  description: string;
  filters: Record<string, string | undefined>;
}) {
  const config = endpoints[kind];
  const [open, setOpen] = useState(false);
  const [transactionId, setTransactionId] = useState<string | null>(null);
  useEffect(() => {
    const saved = window.localStorage.getItem(config.key);
    if (saved && /^[0-9a-f-]{36}$/i.test(saved)) setTransactionId(saved);
  }, [config.key]);

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) query.set(key, value);
  }
  const queryString = query.toString();

  const startExport = useMutation({
    mutationFn: async () => {
      const response = await fetch(
        `${config.start}${queryString ? `?${queryString}` : ""}`,
        { method: "POST", credentials: "same-origin", cache: "no-store" },
      );
      if (!response.ok) throw new Error(await errorMessage(response));
      return (await response.json()) as { transaction_id: string };
    },
    onSuccess: ({ transaction_id }) => {
      window.localStorage.setItem(config.key, transaction_id);
      setTransactionId(transaction_id);
    },
  });

  const execution = useQuery({
    queryKey: ["commerce-csv-export", kind, transactionId],
    enabled: open && transactionId !== null,
    queryFn: async (): Promise<ExportExecution> => {
      const response = await fetch(
        `/api/admin/workflows-executions/${config.workflow}/${transactionId}`,
        { credentials: "same-origin", cache: "no-store" },
      );
      if (response.status === 404) {
        window.localStorage.removeItem(config.key);
        setTransactionId(null);
      }
      if (!response.ok) throw new Error(await errorMessage(response));
      return (await response.json()) as ExportExecution;
    },
    refetchInterval: (queryState) => {
      const status = queryState.state.data?.workflow_execution.status;
      return status === "pending" || status === "running" ? 1200 : false;
    },
  });

  const workflow = execution.data?.workflow_execution;
  const statusLabel =
    workflow?.status === "pending"
      ? "Waiting to start"
      : workflow?.status === "running"
        ? "Preparing CSV"
        : workflow?.status === "succeeded"
          ? "Export ready"
          : workflow?.status === "failed"
            ? "Export failed"
            : workflow?.status === "expired"
              ? "Export expired"
              : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) startExport.reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <FileDown />
          Export
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Export {resourceLabel}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
          <div className="font-medium">Export filters</div>
          <div className="mt-1 text-muted-foreground">
            {filterSummary(workflow?.filters, filters)}
          </div>
        </div>

        {startExport.error ? (
          <p role="alert" className="text-sm text-destructive">
            {startExport.error.message}
          </p>
        ) : null}
        {execution.error ? (
          <p role="alert" className="text-sm text-destructive">
            {execution.error.message}
          </p>
        ) : null}

        {workflow ? (
          <div
            className="flex items-start gap-3 rounded-md border px-3 py-3"
            aria-live="polite"
          >
            {workflow.status === "pending" || workflow.status === "running" ? (
              <LoaderCircle className="mt-0.5 size-4 animate-spin text-muted-foreground" />
            ) : workflow.status === "succeeded" ? (
              <Download className="mt-0.5 size-4 text-muted-foreground" />
            ) : (
              <FileDown className="mt-0.5 size-4 text-muted-foreground" />
            )}
            <div className="min-w-0 flex-1">
              <div className="font-medium">{statusLabel}</div>
              {workflow.status === "running" &&
              workflow.progress.total_items !== null ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  {workflow.progress.processed_items} of{" "}
                  {workflow.progress.total_items} items
                </p>
              ) : null}
              {workflow.status === "failed" || workflow.status === "expired" ? (
                <p className="mt-1 text-sm text-destructive">
                  {workflow.errors[0]?.message ??
                    "The export could not be created."}
                </p>
              ) : null}
              {workflow.result?.download_url ? (
                <a
                  className="mt-2 inline-flex text-sm font-medium text-primary underline-offset-4 hover:underline"
                  href={workflow.result.download_url}
                >
                  Download CSV
                </a>
              ) : null}
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Close</Button>
          </DialogClose>
          {!transactionId ||
          workflow?.status === "failed" ||
          workflow?.status === "expired" ||
          execution.isError ? (
            <Button
              disabled={startExport.isPending}
              onClick={() => startExport.mutate()}
            >
              {startExport.isPending ? (
                <LoaderCircle className="animate-spin" />
              ) : null}
              {transactionId ? "Try again" : "Start export"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
