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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileUp, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";

type ImportStatus =
  | "awaiting_confirmation"
  | "pending"
  | "running"
  | "succeeded"
  | "failed";

type ImportExecution = {
  workflow_execution: {
    id: string;
    status: ImportStatus;
    preview: {
      rows: number;
      products_to_create: number;
      products_to_update: number;
      variants: number;
    };
    progress: {
      processed_items: number;
      total_items: number;
      created_products: number;
      updated_products: number;
    };
    errors: Array<{ row: number | null; field?: string | null; message: string }>;
    error_count: number;
  };
};

type PreviewResult = {
  transaction_id: string;
  preview: ImportExecution["workflow_execution"]["preview"] & {
    error_count: number;
    errors: ImportExecution["workflow_execution"]["errors"];
  };
};

const storageKey = "morph.product-import.last-transaction";

const requestError = async (response: Response) => {
  try {
    const body = (await response.json()) as { message?: string };
    return body.message ?? `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
};

export function ProductCsvImportAction() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [transactionId, setTransactionId] = useState<string | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem(storageKey);
    if (saved && /^[0-9a-f-]{36}$/i.test(saved)) setTransactionId(saved);
  }, []);

  const previewImport = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose a CSV file first");
      const response = await fetch("/api/admin/products/import", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "content-type": "text/csv; charset=utf-8" },
        body: file,
      });
      if (!response.ok) throw new Error(await requestError(response));
      return (await response.json()) as PreviewResult;
    },
    onSuccess: ({ transaction_id }) => {
      window.localStorage.setItem(storageKey, transaction_id);
      setTransactionId(transaction_id);
    },
  });

  const execution = useQuery({
    queryKey: ["product-csv-import", transactionId],
    enabled: open && transactionId !== null,
    queryFn: async (): Promise<ImportExecution> => {
      const response = await fetch(
        `/api/admin/workflows-executions/import-products/${transactionId}`,
        { credentials: "same-origin", cache: "no-store" },
      );
      if (response.status === 404) {
        window.localStorage.removeItem(storageKey);
        setTransactionId(null);
      }
      if (!response.ok) throw new Error(await requestError(response));
      return (await response.json()) as ImportExecution;
    },
    refetchInterval: (state) => {
      const status = state.state.data?.workflow_execution.status;
      return status === "pending" || status === "running" ? 1200 : false;
    },
  });

  const confirmImport = useMutation({
    mutationFn: async () => {
      if (!transactionId) throw new Error("Preview a CSV before importing");
      const response = await fetch(
        `/api/admin/products/import/${transactionId}/confirm`,
        {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
        },
      );
      if (!response.ok) throw new Error(await requestError(response));
      return (await response.json()) as ImportExecution;
    },
    onSuccess: () => {
      void execution.refetch();
    },
  });

  const workflow = execution.data?.workflow_execution;
  useEffect(() => {
    if (workflow?.status === "succeeded" || workflow?.status === "failed") {
      void queryClient.invalidateQueries({ queryKey: ["products"] });
    }
  }, [queryClient, workflow?.status]);

  const statusLabel =
    workflow?.status === "awaiting_confirmation"
      ? "Preview ready"
      : workflow?.status === "pending"
        ? "Waiting to start"
        : workflow?.status === "running"
          ? "Importing products"
          : workflow?.status === "succeeded"
            ? "Import complete"
            : workflow?.status === "failed"
              ? "Import finished with errors"
              : null;
  const hasPreviewErrors = (workflow?.error_count ?? 0) > 0;
  const isProcessing = workflow?.status === "pending" || workflow?.status === "running";

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) {
          previewImport.reset();
          confirmImport.reset();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <FileUp />
          Import
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import products from CSV</DialogTitle>
          <DialogDescription>
            Upload a CSV to review product and variant rows. Confirming starts a background import.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-3">
          <div>
            <div className="font-medium">CSV format</div>
            <p className="mt-1 text-sm text-muted-foreground">
              UTF-8 CSV, up to 5 MB. Product and variant identifiers must be Morph IDs.
            </p>
          </div>
          <a
            className="inline-flex items-center gap-2 text-sm font-medium text-primary underline-offset-4 hover:underline"
            href="/api/admin/products/import/template"
          >
            <Download className="size-4" />
            Download template
          </a>
        </div>

        <div className="space-y-2">
          <label htmlFor="product-csv-import-file" className="text-sm font-medium">
            CSV file
          </label>
          <input
            id="product-csv-import-file"
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => {
              setFile(event.currentTarget.files?.[0] ?? null);
              setTransactionId(null);
              window.localStorage.removeItem(storageKey);
              previewImport.reset();
            }}
            className="block w-full rounded-md border bg-background px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-muted file:px-2 file:py-1"
          />
          {file ? <p className="text-xs text-muted-foreground">{file.name}</p> : null}
        </div>

        {previewImport.error ? (
          <p role="alert" className="text-sm text-destructive">{previewImport.error.message}</p>
        ) : null}
        {execution.error ? (
          <p role="alert" className="text-sm text-destructive">{execution.error.message}</p>
        ) : null}
        {confirmImport.error ? (
          <p role="alert" className="text-sm text-destructive">{confirmImport.error.message}</p>
        ) : null}

        {workflow ? (
          <section className="space-y-3 rounded-md border px-3 py-3" aria-live="polite">
            <div className="flex items-center gap-2 font-medium">
              {isProcessing ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {statusLabel}
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <div><span className="text-muted-foreground">Rows</span><div>{workflow.preview.rows}</div></div>
              <div><span className="text-muted-foreground">Create</span><div>{workflow.preview.products_to_create}</div></div>
              <div><span className="text-muted-foreground">Update</span><div>{workflow.preview.products_to_update}</div></div>
              <div><span className="text-muted-foreground">Variants</span><div>{workflow.preview.variants}</div></div>
            </div>
            {isProcessing ? (
              <p className="text-sm text-muted-foreground">
                Processed {workflow.progress.processed_items} of {workflow.progress.total_items} products.
              </p>
            ) : null}
            {workflow.status === "succeeded" || workflow.status === "failed" ? (
              <p className="text-sm text-muted-foreground">
                Created {workflow.progress.created_products}; updated {workflow.progress.updated_products}.
              </p>
            ) : null}
            {workflow.errors.length ? (
              <div className="max-h-48 space-y-1 overflow-y-auto rounded border bg-muted/20 p-2 text-sm" role="alert">
                {workflow.errors.slice(0, 100).map((issue, index) => (
                  <p key={`${issue.row ?? "job"}-${issue.field ?? ""}-${index}`}>
                    {issue.row ? `Row ${issue.row}${issue.field ? ` · ${issue.field}` : ""}: ` : ""}{issue.message}
                  </p>
                ))}
                {workflow.error_count > workflow.errors.length ? (
                  <p className="text-muted-foreground">And {workflow.error_count - workflow.errors.length} more errors.</p>
                ) : null}
              </div>
            ) : null}
          </section>
        ) : null}

        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Close</Button></DialogClose>
          <Button
            variant="outline"
            disabled={!file || previewImport.isPending || isProcessing}
            onClick={() => previewImport.mutate()}
          >
            {previewImport.isPending ? <LoaderCircle className="animate-spin" /> : null}
            {workflow && workflow.status !== "awaiting_confirmation" ? "Preview another file" : "Preview CSV"}
          </Button>
          {workflow?.status === "awaiting_confirmation" && !hasPreviewErrors ? (
            <Button disabled={confirmImport.isPending} onClick={() => confirmImport.mutate()}>
              {confirmImport.isPending ? <LoaderCircle className="animate-spin" /> : null}
              Confirm import
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
