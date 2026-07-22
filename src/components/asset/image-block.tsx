import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import { XIcon } from "lucide-react";
import Image from "next/image";
import { MaximizeButton } from "../button/maximize-button";

type Props = {
  src: string;
  alt: string;
  name?: string;
  className?: string;
  category?: string;
  onRemove?: () => void;
};

export const ImageUploadBlock = ({
  src,
  alt,
  className,
  name,
  category,
  onRemove,
}: Props) => {
  return (
    <div
      className={cn(
        "relative border border-dashed bg-card shadow-sm dark:shadow-sm/50 aspect-square overflow-hidden rounded-md group",
        className,
      )}
    >
      {src && src.length > 0 && (
        <img src={src} alt={alt} className="size-full object-cover" />
      )}

      {onRemove && (
        <div
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="absolute top-1 right-1 size-5 cursor-pointer rounded-md-plus shadow-sm shadow-background bg-zinc-400/50 text-destructive-foreground flex items-center justify-center transition-opacity"
          aria-label="Remove image"
        >
          <XIcon className="size-4" />
        </div>
      )}
    </div>
  );
};

export const ImageBlock = ({
  src,
  alt,
  className,
  name,
  category,
  onRemove,
}: Props) => {
  return (
    <div
      className={cn(
        "relative border border-dashed bg-card shadow-sm dark:shadow-sm/50 aspect-square overflow-hidden rounded-md group",
        className,
      )}
    >
      {src && src.length > 0 && (
        <img src={src} alt={alt} className="size-full object-cover" />
      )}
      {(name || category) && (
        <div className="absolute gap-2 flex p-3 bg-card/50 rounded-md shadow-elevation-modal bottom-1 left-1 right-1 text-xs text-white">
          <p className="truncate">{name}</p>
          {category && <Kbd className="ml-auto">{category}</Kbd>}
        </div>
      )}
      {onRemove && (
        <div
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="absolute top-1 right-1 size-5 cursor-pointer rounded-md-plus shadow-sm shadow-background bg-zinc-400/50 text-destructive-foreground flex items-center justify-center transition-opacity"
          aria-label="Remove image"
        >
          <XIcon className="size-4" />
        </div>
      )}
    </div>
  );
};

export const ImagePropertyBlock = ({
  src,
  alt,
  onMaximize,
  className,
}: {
  src: string;
  alt: string;
  onMaximize?: () => void;
  className?: string;
}) => {
  return (
    <div
      onDoubleClick={onMaximize}
      style={{ background: "var(--gradient-checker-board)" }}
      className={cn("relative z-10 w-full h-full", className)}
    >
      <Image className="object-contain" alt={alt} fill sizes="auto" src={src} />
      <div className="absolute h-[44px] bottom-0 right-0 pr-2 flex items-center">
        <MaximizeButton onMaximize={onMaximize} />
      </div>
    </div>
  );
};

export const ImageSmBlock = ({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) => {
  return (
    <div
      className={cn(
        "border w-6 h-8 rounded-sm relative bg-component overflow-hidden",
        className,
      )}
    >
      <Image fill className="object-cover" alt={alt} src={src} />
    </div>
  );
};

export const ImagePreviewBlock = ({
  src,
  alt,
  className,
  onMaximize,
}: {
  src: string;
  alt: string;
  className?: string;
  onMaximize?: () => void;
}) => {
  return (
    <div
      className={cn(
        "flex items-center justify-center w-full h-full",
        className,
      )}
    >
      <div className="relative w-full h-full">
        <Image
          src={src}
          alt={alt}
          fill
          className="object-contain"
          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 80vw, 70vw"
          priority
        />
        <div className="absolute bottom-2 right-2 z-20">
          <MaximizeButton onMaximize={onMaximize} />
        </div>
      </div>
    </div>
  );
};
