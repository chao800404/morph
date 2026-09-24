import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AlertTriangle, LoaderCircle } from "lucide-react";

const MAX_LISTED = 3;

/**
 * Edits this tab could not save because the Theme moved on elsewhere.
 *
 * A save is refused when another tab or person saved to the Theme first. The
 * refusal said so in a toast that vanished in seconds, with one button
 * labelled "Accept Remote" — which reads as taking their version over yours,
 * while what it did was let your edits be saved on top. The edits were never
 * lost; the author just could not tell.
 *
 * So the state stays on screen until it is resolved, and says plainly that
 * the edits are still here and not yet saved. Saving them is still checked
 * file by file: a file the other side also changed comes back as a conflict,
 * with its own choice between their version and yours.
 */
export function EditorSourceConflictNotice({
  paths,
  saving,
  onSave,
  className,
}: {
  paths: readonly string[];
  saving: boolean;
  onSave: () => void;
  className?: string;
}) {
  if (paths.length === 0) return null;
  const listed = paths
    .slice(0, MAX_LISTED)
    .map((path) => path.split("/").pop());
  const more = paths.length - listed.length;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-center gap-3 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs",
        className,
      )}
    >
      <AlertTriangle
        className="size-4 shrink-0 text-amber-500"
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-foreground">
          Remote source changes detected in this theme
        </p>
        <p className="truncate text-muted-foreground" title={paths.join(", ")}>
          Your changes to {listed.join(", ")}
          {more > 0 ? ` and ${more} more` : ""} are still here in this tab, but
          not saved yet.
        </p>
      </div>
      <Button
        type="button"
        size="xs"
        variant="form"
        disabled={saving}
        onClick={onSave}
      >
        {saving ? (
          <>
            <LoaderCircle className="size-3.5 animate-spin" />
            Saving…
          </>
        ) : (
          "Save my changes"
        )}
      </Button>
    </div>
  );
}
