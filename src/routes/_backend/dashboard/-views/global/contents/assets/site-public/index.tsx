import { AssetLibraryPicker } from "@/components/asset/asset-library-picker";
import type { SelectedAsset } from "@/components/asset/asset-tile";
import { CopyAssetToPublicForm } from "@/components/theme-public/copy-asset-to-public-form";
import {
  PublicUrlMoveDialog,
  type PublicUrlMoveReviewState,
} from "@/components/theme-public/public-url-move-dialog";
import { PublicUrlReview } from "@/components/theme-public/public-url-review";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { StorefrontThemeBinaryFileDTO } from "@/lib/storefront/dto/storefront-theme-file.dto";
import {
  checkPublicFileWrite,
  planBinaryMoveBatch,
  publicFileDestination,
  suggestPublicAssetPath,
} from "@/lib/storefront/editor/public-file-operations";
import type { PublicUrlRewriteRequest } from "@/lib/storefront/editor/public-url-move-batch";
import { reviewPublicUrlMove } from "@/lib/storefront/editor/public-url-move-review";
import {
  scanPublicUrlReferences,
  type PublicUrlScan,
} from "@/lib/storefront/editor/public-url-references";
import { useThemeWorkspaceStore } from "@/lib/storefront/store/theme-workspace-store";
import {
  THEME_PUBLIC_ACCEPT,
  THEME_PUBLIC_DIRECTORY,
  themePublicUrlPath,
} from "@/lib/storefront/theme-public-files";
import { formatBytes } from "@/lib/utils";
import { storefrontThemeFileQueries } from "@/routes/_editor/-queries/storefront-theme-files.queries";
import {
  themeBinaryFileUrl,
  writeThemeBinaryFile,
} from "@/routes/_editor/-queries/theme-binary-files";
import { CardWrapper } from "@/routes/_backend/dashboard/-components/card-wrapper";
import {
  deleteStorefrontThemeFile,
  saveStorefrontThemeFilesBatch,
} from "@/server/storefront/storefront-theme-files.serverFn";
import { copyAssetToThemePublic } from "@/server/storefront/theme-public-asset-copy.serverFn";
import { storefrontQueries } from "@queries/storefront.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  FileType,
  Folder,
  FolderPlus,
  ImagePlus,
  MoreHorizontal,
  Upload,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

/**
 * The site's `public/` folder, in Assets.
 *
 * The same files Code mode lists under `public/`, read and written through
 * the same entries: the list, the binary write, the batch, the delete. Unlike
 * the rest of Assets these are part of the site's code — served at their own
 * URL once published, to anyone, and never private — so the page says so, and
 * a move or deletion is reviewed for the URLs it changes, as in Code mode.
 */

const ROOT = THEME_PUBLIC_DIRECTORY.slice(0, -1);

type FolderEntry = { name: string; path: string };

/** The folders and files directly inside `folder`. */
function listFolder(
  folder: string,
  binaryFiles: readonly StorefrontThemeBinaryFileDTO[],
  pendingFolders: readonly string[],
): { folders: FolderEntry[]; files: StorefrontThemeBinaryFileDTO[] } {
  const prefix = `${folder}/`;
  const folders = new Map<string, FolderEntry>();
  const files: StorefrontThemeBinaryFileDTO[] = [];
  const addFolder = (rest: string) => {
    const name = rest.slice(0, rest.indexOf("/"));
    folders.set(name, { name, path: `${prefix}${name}` });
  };
  for (const file of binaryFiles) {
    if (!file.path.startsWith(prefix)) continue;
    const rest = file.path.slice(prefix.length);
    if (rest.includes("/")) addFolder(rest);
    else files.push(file);
  }
  for (const pending of pendingFolders) {
    if (pending.startsWith(prefix))
      addFolder(`${pending.slice(prefix.length)}/`);
  }
  return {
    folders: [...folders.values()].sort((a, b) => a.name.localeCompare(b.name)),
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
  };
}

/**
 * An image's preview, or the file icon for a font and for an image the
 * browser cannot show — one replaced since the list was read, or bytes that
 * do not decode — rather than an empty box.
 */
