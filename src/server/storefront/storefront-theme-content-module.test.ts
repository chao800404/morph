// @vitest-environment node
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getDb } from "@/db";
import * as storefrontSchema from "@/db/storefront.schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { starterThemeWorkspaceFiles } from "@/lib/storefront/starter-theme-files";
import { STARTER_THEME_CONTENT_MODULE_SOURCE } from "@/lib/storefront/starter-theme-v3-files";
import { THEME_CONTENT_MODULE_PATH } from "@/lib/storefront/theme-content-slots";
import { themeSourceStore } from "@/lib/storefront/storage/theme-storage.server";

/**
 * `src/morph/content.ts` is the author's file: the server takes edits and
 * deletions of it like any other source file, and the explicit restore writes
 * the Starter module back only while it is missing, under the same create
 * precondition and source generation as any create.
 *
 * Real SQLite with the real migration, the production storage and the real
 * handlers; only `createServerFn` and the auth middleware are stood in for.
 * The request the editor's restore command sends is pinned by
 * editor-code-workspace.test.tsx; this proves what the server does with it.
 * The database harness is the one `theme-binary-build.test.ts` uses.
 */

vi.mock("@tanstack/react-start", () => {
  type Validator = (data: unknown) => unknown;
  type Handler = (args: {
    data: unknown;
    context: { user: { id: string } };
  }) => unknown;
  function builder(validator: Validator = (data) => data) {
    return {
      validator: (next: Validator) => builder(next),
      middleware: () => builder(validator),
      handler:
        (handler: Handler) =>
        ({ data }: { data: unknown }) =>
          handler({ data: validator(data), context: { user: { id: "u1" } } }),
    };
  }
  return { createServerFn: () => builder() };
});

vi.mock("@/server/middleware/auth.middleware", () => ({
  commerceAdminMiddleware: {},
}));

const r2 = vi.hoisted(() => {
  const objects = new Map<string, Uint8Array>();
  const object = (bytes: Uint8Array) => ({
    body: bytes,
    size: bytes.byteLength,
    arrayBuffer: async () => new Uint8Array(bytes).buffer,
    text: async () => new TextDecoder().decode(bytes),
  });
  const bucket = {
    async get(key: string) {
      const bytes = objects.get(key);
      return bytes ? object(bytes) : null;
    },
    async head(key: string) {
      const bytes = objects.get(key);
      return bytes ? { size: bytes.byteLength } : null;
    },
    async put(
      key: string,
      value: Uint8Array,
      options?: { onlyIf?: { etagDoesNotMatch?: string } },
    ) {
      if (options?.onlyIf?.etagDoesNotMatch === "*" && objects.has(key)) {
        return null;
      }
      objects.set(key, new Uint8Array(value));
      return { key, size: value.byteLength };
    },
    async delete(key: string) {
      objects.delete(key);
    },
    async list() {
      return { objects: [], truncated: false };
    },
  };
  return { objects, bucket };
});

vi.mock("cloudflare:workers", () => ({
  env: {
    R2_BUCKET: r2.bucket,
    DATABASE: {
      prepare: (sql: string) => ({
        bind: (...args: any[]) => {
          const hasNumbered = /\?\d+/.test(sql);
          const params = hasNumbered
            ? Object.fromEntries(args.map((val, idx) => [String(idx + 1), val]))
            : args;
          return {
            run: () => {
              const stmt = sqlite.prepare(sql);
              const upper = sql.trim().toUpperCase();
              if (upper.startsWith("SELECT") || upper.includes("RETURNING")) {
                const res = hasNumbered ? stmt.all(params) : stmt.all(...args);
                return { results: res };
              }
              const res = hasNumbered ? stmt.run(params) : stmt.run(...args);
              return { meta: { changes: res.changes } };
            },
            all: () => {
              const stmt = sqlite.prepare(sql);
              const res = hasNumbered ? stmt.all(params) : stmt.all(...args);
              return { results: res };
            },
            first: () => {
              const stmt = sqlite.prepare(sql);
              return hasNumbered ? stmt.get(params) : stmt.get(...args);
            },
          };
        },
      }),
      batch: async (statements: Array<any>) =>
        sqlite.transaction(() =>
          statements.map((s) => {
            if (typeof s.run === "function") return s.run();
            if (typeof s.all === "function") return s.all();
            return {};
          }),
        )(),
    },
  },
}));
vi.mock("@/db", () => ({ getDb: vi.fn() }));
/**
 * Which Starter paths count as needing the full Start preview. Null keeps the
 * real detection (no Starter file below 32 needs it); a list stands in for a
 * Starter whose content module does, so the restore and the other Starter
 * writes are held to `start` through the real handlers and storage.
 */
