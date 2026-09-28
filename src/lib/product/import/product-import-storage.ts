import { z } from "zod";
import type { ProductImportIssue } from "./product-import.csv";

export const PRODUCT_IMPORT_ISSUE_LIMIT = 100;

export const productImportExecutionSchema = z
  .object({
    version: z.literal(1),
    id: z.uuid(),
    ownerId: z.string().min(1).max(200),
    status: z.enum([
      "awaiting_confirmation",
      "pending",
      "running",
      "succeeded",
      "failed",
    ]),
    dispatchToken: z.uuid().nullable(),
    leaseExpiresAt: z.iso.datetime().nullable(),
    fileKey: z.string().max(500),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    rows: z.number().int().nonnegative(),
    createCount: z.number().int().nonnegative(),
    updateCount: z.number().int().nonnegative(),
    variantCount: z.number().int().nonnegative(),
    processedGroups: z.number().int().nonnegative(),
    createdProducts: z.number().int().nonnegative(),
    updatedProducts: z.number().int().nonnegative(),
    issueCount: z.number().int().nonnegative(),
    issues: z.array(
      z.object({
        row: z.number().int().positive().nullable(),
        field: z.string().max(200).optional(),
        message: z.string().max(500),
      }).strict(),
    ).max(PRODUCT_IMPORT_ISSUE_LIMIT),
    error: z.string().max(500).nullable(),
  })
  .strict();

export type ProductImportExecution = z.infer<
  typeof productImportExecutionSchema
>;

export type VersionedProductImportExecution = {
  execution: ProductImportExecution;
  etag: string;
};

export interface ProductImportStorage {
  createExecution(execution: ProductImportExecution): Promise<boolean>;
  getExecution(id: string): Promise<VersionedProductImportExecution | null>;
  compareAndSwapExecution(
    id: string,
    etag: string,
    execution: ProductImportExecution,
  ): Promise<boolean>;
  putCsv(key: string, contents: string): Promise<void>;
  getCsv(key: string): Promise<string | null>;
  deleteCsv(key: string): Promise<void>;
}

export interface ProductImportR2Bucket {
  get(key: string): Promise<{
    etag: string;
    text(): Promise<string>;
  } | null>;
  put(
    key: string,
    value: string,
    options?: {
      onlyIf?: { etagDoesNotMatch?: string; etagMatches?: string };
      httpMetadata?: { contentType?: string; cacheControl?: string };
    },
  ): Promise<{ etag: string } | null>;
  delete(key: string): Promise<void>;
}

const executionKey = (id: string) =>
  `commerce/product-imports/executions/${id}.json`;
const csvKeyPrefix = "commerce/product-imports/files";

/** Private R2 records and uploaded source CSVs for product imports. */
export class R2ProductImportStorage implements ProductImportStorage {
  constructor(private readonly bucket?: ProductImportR2Bucket) {}

  private requireBucket(): ProductImportR2Bucket {
    if (!this.bucket) throw new Error("PRODUCT_IMPORT_STORAGE_UNAVAILABLE");
    return this.bucket;
  }

  async createExecution(execution: ProductImportExecution): Promise<boolean> {
    const result = await this.requireBucket().put(
      executionKey(execution.id),
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

  async getExecution(id: string): Promise<VersionedProductImportExecution | null> {
    const object = await this.requireBucket().get(executionKey(id));
    if (!object) return null;
    let raw: unknown;
    try {
      raw = JSON.parse(await object.text());
    } catch {
      throw new Error("PRODUCT_IMPORT_EXECUTION_CORRUPT");
    }
    const parsed = productImportExecutionSchema.safeParse(raw);
    if (!parsed.success || parsed.data.id !== id) {
      throw new Error("PRODUCT_IMPORT_EXECUTION_CORRUPT");
    }
    return { execution: parsed.data, etag: object.etag };
  }

  async compareAndSwapExecution(
    id: string,
    etag: string,
    execution: ProductImportExecution,
  ): Promise<boolean> {
    const result = await this.requireBucket().put(
      executionKey(id),
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

  async putCsv(key: string, contents: string): Promise<void> {
    if (!key.startsWith(`${csvKeyPrefix}/`)) {
      throw new Error("PRODUCT_IMPORT_FILE_KEY_INVALID");
    }
    const result = await this.requireBucket().put(key, contents, {
      onlyIf: { etagDoesNotMatch: "*" },
      httpMetadata: {
        contentType: "text/csv; charset=utf-8",
        cacheControl: "private, no-store",
      },
    });
    if (!result) throw new Error("PRODUCT_IMPORT_FILE_KEY_COLLISION");
  }

  async getCsv(key: string): Promise<string | null> {
    if (!key.startsWith(`${csvKeyPrefix}/`)) {
      throw new Error("PRODUCT_IMPORT_FILE_KEY_INVALID");
    }
    const object = await this.requireBucket().get(key);
    return object ? object.text() : null;
  }

  async deleteCsv(key: string): Promise<void> {
    if (!key.startsWith(`${csvKeyPrefix}/`)) {
      throw new Error("PRODUCT_IMPORT_FILE_KEY_INVALID");
    }
    await this.requireBucket().delete(key);
  }
}

export const productImportIssuePreview = (issues: ProductImportIssue[]) =>
  issues.slice(0, PRODUCT_IMPORT_ISSUE_LIMIT);
