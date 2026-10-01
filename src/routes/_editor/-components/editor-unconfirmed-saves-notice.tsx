import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AlertTriangle, LoaderCircle } from "lucide-react";

/**
 * Why a step that would send a save is held while a save is unanswered.
 *
 * Shared by every place that stops: publishing, switching modes, a
 * structural edit, and the save paths themselves.
 */
export const UNCONFIRMED_SAVE_HOLD =
  "It could not be confirmed whether an earlier save was stored. Your changes are kept. Use Check and save first.";

/**
 * A save went out and no answer came back: the connection dropped, the
 * answer was cut off on the way, or the server failed without saying why.
 *
 * It may have been stored, so nothing more is sent until the author checks.
 * Checking asks the server what it holds first: what was stored stays saved,
 * and only what was not is sent, once. Kept apart from
 * `EditorWritesPausedNotice`: an unanswered save says nothing about who is
 * signed in.
 */
export function EditorUnconfirmedSavesNotice({
  count,
  checking,
  onCheck,
  className,
}: {
  /** Files and sections whose last save was not answered. */
  count: number;
  checking: boolean;
  onCheck: () => void;
  className?: string;
}) {
  if (count === 0) return null;

  return (
    <div
      role="alert"
      className={cn(
        "flex items-center gap-3 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs",
        className,
      )}
      data-editor-unconfirmed-saves={count}
    >
      <AlertTriangle
        className="size-4 shrink-0 text-amber-500"
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-foreground">
          Could not confirm whether{" "}
          {count === 1 ? "a change was" : `${count} changes were`} saved. Your
          changes are kept.
        </p>
        <p className="text-muted-foreground">
          Nothing more is sent, and publishing waits, until you check. Checking
          asks the server first: what was stored stays saved, and only the rest
          is sent.
        </p>
      </div>
      <Button
        type="button"
        size="xs"
        variant="form"
        disabled={checking}
        onClick={onCheck}
      >
        {checking ? (
          <>
            <LoaderCircle className="size-3.5 animate-spin" />
            Checking…
          </>
        ) : (
          "Check and save"
        )}
      </Button>
    </div>
  );
}
