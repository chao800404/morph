import { cn } from "@/lib/utils";
import { MaximizeButton } from "../button/maximize-button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { AssetCardCaption } from "./asset-card-caption";
import { AssetRemoveButton } from "./asset-remove-button";

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

      <AssetCardCaption name={name} category={category} variant="subtle" />

      <AssetRemoveButton onRemove={onRemove} label="Remove image" />
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
      <AssetCardCaption name={name} category={category} />
      <AssetRemoveButton onRemove={onRemove} label="Remove image" />
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
      <img className="size-full object-contain" alt={alt} src={src} />
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
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            "border w-6 h-8 rounded-[4px] relative bg-component overflow-hidden",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            className,
          )}
          tabIndex={0}
        >
          <img
            className="size-full object-cover object-center"
            alt={alt}
            src={src}
            draggable={false}
          />
        </div>
      </TooltipTrigger>
      <TooltipContent
        side="right"
        align="center"
        sideOffset={12}
        collisionPadding={16}
        hasArrow={false}
        className="size-[150px] overflow-hidden border bg-card p-0.5 text-card-foreground"
        style={{
          boxShadow: "var(--table-image-preview-shadow)",
        }}
      >
        <div
          className="size-full overflow-hidden rounded-[calc(var(--radius-md)-2px)]"
          style={{ background: "var(--gradient-checker-board)" }}
        >
          <img
            className="size-full object-contain object-center"
            alt=""
            src={src}
            draggable={false}
          />
        </div>
      </TooltipContent>
    </Tooltip>
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
        <img src={src} alt={alt} className="size-full object-contain" />
        <div className="absolute bottom-2 right-2 z-20">
          <MaximizeButton onMaximize={onMaximize} />
        </div>
      </div>
    </div>
  );
};
