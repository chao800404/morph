import {
    VideoPlayer,
    VideoPlayerContent,
    VideoPlayerControlBar,
    VideoPlayerPlayButton,
    VideoPlayerTimeRange,
} from "@/components/kibo-ui/video-player";
import { FileTIcon } from "@/components/ui/icons/file-t-icon";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import { Film, XIcon } from "lucide-react";
import { MaximizeButton } from "../../button/maximize-button";

type Props = {
    src: string;
    alt: string;
    name?: string;
    className?: string;
    category?: string;
    onRemove?: () => void;
};

export const VideoUploadBlock = ({ src, alt, className, name, category, onRemove }: Props) => {
    return (
        <div
            className={cn(
                "relative border border-dashed bg-card shadow-sm dark:shadow-sm/50 aspect-square overflow-hidden rounded-md group",
                className
            )}
        >
            <div className="size-full flex items-center justify-center relative">
                <VideoPlayer className="overflow-hidden">
                    <VideoPlayerContent
                        className="object-cover w-full h-full object-center"
                        crossOrigin=""
                        muted
                        preload="auto"
                        slot="media"
                        src={src}
                    />
                </VideoPlayer>
                <div className="absolute top-0 left-0 right-0 bottom-0 z-20 bg-zinc-900/80 flex items-center justify-center">
                    <Film className="size-10 opacity-80" />
                </div>
            </div>
            {onRemove && (
                <div
                    onClick={e => {
                        e.stopPropagation();
                        onRemove();
                    }}
                    className="absolute top-1 right-1 size-5 cursor-pointer rounded-md-plus shadow-sm shadow-background bg-zinc-400/50 text-destructive-foreground flex items-center justify-center transition-opacity z-30"
                    aria-label="Remove image"
                >
                    <XIcon className="size-4" />
                </div>
            )}
        </div>
    );
};

export const VideoBlock = ({ src, alt, className, name, category, onRemove }: Props) => {
    return (
        <div
            className={cn(
                "relative border border-dashed bg-card shadow-sm dark:shadow-sm/50 aspect-square overflow-hidden rounded-md group",
                className
            )}
        >
            <div className="size-full flex items-center justify-center">
                <div className="size-32 opacity-90 mb-10 flex items-center justify-center">
                    <FileTIcon className="size-28" />
                </div>
            </div>
            {(name || category) && (
                <div className="absolute gap-2 flex p-3 bg-card/50 rounded-md shadow-elevation-modal bottom-1 left-1 right-1 text-xs text-white">
                    <p className="truncate">{name}</p>
                    {category && <Kbd className="ml-auto">{category}</Kbd>}
                </div>
            )}
            {onRemove && (
                <div
                    onClick={e => {
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

export const VideoPropertyBlock = ({
    className,
    extension,
    src,
    duration,
    onMaximize,
}: {
    className?: string;
    extension?: string;
    src?: string;
    duration?: number;
    onMaximize?: () => void;
}) => {
    return (
        <div
            onDoubleClick={onMaximize}
            style={{ background: "var(--gradient-checker-board)" }}
            className={cn("relative z-10 w-full h-full", className)}
        >
            <VideoPlayer className="overflow-hidden border-b h-full w-full object-contain">
                <VideoPlayerContent crossOrigin="" muted preload="auto" slot="media" src={src} />
                <VideoPlayerControlBar>
                    <VideoPlayerPlayButton className="rounded-full absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                    <VideoPlayerTimeRange className="border-none bg-transparent" />
                    <MaximizeButton onMaximize={onMaximize} classNames={{ buttonClassName: "pr-2" }} />
                </VideoPlayerControlBar>
            </VideoPlayer>
        </div>
    );
};

export const VideoSmBlock = ({ className, extension }: { className?: string; extension?: string }) => {
    return <FileTIcon className={cn(className, "size-7")} extension={extension} />;
};

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
}) => {
    return (
        <div onDoubleClick={onMaximize} className={cn("flex items-center justify-center w-full h-full", className)}>
            <VideoPlayer className="overflow-hidden border h-full w-full object-contain">
                <VideoPlayerContent crossOrigin="" muted preload="auto" slot="media" src={src} />
                <VideoPlayerControlBar>
                    <VideoPlayerPlayButton className="rounded-full absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                    <VideoPlayerTimeRange className="border-none bg-transparent" />
                    <MaximizeButton onMaximize={onMaximize} classNames={{ buttonClassName: "pr-2" }} />
                </VideoPlayerControlBar>
            </VideoPlayer>
        </div>
    );
};
