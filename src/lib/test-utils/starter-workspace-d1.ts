import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { env } from "cloudflare:workers";
import { getPlatformProxy } from "wrangler";

import { storefrontDal } from "@/lib/storefront/dal/storefront.dal";

/**
 * The workspace a new Starter Theme really starts with, produced by the
 * product's own initialisation (`storefrontDal.ensureDefault`, which creates
 * the Theme and calls `ensureStarterThemeWorkspace` -> `initStarterTheme`)
 * against a fresh local D1 (Miniflare) with every migration under `drizzle/`
 * applied. Nothing here builds the file list itself: it is read back from
 * `storefront_theme_files` after the init committed.
 *
 * Used by `starter-workspace-v31.test.ts`, which pins
 * `src/lib/storefront/__fixtures__/starter-workspace/v31.json` to it. That
 * test also writes what the init produced to `PRODUCED_FIXTURE_PATH`, in the
 * fixture's own format, which is how the fixture was made: run the test once
 * and copy that file over the fixture. The fixture must only ever be
 * regenerated while the init is the Starter version it is named after.
 */

const MIGRATIONS = join(process.cwd(), "drizzle");

export type StarterWorkspaceFile = {
  path: string;
  mimeType: string | null;
  encoding: string | null;
  isEntry: boolean;
  content: string;
};

export type StarterWorkspaceFixture = {
  starterVersion: number;
  sourceCommit: string;
  producedBy: string;
  /** sha256 of `canonicalFiles(files)`, hex. */
  sha256: string;
  files: StarterWorkspaceFile[];
};

export type ProducedStarterWorkspace = {
  files: StarterWorkspaceFile[];
  /** `storefront_themes.metadata` after the init, parsed. */
  metadata: Record<string, unknown>;
  previewRuntime: string | null;
};

export const PRODUCED_BY =
  "storefrontDal.ensureDefault on a fresh local D1 (Miniflare) with every drizzle/ migration applied; files read back from storefront_theme_files";

export const PRODUCED_FIXTURE_PATH = join(
  tmpdir(),
  "morph-starter-workspace-produced.json",
);

/** Files sorted by path, serialised with a fixed key order. */
export function canonicalFiles(
  files: readonly StarterWorkspaceFile[],
): string {
  return JSON.stringify(
    [...files]
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      .map((file) => ({
        path: file.path,
        mimeType: file.mimeType,
        encoding: file.encoding,
        isEntry: file.isEntry,
        content: file.content,
      })),
  );
}

export function filesSha256(files: readonly StarterWorkspaceFile[]): string {
  return createHash("sha256")
    .update(canonicalFiles(files), "utf8")
    .digest("hex");
}

/**
 * Runs the product's init for a new sales channel on a fresh, fully migrated
 * local D1 and returns what it stored. The database lives in its own
 * temporary directory and is removed afterwards.
 */
export async function produceStarterWorkspace(): Promise<ProducedStarterWorkspace> {
  const dir = mkdtempSync(join(tmpdir(), "starter-workspace-d1-"));
  writeFileSync(
    join(dir, "wrangler.json"),
    JSON.stringify({
      name: "starter-workspace-d1",
      compatibility_date: "2025-09-02",
      d1_databases: [
        {
          binding: "DATABASE",
          database_name: "starter-workspace",
          database_id: "00000000-0000-0000-0000-000000000000",
        },
      ],
    }),
  );
  const proxy = await getPlatformProxy({
    configPath: join(dir, "wrangler.json"),
    persist: { path: join(dir, "state") },
  });
  try {
    const d1 = (proxy.env as { DATABASE: D1Database }).DATABASE;
    const migrations = readdirSync(MIGRATIONS)
      .filter((file) => /^\d{4}_.+\.sql$/.test(file))
      .sort();
    for (const file of migrations) {
      for (const statement of readFileSync(
        join(MIGRATIONS, file),
        "utf8",
      ).split("--> statement-breakpoint")) {
        if (statement.trim()) await d1.prepare(statement.trim()).run();
      }
    }
    // The application's `getDb()` and raw `env.DATABASE` both read this.
    (env as unknown as { DATABASE: D1Database }).DATABASE = d1;

    await storefrontDal.ensureDefault("starter-workspace-fixture-channel");

    const themes = await d1
      .prepare(
        "SELECT id, metadata, preview_runtime FROM storefront_themes WHERE deleted_at IS NULL",
      )
      .all<{ id: string; metadata: string | null; preview_runtime: string | null }>();
    if (themes.results.length !== 1) {
      throw new Error(
        `Expected the init to create one Theme, found ${themes.results.length}.`,
      );
    }
    const theme = themes.results[0]!;
    const rows = await d1
      .prepare(
        `SELECT path, mime_type, encoding, is_entry, content
         FROM storefront_theme_files
         WHERE theme_id = ?1 AND deleted_at IS NULL
         ORDER BY path`,
      )
      .bind(theme.id)
      .all<{
        path: string;
        mime_type: string | null;
        encoding: string | null;
        is_entry: number | null;
        content: string;
      }>();
    return {
      files: rows.results.map((row) => ({
        path: row.path,
        mimeType: row.mime_type,
        encoding: row.encoding,
        isEntry: row.is_entry === 1,
        content: row.content,
      })),
      metadata: theme.metadata ? JSON.parse(theme.metadata) : {},
      previewRuntime: theme.preview_runtime,
    };
  } finally {
    await proxy.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
}
