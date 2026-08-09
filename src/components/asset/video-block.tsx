import { MaximizeButton } from "@/components/button/maximize-button";
import { FileTIcon } from "@/components/ui/icons/file-t-icon";
import { cn } from "@/lib/utils";
import { Film } from "lucide-react";
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

export const VideoUploadBlock = ({
  src,
  alt,
  className,
  name,
  category,
  onRemove,
}: Props) => (
  <div
    className={cn(
      "group relative aspect-square overflow-hidden rounded-md border border-dashed bg-card",
      className,
    )}
  >
    {src ? (
      <video
        src={src}
        aria-label={alt}
        muted
        preload="metadata"
        className="size-full object-cover"
      />
    ) : (
      <Film className="absolute left-1/2 top-1/2 size-10 -translate-x-1/2 -translate-y-1/2" />
    )}
    <AssetCardCaption name={name} category={category} variant="subtle" />
    <AssetRemoveButton onRemove={onRemove} label="Remove video" />
  </div>
);

export const VideoBlock = ({
  src,
  alt,
  className,
  name,
  category,
  onRemove,
}: Props) => (
  <div
    className={cn(
      "group relative aspect-square overflow-hidden rounded-md border border-dashed bg-card",
      className,
    )}
  >
    {src ? (
      // Show the first frame so videos are identifiable at a glance.
      // The "#t=0.1" fragment nudges the browser to render a real frame
      // instead of a blank poster.
      <video
        src={`${src}#t=0.1`}
        aria-label={alt}
        muted
        playsInline
        preload="metadata"
        className="size-full object-cover"
      />
    ) : (
      <div className="flex size-full items-center justify-center pb-10">
        <FileTIcon className="size-28" />
      </div>
    )}
    <AssetCardCaption name={name} category={category} variant="subtle" />
    <AssetRemoveButton onRemove={onRemove} label="Remove video" />
  </div>
);

export const VideoPropertyBlock = ({
  className,
  src,
  onMaximize,
}: {
  className?: string;
  extension?: string;
  src?: string;
  duration?: number;
  onMaximize?: () => void;
}) => (
  <div className={cn("relative size-full", className)}>
    <video
      src={src}
      controls
      preload="metadata"
      className="size-full object-contain"
    />
    <div className="absolute bottom-3 right-3">
      <MaximizeButton onMaximize={onMaximize} />
    </div>
  </div>
);

export const VideoSmBlock = ({
  className,
  extension,
}: {
  className?: string;
  extension?: string;
}) => <FileTIcon className={cn(className, "size-7")} extension={extension} />;

export const VideoPreviewBlock = ({
  src,
  alt,
  className,
  onMaximize,
}: {
  src: string;
  alt?: string;
  className?: string;
  onMaximize?: () => void;
}) => (
  <div
    className={cn(
      "relative flex size-full items-center justify-center",
      className,
    )}
  >
    <video
      src={src}
      aria-label={alt}
      controls
      preload="metadata"
      className="size-full object-contain"
    />
    <div className="absolute bottom-3 right-3">
      <MaximizeButton onMaximize={onMaximize} />
    </div>
  </div>
);
