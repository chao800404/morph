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
