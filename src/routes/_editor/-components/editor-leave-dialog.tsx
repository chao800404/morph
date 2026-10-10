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
import { buttonVariants } from "@/components/ui/button";
import type { EditorLeavePrompt } from "@/lib/storefront/editor/editor-leave-guard";
import { LoaderCircle } from "lucide-react";

/**
 * The question a navigation asks while it waits on unsaved edits.
 *
 * Two promises it keeps: the author is never stuck — staying and going are
 * both always offered — and it never says the edits will be saved. Going
 * from a page switch keeps them in this tab; going from the editor loses
 * whatever was not stored, and says so.
 */
export function EditorLeaveDialog({
  prompt,
  onStay,
  onLeave,
}: {
  prompt: EditorLeavePrompt | null;
  onStay: () => void;
  onLeave: () => void;
}) {
  const leaving = prompt?.kind === "leave-editor";
  const saving = prompt?.phase === "saving";

  return (
    <AlertDialog
      open={prompt !== null}
      onOpenChange={(open) => {
        // Escape is staying.
        if (!open) onStay();
      }}
    >
      <AlertDialogContent
        data-editor-leave-prompt={prompt?.phase}
        data-editor-leave-kind={prompt?.kind}
      >
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            {saving ? (
              <>
                <LoaderCircle
                  className="size-4 animate-spin text-primary"
                  aria-hidden="true"
                />
                Saving your changes…
              </>
            ) : (
              "Your changes were not saved"
            )}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {saving
              ? leaving
                ? "You will leave as soon as they are saved. Leaving now loses whatever has not been saved yet."
                : "The page will switch as soon as they are saved."
              : prompt?.phase === "not-saved"
                ? `${prompt.reason} ${
                    leaving
                      ? "If you leave now, they are lost."
                      : "If you switch now, they stay unsaved in this tab."
                  }`
                : null}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onStay}>Stay here</AlertDialogCancel>
          <AlertDialogAction
            className={
              leaving ? buttonVariants({ variant: "destructive" }) : undefined
            }
            onClick={onLeave}
          >
            {leaving
              ? saving
                ? "Leave without saving"
                : "Leave and discard"
              : saving
                ? "Switch without waiting"
                : "Switch anyway"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
