import type { StorefrontThemeBinaryFileDTO } from "@/lib/storefront/dto/storefront-theme-file.dto";
import { themePublicUrlPath } from "@/lib/storefront/theme-public-files";
import { formatBytes } from "@/lib/utils";
import { FileImage, FileType } from "lucide-react";

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
 * Binary files are stored bytes, not source: Monaco has nothing to open and
 * nothing here may write them. The panel says what the file is and where the
 * storefront serves it, from metadata alone — the bytes are never fetched.
 */
export function EditorCodeBinaryFile({
  file,
}: {
  file: StorefrontThemeBinaryFileDTO;
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
        <p className="mt-3 text-muted-foreground">
          A binary file is read-only in the Code workspace. It cannot be
          renamed, moved, copied or deleted here yet.
        </p>
      </div>
    </div>
  );
}