const startPreview = vi.hoisted(() => ({
  requiredPaths: null as null | readonly string[],
}));
vi.mock("@/lib/storefront/starter-upgrade-start-preview", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/lib/storefront/starter-upgrade-start-preview")
    >();
  return {
    ...actual,
    starterPlanFilesRequiringStartPreview: (
      files: ReadonlyArray<{ path: string; content: string }>,
    ) =>
      startPreview.requiredPaths === null
        ? actual.starterPlanFilesRequiringStartPreview(files)
        : files
            .map((file) => file.path)
            .filter((path) => startPreview.requiredPaths!.includes(path))
            .sort(),
  };
});

let sqlite: Database.Database;

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE storefronts (
      id text PRIMARY KEY NOT NULL,
      sales_channel_id text NOT NULL,
      name text NOT NULL,
      domain text,
      status text NOT NULL,
      active_theme_id text,
      active_release_id text,
      metadata text,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      deleted_at text
    );
    CREATE TABLE storefront_themes (
      id text PRIMARY KEY NOT NULL,
      storefront_id text NOT NULL,
      name text NOT NULL,
      status text NOT NULL,
      published_source_revision_id text,
      source_generation integer DEFAULT 1 NOT NULL,
      source_index_version integer,
      source_index_status text,
      source_index text,
      preview_runtime text,
      metadata text,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      deleted_at text
    );
    CREATE TABLE storefront_theme_files (
      id text PRIMARY KEY NOT NULL,
      storefront_id text NOT NULL,
      theme_id text NOT NULL,
      path text NOT NULL,
      content text NOT NULL,
      mime_type text,
      is_entry integer DEFAULT 0,
      version integer DEFAULT 1,
      last_write_attempt_id text,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      deleted_at text
    );
    CREATE TABLE storefront_theme_revisions (
      id text PRIMARY KEY NOT NULL,
      storefront_id text NOT NULL,
      theme_id text NOT NULL,
      revision_number integer NOT NULL,
      source_generation integer,
      message text,
      source text,
      snapshot text,
      source_manifest text,
      source_index text,
      created_by text,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      deleted_at text
    );
    CREATE TABLE storefront_theme_templates (
      id text PRIMARY KEY NOT NULL,
      theme_id text NOT NULL,
      type text NOT NULL,
      name text NOT NULL,
      route_path text,
      updated_at text NOT NULL,
      deleted_at text
    );
    CREATE UNIQUE INDEX storefront_theme_templates_active_name_unique
      ON storefront_theme_templates (theme_id, type, name)
      WHERE deleted_at IS NULL;
    CREATE UNIQUE INDEX storefront_theme_templates_active_route_unique
      ON storefront_theme_templates (theme_id, route_path)
      WHERE route_path IS NOT NULL AND deleted_at IS NULL;
    CREATE TABLE storefront_theme_route_document_moves (
      id text PRIMARY KEY NOT NULL,
      theme_id text NOT NULL,
      from_route_path text NOT NULL,
      to_route_path text NOT NULL,
      source_generation integer NOT NULL,
      sequence integer NOT NULL,
      created_at text NOT NULL
    );
    CREATE TABLE storefront_content_publication_items (
      id text PRIMARY KEY NOT NULL,
      item_type text NOT NULL,
      content_id text NOT NULL,
      metadata text NOT NULL DEFAULT '{}',
      deleted_at text
    );
    CREATE UNIQUE INDEX storefront_theme_files_unique_path_idx
    ON storefront_theme_files (storefront_id, theme_id, path)
    WHERE deleted_at IS NULL;
  `);

  sqlite.exec(`
    INSERT INTO storefronts (id, sales_channel_id, name, status, created_at, updated_at)
    VALUES ('storefront-a', 'channel-a', 'Store A', 'draft', 'now', 'now');
    INSERT INTO storefront_themes (id, storefront_id, name, status, source_generation, created_at, updated_at)
    VALUES ('theme-a', 'storefront-a', 'Theme A', 'draft', 1, 'now', 'now');
  `);

  applyBinaryFilesMigration();
  r2.objects.clear();

  const db = drizzle(sqlite, { schema: storefrontSchema });
  vi.mocked(getDb).mockResolvedValue(db as any);
});

afterEach(() => {
  sqlite.close();
  vi.clearAllMocks();
});

// The real migration, applied over the table as it was before it.
function applyBinaryFilesMigration() {
  const migration = readFileSync(
    resolve(process.cwd(), "drizzle/0059_theme_binary_files.sql"),
    "utf8",
  );
  for (const statement of migration.split("--> statement-breakpoint")) {
    if (statement.replace(/--.*$/gm, "").trim()) sqlite.exec(statement);
  }
}

const STORE = "storefront-a";
const THEME = "theme-a";

type Result = {
  success: boolean;
  error?: string;
  message: string;
  data?: { id: string; version: number; sourceGeneration?: number };
};
const handlers = () => import("./storefront-theme-files.serverFn");
const call = (fn: unknown, data: Record<string, unknown>) =>
  (fn as (args: { data: unknown }) => Promise<Result>)({ data });

/** A Theme created from today's Starter. */
function seedStarterWorkspace() {
  const insert = sqlite.prepare(
    `INSERT INTO storefront_theme_files
      (id, storefront_id, theme_id, path, content, mime_type, is_entry, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'now', 'now')`,
  );
  starterThemeWorkspaceFiles().forEach((file, index) => {
    insert.run(
      `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      STORE,
      THEME,
      file.path,
      file.content,
      file.mimeType ?? "text/plain",
      file.isEntry ? 1 : 0,
    );
  });
}

