import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ArrowUpCircle, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { StarterUpgradeStatusDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import type {
  StarterUpgradeChange,
  StarterUpgradeKept,
  StarterUpgradeKeptReason,
} from "@/lib/storefront/starter-theme-upgrade-review";
import { diffLines } from "@/lib/text/line-diff";
import { cn } from "@/lib/utils";
import {
  applyStorefrontStarterUpgrade,
  reviewStorefrontStarterUpgrade,
} from "@/server/storefront/storefront-themes.serverFn";

type Review = {
  sourceGeneration: number;
  versionState: StarterUpgradeStatusDTO["versionState"];
  storedVersion: number | null;
  currentVersion: number;
  applies: boolean;
  digest: string;
  changes: StarterUpgradeChange[];
  kept: StarterUpgradeKept[];
};

const KEPT_REASON: Record<StarterUpgradeKeptReason, string> = {
  changed:
    "Kept as it is: it differs from every Starter copy Morph knows, so it is yours. That includes formatting-only changes.",
  missing: "Not in this Theme, and not added back.",
  "markers-kept":
    "Kept as it is: you changed it. Its data-* markers keep working; remove them by hand if you like.",
};

function versionLine(status: StarterUpgradeStatusDTO): string {
  if (status.versionState === "pending") {
    return `This Theme does not record which Starter it came from. Review it against Starter ${status.currentVersion} to record one.`;
  }
  return `This Theme is on Starter ${status.storedVersion}; Starter ${status.currentVersion} is available.`;
}

/**
 * A Starter upgrade the author has not reviewed yet.
 *
 * Opening the editor never upgrades a Theme. This says one is available, or
 * that the Theme's version is unknown, and opens a review: every file the
 * upgrade would write, with its text before and after, and every Starter file
 * it leaves alone, with why. Applying sends the review's generation and
 * digest, so what is written is what was shown; a Theme that moved on since
 * is refused, with nothing written.
 */
export function EditorStarterUpgradeNotice({
  status,
  storefrontId,
  themeId,
  unsavedCount,
  onApplied,
  className,
}: {
  status: StarterUpgradeStatusDTO | null | undefined;
  storefrontId: string;
  themeId: string;
  /** Applying waits until nothing in this tab is unsaved. */
  unsavedCount: number;
  onApplied: () => void | Promise<void>;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [shownPath, setShownPath] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const reviewMutation = useMutation({
    mutationFn: async () => {
      const result = await reviewStorefrontStarterUpgrade({
        data: { storefrontId, themeId },
      });
      if (!result.success) throw new Error(result.message);
      return result.data as Review;
    },
    onSuccess: (next) => {
      setReview(next);
      setShownPath(next.changes[0]?.path ?? null);
      setMessage(null);
      setOpen(true);
    },
    onError: (error) => {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not review the upgrade.",
      );
    },
  });

  const applyMutation = useMutation({
    mutationFn: async (reviewed: Review) => {
      const result = await applyStorefrontStarterUpgrade({
        data: {
          storefrontId,
          themeId,
          expectedSourceGeneration: reviewed.sourceGeneration,
          planDigest: reviewed.digest,
        },
      });
      if (!result.success) throw new Error(result.message);
      return result.data;
    },
    onSuccess: async () => {
      setOpen(false);
      setReview(null);
      setMessage(
        "Starter upgrade applied. The preview is reloading; publish when you are ready.",
      );
      await onApplied();
    },
    onError: (error) => {
      setMessage(
        error instanceof Error ? error.message : "Could not apply the upgrade.",
      );
    },
  });

  if (!status || status.versionState === "current") {
    return message ? (
      <div
        role="status"
        className={cn(
          "flex items-center gap-3 border-b bg-muted/40 px-4 py-2 text-xs",
          className,
        )}
        data-editor-starter-upgrade="applied"
      >
        <ArrowUpCircle className="size-4 shrink-0 text-emerald-600" />
        <span className="min-w-0 flex-1">{message}</span>
        <Button size="sm" variant="ghost" onClick={() => setMessage(null)}>
          Dismiss
        </Button>
      </div>
    ) : null;
  }

  const shown = review?.changes.find((change) => change.path === shownPath);
  const rows = shown ? diffLines(shown.before ?? "", shown.after ?? "") : null;
  const nothingToWrite = review !== null && review.changes.length === 0;

  return (
    <>
      <div
        role="status"
        className={cn(
          "flex items-center gap-3 border-b border-sky-500/30 bg-sky-500/10 px-4 py-2 text-xs",
          className,
        )}
        data-editor-starter-upgrade={status.versionState}
      >
        <ArrowUpCircle className="size-4 shrink-0 text-sky-600" />
        <span className="min-w-0 flex-1">
          {versionLine(status)} Nothing changes until you apply it.
          {message ? ` ${message}` : null}
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={reviewMutation.isPending}
          onClick={() => reviewMutation.mutate()}
        >
          {reviewMutation.isPending ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : null}
          Review upgrade
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Review the Starter upgrade</DialogTitle>
            <DialogDescription>
              Only files that still match a Starter copy Morph wrote are
              changed. Files you changed are kept and listed below. Applying
              saves one new revision; it does not publish.
            </DialogDescription>
          </DialogHeader>
          {review && !review.applies ? (
            <p className="text-xs text-muted-foreground">
              This Theme is not a TanStack Start Theme, so the Starter upgrade
              does not apply to it.
            </p>
          ) : review ? (
            <div className="grid min-h-0 grid-cols-[14rem_1fr] gap-3 text-xs">
              <div className="max-h-[28rem] space-y-3 overflow-auto">
                <section aria-label="Changes">
                  <h3 className="mb-1 font-medium">
                    Changes ({review.changes.length})
                  </h3>
                  {review.changes.length === 0 ? (
                    <p className="text-muted-foreground">
                      No file needs changing. Applying records Starter{" "}
                      {review.currentVersion} for this Theme.
                    </p>
                  ) : (
                    <ul>
                      {review.changes.map((change) => (
                        <li key={change.path}>
                          <button
                            type="button"
                            className={cn(
                              "flex w-full items-center gap-2 rounded px-1.5 py-1 text-left font-mono",
                              change.path === shownPath && "bg-muted",
                            )}
                            onClick={() => setShownPath(change.path)}
                          >
                            <span className="w-12 shrink-0 text-[10px] uppercase text-muted-foreground">
                              {change.operation}
                            </span>
                            <span className="truncate">{change.path}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
                <section aria-label="Kept">
                  <h3 className="mb-1 font-medium">
                    Kept as they are ({review.kept.length})
                  </h3>
                  <ul className="space-y-1">
                    {review.kept.map((item) => (
                      <li key={item.path} data-kept-reason={item.reason}>
                        <div className="truncate font-mono">{item.path}</div>
                        <div className="text-muted-foreground">
                          {KEPT_REASON[item.reason]}
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              </div>
              <div
                className="max-h-[28rem] overflow-auto rounded-md border bg-card font-mono text-[11px]"
                aria-label={
                  shown ? `Changes to ${shown.path}` : "No file selected"
                }
              >
                {shown && rows ? (
                  rows.map((row, index) => (
                    <div
                      key={index}
                      className={cn(
                        "whitespace-pre px-2",
                        row.kind === "added" &&
                          "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                        row.kind === "removed" &&
                          "bg-red-500/10 text-red-700 dark:text-red-300",
                      )}
                    >
                      {row.kind === "added"
                        ? "+ "
                        : row.kind === "removed"
                          ? "- "
                          : "  "}
                      {row.text}
                    </div>
                  ))
                ) : shown ? (
                  <p className="p-3 text-muted-foreground">
                    This file is too long to compare here. Open it in Code mode
                    after applying to see it.
                  </p>
                ) : (
                  <p className="p-3 text-muted-foreground">
                    Select a change to see it.
                  </p>
                )}
              </div>
            </div>
          ) : null}
          <DialogFooter>
            {unsavedCount > 0 ? (
              <span className="mr-auto text-xs text-muted-foreground">
                Save or discard your unsaved changes first.
              </span>
            ) : null}
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                !review ||
                !review.applies ||
                unsavedCount > 0 ||
                applyMutation.isPending
              }
              onClick={() => review && applyMutation.mutate(review)}
            >
              {applyMutation.isPending ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : null}
              {nothingToWrite ? "Record version" : "Apply upgrade"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
