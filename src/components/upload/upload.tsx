import {
  Dropzone,
  DropzoneContent,
  DropzoneEmptyState,
} from "@/components/ui/shadcn-io/dropzone";
import { extractVideoDuration } from "@/lib/config/video-duration";
import { cn, formatDuration, getFileExtension, getFileType } from "@/lib/utils";
import { useCallback, useMemo } from "react";

import { PlusIcon, X } from "lucide-react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import {
  selectError,
  selectFileData,
  useUploadStore,
} from "./_store/upload.store";
import type { UploadFieldRenderProps } from "./types";

const FILE_KEY = (file: File) =>
  `${file.name}-${file.size}-${file.lastModified}`;

interface UploadPreviewItemProps {
  src: string;
  alt: string;
  onRemove: () => void;
  className?: string;
  fileType: "image" | "video" | "audio" | "file" | "unknown";
  extension: string;
  duration?: number;
}

function UploadPreviewItem({
  src,
  alt,
  onRemove,
  className,
  fileType,
  extension,
  duration,
}: UploadPreviewItemProps) {
  const isVideo =
    fileType === "video" ||
    ["mp4", "webm", "mov", "ogg", "ogv"].includes(extension.toLowerCase());

  return (
    <div
      className={cn(
        "relative group overflow-hidden rounded-md border bg-background aspect-square",
        className,
      )}
    >
      {fileType === "image" ? (
        <img src={src} alt={alt} className="size-full object-cover" />
      ) : isVideo ? (
        <video
          src={src}
          aria-label={alt}
          muted
          playsInline
          preload="metadata"
          className="size-full object-cover"
          onMouseOver={(e) => {
            const v = e.currentTarget;
            v.play().catch(() => {});
          }}
          onMouseOut={(e) => {
            const v = e.currentTarget;
            v.pause();
            v.currentTime = 0;
          }}
        />
      ) : (
        <div className="flex flex-col items-center justify-center size-full bg-muted text-muted-foreground p-2 text-center">
          <span className="uppercase font-semibold text-xs mb-1">
            {extension}
          </span>
          <span className="text-[10px] truncate w-full px-1">{alt}</span>
        </div>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          onRemove();
        }}
        className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity bg-background/80 hover:bg-background rounded-full p-1 border shadow-sm z-10"
        type="button"
      >
        <X className="size-3" />
      </button>
      {duration ? (
        <span className="absolute bottom-1 right-1 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded font-mono z-10 backdrop-blur-xs">
          {formatDuration(duration)}
        </span>
      ) : null}
    </div>
  );
}

export const UploadField = ({
  field,
  fieldId,
  onChange,
  className,
}: UploadFieldRenderProps) => {
  const maxFiles = field.maxFiles ?? 10;

  // Use memoized selectors to avoid creating new arrays on every render
  const fileData = useUploadStore(
    useMemo(() => selectFileData(field.name), [field.name]),
  );
  const error = useUploadStore(
    useMemo(() => selectError(field.name), [field.name]),
  );
  const { setFileData, removeFile, setError } = useUploadStore(
    useShallow((state) => ({
      setFileData: state.setFileData,
      removeFile: state.removeFile,
      setError: state.setError,
    })),
  );

  const remainingSlots = useMemo(
    () => Math.max(maxFiles - fileData.length, 0),
    [fileData.length, maxFiles],
  );

  const handleDrop = useCallback(
    async (acceptedFiles: File[]) => {
      setError(field.name, null);
      const existing = new Set(fileData.map(({ file }) => FILE_KEY(file)));

      if (fileData.length >= maxFiles) {
        const errorMsg = `You can only upload up to ${maxFiles} files`;
        console.error("❌ [Upload Limit Exceeded]", errorMsg);
        setError(field.name, errorMsg);
        toast.error(errorMsg, { position: "top-center" });
        return;
      }

      const next = [...fileData];

      for (const file of acceptedFiles) {
        if (next.length >= maxFiles) {
          break;
        }
        const key = FILE_KEY(file);
        if (existing.has(key)) {
          continue;
        }

        // Extract duration for video files
        let duration: number | undefined;
        const videoExtensions = new Set([".mp4", ".webm", ".ogg", ".ogv", ".mov"]);
        const ext = `.${file.name.split(".").pop()?.toLowerCase()}`;
        if (file.type.startsWith("video/") || videoExtensions.has(ext)) {
          try {
            duration = await extractVideoDuration(file);
          } catch (error) {
            console.warn(`Failed to extract duration for ${file.name}:`, error);
          }
        }

        next.push({ file, preview: URL.createObjectURL(file), duration });
        existing.add(key);
      }

      // Store in Zustand
      setFileData(field.name, next);
      // Notify parent with all files
      onChange?.(next.map(({ file }) => file));
    },
    [maxFiles, onChange, field.name, setFileData, setError, fileData],
  );

  const handleRemove = useCallback(
    (index: number) => {
      // Remove from Zustand (also revokes URL)
      removeFile(field.name, index);
      // Get updated files and notify parent
      const updatedFiles = fileData
        .filter((_, i) => i !== index)
        .map(({ file }) => file);
      onChange?.(updatedFiles);
    },
    [field.name, removeFile, fileData, onChange],
  );

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {error && <p className="text-destructive text-sm font-normal">{error}</p>}
      <Dropzone
        accept={field.accept ?? { "image/*": [] }}
        maxFiles={maxFiles}
        maxSize={field.maxSize ?? 1024 * 1024 * 10}
        minSize={field.minSize}
        disabled={field.disabled}
        onDrop={handleDrop}
        onError={(error) => {
          const errorMsg = error.message ?? "Failed to upload file";
          console.error("❌ [Dropzone Error]", error);
          toast.error(errorMsg, { position: "top-center" });
          setError(field.name, errorMsg);
        }}
        src={fileData.map(({ file }) => file)}
        className={cn(field.inputClassName, "cursor-pointer")}
        error={error !== null}
        variant="card"
        inputId={fieldId}
        inputAriaRequired={field.required}
        inputAriaDescribedBy={
          field.description ? `${fieldId}-description` : undefined
        }
      >
        <DropzoneEmptyState />
        {fileData.length > 0 && (
          <DropzoneContent>
            <div className="grid grid-cols-6 gap-2 w-full">
              {fileData.map(({ file, preview, duration }, index) => {
                if (!preview) return null;

                // Use shared utility to determine file type
                const fileType = getFileType(file.type);

                // Get file extension (without dot)
                const extension = getFileExtension(file.name);

                return (
                  <UploadPreviewItem
                    key={index}
                    fileType={fileType}
                    extension={extension}
                    src={preview}
                    alt={file.name}
                    onRemove={() => handleRemove(index)}
                    className="first:row-span-2 first:col-span-2 col-span-1 row-span-1"
                    duration={duration}
                  />
                );
              })}
              {remainingSlots > 0 && (
                <div className="border-2 border-dashed aspect-square flex items-center justify-center overflow-hidden rounded-md border-muted-foreground/50 bg-component/50">
                  <PlusIcon className="size-6 text-muted-foreground/50" />
                </div>
              )}
            </div>
          </DropzoneContent>
        )}
      </Dropzone>
    </div>
  );
};
