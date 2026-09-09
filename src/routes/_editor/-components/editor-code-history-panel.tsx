import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  isThemeRollbackNoop,
  type ThemeRollbackPlan,
} from "@/lib/storefront/editor/theme-rollback-plan";
import { cn } from "@/lib/utils";
import { AlertTriangle, FilePlus2, FileX2, Pencil } from "lucide-react";

/** One entry of the workspace's source history, as the list shows it. */
export type EditorCodeRevision = Readonly<{
  id: string;
  revisionNumber: number;
  message: string | null;
  source: "manual" | "ai" | "publish" | "rollback";
  createdAt: string;
}>;

const SOURCE_LABEL: Record<EditorCodeRevision["source"], string> = {
  manual: "Saved",
  ai: "Agent",
  publish: "Published",
  rollback: "Restored",
};

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * One group of the rollback plan.
 *
 * Restores are listed first and deletions last, because those are the two an
 * author is deciding between: what comes back, and what it costs.
 */
function PlanGroup({
  title,
  paths,
  icon,
  tone,
}: {
  title: string;
  paths: readonly string[];
  icon: React.ReactNode;
  tone?: "destructive";
}) {
  if (paths.length === 0) return null;
  return (
    <div className="space-y-1">
      <div
        className={cn(
          "flex items-center gap-1.5 text-[11px] font-medium",
          tone === "destructive" ? "text-destructive" : "text-foreground",
        )}
      >
        {icon}
        <span>
          {title} · {paths.length}
        </span>
      </div>
      <ul className="space-y-0.5 pl-5">
        {paths.map((path) => (
          <li
            key={path}
            className="truncate font-mono text-[11px] text-muted-foreground"
            title={path}
          >
            {path}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The workspace's source history, and what returning to one point would do.
 *
 * Rollback replaces every file rather than merging, so the panel refuses to
 * present it as a one-click action: a revision is selected, the server says
 * exactly which files it restores and which it deletes, and only then is there
 * something to confirm. Restoring a file deleted by mistake is the reason this
 * exists, and it is also the case where the cost — losing work done since —
 * has to be visible rather than discovered afterwards.
 */
export function EditorCodeHistoryPanel({
  revisions,
  isLoading,
  error,
  selectedRevisionNumber,
  onSelectRevision,
  plan,
  isPlanLoading,
  planError,
  onRollback,
  isRollingBack,
  blockedReason,
}: {
  revisions: readonly EditorCodeRevision[];
  isLoading: boolean;
  error?: string | null;
  selectedRevisionNumber: number | null;
  onSelectRevision: (revisionNumber: number | null) => void;
  plan: ThemeRollbackPlan | null;
  isPlanLoading: boolean;
  planError?: string | null;
  onRollback: (revisionNumber: number) => void;
  isRollingBack: boolean;
  /** Why rollback cannot run right now, if it cannot. */
  blockedReason?: string | null;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScrollArea className="flex-1">
        <div className="space-y-0.5 p-1">
          {isLoading ? (
            <p className="px-2 py-3 text-[11px] text-muted-foreground">
              Loading history…
            </p>
          ) : null}

          {error ? (
            <p className="px-2 py-3 text-[11px] text-destructive">{error}</p>
          ) : null}

          {!isLoading && !error && revisions.length === 0 ? (
            <p className="px-2 py-3 text-[11px] leading-relaxed text-muted-foreground">
              No source history yet. A version is recorded when the workspace is
              saved, when an agent writes to it, and on every publish.
            </p>
          ) : null}

          {revisions.map((revision) => {
            const selected = revision.revisionNumber === selectedRevisionNumber;
            return (
              <div key={revision.id}>
                <button
                  type="button"
                  aria-expanded={selected}
                  onClick={() =>
                    onSelectRevision(selected ? null : revision.revisionNumber)
                  }
                  className={cn(
                    "w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted",
                    selected && "bg-muted",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-medium text-foreground">
                      {revision.message?.trim() ||
                        SOURCE_LABEL[revision.source]}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      #{revision.revisionNumber}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <span>{SOURCE_LABEL[revision.source]}</span>
                    <span aria-hidden="true">·</span>
                    <span>{formatWhen(revision.createdAt)}</span>
                  </div>
                </button>

                {selected ? (
                  <div className="mt-1 space-y-3 rounded-md border bg-background/60 p-2.5">
                    {isPlanLoading ? (
                      <p className="text-[11px] text-muted-foreground">
                        Working out what this would change…
                      </p>
                    ) : null}

                    {planError ? (
                      <p className="text-[11px] text-destructive">
                        {planError}
                      </p>
                    ) : null}

                    {plan && !isPlanLoading && !planError ? (
                      isThemeRollbackNoop(plan) ? (
                        <p className="text-[11px] leading-relaxed text-muted-foreground">
                          The workspace already matches this version. Nothing
                          would change.
                        </p>
                      ) : (
                        <>
                          <PlanGroup
                            title="Restored"
                            paths={plan.restored}
                            icon={<FilePlus2 className="size-3" />}
                          />
                          <PlanGroup
                            title="Rewritten"
                            paths={plan.rewritten}
                            icon={<Pencil className="size-3" />}
                          />
                          <PlanGroup
                            title="Deleted"
                            paths={plan.removed}
                            icon={<FileX2 className="size-3" />}
                            tone="destructive"
                          />

                          {plan.removed.length > 0 ? (
                            <div className="flex items-start gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-[11px] leading-relaxed text-destructive">
                              <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                              <span>
                                {plan.removed.length === 1
                                  ? "This file was added after this version and will be deleted."
                                  : `These ${plan.removed.length} files were added after this version and will be deleted.`}{" "}
                                A version of the current workspace is recorded
                                first, so this can be undone from the list.
                              </span>
                            </div>
                          ) : null}

                          {blockedReason ? (
                            <p className="text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
                              {blockedReason}
                            </p>
                          ) : null}

                          <Button
                            type="button"
                            size="sm"
                            variant={
                              plan.removed.length > 0
                                ? "destructive"
                                : "default"
                            }
                            className="w-full"
                            disabled={Boolean(blockedReason) || isRollingBack}
                            onClick={() => onRollback(revision.revisionNumber)}
                          >
                            {isRollingBack
                              ? "Restoring…"
                              : `Restore version #${revision.revisionNumber}`}
                          </Button>
                        </>
                      )
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
