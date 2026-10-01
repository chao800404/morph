import { Button } from "@/components/ui/button";
import type { EditorWriteGate } from "@/lib/storefront/editor/editor-write-gate";
import { cn } from "@/lib/utils";
import { AlertTriangle, LoaderCircle } from "lucide-react";

/**
 * The editor has stopped saving because of who is (or is not) signed in.
 *
 * Shown in the place of `EditorSourceConflictNotice` and in the same shape,
 * but a separate notice: signing in again does not settle a Theme that moved
 * on elsewhere, so the two are never folded into one message or one button.
 *
 * It says what is true at each step — nothing is being saved, the changes are
 * still here, and only in this tab — and offers the one next step:
 *
 * - signed out: sign in (in another tab, so this one keeps its changes), then
 *   check again;
 * - checked, same account: save the changes — only now, on this press;
 * - checked, another account: nothing can be saved as that account;
 * - no permission: nothing can be saved; checking again is how to find out
 *   once it has been granted.
 */
export function EditorWritesPausedNotice({
  gate,
  unsavedCount,
  saving,
  onSignIn,
  onCheckAgain,
  onSave,
  className,
}: {
  gate: EditorWriteGate;
  /** Files and sections whose changes are kept here, unsaved. */
  unsavedCount: number;
  saving: boolean;
  onSignIn: () => void;
  onCheckAgain: () => void;
  onSave: () => void;
  className?: string;
}) {
  if (!gate.signedOut && gate.denied.length === 0) return null;

  const kept =
    unsavedCount > 0
      ? `${unsavedCount} unsaved ${unsavedCount === 1 ? "change is" : "changes are"} kept in this tab only — reloading or closing it loses them.`
      : "Nothing unsaved is waiting.";
  const checking = gate.recovery === "verifying";

  let title: string;
  let detail: string;
  let action: "sign-in" | "check" | "save" | null;
  if (gate.recovery === "verified") {
    title = "Signed in again. Your changes are not saved yet.";
    detail = `${kept} Save them to check them against the Theme as it is now.`;
    action = "save";
  } else if (gate.recovery === "different-account") {
    title = "A different account is signed in.";
    detail = `Changes made here cannot be saved as another account. ${kept}`;
    action = "check";
  } else if (gate.signedOut) {
    title =
      gate.recovery === "still-signed-out"
        ? "Still not signed in. Nothing is being saved."
        : "Your sign-in has expired. Nothing is being saved.";
    detail = `${kept} Sign in again in a new tab, then check again here.`;
    action = "sign-in";
  } else {
    title = "Your account cannot change this Theme. Nothing is being saved.";
    detail = kept;
    action = "check";
  }

  return (
    <div
      role="alert"
      className={cn(
        "flex items-center gap-3 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs",
        className,
      )}
      data-editor-writes-paused={gate.recovery}
    >
      <AlertTriangle
        className="size-4 shrink-0 text-amber-500"
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-foreground">{title}</p>
        <p className="text-muted-foreground">{detail}</p>
      </div>
      {action === "sign-in" ? (
        <Button type="button" size="xs" variant="outline" onClick={onSignIn}>
          Sign in in a new tab
        </Button>
      ) : null}
      {action === "sign-in" || action === "check" ? (
        <Button
          type="button"
          size="xs"
          variant="form"
          disabled={checking}
          onClick={onCheckAgain}
        >
          {checking ? (
            <>
              <LoaderCircle className="size-3.5 animate-spin" />
              Checking…
            </>
          ) : (
            "Check again"
          )}
        </Button>
      ) : null}
      {action === "save" ? (
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
      ) : null}
    </div>
  );
}
