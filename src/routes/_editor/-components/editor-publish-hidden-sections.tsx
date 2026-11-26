import { useState } from "react";
import { ExternalLink, EyeOff, LoaderCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ServerResult } from "@/lib/db/server-result";
import {
  showAgainFailureMessage,
  showAgainSuccessMessage,
  storefrontPageEditPath,
} from "@/lib/storefront/editor/show-again-messages";
import type {
  PublishHiddenSectionDetail,
  PublishHiddenSectionsDetails,
} from "@/lib/storefront/publish-hidden-sections-details";

/** The answer of one Show again, as `showStorefrontSectionAgain` gives it. */
export type ShowAgainAnswer = ServerResult<{ changed: boolean }>;

type RowState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "shown"; message: string }
  | { status: "failed"; message: string };

const problemKey = (problem: PublishHiddenSectionDetail) =>
  `${problem.itemType}:${problem.contentId}:${problem.sectionId}`;

/**
 * A Theme publish refused for hidden sections Morph cannot prove are left
 * out (M3 stage 1): which document and which section, each with "Show
 * again".
 *
 * Show again changes one draft and nothing else; it never publishes. The
 * merchant reviews and publishes again, the CMS Page first when the refusal
 * says so. A draft that moved since it was read answers a conflict: the
 * caller (`showAgain`) has reloaded it, this says so, and the merchant
 * decides whether to try again. Nothing is retried on its own.
 */
export function EditorPublishHiddenSections({
  refusal,
  activeTemplateId,
  onOpenChange,
  showAgain,
}: {
  refusal: { message: string; details: PublishHiddenSectionsDetails } | null;
  /** The template open in the editor, which the next publish seals. */
  activeTemplateId: string | null;
  onOpenChange: (open: boolean) => void;
  /** Reads the document's draft version or generation, then sends Show again. */
  showAgain: (problem: PublishHiddenSectionDetail) => Promise<ShowAgainAnswer>;
}) {
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [forRefusal, setForRefusal] = useState(refusal);
  // A new refusal starts with nothing done.
  if (refusal !== forRefusal) {
    setForRefusal(refusal);
    setRows({});
  }

  const run = async (problem: PublishHiddenSectionDetail) => {
    const key = problemKey(problem);
    setRows((current) => ({ ...current, [key]: { status: "pending" } }));
    let next: RowState;
    try {
      const answer = await showAgain(problem);
      next = answer.success
        ? {
            status: "shown",
            message: showAgainSuccessMessage(problem, {
              changed: answer.data.changed !== false,
              activeTemplateId,
            }),
          }
        : { status: "failed", message: showAgainFailureMessage(answer) };
    } catch (error) {
      next = {
        status: "failed",
        message:
          error instanceof Error && error.message
            ? error.message
            : "Morph could not show this section again.",
      };
    }
    setRows((current) => ({ ...current, [key]: next }));
  };

  const problems = refusal?.details.problems ?? [];
  return (
    <Dialog open={refusal !== null} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[85vh] overflow-y-auto sm:max-w-xl"
        data-publish-hidden-sections
      >
        <DialogHeader>
          <DialogTitle>Nothing was published</DialogTitle>
          <DialogDescription>{refusal?.message}</DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-2">
          {problems.map((problem) => {
            const key = problemKey(problem);
            const state = rows[key] ?? { status: "idle" };
            return (
              <li
                key={key}
                data-hidden-section-id={problem.sectionId}
                data-hidden-section-item={problem.itemType}
                className="flex flex-col gap-2 rounded-md border p-3 text-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-2">
                    <EyeOff className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="font-medium break-words">{problem.label}</p>
                      <p className="text-xs text-muted-foreground">
                        Hidden section{" "}
                        <code className="font-mono">{problem.sectionId}</code>
                      </p>
                    </div>
                  </div>
                  {state.status === "shown" ? null : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={state.status === "pending"}
                      aria-busy={state.status === "pending"}
                      onClick={() => void run(problem)}
                    >
                      {state.status === "pending" ? (
                        <LoaderCircle className="size-3.5 animate-spin" />
                      ) : null}
                      Show again
                    </Button>
                  )}
                </div>
                {state.status === "shown" ? (
                  <p className="text-xs" role="status">
                    {state.message}
                    {problem.mustPublish === "page" ? (
                      <>
                        {" "}
                        <a
                          href={storefrontPageEditPath(problem.contentId)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-medium underline underline-offset-2"
                        >
                          Open the Page
                          <ExternalLink className="size-3" />
                        </a>
                      </>
                    ) : null}
                  </p>
                ) : null}
                {state.status === "failed" ? (
                  <Alert variant="destructive" role="alert" className="text-xs">
                    <AlertDescription className="text-xs">
                      {state.message}
                    </AlertDescription>
                  </Alert>
                ) : null}
              </li>
            );
          })}
        </ul>
        {refusal?.details.truncated ? (
          <p className="text-xs text-muted-foreground">
            More hidden sections were not listed. Publish again after these to
            see the rest.
          </p>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
