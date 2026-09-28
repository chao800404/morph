import {
  parseProductImportCsv,
  PRODUCT_IMPORT_MAX_BYTES,
  type ProductImportGroup,
  type ProductImportIssue,
  type ProductImportPlan,
} from "./product-import.csv";
import {
  PRODUCT_IMPORT_ISSUE_LIMIT,
  productImportIssuePreview,
  type ProductImportExecution,
  type ProductImportStorage,
} from "./product-import-storage";

export interface ProductImportQueue {
  send(message: {
    version: 1;
    type: "product-import";
    transactionId: string;
    dispatchToken: string;
  }): Promise<void>;
}

export interface ProductImportGroupResult {
  success: boolean;
  action?: "created" | "updated";
  message?: string;
}

export interface ProductImportServiceDependencies {
  storage: ProductImportStorage;
  queue?: ProductImportQueue;
  applyGroup(
    group: ProductImportGroup,
    actorId: string,
  ): Promise<ProductImportGroupResult>;
  findCategoriesByName?(names: string[]): Promise<Array<{ id: string; name: string }>>;
  findCategoryIds?(ids: string[]): Promise<string[]>;
  now?(): Date;
  createId?(): string;
}

const nowIso = (now: () => Date) => now().toISOString();
const fileKey = (id: string) => `commerce/product-imports/files/${id}.csv`;
const LEASE_MS = 10 * 60 * 1000;
const GROUPS_PER_MESSAGE = 10;

const withIssues = (
  execution: ProductImportExecution,
  issues: ProductImportIssue[],
) => ({
  ...execution,
  issueCount: issues.length,
  issues: productImportIssuePreview(issues),
});

const resolveCategoryNames = async (
  plan: ProductImportPlan,
  findCategoriesByName: ProductImportServiceDependencies["findCategoriesByName"],
  findCategoryIds: ProductImportServiceDependencies["findCategoryIds"],
): Promise<ProductImportPlan> => {
  const ids = [...new Set(plan.groups.flatMap((group) => group.rows.flatMap((row) => row.product.categoryIds ?? [])))];
  const foundIds = new Set(findCategoryIds ? await findCategoryIds(ids) : []);
  const issues: ProductImportIssue[] = [];
  for (const group of plan.groups) {
    for (const row of group.rows) {
      for (const id of row.product.categoryIds ?? []) {
        if (!foundIds.has(id)) {
          issues.push({ row: row.row, field: "Product Category Id", message: `Category ${id} was not found` });
        }
      }
    }
  }
  const names = [...new Set(plan.groups.flatMap((group) => group.rows.flatMap((row) => row.product.categoryNames ?? [])))];
  if (names.length === 0) return { ...plan, issues: [...plan.issues, ...issues] };
  const rows = findCategoriesByName ? await findCategoriesByName(names) : [];
  const matches = new Map<string, string[]>();
  for (const row of rows) {
    const key = row.name.trim().toLowerCase();
    const ids = matches.get(key) ?? [];
    ids.push(row.id);
    matches.set(key, ids);
  }
  for (const group of plan.groups) {
    for (const row of group.rows) {
      const categoryIds = new Set(row.product.categoryIds ?? []);
      for (const name of row.product.categoryNames ?? []) {
        const ids = matches.get(name.trim().toLowerCase()) ?? [];
        if (ids.length !== 1) {
          issues.push({
            row: row.row,
            field: "Product Category",
            message:
              ids.length === 0
                ? `Category "${name}" was not found. Use an existing category name or Morph category ID.`
                : `Category "${name}" matches more than one category. Use a Morph category ID.`,
          });
        } else categoryIds.add(ids[0]!);
      }
      if (categoryIds.size > 0) row.product.categoryIds = [...categoryIds];
    }
  }
  return { ...plan, issues: [...plan.issues, ...issues] };
};

/**
 * Preview, confirmation, owner-bound status, and queued application for CSV
 * product imports. Product writes stay behind the existing write services.
 */
