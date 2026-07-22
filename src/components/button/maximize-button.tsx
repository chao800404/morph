import { cn } from "@/lib/utils";
import { Maximize } from "lucide-react";

type Props = {
    onMaximize?: () => void;
    classNames?: {
        buttonClassName?: string;
        iconClassName?: string;
    };
};

export const MaximizeButton = ({ onMaximize, classNames }: Props) => {
    if (!onMaximize) return null;
    return (
        <button
            onClick={onMaximize}
            className={cn(
                "flex text-zinc-400 items-center cursor-pointer",
                "hover:text-zinc-200",
                classNames?.buttonClassName
            )}
            aria-label="Maximize video"
        >
            <Maximize className={cn("z-3", classNames?.iconClassName)} />
        </button>
    );
};
