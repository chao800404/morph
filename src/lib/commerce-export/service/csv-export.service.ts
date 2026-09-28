import { z } from "zod";
import type {
  CommerceExportExecution,
  CommerceExportFile,
  CommerceExportKind,
  CommerceExportStorage,
} from "@/lib/commerce-export/storage/commerce-export-storage";

export type CsvExportQueueMessage = {
  version: 1;
  type: "inventory-export" | "product-export" | "order-export";
  transactionId: string;
};

export interface CsvExportQueue {
  send(message: CsvExportQueueMessage): Promise<void>;
}

export type CsvExportPage = {
  page: number;
  limit: number;
  offset: number;
};

export interface CsvExportDefinition<TItem, TFilters extends object> {
  kind: CommerceExportKind;
  errorPrefix: "INVENTORY_EXPORT" | "PRODUCT_EXPORT" | "ORDER_EXPORT";
  pageSize?: number;
  filtersSchema: z.ZodType<TFilters>;
  columns: readonly string[];
  listItems(
    input: TFilters & CsvExportPage,
  ): Promise<{ items: TItem[]; total: number }>;
  rowsForItem(item: TItem): readonly (readonly unknown[])[];
  prepare?(): Promise<void>;
}

export interface CsvExportServiceDependencies<
  TItem,
  TFilters extends object,
> extends CsvExportDefinition<TItem, TFilters> {
  storage: CommerceExportStorage;
  queue?: CsvExportQueue;
  now?(): Date;
  createId?(): string;
}

const PAGE_SIZE = 100;
const MAX_EXPORT_ITEMS = 100_000;
const MAX_CSV_BYTES = 50 * 1024 * 1024;
const EXPORT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const textEncoder = new TextEncoder();

