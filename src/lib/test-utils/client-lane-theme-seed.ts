import { and, eq, isNull } from "drizzle-orm";

import { getDb } from "@/db";
import {
  storefrontThemes,
  storefrontThemeTemplates,
} from "@/db/storefront.schema";
import { createDefaultStorefrontHomeDocument } from "@/lib/storefront/default-storefront-document";
import { storefrontThemeDal } from "@/lib/storefront/dal/storefront-theme.dal";
import { storefrontThemeFileDal } from "@/lib/storefront/dal/storefront-theme-file.dal";
import { ensureStarterHomeDocument } from "@/lib/storefront/dal/storefront.dal";

import type { StarterWorkspaceFile } from "./starter-workspace-d1";

/**
 * Seeds one client-lane Theme: a Theme on the pinned Starter 31 workspace
 * that records no preview runtime, prepared before any editor opens it.
 *
 * Every write goes through the product's own DAL against whatever
 * `env.DATABASE` is (the run's local D1 in E2E, a fresh one in tests):
 *
 * 1. the Theme row, inserted as `storefrontDal.ensureDefault` inserts one
 *    (Drizzle, `metadata` `{}`), but recording no runtime and no framework
 *    (TanStack Start), whatever the current Starter would record;
 * 2. `storefrontThemeFileDal.initStarterTheme()` with the given files, so its
 *    ownership, empty-workspace and Start-runtime guards and its source
 *    generation run on them;
 * 3. `ensureStarterHomeDocument` with `targetVersion` 31: the index, product
 *    and layout templates and their Documents, and the Starter version under
 *    its compare-and-set record;
 * 4. route documents through `storefrontThemeDal.ensureRouteTemplate`, for
 *    the paths given (none by default: the editor creates a route's document
 *    on first use, and specs assert that it does).
 *
 * Nothing here checks the result; `readClientLaneTheme` reads it back for
 * `clientLaneThemeRefusal` in `scripts/e2e-client-lane-guard.mjs`.
 */

export const CLIENT_LANE_STARTER_VERSION = 31;

export type ClientLaneSeedInput = {
  storefrontId: string;
  themeId: string;
  name: string;
  /** The user the init revision is recorded under. */
  createdBy: string;
  files: readonly StarterWorkspaceFile[];
  routePaths?: readonly string[];
  now?: string;
  /**
   * The id the Theme's index template must have, when the caller named the
   * editor path before the Theme existed: the client lane's shared slot,
   * whose `E2E_EDITOR_PATH` the runner sets before Playwright loads a spec.
   * The template is then inserted here, as `ensureStarterHomeDocument`
   * inserts one (same type, name and default home Document), and that step
   * finds it and creates none.
   */
  indexTemplateId?: string;
  /**
   * A retry of a seed whose earlier attempt may have stopped part way (a
   * busy database), for a Theme whose id the caller cannot change. Every
   * step is taken only if it has not been: the row is inserted unless this
   * seed's row is already there, the init returns the files it already
   * wrote, and a Starter 31 record already written counts. The read-back
   * check afterwards is the same as for a first attempt.
   */
  resume?: boolean;
};

export type ClientLaneSeedResult = {
  themeId: string;
  routeTemplates: Record<string, string>;
};

export async function seedClientLaneTheme(
  input: ClientLaneSeedInput,
): Promise<ClientLaneSeedResult> {
  const now = input.now ?? new Date().toISOString();
  const files = input.files.map((file) => {
    if (file.encoding !== "utf8") {
      throw new Error(
        `CLIENT_LANE_SEED: ${file.path} is ${JSON.stringify(file.encoding)}, and initStarterTheme writes text files only.`,
      );
    }
    if (typeof file.mimeType !== "string") {
      throw new Error(`CLIENT_LANE_SEED: ${file.path} has no MIME type.`);
    }
    return {
      path: file.path,
      content: file.content,
      mimeType: file.mimeType,
      isEntry: file.isEntry,
    };
  });

  const db = await getDb();
  const [existing] = input.resume
    ? await db
        .select({
          storefrontId: storefrontThemes.storefrontId,
          name: storefrontThemes.name,
          previewRuntime: storefrontThemes.previewRuntime,
          deletedAt: storefrontThemes.deletedAt,
        })
        .from(storefrontThemes)
        .where(eq(storefrontThemes.id, input.themeId))
        .limit(1)
    : [];
  if (existing) {
    // Only this seed's own row is taken up again: same storefront and name,
    // no runtime, not deleted.
    if (
      existing.storefrontId !== input.storefrontId ||
      existing.name !== input.name ||
      existing.previewRuntime !== null ||
      existing.deletedAt !== null
    ) {
      throw new Error(
        `CLIENT_LANE_SEED: Theme ${input.themeId} already exists and is not an earlier attempt of this seed: ${JSON.stringify(existing)}`,
      );
    }
  } else {
    await db.insert(storefrontThemes).values({
      id: input.themeId,
      storefrontId: input.storefrontId,
      name: input.name,
      previewRuntime: null,
      metadata: {},
      createdAt: now,
      updatedAt: now,
    });
  }

  // Returns the files it already wrote when the workspace is not empty.
  await storefrontThemeFileDal.initStarterTheme(
    input.storefrontId,
    input.themeId,
    input.createdBy,
    { files },
  );

  if (input.indexTemplateId) {
    const [index] = await db
      .select({ id: storefrontThemeTemplates.id })
      .from(storefrontThemeTemplates)
      .where(
        and(
          eq(storefrontThemeTemplates.themeId, input.themeId),
          eq(storefrontThemeTemplates.type, "index"),
          isNull(storefrontThemeTemplates.deletedAt),
        ),
      )
      .limit(1);
    if (!index) {
      await db.insert(storefrontThemeTemplates).values({
        id: input.indexTemplateId,
        themeId: input.themeId,
        type: "index",
        name: "Default",
        document: createDefaultStorefrontHomeDocument(),
        createdAt: now,
        updatedAt: now,
      });
    } else if (index.id !== input.indexTemplateId) {
      throw new Error(
        `CLIENT_LANE_SEED: Theme ${input.themeId} has index template ${index.id}, not ${input.indexTemplateId}.`,
      );
    }
  }

  const recorded = await ensureStarterHomeDocument(db, input.themeId, {
    filesSaved: true,
    storefrontId: input.storefrontId,
    record: true,
    createdBy: input.createdBy,
    targetVersion: CLIENT_LANE_STARTER_VERSION,
  });
  const recordedVersion =
    recorded.status === "recorded"
      ? recorded.version
      : input.resume && recorded.status === "already-current"
        ? recorded.storedVersion
        : null;
  if (recordedVersion !== CLIENT_LANE_STARTER_VERSION) {
    throw new Error(
      `CLIENT_LANE_SEED: Starter ${CLIENT_LANE_STARTER_VERSION} was not recorded for Theme ${input.themeId}: ${JSON.stringify(recorded)}`,
    );
  }

  const routeTemplates: Record<string, string> = {};
  for (const routePath of input.routePaths ?? []) {
    const ensured = await storefrontThemeDal.ensureRouteTemplate({
      storefrontId: input.storefrontId,
      themeId: input.themeId,
      routePath,
    });
    if (!ensured.ok) {
      throw new Error(
        `CLIENT_LANE_SEED: no route document for ${routePath} on Theme ${input.themeId}: ${ensured.reason}`,
      );
    }
    routeTemplates[routePath] = ensured.template.id;
  }
  return { themeId: input.themeId, routeTemplates };
}