export function createProductImportService(
  dependencies: ProductImportServiceDependencies,
) {
  const now = dependencies.now ?? (() => new Date());
  const createId = dependencies.createId ?? (() => crypto.randomUUID());

  return {
    async preview(input: {
      ownerId: string;
      csv: string;
    }): Promise<ProductImportExecution> {
      if (new TextEncoder().encode(input.csv).byteLength > PRODUCT_IMPORT_MAX_BYTES) {
        throw new Error("PRODUCT_IMPORT_FILE_TOO_LARGE");
      }
      const plan = await resolveCategoryNames(
        parseProductImportCsv(input.csv),
        dependencies.findCategoriesByName,
        dependencies.findCategoryIds,
      );
      const id = createId();
      const timestamp = nowIso(now);
      const execution = withIssues(
        {
          version: 1,
          id,
          ownerId: input.ownerId,
          status: "awaiting_confirmation",
          dispatchToken: null,
          leaseExpiresAt: null,
          fileKey: fileKey(id),
          createdAt: timestamp,
          updatedAt: timestamp,
          rows: plan.rows,
          createCount: plan.createCount,
          updateCount: plan.updateCount,
          variantCount: plan.variantCount,
          processedGroups: 0,
          createdProducts: 0,
          updatedProducts: 0,
          issueCount: 0,
          issues: [],
          error: null,
        },
        plan.issues,
      );
      if (execution.issueCount === 0 && execution.rows > 0) {
        await dependencies.storage.putCsv(execution.fileKey, input.csv);
      }
      if (!(await dependencies.storage.createExecution(execution))) {
        await dependencies.storage.deleteCsv(execution.fileKey).catch(() => {});
        throw new Error("PRODUCT_IMPORT_EXECUTION_COLLISION");
      }
      return execution;
    },

    async confirm(id: string, ownerId: string): Promise<ProductImportExecution | null> {
      if (!dependencies.queue) throw new Error("PRODUCT_IMPORT_QUEUE_UNAVAILABLE");
      const current = await dependencies.storage.getExecution(id);
      if (!current || current.execution.ownerId !== ownerId) return null;
      if (current.execution.status !== "awaiting_confirmation") {
        return current.execution;
      }
      if (current.execution.issueCount > 0 || current.execution.rows === 0) {
        throw new Error("PRODUCT_IMPORT_PREVIEW_HAS_ISSUES");
      }
      const dispatchToken = createId();
      const pending: ProductImportExecution = {
        ...current.execution,
        status: "pending",
        updatedAt: nowIso(now),
        dispatchToken,
        leaseExpiresAt: null,
        error: null,
      };
      if (!(await dependencies.storage.compareAndSwapExecution(id, current.etag, pending))) {
        const fresh = await dependencies.storage.getExecution(id);
        return fresh?.execution ?? null;
      }
      try {
        await dependencies.queue.send({
          version: 1,
          type: "product-import",
          transactionId: id,
          dispatchToken,
        });
      } catch {
        const saved = await dependencies.storage.getExecution(id);
        if (saved?.execution.status === "pending" && saved.execution.dispatchToken === dispatchToken) {
          await dependencies.storage.compareAndSwapExecution(id, saved.etag, {
            ...saved.execution,
            status: "awaiting_confirmation",
            updatedAt: nowIso(now),
            dispatchToken: null,
            error: "The import queue could not be reached. Try confirming again.",
          });
        }
        throw new Error("PRODUCT_IMPORT_QUEUE_SEND_FAILED");
      }
      const saved = await dependencies.storage.getExecution(id);
      return saved?.execution ?? pending;
    },

    async getForOwner(id: string, ownerId: string) {
      const result = await dependencies.storage.getExecution(id);
      return result?.execution.ownerId === ownerId ? result.execution : null;
    },

    async fail(id: string, error: string) {
      const current = await dependencies.storage.getExecution(id);
      if (!current || current.execution.status === "succeeded" || current.execution.status === "failed") return;
      const updated = await dependencies.storage.compareAndSwapExecution(id, current.etag, {
        ...current.execution,
        status: "failed",
        updatedAt: nowIso(now),
        dispatchToken: null,
        leaseExpiresAt: null,
        error: error.slice(0, 500),
      });
      if (updated) await dependencies.storage.deleteCsv(current.execution.fileKey).catch(() => {});
    },

    async retry(id: string, dispatchToken: string) {
      const current = await dependencies.storage.getExecution(id);
      if (
        !current ||
        current.execution.status !== "running" ||
        current.execution.dispatchToken !== dispatchToken
      ) return;
      await dependencies.storage.compareAndSwapExecution(id, current.etag, {
        ...current.execution,
        status: "pending",
        updatedAt: nowIso(now),
        leaseExpiresAt: null,
      });
    },

    async process(id: string, dispatchToken: string): Promise<void> {
      let stored = await dependencies.storage.getExecution(id);
      if (!stored) return;
      const isPendingDispatch =
        stored.execution.status === "pending" &&
        stored.execution.dispatchToken === dispatchToken;
      const isExpiredLease =
        stored.execution.status === "running" &&
        stored.execution.dispatchToken === dispatchToken &&
        stored.execution.leaseExpiresAt !== null &&
        Date.parse(stored.execution.leaseExpiresAt) <= now().getTime();
      if (!isPendingDispatch && !isExpiredLease) return;

      const running: ProductImportExecution = {
        ...stored.execution,
        status: "running",
        updatedAt: nowIso(now),
        leaseExpiresAt: new Date(now().getTime() + LEASE_MS).toISOString(),
      };
      if (!(await dependencies.storage.compareAndSwapExecution(id, stored.etag, running))) return;
      stored = (await dependencies.storage.getExecution(id))!;

      const csv = await dependencies.storage.getCsv(stored.execution.fileKey);
      if (csv === null) {
        await this.finishFailed(stored, "The uploaded CSV is no longer available");
        return;
      }
      const plan = await resolveCategoryNames(
        parseProductImportCsv(csv),
        dependencies.findCategoriesByName,
        dependencies.findCategoryIds,
      );
      if (plan.issues.length > 0 || plan.groups.length === 0) {
        await this.finishFailed(stored, "The CSV changed or failed validation after preview", plan.issues);
        return;
      }

      const end = Math.min(
        plan.groups.length,
        stored.execution.processedGroups + GROUPS_PER_MESSAGE,
      );
      for (let index = stored.execution.processedGroups; index < end; index += 1) {
        const group = plan.groups[index]!;
        let result: ProductImportGroupResult;
        try {
          result = await dependencies.applyGroup(group, stored.execution.ownerId);
        } catch (error) {
          result = {
            success: false,
            message: error instanceof Error ? error.message : "Product write failed",
          };
        }
        const latest = await dependencies.storage.getExecution(id);
        if (!latest || latest.execution.status !== "running" || latest.execution.dispatchToken !== dispatchToken) return;
        const runtimeIssues = result.success
          ? latest.execution.issues
          : [
              ...latest.execution.issues,
              {
                row: group.rows[0]?.row ?? null,
                message: result.message ?? "Product could not be imported",
              },
            ].slice(0, PRODUCT_IMPORT_ISSUE_LIMIT);
        const updated: ProductImportExecution = {
          ...latest.execution,
          processedGroups: index + 1,
          createdProducts: latest.execution.createdProducts + (result.success && result.action === "created" ? 1 : 0),
          updatedProducts: latest.execution.updatedProducts + (result.success && result.action === "updated" ? 1 : 0),
          issueCount: latest.execution.issueCount + (result.success ? 0 : 1),
          issues: runtimeIssues,
          updatedAt: nowIso(now),
          leaseExpiresAt: new Date(now().getTime() + LEASE_MS).toISOString(),
        };
        if (!(await dependencies.storage.compareAndSwapExecution(id, latest.etag, updated))) {
          throw new Error("PRODUCT_IMPORT_STATE_CONFLICT");
        }
        stored = (await dependencies.storage.getExecution(id))!;
      }

      if (end >= plan.groups.length) {
        const final = await dependencies.storage.getExecution(id);
        if (!final || final.execution.status !== "running") return;
        const finished = await dependencies.storage.compareAndSwapExecution(id, final.etag, {
          ...final.execution,
          status: final.execution.issueCount === 0 ? "succeeded" : "failed",
          updatedAt: nowIso(now),
          leaseExpiresAt: null,
          dispatchToken: null,
          error: final.execution.issueCount === 0 ? null : "Some products could not be imported",
        });
        if (finished) await dependencies.storage.deleteCsv(final.execution.fileKey).catch(() => {});
        return;
      }

      const next = await dependencies.storage.getExecution(id);
      if (!next || next.execution.status !== "running") return;
      const queued: ProductImportExecution = {
        ...next.execution,
        status: "pending",
        updatedAt: nowIso(now),
        leaseExpiresAt: null,
      };
      if (!(await dependencies.storage.compareAndSwapExecution(id, next.etag, queued))) return;
      try {
        if (!dependencies.queue) throw new Error("PRODUCT_IMPORT_QUEUE_UNAVAILABLE");
        await dependencies.queue.send({
          version: 1,
          type: "product-import",
          transactionId: id,
          dispatchToken,
        });
      } catch {
        const failed = await dependencies.storage.getExecution(id);
        if (failed?.execution.status === "pending") {
          const markedFailed = await dependencies.storage.compareAndSwapExecution(id, failed.etag, {
            ...failed.execution,
            status: "failed",
            updatedAt: nowIso(now),
            dispatchToken: null,
            error: "The import stopped before all products were processed",
          });
          if (markedFailed) await dependencies.storage.deleteCsv(failed.execution.fileKey).catch(() => {});
        }
      }
    },

    async finishFailed(
      stored: { execution: ProductImportExecution; etag: string },
      error: string,
      issues: ProductImportIssue[] = [],
    ) {
      const markedFailed = await dependencies.storage.compareAndSwapExecution(
        stored.execution.id,
        stored.etag,
        withIssues(
          {
            ...stored.execution,
            status: "failed",
            updatedAt: nowIso(now),
            leaseExpiresAt: null,
            dispatchToken: null,
            error,
          },
          issues,
        ),
      );
      if (markedFailed) await dependencies.storage.deleteCsv(stored.execution.fileKey).catch(() => {});
    },
  };
}

export type ProductImportService = ReturnType<typeof createProductImportService>;
