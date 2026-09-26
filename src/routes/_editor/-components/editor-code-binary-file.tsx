import type { StorefrontThemeBinaryFileDTO } from "@/lib/storefront/dto/storefront-theme-file.dto";
import { themePublicUrlPath } from "@/lib/storefront/theme-public-files";
import { formatBytes } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { FileImage, FileType, Trash2, Upload } from "lucide-react";

const FONT_EXTENSIONS = /\.woff2?$/i;

/** The Explorer's icon for a binary file: a font, or otherwise an image. */
export function BinaryFileIcon({ path }: { path: string }) {
  return FONT_EXTENSIONS.test(path) ? (
    <FileType className="size-3.5 text-violet-500 shrink-0" />
  ) : (
    <FileImage className="size-3.5 text-emerald-500 shrink-0" />
  );
}

/**
 * What the Code workspace shows for a binary file in place of an editor.
 *
 * Binary files are stored bytes, not source: Monaco has nothing to open. The
 * panel says what the file is and where the storefront serves it, from
 * metadata alone — the bytes are never fetched — and offers the two writes a
 * binary file has here: replacing its bytes, and deleting it.
 */
export function EditorCodeBinaryFile({
  file,
  busy = false,
  onReplace,
  onDelete,
}: {
  file: StorefrontThemeBinaryFileDTO;
  busy?: boolean;
  onReplace?: () => void;
  onDelete?: () => void;
}) {
  const name = file.path.split("/").pop() ?? file.path;
  const urlPath = themePublicUrlPath(file.path);
  return (
    <div
      className="flex h-full items-center justify-center p-6"
      data-code-binary-file={file.path}
    >
      <div className="w-full max-w-md rounded-lg border bg-muted/30 p-4 text-xs">
        <div className="mb-3 flex items-center gap-2">
          <BinaryFileIcon path={file.path} />
          <span className="truncate font-medium text-foreground">{name}</span>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-muted-foreground">
          <dt>Path</dt>
          <dd className="truncate font-mono text-foreground" title={file.path}>
            {file.path}
          </dd>
          {urlPath ? (
            <>
              <dt>Served at</dt>
              <dd
                className="truncate font-mono text-foreground"
                title={urlPath}
              >
                {urlPath}
              </dd>
            </>
          ) : null}
          <dt>Type</dt>
          <dd className="text-foreground">{file.mimeType}</dd>
          <dt>Size</dt>
          <dd className="text-foreground">{formatBytes(file.sizeBytes)}</dd>
          <dt>SHA-256</dt>
          <dd
            className="truncate font-mono text-foreground"
            title={file.blobDigest}
          >
            {file.blobDigest}
          </dd>
        </dl>
        {onReplace || onDelete ? (
          <div className="mt-4 flex items-center gap-2">
            {onReplace ? (
              <Button
                variant="outline"
                size="xs"
                disabled={busy}
                onClick={onReplace}
              >
                <Upload className="size-3" />
                Replace…
              </Button>
            ) : null}
            {onDelete ? (
              <Button
                variant="ghost"
                size="xs"
                className="text-destructive"
                disabled={busy}
                onClick={onDelete}
              >
                <Trash2 className="size-3" />
                Delete
              </Button>
            ) : null}
          </div>
        ) : null}
        <p className="mt-3 text-muted-foreground">
          Rename, move or copy it from its Explorer menu. A move shows the URLs
          it changes, and what names them, before anything is written.
        </p>
      </div>
    </div>
  );
}
