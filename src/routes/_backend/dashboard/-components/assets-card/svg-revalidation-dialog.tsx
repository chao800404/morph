import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ASSET_QUERY_KEY } from "@/lib/asset/query-key";
import { SVG_REVALIDATION_BATCH } from "@/lib/asset/svg-revalidation-batch";
import type {
  SvgRestoreOutcome,
  SvgScanEntry,
} from "@/lib/asset/svg-revalidation";
import {
  restoreLibrarySvgsServerFn,
  scanLibrarySvgsServerFn,
} from "@/server/asset/svg-revalidation.serverFn";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

/**
 * Re-checks the library's SVG files against the current rules, and restores
 * inline display for the ones that pass — in two steps, the second only on
 * an administrator's say-so, and checked again on the server file by file.
 */

type Phase =
  | { kind: "idle" }
  | { kind: "scanning" }
  | { kind: "scanned" }
  | { kind: "restoring" }
  | { kind: "restored" };

const OUTCOME_LABEL: Record<SvgRestoreOutcome["status"], string> = {
  restored: "Restored",
  changed: "Changed since the scan",
  refused: "Refused now",
  missing: "Gone",
  "write-failed": "Write failed",
};

export function SvgRevalidationDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [entries, setEntries] = useState<SvgScanEntry[]>([]);
  const [outcomes, setOutcomes] = useState<SvgRestoreOutcome[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stopRef = useRef(false);

  const passing = entries.filter((entry) => entry.status === "passes");
  const refused = entries.filter((entry) => entry.status === "refused");
  const count = (status: SvgScanEntry["status"]) =>
    entries.filter((entry) => entry.status === status).length;

  const scan = async () => {
    setPhase({ kind: "scanning" });
    setEntries([]);
    setOutcomes([]);
    setAcknowledged(false);
    setError(null);
    stopRef.current = false;
    let after: string | null = null;
    const found: SvgScanEntry[] = [];
    try {
      do {
        const result: Awaited<ReturnType<typeof scanLibrarySvgsServerFn>> =
          await scanLibrarySvgsServerFn({ data: { after } });
        if (!result.success || !result.data) {
          throw new Error(result.message);
        }
        found.push(...result.data.entries);
        setEntries([...found]);
        after = result.data.next;
      } while (after && !stopRef.current);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
    setPhase({ kind: "scanned" });
  };

  const restore = async (
    items: ReadonlyArray<{ assetId: string; etag: string }>,
  ) => {
    setPhase({ kind: "restoring" });
    setError(null);
    const results = new Map(
      outcomes.map((outcome) => [outcome.assetId, outcome]),
    );
    try {
      for (let at = 0; at < items.length; at += SVG_REVALIDATION_BATCH) {
        const batch = items.slice(at, at + SVG_REVALIDATION_BATCH);
        const result = await restoreLibrarySvgsServerFn({
          data: { items: batch.map((item) => ({ ...item })) },
        });
        if (!result.success || !result.data) {
          // A batch the server never answered for is not known to be written.
          for (const item of batch) {
            results.set(item.assetId, {
              assetId: item.assetId,
              status: "write-failed",
              detail: result.message,
            });
          }
          continue;
        }
        for (const outcome of result.data)
          results.set(outcome.assetId, outcome);
        setOutcomes([...results.values()]);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
    setOutcomes([...results.values()]);
    setPhase({ kind: "restored" });
    await queryClient.invalidateQueries({ queryKey: ASSET_QUERY_KEY });
  };

  const scanned = new Map(entries.map((entry) => [entry.assetId, entry]));
  const failedWrites = outcomes.filter(
    (outcome) => outcome.status === "write-failed",
  );
  const outcomeCount = (status: SvgRestoreOutcome["status"]) =>
    outcomes.filter((outcome) => outcome.status === status).length;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) stopRef.current = true;
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-2xl" data-svg-revalidation>
        <DialogHeader>
          <DialogTitle>Check SVG files</DialogTitle>
          <DialogDescription>
            SVG files checked under earlier rules are sent as downloads rather
            than shown when opened. This checks each one against the current
            rules. The check only reads; nothing changes until you confirm.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          {phase.kind === "idle" ? (
            <Button onClick={() => void scan()}>Start check</Button>
          ) : null}

          {phase.kind === "scanning" ? (
            <div className="flex items-center gap-3">
              <span data-svg-scan-progress>{entries.length} checked…</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => (stopRef.current = true)}
              >
                Stop
              </Button>
            </div>
          ) : null}

          {entries.length > 0 && phase.kind !== "scanning" ? (
            <ul className="grid grid-cols-4 gap-2" data-svg-scan-summary>
              <li>
                <div className="text-lg font-medium">{count("passes")}</div>
                <div className="text-xs text-muted-foreground">Pass</div>
              </li>
              <li>
                <div className="text-lg font-medium">{count("current")}</div>
                <div className="text-xs text-muted-foreground">
                  Already current
                </div>
              </li>
              <li>
                <div className="text-lg font-medium">{count("refused")}</div>
                <div className="text-xs text-muted-foreground">Refused</div>
              </li>
              <li>
                <div className="text-lg font-medium">{count("missing")}</div>
                <div className="text-xs text-muted-foreground">
                  File missing
                </div>
              </li>
            </ul>
          ) : null}

          {refused.length > 0 && phase.kind !== "scanning" ? (
            <div className="space-y-1">
              <div className="text-xs font-medium">
                Refused — these stay downloads until the file is fixed and
                uploaded again
              </div>
              <ul className="max-h-40 space-y-1 overflow-auto rounded-md border p-2 text-xs">
                {refused.map((entry) => (
                  <li key={entry.assetId} data-svg-refused={entry.assetId}>
                    <span className="font-medium">{entry.name}</span>
                    <span className="ml-2 text-muted-foreground">
                      {entry.reason}
                      {entry.line ? ` (line ${entry.line})` : ""}:{" "}
                      {entry.detail}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {phase.kind === "scanned" && passing.length > 0 ? (
            <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
              <p className="text-xs" data-svg-restore-notice>
                Restoring lets these {passing.length} file
                {passing.length === 1 ? "" : "s"} display when opened directly,
                at the URLs they already have — right away, for anyone with the
                address, without a Theme publish. Each file is checked again
                before it is changed; a file changed since this check is
                skipped.
              </p>
              <label className="flex items-center gap-2 text-xs">
                <Checkbox
                  checked={acknowledged}
                  onCheckedChange={(checked) =>
                    setAcknowledged(checked === true)
                  }
                  aria-label="I understand these files change how they are served now"
                />
                I understand these files change how they are served now.
              </label>
              <Button
                disabled={!acknowledged}
                onClick={() =>
                  void restore(
                    passing.map((entry) => ({
                      assetId: entry.assetId,
                      etag: entry.etag!,
                    })),
                  )
                }
              >
                Restore {passing.length} file{passing.length === 1 ? "" : "s"}
              </Button>
            </div>
          ) : null}

          {phase.kind === "restoring" ? (
            <p data-svg-restore-progress>
              {outcomes.length} of {passing.length} handled…
            </p>
          ) : null}

          {phase.kind === "restored" ? (
            <div className="space-y-2" data-svg-restore-results>
              <ul className="grid grid-cols-5 gap-2 text-xs">
                {(
                  Object.keys(OUTCOME_LABEL) as SvgRestoreOutcome["status"][]
                ).map((status) => (
                  <li key={status}>
                    <div className="text-lg font-medium">
                      {outcomeCount(status)}
                    </div>
                    <div className="text-muted-foreground">
                      {OUTCOME_LABEL[status]}
                    </div>
                  </li>
                ))}
              </ul>
              <ul className="max-h-40 space-y-1 overflow-auto text-xs">
                {outcomes
                  .filter((outcome) => outcome.status !== "restored")
                  .map((outcome) => (
                    <li
                      key={outcome.assetId}
                      data-svg-restore-outcome={outcome.status}
                    >
                      {scanned.get(outcome.assetId)?.name ?? outcome.assetId}:{" "}
                      {OUTCOME_LABEL[outcome.status]}
                      {outcome.detail ? ` — ${outcome.detail}` : ""}
                    </li>
                  ))}
              </ul>
              <div className="flex gap-2">
                {failedWrites.length > 0 ? (
                  <Button
                    variant="outline"
                    onClick={() =>
                      void restore(
                        failedWrites.map((outcome) => ({
                          assetId: outcome.assetId,
                          etag: scanned.get(outcome.assetId)!.etag!,
                        })),
                      )
                    }
                  >
                    Retry {failedWrites.length} failed
                  </Button>
                ) : null}
                <Button variant="outline" onClick={() => void scan()}>
                  Check again
                </Button>
              </div>
            </div>
          ) : null}

          {error ? (
            <p className="text-xs text-destructive" data-svg-revalidation-error>
              {error}
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
