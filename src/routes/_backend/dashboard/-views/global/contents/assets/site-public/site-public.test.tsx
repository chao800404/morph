import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import type {
  StorefrontThemeBinaryFileDTO,
  StorefrontThemeFileDTO,
} from "@/lib/storefront/dto/storefront-theme-file.dto";
import { useThemeWorkspaceStore } from "@/lib/storefront/store/theme-workspace-store";
import { storefrontThemeFileQueries } from "@/routes/_editor/-queries/storefront-theme-files.queries";
import { writeThemeBinaryFile } from "@/routes/_editor/-queries/theme-binary-files";
import {
  deleteStorefrontThemeFile,
  saveStorefrontThemeFilesBatch,
} from "@/server/storefront/storefront-theme-files.serverFn";
import { SitePublicFilesPanel } from "./index";

vi.mock(
  "@/server/storefront/storefront-theme-files.serverFn",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/server/storefront/storefront-theme-files.serverFn")
    >()),
    deleteStorefrontThemeFile: vi.fn(),
    listStorefrontThemeFiles: vi.fn(async () => ({
      success: true,
      data: tree(),
    })),
    saveStorefrontThemeFilesBatch: vi.fn(),
  }),
);

vi.mock(
  "@/routes/_editor/-queries/theme-binary-files",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/routes/_editor/-queries/theme-binary-files")
    >()),
    writeThemeBinaryFile: vi.fn(),
  }),
);

const STORE = "store-1";
const THEME = "theme-1";

const binary = (
  path: string,
  overrides: Partial<StorefrontThemeBinaryFileDTO> = {},
): StorefrontThemeBinaryFileDTO => ({
  id: `00000000-0000-4000-8000-${String(path.length).padStart(12, "0")}`,
  storefrontId: STORE,
  themeId: THEME,
  path,
  encoding: "binary",
  blobDigest: "d".repeat(64),
  sizeBytes: 2048,
  mimeType: "image/png",
  isEntry: false,
  version: 2,
  createdAt: "now",
  updatedAt: "now",
  ...overrides,
});

const hero = binary("public/images/hero.png");
const font = binary("public/fonts/brand.woff2", { mimeType: "font/woff2" });
const heroSource: StorefrontThemeFileDTO = {
  id: "00000000-0000-4000-8000-00000000aaaa",
  storefrontId: STORE,
  themeId: THEME,
  path: "src/components/Hero.tsx",
  content: 'export default () => <img src="/images/hero.png" alt="" />;\n',
  mimeType: "text/typescript",
  isEntry: false,
  version: 4,
  createdAt: "now",
  updatedAt: "now",
};

function tree() {
  return {
    files: [heroSource],
    binaryFiles: [hero, font],
    tree: [],
    sourceGeneration: 9,
    latestPublishedRevision: null,
  };
}

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(
    storefrontThemeFileQueries.tree(STORE, THEME).queryKey,
    tree() as never,
  );
  return render(
    <QueryClientProvider client={client}>
      <SitePublicFilesPanel storefrontId={STORE} themeId={THEME} />
    </QueryClientProvider>,
  );
}

async function openActions(path: string, item: RegExp) {
  fireEvent.pointerDown(
    screen.getByRole("button", { name: `Actions for ${path}` }),
    { button: 0, ctrlKey: false },
  );
  fireEvent.click(await screen.findByRole("menuitem", { name: item }));
}

