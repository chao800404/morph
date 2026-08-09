import { FluentFolderIcon } from "@/components/ui/icons/fluent-folder-icon";
import { cn } from "@/lib/utils";
import { XIcon } from "lucide-react";
import { AssetCardCaption } from "./asset-card-caption";

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
                "relative border border-dashed bg-card shadow-xs dark:shadow-xs/50 aspect-square overflow-hidden rounded-md group",
                className
            )}
        >
            <div className="size-full flex items-center justify-center">
                <div className="size-24 opacity-95 mb-6 flex items-center justify-center">
                    <FluentFolderIcon />
                </div>
            </div>
            <AssetCardCaption name={name} category={category} />
            {onRemove && (
                <div
                    onClick={e => {
                        e.stopPropagation();
                        onRemove();
                    }}
                    className="absolute top-1 right-1 size-5 cursor-pointer rounded-md-plus shadow-xs shadow-background bg-zinc-400/50 text-destructive-foreground flex items-center justify-center transition-opacity"
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
            <FluentFolderIcon className="size-24" />
        </div>
    );
};