const generation = async () =>
  (await themeSourceStore.getSourceGeneration(STORE, THEME))!;
const contentModule = async () =>
  (await themeSourceStore.listFiles(STORE, THEME)).find(
    (file) => file.path === THEME_CONTENT_MODULE_PATH,
  );

/** The request the editor's restore command sends. */
const restore = async (expectedSourceGeneration: number) =>
  call((await handlers()).saveStorefrontThemeFile, {
    storefrontId: STORE,
    themeId: THEME,
    path: THEME_CONTENT_MODULE_PATH,
    content: STARTER_THEME_CONTENT_MODULE_SOURCE,
    mimeType: "text/typescript",
    expectMissing: true,
    expectedSourceGeneration,
  });

/**
 * The restore command's declared request (`operation: "restore-starter-file"`):
 * the server resolves the Starter's bytes for the path itself, so whatever
 * the request carries as `content` is not what gets written.
 */
const declaredRestore = async (
  expectedSourceGeneration: number,
  overrides: Record<string, unknown> = {},
) =>
  call((await handlers()).saveStorefrontThemeFile, {
    storefrontId: STORE,
    themeId: THEME,
    path: THEME_CONTENT_MODULE_PATH,
    content: STARTER_THEME_CONTENT_MODULE_SOURCE,
    mimeType: "text/typescript",
    expectMissing: true,
    expectedSourceGeneration,
    operation: "restore-starter-file",
    ...overrides,
  });

/** Bytes that are not the Starter's, sent with a declared restore. */
const NOT_THE_STARTER =
  "export const content = () => ({}); // not the Starter's module\n";

async function deleteContentModule() {
  const existing = (await contentModule())!;
  const deleted = await call((await handlers()).deleteStorefrontThemeFile, {
    storefrontId: STORE,
    themeId: THEME,
    path: THEME_CONTENT_MODULE_PATH,
    expectedFileId: existing.id,
    expectedVersion: existing.version,
    expectedSourceGeneration: await generation(),
  });
  expect(deleted.success, deleted.message).toBe(true);
  expect(await contentModule()).toBeUndefined();
}

