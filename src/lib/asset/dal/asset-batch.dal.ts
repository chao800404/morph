import { env } from "cloudflare:workers";

const SQL_VARIABLE_CHUNK = 50;

const chunksOf = <T>(values: T[]) => {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += SQL_VARIABLE_CHUNK) {
    chunks.push(values.slice(index, index + SQL_VARIABLE_CHUNK));
  }
  return chunks;
};

const placeholders = (length: number) => Array(length).fill("?").join(",");

export type FolderLocationUpdate = {
  id: string;
  path: string;
  idPath: string;
  parentId?: string | null;
  updateParent: boolean;
};

export type AssetMetadataUpdate = {
  id: string;
  name?: string;
  originalName?: string;
  alt?: string | null;
  caption?: string | null;
  tags?: string[] | null;
};

export type FolderMetadataUpdate = {
  id: string;
  name?: string;
  description?: string | null;
  path?: string;
};

export type AssetUsageSummary = {
  productCount: number;
  variantCount: number;
  productTitles: string[];
  variantTitles: string[];
};

type MoveBatchOptions = {
  assetIds: string[];
  targetFolderId: string | null;
  folderUpdates: FolderLocationUpdate[];
  userId: string;
};

export type AssetLocationUpdate = {
  ids: string[];
  folderId: string | null;
};

type LocationBatchOptions = {
  assetUpdates: AssetLocationUpdate[];
  folderUpdates: FolderLocationUpdate[];
  userId: string;
};

type MetadataBatchOptions = {
  assetUpdates: AssetMetadataUpdate[];
  folderUpdates: FolderMetadataUpdate[];
  userId: string;
};

const createLocationStatements = (
  options: LocationBatchOptions,
  now: string,
): D1PreparedStatement[] => {
  const statements: D1PreparedStatement[] = [];

  for (const update of options.assetUpdates) {
    for (const ids of chunksOf(update.ids)) {
      statements.push(
        env.DATABASE.prepare(
          `UPDATE assets SET folder_id = ?, updated_by = ?, updated_at = ? WHERE deleted_at IS NULL AND id IN (${placeholders(ids.length)})`,
        ).bind(update.folderId, options.userId, now, ...ids),
      );
    }
  }

  for (const update of options.folderUpdates) {
    statements.push(
      update.updateParent
        ? env.DATABASE.prepare(
            "UPDATE asset_folders SET parent_id = ?, path = ?, id_path = ?, updated_by = ?, updated_at = ? WHERE deleted_at IS NULL AND id = ?",
          ).bind(
            update.parentId ?? null,
            update.path,
            update.idPath,
            options.userId,
            now,
            update.id,
          )
        : env.DATABASE.prepare(
            "UPDATE asset_folders SET path = ?, id_path = ?, updated_by = ?, updated_at = ? WHERE deleted_at IS NULL AND id = ?",
          ).bind(update.path, update.idPath, options.userId, now, update.id),
    );
  }

  return statements;
};

export async function batchSoftDeleteItemsInD1(options: {
  assetIds: string[];
  folderIds: string[];
  userId: string;
}) {
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];

  // Soft deletes do not trigger SQLite ON DELETE actions. Remove media links
  // explicitly, then derive a new lead image from each remaining gallery.
  // Keeping these statements in the same D1 batch prevents products from ever
  // committing with a thumbnail that points at a hidden asset.
  for (const ids of chunksOf(options.assetIds)) {
    const inClause = placeholders(ids.length);
    statements.push(
      env.DATABASE.prepare(
        `DELETE FROM product_variant_assets WHERE asset_id IN (${inClause})`,
      ).bind(...ids),
      env.DATABASE.prepare(
        `DELETE FROM product_assets WHERE asset_id IN (${inClause})`,
      ).bind(...ids),
    );
  }

  for (const ids of chunksOf(options.assetIds)) {
    const inClause = placeholders(ids.length);
    statements.push(
      env.DATABASE.prepare(
        `UPDATE product_variants
         SET thumbnail_asset_id = (
           SELECT pva.asset_id
           FROM product_variant_assets pva
           JOIN assets a ON a.id = pva.asset_id AND a.deleted_at IS NULL
           WHERE pva.variant_id = product_variants.id
           ORDER BY pva.rank ASC
           LIMIT 1
         ), updated_at = ?, updated_by = ?
         WHERE thumbnail_asset_id IN (${inClause})`,
      ).bind(now, options.userId, ...ids),
      env.DATABASE.prepare(
        `UPDATE products
         SET thumbnail_asset_id = (
           SELECT pa.asset_id
           FROM product_assets pa
           JOIN assets a ON a.id = pa.asset_id AND a.deleted_at IS NULL
           WHERE pa.product_id = products.id
           ORDER BY pa.rank ASC
           LIMIT 1
         ), updated_at = ?, updated_by = ?
         WHERE thumbnail_asset_id IN (${inClause})`,
      ).bind(now, options.userId, ...ids),
    );
  }

  for (const ids of chunksOf(options.assetIds)) {
    statements.push(
      env.DATABASE.prepare(
        `UPDATE assets SET deleted_at = ?, updated_at = ?, updated_by = ? WHERE deleted_at IS NULL AND id IN (${placeholders(ids.length)})`,
      ).bind(now, now, options.userId, ...ids),
    );
  }
  for (const ids of chunksOf(options.folderIds)) {
    statements.push(
      env.DATABASE.prepare(
        `UPDATE asset_folders SET deleted_at = ?, updated_at = ?, updated_by = ? WHERE deleted_at IS NULL AND id IN (${placeholders(ids.length)})`,
      ).bind(now, now, options.userId, ...ids),
    );
  }

  if (statements.length > 0) await env.DATABASE.batch(statements);
}

