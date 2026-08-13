import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface AssetCardCaptionProps {
  name?: string;
  category?: string;
  variant?: "default" | "subtle";
}

/** Keeps long names truncating without ever compressing the file-type badge. */
export const AssetCardCaption = ({
  name,
  category,
  variant = "default",
}: AssetCardCaptionProps) => {
  if (!name && !category) return null;

  if (!name) {
    return (
      <Badge className="absolute bottom-2 right-2 shrink-0 border-primary bg-primary text-primary-foreground shadow-sm">
        {category}
      </Badge>
    );
  }

  return (
    <div
      className={cn(
        "absolute bottom-1 left-1 right-1 flex items-center gap-2 rounded-md text-xs",
        variant === "default"
          ? "bg-card/50 p-3 text-white shadow-elevation-modal"
          : "bg-card/70 p-2",
      )}
    >
      <p className="min-w-0 flex-1 truncate">{name}</p>
      {category ? <Badge className="ml-auto shrink-0">{category}</Badge> : null}
    </div>
  );
};
