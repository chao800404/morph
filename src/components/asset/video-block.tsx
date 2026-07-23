import { MaximizeButton } from "@/components/button/maximize-button";
import { FileTIcon } from "@/components/ui/icons/file-t-icon";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import { Film, XIcon } from "lucide-react";

type Props = {
  src: string;
  alt: string;
  name?: string;
  className?: string;
  category?: string;
  onRemove?: () => void;
};

const RemoveButton = ({ onRemove }: { onRemove?: () => void }) =>
  onRemove ? (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onRemove();
      }}
      className="absolute right-1 top-1 z-30 flex size-6 items-center justify-center rounded-md bg-background/80 text-destructive"
      aria-label="Remove video"
    >
      <XIcon className="size-4" />
    </button>
  ) : null;

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
    {(name || category) && (
      <div className="absolute bottom-1 left-1 right-1 flex gap-2 rounded-md bg-card/70 p-2 text-xs">
        <p className="truncate">{name}</p>
        {category && <Kbd className="ml-auto">{category}</Kbd>}
      </div>
    )}
    <RemoveButton onRemove={onRemove} />
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
    {(name || category) && (
      <div className="absolute bottom-1 left-1 right-1 flex gap-2 rounded-md bg-card/70 p-2 text-xs">
        <p className="truncate">{name}</p>
        {category && <Kbd className="ml-auto">{category}</Kbd>}
      </div>
    )}
    <RemoveButton onRemove={onRemove} />
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
