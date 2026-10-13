import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import type { EditorLeavePrompt } from "@/lib/storefront/editor/editor-leave-guard";
import { LoaderCircle } from "lucide-react";

/**
 * The question a navigation asks while it waits on unsaved edits.
 *
 * Three promises it keeps: the author is never stuck — staying and going are
 * both always offered; it never says the edits will be saved; and it never
 * says a save already sent was not — going without waiting does not recall a
 * request, which may still be stored after the author left.
 *
 * Keeping a draft across a page switch keeps it in this tab's memory only:
 * nothing here is stored anywhere a reload could find it, and the words say
 * so rather than let "kept" read as "saved".
 */
export function EditorLeaveDialog({
  prompt,
  onStay,
  onLeave,
  onFinishEdit,
}: {
  prompt: EditorLeavePrompt | null;
  onStay: () => void;
  onLeave: () => void;
  onFinishEdit: () => void;
}) {
  const leaving = prompt?.kind === "leave-editor";
  const phase = prompt?.phase;

  const title =
    phase === "open-edit"
      ? "You are still editing text on the page"
      : phase === "saving"
        ? "Saving your changes…"
        : "Your changes were not saved";

  const description =
    phase === "open-edit"
      ? "Finish it to save it before going on, stay to keep editing, or discard what you typed there."
      : phase === "saving"
        ? leaving
          ? "You will leave as soon as they are saved. If you leave now, a save already sent may still be stored, but nothing more is sent; anything not sent yet is lost."
          : "The page will switch as soon as they are saved. If you switch now, the save already sent goes on; anything not sent yet stays in this editor tab, unsaved, and is lost if you reload or close it."
        : prompt?.phase === "not-saved"
          ? `${prompt.reason} ${
              leaving
                ? "If you leave now, they are lost."
                : "If you switch now, they stay in this editor tab, still unsaved, and are lost if you reload or close it."
            }`
          : null;

  const leaveLabel =
    phase === "open-edit"
      ? leaving
        ? "Discard text and leave"
        : "Discard text and switch"
      : phase === "saving"
        ? leaving
          ? "Leave without waiting"
          : "Switch without waiting"
        : leaving
          ? "Leave and discard"
          : "Switch, keep draft unsaved";

  return (
    <AlertDialog
      open={prompt !== null}
      onOpenChange={(open) => {
        // Escape is staying.
        if (!open) onStay();
      }}
    >
      <AlertDialogContent
        data-editor-leave-prompt={phase}
        data-editor-leave-kind={prompt?.kind}
      >
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            {phase === "saving" ? (
              <LoaderCircle
                className="size-4 animate-spin text-primary"
                aria-hidden="true"
              />
            ) : null}
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onStay}>Stay here</AlertDialogCancel>
          {phase === "open-edit" ? (
            // Not an AlertDialogAction: it must not close the dialog, which
            // goes on to show the save that finishing starts.
            <Button type="button" onClick={onFinishEdit}>
              Finish editing and continue
            </Button>
          ) : null}
          <AlertDialogAction
            className={
              leaving || phase === "open-edit"
                ? buttonVariants({ variant: "destructive" })
                : undefined
            }
            onClick={onLeave}
          >
            {leaveLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
