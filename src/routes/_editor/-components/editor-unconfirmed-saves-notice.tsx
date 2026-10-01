import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AlertTriangle, LoaderCircle } from "lucide-react";

/**
 * A save went out and no answer came back: the connection dropped, or the
 * answer was cut off on the way.
 *
 * It may have landed, so nothing more is sent on its own. Checking asks the
 * server what it holds first: what arrived is recorded as saved, and only
 * what did not is sent, once. Kept apart from `EditorWritesPausedNotice`: a
 * dropped connection says nothing about who is signed in.
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
          The connection dropped while saving. It is not known whether{" "}
          {count === 1 ? "that save" : `${count} saves`} arrived.
        </p>
        <p className="text-muted-foreground">
          Your changes are kept in this tab, and nothing more is sent until you
          check. Checking asks the server first: what arrived stays saved, and
          only the rest is sent.
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
