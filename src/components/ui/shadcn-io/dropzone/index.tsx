"use client";

import { cn } from "@/lib/utils";
import { UploadIcon } from "lucide-react";
import type { ReactNode } from "react";
import { createContext, useContext } from "react";
import type { DropEvent, DropzoneOptions, FileRejection } from "react-dropzone";
import { useDropzone } from "react-dropzone";

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
        className={cn(
          "relative flex flex-col items-center justify-center w-full min-h-[140px] p-6 rounded-xl cursor-pointer select-none text-center transition-all duration-200",
          "border border-dashed border-zinc-300 dark:border-zinc-700/80",
          "bg-zinc-50/60 dark:bg-zinc-800/30",
          "hover:bg-zinc-100/80 dark:hover:bg-zinc-800/60 hover:border-zinc-400 dark:hover:border-zinc-600",
          "data-[error=true]:border-destructive data-[error=true]:bg-destructive/5",
          "data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50",
          isDragActive && "border-primary bg-primary/5 dark:bg-primary/10 ring-2 ring-primary/20",
          className,
        )}
        {...getRootProps()}
      >
        <input {...getInputProps()} disabled={disabled} />
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
      <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary mb-1">
        <UploadIcon size={18} />
      </div>
      <p className="w-full truncate font-medium text-sm text-zinc-900 dark:text-zinc-100">
        {src.length > maxLabelItems
          ? `${new Intl.ListFormat("en").format(
              src.slice(0, maxLabelItems).map((file) => file.name),
            )} and ${src.length - maxLabelItems} more`
          : new Intl.ListFormat("en").format(src.map((file) => file.name))}
      </p>

      <p className="w-full text-xs text-zinc-500 dark:text-zinc-400">
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
      <div className="flex size-10 items-center justify-center rounded-lg bg-zinc-200/60 dark:bg-zinc-700/40 text-zinc-600 dark:text-zinc-300 mb-1">
        <UploadIcon size={18} />
      </div>
      <p className="font-medium text-sm text-zinc-900 dark:text-zinc-100">
        Upload {maxFiles === 1 ? "a file" : "files"}
      </p>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Drag & drop or click to upload
      </p>
      {(acceptSummary || limitText) && (
        <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-1 max-w-[85%] leading-relaxed">
          {acceptSummary ? `${acceptSummary}${limitText ? ` (${limitText})` : ""}` : limitText}
        </p>
      )}
    </div>
  );
};