/** One query against the database the Theme was seeded into. */
export type ClientLaneQuery = (
  sql: string,
  params: readonly unknown[],
) => Promise<Record<string, unknown>[]> | Record<string, unknown>[];

/**
 * What the database holds for a seeded Theme, in the shape
 * `clientLaneThemeRefusal` (scripts/e2e-client-lane-guard.mjs) judges:
 * file bytes as SHA-256, everything else as stored.
 */
export async function readClientLaneTheme(
  query: ClientLaneQuery,
  scope: { storefrontId: string; themeId: string },
  sha256: (content: string) => string,
) {
  const themes = await query(
    `SELECT storefront_id, preview_runtime, framework, deleted_at,
            json_extract(metadata, '$.starterTemplateVersion') AS starter_version
     FROM storefront_themes WHERE id = ?`,
    [scope.themeId],
  );
  const files = await query(
    `SELECT path, mime_type, encoding, is_entry, content
     FROM storefront_theme_files
     WHERE storefront_id = ? AND theme_id = ? AND deleted_at IS NULL
     ORDER BY path`,
    [scope.storefrontId, scope.themeId],
  );
  const templates = await query(
    `SELECT id, type, route_path FROM storefront_theme_templates
     WHERE theme_id = ? AND deleted_at IS NULL ORDER BY type, id`,
    [scope.themeId],
  );
  const theme = themes[0];
  return {
    storefrontId: scope.storefrontId,
    themeId: scope.themeId,
    rows: themes.length,
    rowStorefrontId: theme?.storefront_id ?? null,
    previewRuntime: theme?.preview_runtime ?? null,
    framework: theme?.framework ?? null,
    deletedAt: theme?.deleted_at ?? null,
    starterTemplateVersion: theme?.starter_version ?? null,
    files: files.map((file) => ({
      path: String(file.path),
      mimeType: file.mime_type ?? null,
      encoding: file.encoding ?? null,
      isEntry: Number(file.is_entry) === 1,
      sha256: sha256(String(file.content)),
    })),
    templates: templates.map((template) => ({
      id: String(template.id),
      type: String(template.type),
      routePath: template.route_path ?? null,
    })),
  };
}

export type ClientLaneThemeEvidence = Awaited<
  ReturnType<typeof readClientLaneTheme>
>;

/**
 * Seeds the Theme, reads it back with `query` and throws unless `refusal`
 * (`clientLaneThemeRefusal` from the guard, given the pinned fixture's
 * digests) passes. What the seed CLI runs per slot, and what the tests run.
 */
export async function seedVerifiedClientLaneTheme(
  input: ClientLaneSeedInput,
  verify: {
    query: ClientLaneQuery;
    sha256: (content: string) => string;
    refusal: (evidence: ClientLaneThemeEvidence) => string | null;
  },
): Promise<{
  seeded: ClientLaneThemeEvidence;
  indexTemplateId: string;
}> {
  await seedClientLaneTheme(input);
  const seeded = await readClientLaneTheme(verify.query, input, verify.sha256);
  const refusal = verify.refusal(seeded);
  if (refusal) throw new Error(refusal);
  const index = seeded.templates.find(
    (template) => template.type === "index" && template.routePath === null,
  );
  if (!index) {
    throw new Error(`CLIENT_LANE_SEED: Theme ${input.themeId} has no index template.`);
  }
  return { seeded, indexTemplateId: index.id };
}
