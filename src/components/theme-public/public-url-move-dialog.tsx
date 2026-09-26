import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { PublicUrlRewriteRequest } from "@/lib/storefront/editor/public-url-move-batch";
import type { PublicUrlMoveReview } from "@/lib/storefront/editor/public-url-move-review";
import type { PublicUrlScan } from "@/lib/storefront/editor/public-url-references";
import { PublicUrlReview, PublicUrlRewriteReview } from "./public-url-review";

/**
 * A move of `public/` files, held for the author before anything is written:
 * what the move changes, the references it updates and the ones it cannot,
 * and the choice between moving and copying. Code mode's Explorer and the
 * Assets page both show this one dialog; each writes its own batch from the
 * choice it reports.
 */

export type PublicUrlMoveReviewState = {
  /** The binary files moving, by path. */
  binaryMoves: ReadonlyArray<{ from: string; to: string }>;
  /** Whether source files move too; copying instead is offered only if not. */
  movesSource: boolean;
  /** The references the move can update, planned from the saved source. */
  rewrite: PublicUrlMoveReview["rewrite"];
  /** What names the URLs in the text as held, for when nothing is updated. */
  review: {
    changes: ReadonlyArray<{ from: string; to: string | null }>;
    scan: PublicUrlScan;
  };
  acknowledged: boolean;
};

export type PublicUrlMoveChoice = Readonly<{
  kind: "move" | "copy";
  /** Present when references follow the files; the server plans them again. */
  publicUrlRewrite?: PublicUrlRewriteRequest;
}>;

const referenceCount = (count: number) =>
  `${count} reference${count === 1 ? "" : "s"}`;

export function PublicUrlMoveDialog({
  review,
  onClose,
  onAcknowledgedChange,
  onChoose,
  pending = false,
}: {
  review: PublicUrlMoveReviewState | null;
  onClose: () => void;
  onAcknowledgedChange: (acknowledged: boolean) => void;
  onChoose: (choice: PublicUrlMoveChoice) => void;
  pending?: boolean;
}) {
  const rewrite = review?.rewrite.kind === "ready" ? review.rewrite : null;
  const updates = rewrite?.plan.rewrites.length ?? 0;
  const unresolved = rewrite?.plan.unresolved.length ?? 0;
  /**
   * Moving removes the old URLs. When something may still name them — a
   * reference the move cannot update, or, with no update at all, any
   * reference found — the author must say they accept it.
   */
  const needsAcknowledgement =
    review !== null &&
    (rewrite ? unresolved > 0 : review.review.scan.known.length > 0);
  /** Keeping the old files is the safer default while anything is unresolved. */
  const copyIsDefault = rewrite !== null && unresolved > 0;
  const rewriteRequest = (
    current: PublicUrlMoveReviewState,
    acknowledgeUnresolved: boolean,
  ): PublicUrlRewriteRequest | undefined =>
    current.rewrite.kind === "ready" && current.rewrite.plan.rewrites.length > 0
      ? {
          moves: current.binaryMoves.map((move) => ({ ...move })),
          expected: current.rewrite.summary,
          acknowledgeUnresolved,
        }
      : undefined;
  const choose = (kind: PublicUrlMoveChoice["kind"]) => {
    if (!review) return;
    // A copy keeps the old files, so their URLs keep working: nothing to
    // acknowledge.
    const publicUrlRewrite = rewriteRequest(
      review,
      kind === "move" && review.acknowledged,
    );
    onChoose({ kind, ...(publicUrlRewrite ? { publicUrlRewrite } : {}) });
  };

  return (
    <AlertDialog
      open={review !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialogContent data-binary-move-review>
        <AlertDialogHeader>
          <AlertDialogTitle>Move files in public/?</AlertDialogTitle>
          <AlertDialogDescription>
            The storefront serves these files at their paths, so moving them
            changes their URLs.{" "}
            {rewrite
              ? "References written out in Theme source are updated in the same save. Copying keeps the old URLs working for anything that is not."
              : "Copying keeps the old URLs working until the references are updated and the old files deleted."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {review && rewrite ? (
          <PublicUrlRewriteReview
            changes={review.review.changes.map((change) => ({
              from: change.from,
              to: change.to ?? change.from,
            }))}
            plan={rewrite.plan}
          />
        ) : null}
        {review && !rewrite ? (
          <>
            {review.rewrite.kind === "blocked" ? (
              <p
                className="text-xs text-amber-700 dark:text-amber-400"
                data-public-url-rewrite-blocked
              >
                Unsaved changes in {review.rewrite.unsavedPaths.join(", ")} name
                these URLs. Save or discard them to have references updated with
                the move.
              </p>
            ) : review.rewrite.kind === "unavailable" ? (
              <p className="text-xs text-muted-foreground">
                References cannot be updated with this move:{" "}
                {review.rewrite.reason}
              </p>
            ) : null}
            <PublicUrlReview
              changes={review.review.changes}
              scan={review.review.scan}
            />
          </>
        ) : null}
        {review && needsAcknowledgement ? (
          <label className="flex items-center gap-2 text-xs">
            <Checkbox
              checked={review.acknowledged}
              onCheckedChange={(checked) =>
                onAcknowledgedChange(checked === true)
              }
              aria-label="I understand these references will break"
            />
            {rewrite
              ? `I understand the ${referenceCount(unresolved)} not updated may break if I move.`
              : "I understand these references will break."}
          </label>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          {review && !review.movesSource ? (
            <Button
              variant={copyIsDefault ? "default" : "outline"}
              disabled={pending}
              data-binary-move-copy
              onClick={() => choose("copy")}
            >
              {updates > 0
                ? `Copy and update ${referenceCount(updates)}`
                : "Copy, keep old URLs"}
            </Button>
          ) : null}
          <Button
            variant={copyIsDefault ? "outline" : "default"}
            disabled={
              !review ||
              pending ||
              (needsAcknowledgement && !review.acknowledged)
            }
            data-binary-move-confirm
            onClick={() => choose("move")}
          >
            {updates > 0
              ? `Move and update ${referenceCount(updates)}`
              : "Move"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