describe("the author's content module on the server", () => {
  it("takes an author's edit like any source file", async () => {
    seedStarterWorkspace();
    const existing = (await contentModule())!;
    const edited = `${STARTER_THEME_CONTENT_MODULE_SOURCE}\n// mine\n`;

    const saved = await call((await handlers()).saveStorefrontThemeFile, {
      storefrontId: STORE,
      themeId: THEME,
      path: THEME_CONTENT_MODULE_PATH,
      content: edited,
      mimeType: "text/typescript",
      expectedFileId: existing.id,
      expectedVersion: existing.version,
      expectedSourceGeneration: await generation(),
    });

    expect(saved.success, saved.message).toBe(true);
    expect((await contentModule())?.content).toBe(edited);
  });

  it("restores the Starter module after the author deleted it", async () => {
    seedStarterWorkspace();
    await deleteContentModule();

    const restored = await restore(await generation());

    expect(restored.success, restored.message).toBe(true);
    expect((await contentModule())?.content).toBe(
      STARTER_THEME_CONTENT_MODULE_SOURCE,
    );
  });

  it("never overwrites the author's module, even from a stale editor", async () => {
    seedStarterWorkspace();
    const existing = (await contentModule())!;
    const edited = "export const morph = { pages: { get() {} } }; // mine\n";
    const saved = await call((await handlers()).saveStorefrontThemeFile, {
      storefrontId: STORE,
      themeId: THEME,
      path: THEME_CONTENT_MODULE_PATH,
      content: edited,
      mimeType: "text/typescript",
      expectedFileId: existing.id,
      expectedVersion: existing.version,
      expectedSourceGeneration: await generation(),
    });
    expect(saved.success, saved.message).toBe(true);

    // An editor that still believes the file is missing, at the current
    // generation, so only the create precondition stands in the way.
    const restored = await restore(await generation());

    expect(restored.success).toBe(false);
    expect(restored.error).toBe("FILE_VERSION_CONFLICT");
    expect((await contentModule())?.content).toBe(edited);
  });

  it("refuses a restore when another tab changed the Theme first", async () => {
    seedStarterWorkspace();
    await deleteContentModule();
    const seenByThisTab = await generation();

    // Another tab saves an unrelated file in the meantime.
    const other = (await themeSourceStore.listFiles(STORE, THEME)).find(
      (file) => file.path === "src/routes/index.tsx",
    )!;
    const otherSave = await call((await handlers()).saveStorefrontThemeFile, {
      storefrontId: STORE,
      themeId: THEME,
      path: other.path,
      content: `${other.content}\n// from another tab\n`,
      mimeType: "text/typescript",
      expectedFileId: other.id,
      expectedVersion: other.version,
      expectedSourceGeneration: seenByThisTab,
    });
    expect(otherSave.success, otherSave.message).toBe(true);

    const restored = await restore(seenByThisTab);

    expect(restored).toMatchObject({
      success: false,
      error: "SOURCE_GENERATION_CONFLICT",
    });
    expect(await contentModule()).toBeUndefined();
  });
});

describe("a restore the editor declares", () => {
  // The server identifies a restore by the request's declared operation and
  // resolves the Starter file for the path itself. The request's bytes are
  // never what is written, so a later change to the restore's source or
  // format cannot make a restore look like an author's create.
  it("writes the Starter's own module, whatever bytes the request carries", async () => {
    seedStarterWorkspace();
    await deleteContentModule();

    const restored = await declaredRestore(await generation(), {
      content: NOT_THE_STARTER,
    });

    expect(restored.success, restored.message).toBe(true);
    expect((await contentModule())?.content).toBe(
      STARTER_THEME_CONTENT_MODULE_SOURCE,
    );
  });

  it("refuses a path the current Starter has no file at, and writes nothing", async () => {
    seedStarterWorkspace();
    const before = await themeSourceStore.listFiles(STORE, THEME);

    const restored = await declaredRestore(await generation(), {
      path: "src/components/AuthorsOwn.tsx",
      content: NOT_THE_STARTER,
    });

    expect(restored).toMatchObject({
      success: false,
      error: "STARTER_FILE_NOT_RESTORABLE",
    });
    expect(await themeSourceStore.listFiles(STORE, THEME)).toEqual(before);
  });

  it("restores only the content module: another Starter path is refused and nothing is written", async () => {
    seedStarterWorkspace();
    const route = (await themeSourceStore.listFiles(STORE, THEME)).find(
      (file) => file.path === "src/routes/index.tsx",
    )!;
    const deleted = await call((await handlers()).deleteStorefrontThemeFile, {
      storefrontId: STORE,
      themeId: THEME,
      path: route.path,
      expectedFileId: route.id,
      expectedVersion: route.version,
      expectedSourceGeneration: await generation(),
    });
    expect(deleted.success, deleted.message).toBe(true);
    const before = await themeSourceStore.listFiles(STORE, THEME);
    const generationBefore = await generation();

    // The current Starter does have a file at this path, but the editor's
    // restore command only ever restores the content module.
    const restored = await declaredRestore(generationBefore, {
      path: "src/routes/index.tsx",
      content: route.content,
    });

    expect(restored).toMatchObject({
      success: false,
      error: "STARTER_FILE_NOT_RESTORABLE",
    });
    expect(await themeSourceStore.listFiles(STORE, THEME)).toEqual(before);
    expect(await generation()).toBe(generationBefore);
  });

  it("only ever creates: a declared restore over an existing file is refused and the file is kept", async () => {
    seedStarterWorkspace();
    const existing = (await contentModule())!;
    const edited = `${STARTER_THEME_CONTENT_MODULE_SOURCE}\n// mine\n`;
    const saved = await call((await handlers()).saveStorefrontThemeFile, {
      storefrontId: STORE,
      themeId: THEME,
      path: THEME_CONTENT_MODULE_PATH,
      content: edited,
      mimeType: "text/typescript",
      expectedFileId: existing.id,
      expectedVersion: existing.version,
      expectedSourceGeneration: await generation(),
    });
    expect(saved.success, saved.message).toBe(true);
    const current = (await contentModule())!;

    const restored = await declaredRestore(await generation(), {
      expectMissing: false,
      expectedFileId: current.id,
      expectedVersion: current.version,
    });

    expect(restored).toMatchObject({
      success: false,
      error: "STARTER_RESTORE_CREATE_ONLY",
    });
    expect((await contentModule())?.content).toBe(edited);
  });

  it("is refused by the create precondition when the file is already there", async () => {
    seedStarterWorkspace();

    const restored = await declaredRestore(await generation());

    expect(restored).toMatchObject({
      success: false,
      error: "FILE_VERSION_CONFLICT",
    });
  });
});