export async function findAssetUsageInD1(
  assetIds: string[],
): Promise<AssetUsageSummary> {
  const products = new Map<string, string>();
  const variants = new Map<string, string>();

  for (const ids of chunksOf(assetIds)) {
    const inClause = placeholders(ids.length);
    const [productResult, variantResult] = await env.DATABASE.batch([
      env.DATABASE.prepare(
        `SELECT DISTINCT p.id, p.title
         FROM products p
         WHERE p.deleted_at IS NULL
           AND (
             p.thumbnail_asset_id IN (${inClause})
             OR EXISTS (
               SELECT 1 FROM product_assets pa
               WHERE pa.product_id = p.id AND pa.asset_id IN (${inClause})
             )
           )`,
      ).bind(...ids, ...ids),
      env.DATABASE.prepare(
        `SELECT DISTINCT pv.id, p.title AS product_title, pv.title AS variant_title
         FROM product_variants pv
         JOIN products p ON p.id = pv.product_id
         WHERE pv.deleted_at IS NULL
           AND p.deleted_at IS NULL
           AND (
             pv.thumbnail_asset_id IN (${inClause})
             OR EXISTS (
               SELECT 1 FROM product_variant_assets pva
               WHERE pva.variant_id = pv.id AND pva.asset_id IN (${inClause})
             )
           )`,
      ).bind(...ids, ...ids),
    ]);

    for (const row of productResult.results as Array<{
      id: string;
      title: string;
    }>) {
      products.set(row.id, row.title);
    }
    for (const row of variantResult.results as Array<{
      id: string;
      product_title: string;
      variant_title: string;
    }>) {
      variants.set(row.id, `${row.product_title} / ${row.variant_title}`);
    }
  }

  return {
    productCount: products.size,
    variantCount: variants.size,
    productTitles: [...products.values()].slice(0, 5),
    variantTitles: [...variants.values()].slice(0, 5),
  };
}

const createMetadataStatements = (
  options: MetadataBatchOptions,
  now: string,
): D1PreparedStatement[] => {
  const statements: D1PreparedStatement[] = [];

  for (const update of options.assetUpdates) {
    const columns: string[] = [];
    const values: Array<string | null> = [];
    for (const [field, column] of [
      ["name", "name"],
      ["originalName", "original_name"],
      ["alt", "alt"],
      ["caption", "caption"],
      ["tags", "tags"],
    ] as const) {
      if (field in update) {
        columns.push(`${column} = ?`);
        values.push(
          field === "tags"
            ? JSON.stringify(update.tags ?? [])
            : (update[field] ?? null),
        );
      }
    }
    if (columns.length === 0) continue;
    columns.push("updated_by = ?", "updated_at = ?");
    values.push(options.userId, now, update.id);
    statements.push(
      env.DATABASE.prepare(
        `UPDATE assets SET ${columns.join(", ")} WHERE deleted_at IS NULL AND id = ?`,
      ).bind(...values),
    );
  }

  for (const update of options.folderUpdates) {
    const columns: string[] = [];
    const values: Array<string | null> = [];
    for (const [field, column] of [
      ["name", "name"],
      ["description", "description"],
      ["path", "path"],
    ] as const) {
      if (field in update) {
        columns.push(`${column} = ?`);
        values.push(update[field] ?? null);
      }
    }
    if (columns.length === 0) continue;
    columns.push("updated_by = ?", "updated_at = ?");
    values.push(options.userId, now, update.id);
    statements.push(
      env.DATABASE.prepare(
        `UPDATE asset_folders SET ${columns.join(", ")} WHERE deleted_at IS NULL AND id = ?`,
      ).bind(...values),
    );
  }

  return statements;
};

export async function batchMoveItemsInD1(options: MoveBatchOptions) {
  const statements = createLocationStatements(
    {
      assetUpdates: [
        { ids: options.assetIds, folderId: options.targetFolderId },
      ],
      folderUpdates: options.folderUpdates,
      userId: options.userId,
    },
    new Date().toISOString(),
  );
  if (statements.length > 0) await env.DATABASE.batch(statements);
}

/**
 * Metadata and location changes emitted by the Assets editor must commit as one
 * unit. D1 executes a batch transactionally, so validation happens before this
 * function and both statement groups are sent in the same batch.
 */
export async function batchSaveItemsInD1(options: {
  metadata: MetadataBatchOptions;
  move?: LocationBatchOptions;
}) {
  const now = new Date().toISOString();
  const statements = [
    ...createMetadataStatements(options.metadata, now),
    ...(options.move ? createLocationStatements(options.move, now) : []),
  ];
  if (statements.length > 0) await env.DATABASE.batch(statements);
}
