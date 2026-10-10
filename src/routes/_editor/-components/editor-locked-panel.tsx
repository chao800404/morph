import { Button } from "@/components/ui/button";
import {
  editorLockMessage,
  type EditorLockReason,
} from "@/lib/storefront/editor/editor-read-lock";
import { cn } from "@/lib/utils";
import { CloudOff, Lock } from "lucide-react";

/**
 * Stands where the editor was while it is closed (`resolveEditorLock`).
 *
 * Says why, and that the unsaved work is still kept. The way back is the
 * paused-writes notice above it — one place to check again from, not two.
 */
export function EditorLockedPanel({ reason }: { reason: EditorLockReason }) {
  const { title, detail } = editorLockMessage(reason);
  return (
    <div
      role="status"
      data-editor-locked={reason}
      className="col-start-1 row-start-3 z-20 flex items-center justify-center bg-background p-6"
    >
      <div className="max-w-md rounded-lg border bg-component p-6 text-center shadow-sm">
        <Lock
          className="mx-auto size-5 text-muted-foreground"
          aria-hidden="true"
        />
        <h2 className="mt-3 text-sm font-semibold">{title}</h2>
        <p className="mt-2 text-xs text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

/**
 * The editor could not read its Theme again, and is showing what it read
 * last. Nothing is decided from the failure: it is not a refusal, and no
 * write stops for it.
 */
export function EditorThemeReadNotice({
  failed,
  onRetry,
  className,
}: {
  failed: boolean;
  onRetry?: () => void;
  className?: string;
}) {
  if (!failed) return null;
  return (
    <div
      role="status"
      data-editor-theme-read="unavailable"
      className={cn(
        "flex items-center gap-3 border-b bg-muted/40 px-4 py-2 text-xs",
        className,
      )}
    >
      <CloudOff
        className="size-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <p className="min-w-0 flex-1 text-muted-foreground">
        Could not refresh this Theme. Showing what was last loaded.
      </p>
      {onRetry ? (
        <Button type="button" size="xs" variant="outline" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}