describe("Starter writes that need the full Start preview", () => {
  // Option B, the switch-then-write order. The restore command, the empty
  // Theme's Starter init and the Starter bootstrap put the Starter's own
  // files into the Theme; when any of them needs the full Start preview the
  // write commits only while the Theme records `start`, in the same batch as
  // its source generation. NULL (the deployment's default) and client are
  // refused with nothing left behind; the runtime is never switched for the
  // author. The content module stands in for the Start-only Starter file.
  const setRuntime = (runtime: string | null) =>
    sqlite
      .prepare("UPDATE storefront_themes SET preview_runtime = ? WHERE id = ?")
      .run(runtime, THEME);
  const stored = () => ({
    files: sqlite
      .prepare(
        "SELECT path, content, version FROM storefront_theme_files WHERE deleted_at IS NULL ORDER BY path",
      )
      .all(),
    revisions: sqlite
      .prepare("SELECT id FROM storefront_theme_revisions ORDER BY id")
      .all(),
    theme: sqlite
      .prepare(
        "SELECT source_generation, preview_runtime, updated_at FROM storefront_themes WHERE id = ?",
      )
      .get(THEME),
  });

  beforeEach(() => {
    startPreview.requiredPaths = [THEME_CONTENT_MODULE_PATH];
  });
  afterEach(() => {
    startPreview.requiredPaths = null;
  });

  it.each([null, "client"])(
    "refuses the restore on a Theme that records %s and leaves nothing of it",
    async (runtime) => {
      seedStarterWorkspace();
      await deleteContentModule();
      setRuntime(runtime);
      const before = stored();

      const restored = await restore(await generation());

      expect(restored).toMatchObject({
        success: false,
        error: "STARTER_START_PREVIEW_REQUIRED",
      });
      expect(await contentModule()).toBeUndefined();
      expect(stored()).toEqual(before);
    },
  );

  it("restores the Starter module on a Theme that records start", async () => {
    seedStarterWorkspace();
    await deleteContentModule();
    setRuntime("start");

    const restored = await restore(await generation());

    expect(restored.success, restored.message).toBe(true);
    expect((await contentModule())?.content).toBe(
      STARTER_THEME_CONTENT_MODULE_SOURCE,
    );
    expect(stored().theme).toMatchObject({ preview_runtime: "start" });
  });

  it.each([null, "client"])(
    "refuses a declared restore on a Theme that records %s even when the request carries other bytes",
    async (runtime) => {
      seedStarterWorkspace();
      await deleteContentModule();
      setRuntime(runtime);
      const before = stored();

      // Not byte-identical to the Starter: the old inference would have taken
      // this as an author's create. The declared operation is what counts.
      const restored = await declaredRestore(await generation(), {
        content: NOT_THE_STARTER,
      });

      expect(restored).toMatchObject({
        success: false,
        error: "STARTER_START_PREVIEW_REQUIRED",
      });
      expect(await contentModule()).toBeUndefined();
      expect(stored()).toEqual(before);
    },
  );

  it("takes a declared restore on a Theme that records start, writing the Starter's bytes", async () => {
    seedStarterWorkspace();
    await deleteContentModule();
    setRuntime("start");

    const restored = await declaredRestore(await generation(), {
      content: NOT_THE_STARTER,
    });

    expect(restored.success, restored.message).toBe(true);
    expect((await contentModule())?.content).toBe(
      STARTER_THEME_CONTENT_MODULE_SOURCE,
    );
    expect(stored().theme).toMatchObject({ preview_runtime: "start" });
  });

  it("does not take an ordinary create of that path with the author's content as a restore", async () => {
    seedStarterWorkspace();
    await deleteContentModule();
    setRuntime("start");
    const authored = `${STARTER_THEME_CONTENT_MODULE_SOURCE}\n// mine\n`;

    const created = await call((await handlers()).saveStorefrontThemeFile, {
      storefrontId: STORE,
      themeId: THEME,
      path: THEME_CONTENT_MODULE_PATH,
      content: authored,
      mimeType: "text/typescript",
      expectMissing: true,
      expectedSourceGeneration: await generation(),
    });

    // The author's bytes, not the Starter's: an ordinary create is never
    // resolved to the Starter file.
    expect(created.success, created.message).toBe(true);
    expect((await contentModule())?.content).toBe(authored);
  });

  it("takes the author's own module on a client Theme: only the Starter's bytes are held to start", async () => {
    seedStarterWorkspace();
    await deleteContentModule();
    setRuntime("client");
    const authored = `${STARTER_THEME_CONTENT_MODULE_SOURCE}\n// mine\n`;

    const created = await call((await handlers()).saveStorefrontThemeFile, {
      storefrontId: STORE,
      themeId: THEME,
      path: THEME_CONTENT_MODULE_PATH,
      content: authored,
      mimeType: "text/typescript",
      expectMissing: true,
      expectedSourceGeneration: await generation(),
    });

    expect(created.success, created.message).toBe(true);
    expect((await contentModule())?.content).toBe(authored);
  });

  it.each([null, "client"])(
    "initialises no Starter file into an empty Theme that records %s",
    async (runtime) => {
      setRuntime(runtime);
      const before = stored();

      const initialised = await call(
        (await handlers()).initStorefrontStarterTheme,
        { storefrontId: STORE, themeId: THEME },
      );

      expect(initialised).toMatchObject({
        success: false,
        error: "STARTER_START_PREVIEW_REQUIRED",
      });
      expect(stored()).toEqual(before);
    },
  );

  it.each([null, "client"])(
    "bootstraps no Starter file into a Theme that records %s",
    async (runtime) => {
      setRuntime(runtime);
      const before = stored();

      const bootstrapped = await call(
        (await handlers()).applyStarterThemeWorkspace,
        {
          storefrontId: STORE,
          themeId: THEME,
          expectedSourceGeneration: await generation(),
        },
      );

      expect(bootstrapped).toMatchObject({
        success: false,
        error: "STARTER_START_PREVIEW_REQUIRED",
      });
      expect(stored()).toEqual(before);
    },
  );

  it("initialises an empty Theme that records start", async () => {
    setRuntime("start");

    const initialised = await call(
      (await handlers()).initStorefrontStarterTheme,
      { storefrontId: STORE, themeId: THEME },
    );

    expect(initialised.success, initialised.message).toBe(true);
    expect((await contentModule())?.content).toBe(
      STARTER_THEME_CONTENT_MODULE_SOURCE,
    );
    expect(stored().theme).toMatchObject({ preview_runtime: "start" });
  });

  it("bootstraps a Theme that records start", async () => {
    setRuntime("start");

    const bootstrapped = await call(
      (await handlers()).applyStarterThemeWorkspace,
      {
        storefrontId: STORE,
        themeId: THEME,
        expectedSourceGeneration: await generation(),
      },
    );

    expect(bootstrapped.success, bootstrapped.message).toBe(true);
    expect((await contentModule())?.content).toBe(
      STARTER_THEME_CONTENT_MODULE_SOURCE,
    );
    expect(stored().theme).toMatchObject({ preview_runtime: "start" });
  });
});