function Thumbnail({
  file,
  src,
}: {
  file: StorefrontThemeBinaryFileDTO;
  src: string;
}) {
  const [failed, setFailed] = useState(false);
  if (!file.mimeType.startsWith("image/") || failed) {
    return <FileType className="size-8 text-muted-foreground" />;
  }
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      className="max-h-full max-w-full object-contain"
      data-site-public-thumbnail={file.path}
      onError={() => setFailed(true)}
    />
  );
}

export function SitePublicFilesPanel({
  storefrontId,
  themeId,
}: {
  storefrontId: string;
  themeId: string;
}) {
  const queryClient = useQueryClient();
  const treeQuery = useQuery(
    storefrontThemeFileQueries.tree(storefrontId, themeId),
  );
  const data = treeQuery.data;
  const binaryFiles = useMemo(() => data?.binaryFiles ?? [], [data]);
  const sourceFiles = useMemo(() => data?.files ?? [], [data]);
  const [folder, setFolder] = useState(ROOT);
  const [pendingFolders, setPendingFolders] = useState<string[]>([]);
  const [newFolderName, setNewFolderName] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{
    file: StorefrontThemeBinaryFileDTO;
    value: string;
  } | null>(null);
  const [deleting, setDeleting] = useState<{
    file: StorefrontThemeBinaryFileDTO;
    scan: PublicUrlScan;
  } | null>(null);
  const [moveReview, setMoveReview] = useState<PublicUrlMoveReviewState | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  /** Copying from the library: picking an asset, then confirming its path. */
  const [adding, setAdding] = useState<{ asset: SelectedAsset | null } | null>(
    null,
  );
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const replacingRef = useRef<StorefrontThemeBinaryFileDTO | null>(null);

  const binaryByPath = useMemo(
    () => new Map(binaryFiles.map((file) => [file.path, file])),
    [binaryFiles],
  );
  const listing = listFolder(folder, binaryFiles, pendingFolders);

  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: storefrontThemeFileQueries.tree(storefrontId, themeId).queryKey,
    });

  /**
   * Theme source as saved, and the drafts Code mode holds for this Theme:
   * the saved source is what the server plans a rewrite from; a draft that
   * differs from it is what the review must not overlook.
   */
  const sourceState = () => {
    const saved = sourceFiles.map((file) => ({
      id: file.id,
      path: file.path,
      content: file.content,
      version: file.version,
      mimeType: file.mimeType,
    }));
    const workspace = useThemeWorkspaceStore
      .getState()
      .getWorkspaceFiles(storefrontId, themeId);
    const drafts = new Map<string, string>();
    for (const file of saved) {
      const local = workspace[file.path];
      if (local?.dirty && local.localContent !== file.content) {
        drafts.set(file.path, local.localContent);
      }
    }
    const current = saved.map((file) => ({
      path: file.path,
      content: drafts.get(file.path) ?? file.content,
    }));
    return { saved, drafts, current };
  };

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  const upload = (chosen: FileList | null) => {
    const picked = [...(chosen ?? [])];
    if (picked.length === 0 || !data) return;
    void run(async () => {
      const existingPaths = new Set([
        ...binaryByPath.keys(),
        ...sourceFiles.map((file) => file.path),
      ]);
      let generation = data.sourceGeneration;
      for (const file of picked) {
        const path = `${folder}/${file.name}`;
        const problem = checkPublicFileWrite({
          path,
          size: file.size,
          replacing: false,
          existingPaths,
        });
        if (problem) throw new Error(problem);
        const result = await writeThemeBinaryFile({
          storefrontId,
          themeId,
          path,
          bytes: file,
          expectedSourceGeneration: generation,
          precondition: { expectMissing: true },
        });
        if (!result.ok) throw new Error(result.message);
        generation = result.sourceGeneration;
        existingPaths.add(path);
      }
      toast.success(
        `Uploaded ${picked.length} file${picked.length === 1 ? "" : "s"}`,
      );
    });
  };

  const replace = (chosen: FileList | null) => {
    const target = replacingRef.current;
    const file = chosen?.[0];
    replacingRef.current = null;
    if (!target || !file || !data) return;
    void run(async () => {
      const problem = checkPublicFileWrite({
        path: target.path,
        size: file.size,
        replacing: true,
        existingPaths: new Set(binaryByPath.keys()),
      });
      if (problem) throw new Error(problem);
      const result = await writeThemeBinaryFile({
        storefrontId,
        themeId,
        path: target.path,
        bytes: file,
        expectedSourceGeneration: data.sourceGeneration,
        precondition: {
          expectedFileId: target.id,
          expectedVersion: target.version,
        },
      });
      if (!result.ok) throw new Error(result.message);
      toast.success(`Replaced ${target.path}`);
    });
  };

  const requestDelete = (file: StorefrontThemeBinaryFileDTO) => {
    const url = themePublicUrlPath(file.path) ?? file.path;
    setDeleting({
      file,
      scan: scanPublicUrlReferences(sourceState().current, [url]),
    });
  };

  const confirmDelete = () => {
    const target = deleting?.file;
    setDeleting(null);
    if (!target || !data) return;
    void run(async () => {
      const result = await deleteStorefrontThemeFile({
        data: {
          storefrontId,
          themeId,
          path: target.path,
          expectedFileId: target.id,
          expectedVersion: target.version,
          expectedSourceGeneration: data.sourceGeneration,
        },
      });
      if (!result.success) throw new Error(result.message);
      toast.success(`Deleted ${target.path}`);
    });
  };

  const submitRename = () => {
    if (!renaming) return;
    const destination = publicFileDestination(renaming.value);
    if (!destination.ok) {
      toast.error(destination.reason);
      return;
    }
    const from = renaming.file.path;
    const to = destination.path;
    if (to === from) {
      setRenaming(null);
      return;
    }
    if (binaryByPath.has(to) || sourceFiles.some((file) => file.path === to)) {
      toast.error(`${to} already exists.`);
      return;
    }
    setRenaming(null);
    const binaryMoves = [{ from, to }];
    const { saved, drafts, current } = sourceState();
    const planned = reviewPublicUrlMove({
      saved,
      drafts,
      files: [],
      deletions: [{ path: from }],
      binaryMoves,
    });
    setMoveReview({
      binaryMoves,
      movesSource: false,
      rewrite: planned.rewrite,
      review: {
        changes: planned.changes,
        scan: scanPublicUrlReferences(
          current,
          planned.changes.map((change) => change.from),
        ),
      },
      acknowledged: false,
    });
  };

  const applyMove = (
    review: PublicUrlMoveReviewState,
    kind: "move" | "copy",
    publicUrlRewrite: PublicUrlRewriteRequest | undefined,
  ) => {
    if (!data) return;
    void run(async () => {
      const planned = planBinaryMoveBatch({
        moves: review.binaryMoves,
        binaryByPath,
        keepSources: kind === "copy",
      });
      if (!planned.ok) throw new Error(planned.reason);
      const move = review.binaryMoves[0]!;
      const result = await saveStorefrontThemeFilesBatch({
        data: {
          storefrontId,
          themeId,
          files: [],
          deletions: planned.batch.deletions,
          binaryCopies: planned.batch.binaryCopies,
          ...(publicUrlRewrite ? { publicUrlRewrite } : {}),
          expectedSourceGeneration: data.sourceGeneration,
          createRevision: true,
          revisionMessage: `${kind === "copy" ? "Copy" : "Move"} ${move.from} to ${move.to}`,
        },
      });
      if (!result.success) throw new Error(result.message);
      const updated = publicUrlRewrite?.expected.rewriteCount ?? 0;
      toast.success(
        `${kind === "copy" ? "Copied" : "Moved"} to ${move.to}${updated > 0 ? `; updated ${updated} URL reference${updated === 1 ? "" : "s"}` : ""}`,
      );
    });
  };

  const existingPaths = () =>
    new Set([...binaryByPath.keys(), ...sourceFiles.map((file) => file.path)]);

  const copyFromAssets = (asset: SelectedAsset, path: string) => {
    setAdding(null);
    if (!data) return;
    void run(async () => {
      const result = await copyAssetToThemePublic({
        data: {
          storefrontId,
          themeId,
          assetId: asset.id,
          path,
          expectedSourceGeneration: data.sourceGeneration,
        },
      });
      if (!result.success) throw new Error(result.message);
      setFolder(path.slice(0, path.lastIndexOf("/")));
      toast.success(`Copied ${asset.name} to ${path}`);
    });
  };

  const addFolder = () => {
    const name = (newFolderName ?? "").trim().replace(/^\/+|\/+$/g, "");
    setNewFolderName(null);
    if (!name) return;
    if (name.includes("/") || name === "." || name === "..") {
      toast.error("A folder name cannot contain slashes.");
      return;
    }
    const path = `${folder}/${name}`;
    setPendingFolders((current) =>
      current.includes(path) ? current : [...current, path],
    );
    setFolder(path);
  };

  const crumbs = folder.split("/");

  return (
    <CardWrapper
      label="Site public/"
      description="The files your site's code serves at their own URL, the same public/ folder Code mode shows."
      headerButton={
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setNewFolderName("")}
            disabled={busy}
          >
            <FolderPlus className="size-4" />
            New folder
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAdding({ asset: null })}
            disabled={busy || !data}
          >
            <ImagePlus className="size-4" />
            Add from Assets
          </Button>
          <Button
            size="sm"
            onClick={() => uploadInputRef.current?.click()}
            disabled={busy || !data}
          >
            <Upload className="size-4" />
            Upload
          </Button>
        </div>
      }
    >
      <div className="space-y-4 p-4" data-site-public>
        <p
          className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-muted-foreground"
          data-site-public-notice
        >
          Everything here becomes public when you publish: anyone can open a
          file at its URL, and it cannot be made private. Changes go to the site
          draft and reach the live site when you publish. Product images and
          private files belong in Assets.
        </p>

        <nav className="flex items-center gap-1 text-sm" aria-label="Folder">
          {crumbs.map((name, index) => {
            const path = crumbs.slice(0, index + 1).join("/");
            return (
              <span key={path} className="flex items-center gap-1">
                {index > 0 ? (
                  <ChevronRight className="size-3 text-muted-foreground" />
                ) : null}
                <button
                  type="button"
                  className="font-mono hover:underline"
                  onClick={() => setFolder(path)}
                  data-site-public-crumb={path}
                >
                  {name}/
                </button>
              </span>
            );
          })}
        </nav>

        {treeQuery.isPending ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-40" />
            ))}
          </div>
        ) : treeQuery.isError ? (
          <p className="text-sm text-destructive">
            {treeQuery.error instanceof Error
              ? treeQuery.error.message
              : "The files could not be listed."}
          </p>
        ) : listing.folders.length === 0 && listing.files.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-site-public-empty>
            No files in {folder}/ yet. Upload images or fonts to use them in
            your site's code, for example as /
            {folder.slice(ROOT.length + 1) || "images"}/logo.png.
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {listing.folders.map((entry) => (
              <li key={entry.path}>
                <button
                  type="button"
                  className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-md border p-4 text-sm hover:bg-muted/50"
                  onClick={() => setFolder(entry.path)}
                  data-site-public-folder={entry.path}
                >
                  <Folder className="size-8 text-muted-foreground" />
                  <span className="font-mono">{entry.name}/</span>
                </button>
              </li>
            ))}
            {listing.files.map((file) => {
              const url = themePublicUrlPath(file.path) ?? file.path;
              return (
                <li
                  key={file.path}
                  className="flex flex-col overflow-hidden rounded-md border"
                  data-site-public-file={file.path}
                >
                  <div className="flex h-28 items-center justify-center bg-muted/30">
                    <Thumbnail
                      file={file}
                      src={themeBinaryFileUrl({
                        storefrontId,
                        themeId,
                        path: file.path,
                        blobDigest: file.blobDigest,
                      })}
                    />
                  </div>
                  <div className="flex items-start gap-1 p-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-xs" title={url}>
                        {url}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {formatBytes(file.sizeBytes)}
                      </div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label={`Actions for ${file.path}`}
                          disabled={busy}
                        >
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => {
                            void navigator.clipboard
                              ?.writeText(url)
                              .then(() => toast.success(`Copied ${url}`));
                          }}
                        >
                          Copy URL
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() =>
                            setRenaming({
                              file,
                              value: file.path.slice(
                                THEME_PUBLIC_DIRECTORY.length,
                              ),
                            })
                          }
                        >
                          Rename or move…
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => {
                            replacingRef.current = file;
                            replaceInputRef.current?.click();
                          }}
                        >
                          Replace…
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive"
                          onSelect={() => requestDelete(file)}
                        >
                          Delete…
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <input
          ref={uploadInputRef}
          type="file"
          multiple
          accept={THEME_PUBLIC_ACCEPT}
          className="hidden"
          data-site-public-upload-input
          onChange={(event) => {
            upload(event.currentTarget.files);
            event.currentTarget.value = "";
          }}
        />
        <input
          ref={replaceInputRef}
          type="file"
          accept={THEME_PUBLIC_ACCEPT}
          className="hidden"
          data-site-public-replace-input
          onChange={(event) => {
            replace(event.currentTarget.files);
            event.currentTarget.value = "";
          }}
        />
      </div>

      <Dialog
        open={renaming !== null}
        onOpenChange={(open) => {
          if (!open) setRenaming(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename or move</DialogTitle>
            <DialogDescription>
              The path inside public/, which is also the file's URL. Folders are
              created as needed.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submitRename();
            }}
            className="space-y-3"
          >
            <div className="flex items-center gap-1 font-mono text-sm">
              <span className="text-muted-foreground">public/</span>
              <Input
                aria-label="New path"
                value={renaming?.value ?? ""}
                onChange={(event) =>
                  setRenaming((current) =>
                    current
                      ? { ...current, value: event.target.value }
                      : current,
                  )
                }
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRenaming(null)}
              >
                Cancel
              </Button>
              <Button type="submit">Review</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={newFolderName !== null}
        onOpenChange={(open) => {
          if (!open) setNewFolderName(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New folder in {folder}/</DialogTitle>
            <DialogDescription>
              A folder exists once a file is uploaded into it.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              addFolder();
            }}
            className="space-y-3"
          >
            <Input
              aria-label="Folder name"
              value={newFolderName ?? ""}
              onChange={(event) => setNewFolderName(event.target.value)}
              autoFocus
            />
            <DialogFooter>
              <Button type="submit">Create</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <AlertDialogContent data-site-public-delete-review>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.file.path}?</AlertDialogTitle>
            <AlertDialogDescription>
              Its URL stops working in the site draft, and on the live site once
              you publish.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleting ? (
            <PublicUrlReview
              changes={[
                {
                  from:
                    themePublicUrlPath(deleting.file.path) ??
                    deleting.file.path,
                  to: null,
                },
              ]}
              scan={deleting.scan}
            />
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button variant="destructive" onClick={confirmDelete}>
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={adding !== null}
        onOpenChange={(open) => {
          if (!open) setAdding(null);
        }}
      >
        <DialogContent className="max-w-2xl" data-add-from-assets>
          <DialogHeader>
            <DialogTitle>Add from Assets</DialogTitle>
            <DialogDescription>
              {adding?.asset
                ? "Choose where the copy goes in public/."
                : "Choose an image from the media library to copy into public/."}
            </DialogDescription>
          </DialogHeader>
          {adding?.asset ? (
            <CopyAssetToPublicForm
              asset={adding.asset}
              suggestedPath={suggestPublicAssetPath({
                folder,
                asset: adding.asset,
                existingPaths: existingPaths(),
              })}
              existingPaths={existingPaths()}
              pending={busy}
              onCancel={() => setAdding({ asset: null })}
              onConfirm={(path) => copyFromAssets(adding.asset!, path)}
            />
          ) : adding ? (
            <AssetLibraryPicker
              assetType="image"
              selectedIds={[]}
              onToggle={(asset) => setAdding({ asset })}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <PublicUrlMoveDialog
        review={moveReview}
        pending={busy}
        onClose={() => setMoveReview(null)}
        onAcknowledgedChange={(acknowledged) =>
          setMoveReview((current) =>
            current ? { ...current, acknowledged } : current,
          )
        }
        onChoose={({ kind, publicUrlRewrite }) => {
          const review = moveReview;
          setMoveReview(null);
          if (review) applyMove(review, kind, publicUrlRewrite);
        }}
      />
    </CardWrapper>
  );
}

export default function SitePublicFiles() {
  const query = useQuery(storefrontQueries.detail());
  const storefront = query.data?.success ? query.data.data : null;

  if (query.isPending) {
    return <Skeleton className="h-96 w-full" />;
  }
  if (!storefront?.activeThemeId) {
    return (
      <CardWrapper label="Site public/">
        <p className="p-4 text-sm text-muted-foreground" data-site-public-empty>
          Set up the online store first; its site files appear here.
        </p>
      </CardWrapper>
    );
  }
  return (
    <SitePublicFilesPanel
      storefrontId={storefront.id}
      themeId={storefront.activeThemeId}
    />
  );
}