describe("SitePublicFilesPanel", () => {
  beforeEach(() => {
    vi.mocked(saveStorefrontThemeFilesBatch).mockReset();
    vi.mocked(deleteStorefrontThemeFile).mockReset();
    vi.mocked(writeThemeBinaryFile).mockReset();
    useThemeWorkspaceStore.setState({ files: {}, workspaces: {} });
    vi.spyOn(toast, "error").mockImplementation(() => "toast");
  });

  it("says the files become public, and lists a folder's files with previews at their digest", async () => {
    renderPanel();

    expect(
      document.querySelector("[data-site-public-notice]")?.textContent,
    ).toContain("cannot be made private");
    // The root holds folders only.
    fireEvent.click(
      document.querySelector('[data-site-public-folder="public/images"]')!,
    );

    const thumbnail = await waitFor(() => {
      const found = document.querySelector(
        '[data-site-public-thumbnail="public/images/hero.png"]',
      ) as HTMLImageElement | null;
      expect(found).not.toBeNull();
      return found!;
    });
    const url = new URL(thumbnail.getAttribute("src")!, "http://localhost");
    expect(url.pathname).toBe("/api/storefront/theme-binary-file");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      storefrontId: STORE,
      themeId: THEME,
      path: hero.path,
      digest: hero.blobDigest,
    });
    expect(screen.getByText("/images/hero.png")).toBeTruthy();

    // Back up, and into the fonts: a font has no image preview.
    fireEvent.click(
      document.querySelector('[data-site-public-crumb="public"]')!,
    );
    fireEvent.click(
      document.querySelector('[data-site-public-folder="public/fonts"]')!,
    );
    expect(
      document.querySelector(`[data-site-public-file="${font.path}"] img`),
    ).toBeNull();
  });

  it("shows the file icon instead of a preview the browser cannot show", async () => {
    renderPanel();
    fireEvent.click(
      document.querySelector('[data-site-public-folder="public/images"]')!,
    );
    const thumbnail = await waitFor(() => {
      const found = document.querySelector(
        `[data-site-public-thumbnail="${hero.path}"]`,
      );
      expect(found).not.toBeNull();
      return found!;
    });
    fireEvent.error(thumbnail);
    await waitFor(() =>
      expect(
        document.querySelector(`[data-site-public-file="${hero.path}"] img`),
      ).toBeNull(),
    );
    expect(
      document.querySelector(`[data-site-public-file="${hero.path}"] svg`),
    ).not.toBeNull();
  });

  it("moves a file after review, updating the references Theme source writes out", async () => {
    vi.mocked(saveStorefrontThemeFilesBatch).mockResolvedValue({
      success: true,
      data: { sourceGeneration: 10, files: [] },
    } as never);
    renderPanel();
    fireEvent.click(
      document.querySelector('[data-site-public-folder="public/images"]')!,
    );
    await openActions(hero.path, /Rename or move/);
    fireEvent.change(screen.getByRole("textbox", { name: "New path" }), {
      target: { value: "banners/hero.png" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review" }));

    const dialog = await waitFor(() => {
      const found = document.querySelector("[data-binary-move-review]");
      expect(found).not.toBeNull();
      return found!;
    });
    expect(dialog.textContent).toContain(
      "/images/hero.png → /banners/hero.png",
    );
    expect(
      dialog.querySelector(`[data-public-url-rewrite="${heroSource.path}:1"]`),
    ).not.toBeNull();
    expect(saveStorefrontThemeFilesBatch).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "Move and update 1 reference" }),
    );
    await waitFor(() =>
      expect(saveStorefrontThemeFilesBatch).toHaveBeenCalledTimes(1),
    );
    const payload = (
      vi.mocked(saveStorefrontThemeFilesBatch).mock.calls[0]![0] as {
        data: Record<string, unknown>;
      }
    ).data;
    expect(payload).toMatchObject({
      storefrontId: STORE,
      themeId: THEME,
      files: [],
      binaryCopies: [
        {
          from: hero.path,
          to: "public/banners/hero.png",
          expectedFileId: hero.id,
          expectedVersion: hero.version,
        },
      ],
      deletions: [
        {
          path: hero.path,
          expectedFileId: hero.id,
          expectedVersion: hero.version,
        },
      ],
      publicUrlRewrite: {
        moves: [{ from: hero.path, to: "public/banners/hero.png" }],
        expected: {
          paths: [heroSource.path],
          rewriteCount: 1,
          unresolvedCount: 0,
        },
        acknowledgeUnresolved: false,
      },
      expectedSourceGeneration: 9,
    });
  });

  it("does not update references while Code mode holds a draft naming the URL", async () => {
    const store = useThemeWorkspaceStore.getState();
    store.hydrateFromQuery(STORE, THEME, [heroSource]);
    useThemeWorkspaceStore.setState((state) => {
      const key = Object.keys(state.workspaces)[0]!;
      const files = state.workspaces[key]!;
      return {
        workspaces: {
          ...state.workspaces,
          [key]: {
            ...files,
            [heroSource.path]: {
              ...files[heroSource.path]!,
              localContent: 'export const src = "/images/hero.png";\n',
              dirty: true,
            },
          },
        },
      };
    });
    renderPanel();
    fireEvent.click(
      document.querySelector('[data-site-public-folder="public/images"]')!,
    );
    await openActions(hero.path, /Rename or move/);
    fireEvent.change(screen.getByRole("textbox", { name: "New path" }), {
      target: { value: "banners/hero.png" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review" }));

    const blocked = await waitFor(() => {
      const found = document.querySelector("[data-public-url-rewrite-blocked]");
      expect(found).not.toBeNull();
      return found!;
    });
    expect(blocked.textContent).toContain(heroSource.path);
    expect(screen.queryByRole("button", { name: /update/ })).toBeNull();
  });

  it("shows what names a file before deleting it by its id and version", async () => {
    vi.mocked(deleteStorefrontThemeFile).mockResolvedValue({
      success: true,
      data: { path: hero.path, sourceGeneration: 10 },
    } as never);
    renderPanel();
    fireEvent.click(
      document.querySelector('[data-site-public-folder="public/images"]')!,
    );
    await openActions(hero.path, /Delete/);

    const review = await waitFor(() => {
      const found = document.querySelector("[data-site-public-delete-review]");
      expect(found).not.toBeNull();
      return found!;
    });
    expect(review.textContent).toContain("/images/hero.png (removed)");
    expect(
      review.querySelector('[data-public-url-reference="known"]')?.textContent,
    ).toContain(`${heroSource.path}:1`);
    expect(deleteStorefrontThemeFile).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(deleteStorefrontThemeFile).toHaveBeenCalledWith({
        data: {
          storefrontId: STORE,
          themeId: THEME,
          path: hero.path,
          expectedFileId: hero.id,
          expectedVersion: hero.version,
          expectedSourceGeneration: 9,
        },
      }),
    );
  });

  it("uploads into the open folder as a new file, and refuses a name already taken", async () => {
    vi.mocked(writeThemeBinaryFile).mockResolvedValue({
      ok: true,
      file: binary("public/images/logo.png"),
      sourceGeneration: 10,
    });
    renderPanel();
    fireEvent.click(
      document.querySelector('[data-site-public-folder="public/images"]')!,
    );
    const input = document.querySelector(
      "[data-site-public-upload-input]",
    ) as HTMLInputElement;

    fireEvent.change(input, {
      target: { files: [new File(["x"], "hero.png", { type: "image/png" })] },
    });
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining("already exists"),
      ),
    );
    expect(writeThemeBinaryFile).not.toHaveBeenCalled();

    fireEvent.change(input, {
      target: { files: [new File(["x"], "logo.png", { type: "image/png" })] },
    });
    await waitFor(() => expect(writeThemeBinaryFile).toHaveBeenCalledTimes(1));
    expect(vi.mocked(writeThemeBinaryFile).mock.calls[0]![0]).toMatchObject({
      storefrontId: STORE,
      themeId: THEME,
      path: "public/images/logo.png",
      expectedSourceGeneration: 9,
      precondition: { expectMissing: true },
    });
  });
});
