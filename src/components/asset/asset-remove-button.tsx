import { XIcon } from "lucide-react";

interface AssetRemoveButtonProps {
  onRemove?: () => void;
  label?: string;
}

export const AssetRemoveButton = ({
  onRemove,
  label = "Remove asset",
}: AssetRemoveButtonProps) =>
  onRemove ? (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onRemove();
      }}
      className="absolute right-1 top-1 z-30 flex size-6 items-center justify-center rounded-md bg-background/80 text-destructive"
      aria-label={label}
    >
      <XIcon className="size-4" />
    </button>
  ) : null;
