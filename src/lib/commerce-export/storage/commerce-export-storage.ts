import { z } from "zod";

export const commerceExportKindSchema = z.enum([
  "inventory-items",
  "products",
  "orders",
]);
export type CommerceExportKind = z.infer<typeof commerceExportKindSchema>;

const executionRecordSchema = z
  .object({
    version: z.literal(1),
    // Missing kind is accepted for inventory jobs created by the first export
    // implementation. New executions always store an explicit kind.
    kind: commerceExportKindSchema.optional(),
    id: z.uuid(),
    ownerId: z.string().min(1).max(200),
    status: z.enum(["pending", "running", "succeeded", "failed"]),
    filters: z.unknown(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    processedItems: z.number().int().nonnegative(),
    totalItems: z.number().int().nonnegative().nullable(),
    fileKey: z.string().max(500).nullable(),
    expiresAt: z.iso.datetime().nullable(),
    error: z.string().max(500).nullable(),
  })
  .strict();

export type CommerceExportExecution<TFilters = unknown> = {
  version: 1;
  kind?: CommerceExportKind;
  id: string;
  ownerId: string;
  status: "pending" | "running" | "succeeded" | "failed";
  filters: TFilters;
  createdAt: string;
  updatedAt: string;
  processedItems: number;
  totalItems: number | null;
  fileKey: string | null;
  expiresAt: string | null;
  error: string | null;
};

export type VersionedCommerceExportExecution = {
  execution: CommerceExportExecution;
  etag: string;
};

export type CommerceExportFile = {
  body: ReadableStream;
  size: number;
};

export interface CommerceExportStorage {
  createExecution(execution: CommerceExportExecution): Promise<boolean>;
  getExecution(
    id: string,
    kind?: CommerceExportKind,
  ): Promise<VersionedCommerceExportExecution | null>;
  compareAndSwapExecution(
    id: string,
    etag: string,
    execution: CommerceExportExecution,
  ): Promise<boolean>;
  putFile(key: string, contents: string | ReadableStream): Promise<void>;
  getFile(key: string): Promise<CommerceExportFile | null>;
  deleteFile(key: string): Promise<void>;
}

export interface CommerceExportR2Bucket {
  get(key: string): Promise<{
    body: ReadableStream;
    etag: string;
    size: number;
    text(): Promise<string>;
  } | null>;
  put(
    key: string,
    value: string | ReadableStream,
    options?: {
      onlyIf?: { etagDoesNotMatch?: string; etagMatches?: string };
      httpMetadata?: { contentType?: string; cacheControl?: string };
    },
  ): Promise<{ etag: string } | null>;
  delete(key: string): Promise<void>;
}

const executionPrefix = (kind: CommerceExportKind) =>
  kind === "products"
    ? "commerce/product-exports/executions"
    : kind === "orders"
      ? "commerce/order-exports/executions"
      : "commerce/inventory-exports/executions";

const executionKey = (id: string, kind: CommerceExportKind) =>
  `${executionPrefix(kind)}/${id}.json`;

const parseExecution = (value: unknown): CommerceExportExecution | null => {
  const parsed = executionRecordSchema.safeParse(value);
  return parsed.success ? (parsed.data as CommerceExportExecution) : null;
};

/** R2-backed private workflow state and CSV artifacts for commerce exports. */
export class R2CommerceExportStorage implements CommerceExportStorage {
  constructor(private readonly bucket?: CommerceExportR2Bucket) {}

  private requireBucket(): CommerceExportR2Bucket {
    if (!this.bucket) {
      throw new Error("COMMERCE_EXPORT_STORAGE_UNAVAILABLE");
    }
    return this.bucket;
  }

  async createExecution(execution: CommerceExportExecution): Promise<boolean> {
    const kind = execution.kind ?? "inventory-items";
    const result = await this.requireBucket().put(
      executionKey(execution.id, kind),
      JSON.stringify(execution),
      {
        onlyIf: { etagDoesNotMatch: "*" },
        httpMetadata: {
          contentType: "application/json; charset=utf-8",
          cacheControl: "private, no-store",
        },
      },
    );
    return result !== null;
  }

  async getExecution(
    id: string,
    kind: CommerceExportKind = "inventory-items",
  ): Promise<VersionedCommerceExportExecution | null> {
    const object = await this.requireBucket().get(executionKey(id, kind));
    if (!object) return null;
    let raw: unknown;
    try {
      raw = JSON.parse(await object.text());
    } catch {
      throw new Error("COMMERCE_EXPORT_EXECUTION_CORRUPT");
    }
    const execution = parseExecution(raw);
    if (
      !execution ||
      execution.id !== id ||
      (execution.kind && execution.kind !== kind)
    ) {
      throw new Error("COMMERCE_EXPORT_EXECUTION_CORRUPT");
    }
    return { execution, etag: object.etag };
  }

  async compareAndSwapExecution(
    id: string,
    etag: string,
    execution: CommerceExportExecution,
  ): Promise<boolean> {
    const kind = execution.kind ?? "inventory-items";
    const result = await this.requireBucket().put(
      executionKey(id, kind),
      JSON.stringify(execution),
      {
        onlyIf: { etagMatches: etag },
        httpMetadata: {
          contentType: "application/json; charset=utf-8",
          cacheControl: "private, no-store",
        },
      },
    );
    return result !== null;
  }

  async putFile(key: string, contents: string | ReadableStream): Promise<void> {
    const result = await this.requireBucket().put(key, contents, {
      onlyIf: { etagDoesNotMatch: "*" },
      httpMetadata: {
        contentType: "text/csv; charset=utf-8",
        cacheControl: "private, no-store",
      },
    });
    if (!result) throw new Error("COMMERCE_EXPORT_FILE_KEY_COLLISION");
  }

  async getFile(key: string): Promise<CommerceExportFile | null> {
    const object = await this.requireBucket().get(key);
    return object ? { body: object.body, size: object.size } : null;
  }

  async deleteFile(key: string): Promise<void> {
    await this.requireBucket().delete(key);
  }
}
