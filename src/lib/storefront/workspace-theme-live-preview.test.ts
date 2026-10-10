// @vitest-environment node
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  renderLivePreviewComponent,
  renderLivePreviewRoute,
} from "@/lib/test-utils/live-preview-render";
import type { ThemeSourceFile } from "@/lib/test-utils/theme-module-loader";

/**
 * The Themes in this machine's workspace, through the Live Preview's source
 * pass and real React.
 *
 * The starter is covered by starter-theme-live-preview.test.ts. A Theme built
 * for a real storefront is written without a thought for what the preview
 * pass understands, which makes every one of its components a case nobody
 * designed to pass: the pass must accept each file (or say why it skipped
 * it), and React must render the result without an error.
 *
 * Off by default: it reads a database that only exists on a machine running
 * this project locally.
 *
 *   pnpm test:workspace-preview
 *   MORPH_WORKSPACE_PREVIEW_DB=/path/to/d1.sqlite pnpm test:workspace-preview
 */
const ENABLED = process.env.MORPH_WORKSPACE_PREVIEW === "1";

const D1_DIRECTORY = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject";

/** The local D1 file, or null when this machine has no local workspace. */
function findLocalDatabase(): string | null {
  const explicit = process.env.MORPH_WORKSPACE_PREVIEW_DB;
  if (explicit) return fs.existsSync(explicit) ? explicit : null;
  if (!fs.existsSync(D1_DIRECTORY)) return null;
  const candidates = fs
    .readdirSync(D1_DIRECTORY)
    .filter((name) => name.endsWith(".sqlite") && name !== "metadata.sqlite")
    .map((name) => path.join(D1_DIRECTORY, name));
  return candidates[0] ?? null;
}

/**
 * Each Theme's text files, read from a snapshot of the database.
 *
 * `VACUUM INTO` takes a consistent copy without holding the live file open,
 * so a dev server writing to it is neither blocked nor read mid-write. Themes
 * are kept apart: two Themes share paths, and mixing them would render one
 * Theme's route against another's components.
 */
function readWorkspaceThemes(
  databasePath: string,
): Map<string, ThemeSourceFile[]> {
  const copy = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "morph-workspace-preview-")),
    "workspace.sqlite",
  );
  const live = new Database(databasePath, { readonly: true });
  try {
    live.exec(`VACUUM INTO '${copy.replace(/'/g, "''")}'`);
  } finally {
    live.close();
  }

  const snapshot = new Database(copy, { readonly: true });
  try {
    const rows = snapshot
      .prepare(
        `select theme_id as themeId, path, content from storefront_theme_files
         where deleted_at is null and coalesce(encoding, 'utf8') = 'utf8'`,
      )
      .all() as Array<ThemeSourceFile & { themeId: string }>;
    const themes = new Map<string, ThemeSourceFile[]>();
    for (const { themeId, path: filePath, content } of rows) {
      const files = themes.get(themeId) ?? [];
      files.push({ path: filePath, content });
      themes.set(themeId, files);
    }
    return themes;
  } finally {
    snapshot.close();
    fs.rmSync(path.dirname(copy), { recursive: true, force: true });
  }
}

const databasePath = ENABLED ? findLocalDatabase() : null;
const themes: Map<string, ThemeSourceFile[]> = databasePath
  ? readWorkspaceThemes(databasePath)
  : new Map();

/**
 * Components normally fed by a route loader still need a value when rendered
 * on their own, or they fail before the preview pass's output is exercised.
 */
function propsForComponent(sourcePath: string): Record<string, unknown> {
  if (sourcePath.endsWith("/ProductList.tsx")) {
    return {
      products: [
        {
          id: "product-1",
          handle: "linen-vase",
          thumbnailUrl: "/images/linen-vase.jpg",
          title: "Linen vase",
          subtitle: "A quiet essential",
        },
      ],
      pagination: { page: 1, total: 1, totalPages: 1 },
    };
  }
  if (sourcePath.endsWith("/ProductDetail.tsx")) {
    return {
      product: {
        id: "product-1",
        handle: "linen-vase",
        thumbnailUrl: "/images/linen-vase.jpg",
        title: "Linen vase",
        subtitle: "A quiet essential",
        description: "Made for everyday rituals.",
        assets: [{ id: "asset-1", url: "/images/detail.jpg", name: "Detail" }],
        options: [
          {
            id: "option-1",
            title: "Color",
            values: [{ id: "value-1", value: "Natural" }],
          },
        ],
        variants: [
          {
            id: "variant-1",
            title: "Natural / One size",
            availableQuantity: 1,
            allowBackorder: false,
            formattedPrice: "$48",
          },
        ],
      },
    };
  }
  return {};
}

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  errors.mockRestore();
});

describe.skipIf(!ENABLED || themes.size === 0)(
  "workspace Themes in the real React Live Preview",
  () => {
    it("has Themes to render", () => {
      // Guards the read itself: a query that matched nothing would let every
      // Theme below pass by not existing.
      expect(themes.size).toBeGreaterThan(0);
    });

    for (const [themeId, files] of themes) {
      const components = files
        .map((file) => file.path)
        .filter(
          (filePath) =>
            filePath.startsWith("src/components/") && filePath.endsWith(".tsx"),
        )
        .sort();
      const hasHome =
        files.some((file) => file.path === "src/routes/__root.tsx") &&
        files.some((file) => file.path === "src/routes/index.tsx");

      describe(`Theme ${themeId}`, () => {
        for (const sourcePath of components) {
          it(`renders ${sourcePath.replace("src/components/", "")}`, async () => {
            const { html, prepared } = await renderLivePreviewComponent({
              files,
              sourcePath,
              props: propsForComponent(sourcePath),
            });

            expect(prepared.bindings.skipped).toEqual([]);
            expect(html.length).toBeGreaterThan(0);
            expect(errors.mock.calls).toEqual([]);
          });
        }

        it.skipIf(!hasHome)("renders its home route", async () => {
          const { html, prepared } = await renderLivePreviewRoute({ files });

          expect(prepared.bindings.skipped).toEqual([]);
          expect(html.length).toBeGreaterThan(0);
          expect(errors.mock.calls).toEqual([]);
        });
      });
    }
  },
);
