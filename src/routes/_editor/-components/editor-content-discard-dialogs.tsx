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

/**
 * The two ways out of a list both writers changed, and what each says it
 * discards. The shell decides which applies to a held list
 * (`listDiscardIsPathScoped`) and whether an unanswered write touches what
 * would be discarded; these only ask, and refuse the press while it does.
 */

/** Confirms discarding one list, through the control beside it. */
export function ListDiscardDialog({
  target,
  hasUnconfirmedWrite,
  hasSavedChange,
  discarding,
  onOpenChange,
  onConfirm,
}: {
  target: { sectionLabel: string; fieldPath: string } | null;
  /** An unanswered write touches this list: its outcome decides first. */
  hasUnconfirmedWrite: boolean;
  /** A write of this list landed earlier; the discard leaves it saved. */
  hasSavedChange: boolean;
  discarding: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={target !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Discard changes to this list?</AlertDialogTitle>
          <AlertDialogDescription>
            Someone else changed {target?.fieldPath} in {target?.sectionLabel}.
            This discards only your unsaved changes to this list and loads its
            latest version. Other fields and lists will stay.
            {hasSavedChange ? <> A saved change is not undone.</> : null}
            {hasUnconfirmedWrite ? (
              <> Check and save first; this list has an unconfirmed write.</>
            ) : null}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep my changes</AlertDialogCancel>
          <AlertDialogAction
            disabled={discarding || hasUnconfirmedWrite}
            onClick={(event) => {
              // Kept open while the latest Document loads; the list status
              // then disables a second discard for that path.
              event.preventDefault();
              if (discarding || hasUnconfirmedWrite) return;
              onConfirm();
            }}
          >
            Discard list changes and load latest
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export type SectionDiscardScope = Readonly<{
  sectionLabel: string;
  /** The held lists both writers changed, which have no list-only discard. */
  lists: readonly string[];
  /** Every top-level field of the section with unsaved changes. */
  fields: readonly string[];
}>;

/**
 * Confirms "Discard mine": every unsaved change of the named sections goes,
 * where a held list has no discard of its own (an undeclared list, a section
 * on another page, one the Content panel refuses, one with no stored copy).
 */
export function SectionDiscardDialog({
  open,
  sections,
  hasUnconfirmedWrite,
  hasSavedChange,
  discarding,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  sections: readonly SectionDiscardScope[];
  hasUnconfirmedWrite: boolean;
  hasSavedChange: boolean;
  discarding: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const changed = sections
    .map((section) => `${section.lists.join(", ")} in ${section.sectionLabel}`)
    .join("; ");
  const discarded = sections
    .map(
      (section) =>
        `${section.sectionLabel}${section.fields.length > 0 ? ` (${section.fields.join(", ")})` : ""}`,
    )
    .join("; ");
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Discard your unsaved changes?</AlertDialogTitle>
          <AlertDialogDescription>
            Someone else changed {changed} since you edited it, so your version
            cannot be saved over theirs, and{" "}
            {sections.length === 1 ? "this list has" : "these lists have"} no
            list-only discard here. This discards all of your unsaved changes to{" "}
            {discarded} and loads the latest version. Other sections keep their
            changes. This cannot be undone.
            {hasSavedChange ? <> A saved change is not undone.</> : null}
            {hasUnconfirmedWrite ? (
              <>
                {" "}
                Check and save first; one of these sections has an unconfirmed
                write.
              </>
            ) : null}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep my changes</AlertDialogCancel>
          <AlertDialogAction
            disabled={discarding || hasUnconfirmedWrite}
            onClick={(event) => {
              event.preventDefault();
              if (discarding || hasUnconfirmedWrite) return;
              onConfirm();
            }}
          >
            Discard and load latest
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
