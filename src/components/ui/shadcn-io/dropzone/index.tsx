"use client";

import { cn } from "@/lib/utils";
import { UploadIcon } from "lucide-react";
import type { ReactNode } from "react";
import { createContext, useContext } from "react";
import type { DropEvent, DropzoneOptions, FileRejection } from "react-dropzone";
import { useDropzone } from "react-dropzone";
import { fieldControlVariants } from "../../field-control";

type DropzoneContextType = {
  src?: File[];
  accept?: DropzoneOptions["accept"];
  maxSize?: DropzoneOptions["maxSize"];
  minSize?: DropzoneOptions["minSize"];
  maxFiles?: DropzoneOptions["maxFiles"];
};

const renderBytes = (bytes: number) => {
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(2)}${units[unitIndex]}`;
};

const DropzoneContext = createContext<DropzoneContextType | undefined>(
  undefined,
);

export type DropzoneProps = Omit<DropzoneOptions, "onDrop"> & {
  src?: File[];
  className?: string;
  onDrop?: (
    acceptedFiles: File[],
    fileRejections: FileRejection[],
    event: DropEvent,
  ) => void;
  children?: ReactNode;
  error?: boolean;
  variant?: "default" | "card";
  inputId?: string;
  inputAriaRequired?: boolean;
  inputAriaDescribedBy?: string;
};

export const Dropzone = ({
  accept,
  maxFiles = 1,
  maxSize,
  minSize,
  onDrop,
  onError,
  disabled,
  src,
  className,
  children,
  error,
  variant = "default",
  inputId,
  inputAriaRequired,
  inputAriaDescribedBy,
  ...props
}: DropzoneProps) => {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept,
    maxFiles,
    maxSize,
    minSize,
    onError,
    disabled,
    onDrop: (acceptedFiles, fileRejections, event) => {
      if (fileRejections.length > 0) {
        const message = fileRejections.at(0)?.errors.at(0)?.message;
        onError?.(new Error(message));
        return;
      }

      onDrop?.(acceptedFiles, fileRejections, event);
    },
    ...props,
  });

  return (
    <DropzoneContext.Provider
      key={JSON.stringify(src)}
      value={{ src, accept, maxSize, minSize, maxFiles }}
    >
      <div
        data-error={error ? "true" : undefined}
        data-disabled={disabled ? "true" : undefined}
        aria-invalid={error || undefined}
        className={cn(
          fieldControlVariants({ variant }),
          "relative flex min-h-[140px] w-full cursor-pointer select-none flex-col items-center justify-center border-dashed p-4 text-center",
          "data-[error=true]:bg-destructive/5",
          isDragActive &&
            "border-primary bg-primary/5 ring-2 ring-primary/20 dark:bg-primary/10",
          className,
        )}
        {...getRootProps()}
      >
        <input
          {...getInputProps({
            id: inputId,
            "aria-required": inputAriaRequired || undefined,
            "aria-describedby": inputAriaDescribedBy,
            "aria-invalid": error || undefined,
          })}
          disabled={disabled}
        />
        {children}
      </div>
    </DropzoneContext.Provider>
  );
};

const useDropzoneContext = () => {
  const context = useContext(DropzoneContext);

  if (!context) {
    throw new Error("useDropzoneContext must be used within a Dropzone");
  }

  return context;
};

export type DropzoneContentProps = {
  children?: ReactNode;
  className?: string;
};

const maxLabelItems = 3;

export const DropzoneContent = ({
  children,
  className,
}: DropzoneContentProps) => {
  const { src } = useDropzoneContext();

  if (!src) {
    return null;
  }

  if (children) {
    return children;
  }

  return (
    <div className={cn("flex flex-col items-center justify-center gap-1", className)}>
      <div className="mb-1 flex size-9 items-center justify-center rounded-md-plus bg-primary/10 text-primary">
        <UploadIcon size={18} />
      </div>
      <p className="w-full truncate text-sm font-medium text-foreground">
        {src.length > maxLabelItems
          ? `${new Intl.ListFormat("en").format(
              src.slice(0, maxLabelItems).map((file) => file.name),
            )} and ${src.length - maxLabelItems} more`
          : new Intl.ListFormat("en").format(src.map((file) => file.name))}
      </p>

      <p className="w-full text-xs text-muted-foreground">
        Drag and drop or click to replace
      </p>
    </div>
  );
};

export type DropzoneEmptyStateProps = {
  children?: ReactNode;
  className?: string;
};

export const DropzoneEmptyState = ({
  children,
  className,
}: DropzoneEmptyStateProps) => {
  const { src, accept, maxSize, minSize: _minSize, maxFiles } = useDropzoneContext();

  if (src && src.length > 0) {
    return null;
  }

  if (children) {
    return children;
  }

  let acceptSummary = "";
  if (accept) {
    const types = Object.keys(accept);
    const categories: string[] = [];
    const hasImages = types.some((t) => t.startsWith("image/"));
    const hasVideos = types.some((t) => t.startsWith("video/"));
    const hasAudio = types.some((t) => t.startsWith("audio/"));

    if (hasImages) categories.push("Images");
    if (hasVideos) categories.push("Videos");
    if (hasAudio) categories.push("Audio");

    // Collect custom extensions (e.g. .riv)
    const customExts: string[] = [];
    Object.entries(accept).forEach(([mime, exts]) => {
      if (
        !mime.startsWith("image/") &&
        !mime.startsWith("video/") &&
        !mime.startsWith("audio/")
      ) {
        exts.forEach((ext) => customExts.push(ext.toUpperCase()));
      }
    });

    const allList = [...categories, ...customExts];
    if (allList.length > 0) {
      acceptSummary = allList.join(", ");
    }
  }

  const limitParts: string[] = [];
  if (maxFiles && maxFiles > 1) {
    limitParts.push(`Max ${maxFiles} files`);
  }
  if (maxSize) {
    limitParts.push(`up to ${renderBytes(maxSize)}`);
  }
  const limitText = limitParts.join(", ");

  return (
    <div className={cn("flex flex-col items-center justify-center gap-1 text-center w-full", className)}>
      <div className="mb-1 flex size-10 items-center justify-center rounded-md-plus bg-muted text-muted-foreground">
        <UploadIcon size={18} />
      </div>
      <p className="text-sm font-medium text-foreground">
        Upload {maxFiles === 1 ? "a file" : "files"}
      </p>
      <p className="text-xs text-muted-foreground">
        Drag & drop or click to upload
      </p>
      {(acceptSummary || limitText) && (
        <p className="mt-1 max-w-[85%] text-[11px] leading-relaxed text-muted-foreground/70">
          {acceptSummary ? `${acceptSummary}${limitText ? ` (${limitText})` : ""}` : limitText}
        </p>
      )}
    </div>
  );
};