const csvCell = (value: unknown): string => {
  let text = value == null ? "" : String(value);
  // Prevent spreadsheet formulas from running when user supplied values are
  // opened in Excel or another spreadsheet application.
  if (/^[\u0000-\u0020]*[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const isTerminal = (status: CommerceExportExecution["status"]) =>
  status === "succeeded" || status === "failed";

const filePrefix = (kind: CommerceExportKind) =>
  kind === "products"
    ? "commerce/product-exports/files"
    : kind === "orders"
      ? "commerce/order-exports/files"
      : "commerce/inventory-exports/files";

/**
 * Shared bounded, resumable CSV workflow used by inventory and product
 * exports. Domain adapters own filters, data paging, and row projection.
 */
export function createCsvExportService<TItem, TFilters extends object>(
  dependencies: CsvExportServiceDependencies<TItem, TFilters>,
) {
  const now = dependencies.now ?? (() => new Date());
  const createId = dependencies.createId ?? (() => crypto.randomUUID());
  const { kind, errorPrefix } = dependencies;
  const pageSize = dependencies.pageSize ?? PAGE_SIZE;

  const parseExecution = (
    execution: CommerceExportExecution,
  ): CommerceExportExecution<TFilters> => {
    if (execution.kind && execution.kind !== kind) {
      throw new Error(`${errorPrefix}_EXECUTION_CORRUPT`);
    }
    const parsedFilters = dependencies.filtersSchema.safeParse(
      execution.filters,
    );
    if (!parsedFilters.success) {
      throw new Error(`${errorPrefix}_EXECUTION_CORRUPT`);
    }
    return {
      ...execution,
      kind,
      filters: parsedFilters.data,
    };
  };

  const mutateExecution = async (
    id: string,
    update: (
      execution: CommerceExportExecution<TFilters>,
    ) => CommerceExportExecution<TFilters> | null,
  ): Promise<CommerceExportExecution<TFilters> | null> => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const current = await dependencies.storage.getExecution(id, kind);
      if (!current) return null;
      const parsed = parseExecution(current.execution);
      const next = update(parsed);
      if (!next) return parsed;
      if (
        await dependencies.storage.compareAndSwapExecution(
          id,
          current.etag,
          next,
        )
      ) {
        return next;
      }
    }
    throw new Error(`${errorPrefix}_STATE_CONFLICT`);
  };

  const failExecution = async (id: string, error: string): Promise<void> => {
    await mutateExecution(id, (execution) => {
      if (isTerminal(execution.status)) return null;
      return {
        ...execution,
        status: "failed",
        error: error.slice(0, 500),
        updatedAt: now().toISOString(),
      };
    });
  };

  const getForOwner = async (
    id: string,
    ownerId: string,
  ): Promise<CommerceExportExecution<TFilters> | null> => {
    const record = await dependencies.storage.getExecution(id, kind);
    if (!record || record.execution.ownerId !== ownerId) return null;
    return parseExecution(record.execution);
  };

  return {
    async start(input: {
      ownerId: string;
      filters: TFilters;
    }): Promise<CommerceExportExecution<TFilters>> {
      if (!dependencies.queue) {
        throw new Error(`${errorPrefix}_QUEUE_UNAVAILABLE`);
      }
      const parsedFilters = dependencies.filtersSchema.safeParse(input.filters);
      if (!parsedFilters.success) {
        throw new Error(`${errorPrefix}_FILTERS_INVALID`);
      }
      const timestamp = now().toISOString();
      let execution: CommerceExportExecution<TFilters>;
      let created = false;
      for (let attempt = 0; attempt < 3 && !created; attempt += 1) {
        execution = {
          version: 1,
          kind,
          id: createId(),
          ownerId: input.ownerId,
          status: "pending",
          filters: parsedFilters.data,
          createdAt: timestamp,
          updatedAt: timestamp,
          processedItems: 0,
          totalItems: null,
          fileKey: null,
          expiresAt: null,
          error: null,
        };
        created = await dependencies.storage.createExecution(execution);
        if (!created) continue;
        try {
          await dependencies.queue.send({
            version: 1,
            type:
              kind === "products"
                ? "product-export"
                : kind === "orders"
                  ? "order-export"
                  : "inventory-export",
            transactionId: execution.id,
          });
          return execution;
        } catch {
          await failExecution(execution.id, "Export could not be queued");
          throw new Error(`${errorPrefix}_QUEUE_SEND_FAILED`);
        }
      }
      throw new Error(`${errorPrefix}_ID_COLLISION`);
    },

    getForOwner,

    async getFileForOwner(
      id: string,
      ownerId: string,
    ): Promise<{
      execution: CommerceExportExecution<TFilters>;
      file: CommerceExportFile;
    } | null> {
      const execution = await getForOwner(id, ownerId);
      if (
        !execution ||
        execution.status !== "succeeded" ||
        !execution.fileKey
      ) {
        return null;
      }
      if (
        execution.expiresAt &&
        Date.parse(execution.expiresAt) <= now().getTime()
      ) {
        await dependencies.storage.deleteFile(execution.fileKey);
        return null;
      }
      const file = await dependencies.storage.getFile(execution.fileKey);
      return file ? { execution, file } : null;
    },

    async process(id: string): Promise<"completed" | "already-finished"> {
      const record = await dependencies.storage.getExecution(id, kind);
      if (!record) throw new Error(`${errorPrefix}_EXECUTION_NOT_FOUND`);
      const initial = parseExecution(record.execution);
      if (isTerminal(initial.status)) return "already-finished";

      const running = await mutateExecution(id, (execution) => {
        if (isTerminal(execution.status)) return null;
        return {
          ...execution,
          status: "running",
          updatedAt: now().toISOString(),
          error: null,
        };
      });
      if (!running || isTerminal(running.status)) return "already-finished";
      const current = await dependencies.storage.getExecution(id, kind);
      if (!current) throw new Error(`${errorPrefix}_EXECUTION_NOT_FOUND`);
      const execution = parseExecution(current.execution);

      try {
        await dependencies.prepare?.();
        let offset = 0;
        let processedItems = 0;
        let totalItems: number | null = null;
        let byteCount = 0;
        let currentPage: TItem[] = [];
        let pageItemIndex = 0;
        let currentRows: readonly (readonly unknown[])[] | null = null;
        let rowIndex = 0;
        let streamStopped = false;

        const updateProgress = async (): Promise<void> => {
          const progress = await mutateExecution(id, (state) => {
            if (isTerminal(state.status)) return null;
            return {
              ...state,
              status: "running",
              processedItems: Math.max(state.processedItems, processedItems),
              totalItems,
              updatedAt: now().toISOString(),
            };
          });
          if (!progress || isTerminal(progress.status)) streamStopped = true;
        };

        const encodeLine = (line: string): Uint8Array => {
          const bytes = textEncoder.encode(line);
          byteCount += bytes.byteLength;
          if (byteCount > MAX_CSV_BYTES) {
            throw new Error(`${errorPrefix}_FILE_TOO_LARGE`);
          }
          return bytes;
        };

        const csvStream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encodeLine(
                `\uFEFF${dependencies.columns.map(csvCell).join(",")}\r\n`,
              ),
            );
          },
          async pull(controller) {
            try {
              if (streamStopped) {
                controller.close();
                return;
              }

              while (true) {
                if (currentRows) {
                  const row = currentRows[rowIndex];
                  if (!row) {
                    currentRows = null;
                    rowIndex = 0;
                    processedItems += 1;
                    pageItemIndex += 1;
                    continue;
                  }
                  controller.enqueue(
                    encodeLine(`${row.map(csvCell).join(",")}\r\n`),
                  );
                  rowIndex += 1;
                  if (rowIndex >= currentRows.length) {
                    currentRows = null;
                    rowIndex = 0;
                    processedItems += 1;
                    pageItemIndex += 1;
                  }
                  return;
                }

                if (pageItemIndex >= currentPage.length) {
                  if (currentPage.length > 0) await updateProgress();
                  if (
                    streamStopped ||
                    (totalItems !== null && processedItems >= totalItems)
                  ) {
                    controller.close();
                    return;
                  }
                  const page = await dependencies.listItems({
                    ...execution.filters,
                    page: Math.floor(offset / pageSize) + 1,
                    limit: pageSize,
                    offset,
                  });
                  totalItems = page.total;
                  if (totalItems > MAX_EXPORT_ITEMS) {
                    throw new Error(`${errorPrefix}_TOO_MANY_ITEMS`);
                  }
                  if (page.items.length === 0) {
                    controller.close();
                    return;
                  }
                  currentPage = page.items;
                  pageItemIndex = 0;
                  offset += page.items.length;
                }

                const item = currentPage[pageItemIndex];
                if (!item) throw new Error(`${errorPrefix}_PAGE_STATE_INVALID`);
                const rows = dependencies.rowsForItem(item);
                if (rows.length === 0) {
                  processedItems += 1;
                  pageItemIndex += 1;
                  continue;
                }
                currentRows = rows;
                rowIndex = 0;
              }
            } catch (error) {
              controller.error(error);
            }
          },
        });

        const fileKey = `${filePrefix(kind)}/${id}/${createId()}.csv`;
        try {
          await dependencies.storage.putFile(fileKey, csvStream);
        } catch (error) {
          await dependencies.storage.deleteFile(fileKey);
          throw error;
        }
        const finishedAt = now();
        const completed = await mutateExecution(id, (state) => {
          if (isTerminal(state.status)) return null;
          return {
            ...state,
            status: "succeeded",
            processedItems,
            totalItems: totalItems ?? 0,
            fileKey,
            expiresAt: new Date(
              finishedAt.getTime() + EXPORT_RETENTION_MS,
            ).toISOString(),
            error: null,
            updatedAt: finishedAt.toISOString(),
          };
        });
        if (!completed || completed.fileKey !== fileKey) {
          await dependencies.storage.deleteFile(fileKey);
        }
        return "completed";
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message === `${errorPrefix}_TOO_MANY_ITEMS` ||
            error.message === `${errorPrefix}_FILE_TOO_LARGE`)
        ) {
          await failExecution(
            id,
            error.message === `${errorPrefix}_TOO_MANY_ITEMS`
              ? `Export exceeds the ${MAX_EXPORT_ITEMS.toLocaleString()} item limit`
              : "Export exceeds the 50 MB file limit",
          );
          return "completed";
        }
        throw error;
      }
    },

    async fail(id: string, message: string): Promise<void> {
      await failExecution(id, message);
    },
  };
}

export type CsvExportService<TFilters extends object> = ReturnType<
  typeof createCsvExportService<unknown, TFilters>
>;
