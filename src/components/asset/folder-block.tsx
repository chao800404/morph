import { FolderEmptyIcon } from "@/components/ui/icons/folder-empty-icon";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import { XIcon } from "lucide-react";

type Props = {
    className?: string;
    name?: string;
    onRemove?: () => void;
    category?: string;
};

export const FolderBlock = ({ className, name, onRemove, category }: Props) => {
    return (
        <div
            className={cn(
                "relative border border-dashed bg-card shadow-sm dark:shadow-sm/50 aspect-square overflow-hidden rounded-md group",
                className
            )}
        >
            <div className="size-full flex items-center justify-center">
                <div className="size-32 opacity-90 mb-10 flex items-center justify-center">
                    <FolderEmptyIcon />
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

export const FolderPropertyBlock = ({ className }: { className?: string }) => {
    return (
        <div className={cn("w-full h-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center", className)}>
            <FolderEmptyIcon className="size-32" />
        </div>
    );
};
