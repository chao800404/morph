import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ArrowUpCircle, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { StarterUpgradeStatusDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import type { ThemeCatalogKeptReason } from "@/lib/storefront/service/theme-catalog-setup";
import type {
  StarterUpgradeChange,
  StarterUpgradeKeptReason,
} from "@/lib/storefront/starter-theme-upgrade-review";
import { diffLines } from "@/lib/text/line-diff";
import { cn } from "@/lib/utils";
import {
  applyStorefrontStarterUpgrade,
  reviewStorefrontStarterUpgrade,
} from "@/server/storefront/storefront-themes.serverFn";

type Part<Reason extends string> = {
  applies: boolean;
  digest: string;
  changes: StarterUpgradeChange[];
  kept: { path: string; reason: Reason }[];
};

type Review = {
  sourceGeneration: number;
  versionState: StarterUpgradeStatusDTO["versionState"];
  storedVersion: number | null;
  currentVersion: number;
  starter: Part<StarterUpgradeKeptReason> & {
    /** The review with the Starter's new pages selected, under its digest. */
    optional:
      | (Omit<Part<StarterUpgradeKeptReason>, "applies"> & { paths: string[] })
      | null;
  };
  catalog: Part<ThemeCatalogKeptReason> & { kind: "install" | "update" | null };
};

type PartName = "starter" | "catalog";
type Choice = PartName | "pages";

const STARTER_KEPT: Record<StarterUpgradeKeptReason, string> = {
  changed:
    "Kept as it is: it differs from every Starter copy Morph knows, so it is yours. That includes formatting-only changes.",
  missing: "Not in this Theme, and not added back.",
  "markers-kept":
    "Kept as it is: you changed it. Its data-* markers keep working; remove them by hand if you like.",
  "needs-missing":
    "Not upgraded: its new version needs a file you removed from this Theme.",
  "origin-unknown":
    "Not added: this Theme does not record which Starter it came from, so Morph cannot tell whether you removed it. Add it yourself if you want it.",
  "new-in-starter":
    "Not added unless you select it: the Starter now has this page and this Theme does not. Select \"Add the Starter's new pages\" above to add it.",
  "needs-route":
    "Not upgraded: its new version links to a page this Theme does not have, so it is kept as it is. Adding the Starter's new pages upgrades it too.",
};

const CATALOG_KEPT: Record<ThemeCatalogKeptReason, string> = {
  changed:
    "Kept as it is: it differs from the catalog copy Morph wrote, so it is yours.",
  missing: "Not in this Theme any more, and not added back.",
  "products-route-exists":
    "Not installed: this Theme has its own /products route, which is kept.",
  "route-conflict":
    "Not installed: it would conflict with this Theme's routes.",
};

function noticeLine(status: StarterUpgradeStatusDTO): string {
  const starter =
    status.versionState === "pending"
      ? `This Theme does not record which Starter it came from. Review it against Starter ${status.currentVersion} to record one.`
      : status.versionState === "available"
        ? `This Theme is on Starter ${status.storedVersion}; Starter ${status.currentVersion} is available.`
        : null;
  const catalog =
    status.catalogPending === "install"
      ? "This Theme can add a product list page (/products) and a product detail page (/products/<slug>) for this store's products. These pages are not created until you review and apply them."
      : status.catalogPending === "update"
        ? "Product catalog pages Morph added earlier have updates. They stay as they are until you review and apply them."
        : null;
  return [starter, catalog].filter(Boolean).join(" ");
}

function ChangeList({
  part,
  changes,
  shown,
  onShow,
}: {
  part: PartName;
  changes: StarterUpgradeChange[];
  shown: string | null;
  onShow: (key: string) => void;
}) {
  return (
    <ul>
      {changes.map((change) => {
        const key = `${part}:${change.path}`;
        return (
          <li key={key}>
            <button
              type="button"
              className={cn(
                "flex w-full items-center gap-2 rounded px-1.5 py-1 text-left font-mono",
                key === shown && "bg-muted",
              )}
              onClick={() => onShow(key)}
            >
              <span className="w-12 shrink-0 text-[10px] uppercase text-muted-foreground">
                {change.operation}
              </span>
              <span className="truncate">{change.path}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function KeptList<Reason extends string>({
  kept,
  text,
}: {
  kept: { path: string; reason: Reason }[];
  text: Record<Reason, string>;
}) {
  return (
    <ul className="space-y-1">
      {kept.map((item) => (
        <li key={item.path} data-kept-reason={item.reason}>
          <div className="truncate font-mono">{item.path}</div>
          <div className="text-muted-foreground">{text[item.reason]}</div>
        </li>
      ))}
    </ul>
  );
}

/**
 * A Starter upgrade or a product catalog change the author has not reviewed.
 *
 * Opening the editor writes neither. This says what is waiting and opens one
 * review with two parts kept apart: the Starter upgrade and the product
 * catalog. Each lists every file it would write, with its text before and
 * after, and every file it leaves alone, with why. The author chooses which
 * parts to apply; applying sends the review's generation and each chosen
 * part's digest, so what is written is what was shown, and a Theme that moved
 * on since is refused with nothing written.
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
  const [shownKey, setShownKey] = useState<string | null>(null);
  // The Starter's new pages are never pre-selected: only the author adds them.
  const [chosen, setChosen] = useState<Record<Choice, boolean>>({
    starter: true,
    catalog: true,
    pages: false,
  });
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
      const first =
        next.starter.changes[0] !== undefined
          ? `starter:${next.starter.changes[0].path}`
          : next.catalog.changes[0] !== undefined
            ? `catalog:${next.catalog.changes[0].path}`
            : null;
      setShownKey(first);
      setChosen({ starter: true, catalog: true, pages: false });
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
    mutationFn: async (input: {
      reviewed: Review;
      /** The Starter digest the author applies, when they apply it. */
      starterDigest: string | null;
      catalog: boolean;
    }) => {
      const result = await applyStorefrontStarterUpgrade({
        data: {
          storefrontId,
          themeId,
          expectedSourceGeneration: input.reviewed.sourceGeneration,
          ...(input.starterDigest !== null
            ? { starterDigest: input.starterDigest }
            : {}),
          ...(input.catalog
            ? { catalogDigest: input.reviewed.catalog.digest }
            : {}),
        },
      });
      if (!result.success) throw new Error(result.message);
      return result.data;
    },
    onSuccess: async (applied) => {
      setOpen(false);
      setReview(null);
      setMessage(
        applied.starter && !applied.versionRecorded
          ? "Applied what could be applied. This Theme still does not record which Starter it came from, so the files Morph could not place stay as they are and this notice stays. The preview is reloading; publish when you are ready."
          : "Applied. The preview is reloading; publish when you are ready.",
      );
      await onApplied();
    },
    onError: (error) => {
      setMessage(
        error instanceof Error ? error.message : "Could not apply the upgrade.",
      );
    },
  });

  const waiting =
    !!status &&
    (status.versionState !== "current" || status.catalogPending !== null);
  if (!status || !waiting) {
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

  // The Starter part is offered while its version is not current, even with
  // no file to change: applying it records the version. The catalog part is
  // offered when it has files to write, and shown when it keeps any.
  const starterShown =
    !!review &&
    (review.versionState !== "current" || review.starter.changes.length > 0);
  const starterOffered = starterShown && review!.starter.applies;
  const catalogShown =
    !!review &&
    review.catalog.applies &&
    (review.catalog.changes.length > 0 || review.catalog.kept.length > 0);
  const catalogOffered = catalogShown && review!.catalog.changes.length > 0;
  const applyStarter = starterOffered && chosen.starter;
  const applyCatalog = catalogOffered && chosen.catalog;
  const pagesOffered = starterOffered && !!review!.starter.optional;
  const addPages = pagesOffered && applyStarter && chosen.pages;
  // What the Starter part writes and keeps: with the new pages once the
  // author selects them, which is a plan of its own with its own digest.
  const starterPart = review
    ? addPages && review.starter.optional
      ? review.starter.optional
      : review.starter
    : null;

  const [shownPart, ...shownRest] = shownKey?.split(":") ?? [];
  const shownPath = shownRest.join(":");
  const shown =
    review && starterPart && (shownPart === "starter" || shownPart === "catalog")
      ? (shownPart === "starter" ? starterPart : review.catalog).changes.find(
          (change) => change.path === shownPath,
        )
      : undefined;
  const rows = shown ? diffLines(shown.before ?? "", shown.after ?? "") : null;

  return (
    <>
      <div
        role="status"
        className={cn(
          "flex items-center gap-3 border-b border-sky-500/30 bg-sky-500/10 px-4 py-2 text-xs",
          className,
        )}
        data-editor-starter-upgrade={
          status.versionState === "current" ? "catalog" : status.versionState
        }
        data-catalog-pending={status.catalogPending ?? "none"}
      >
        <ArrowUpCircle className="size-4 shrink-0 text-sky-600" />
        <span className="min-w-0 flex-1">
          {noticeLine(status)} Nothing changes until you apply it.
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
              Only files that still match a copy Morph wrote are changed, and
              new files are added only where nothing is in the way. Files you
              changed are kept and listed. Applying saves one new revision; it
              does not publish.
            </DialogDescription>
          </DialogHeader>
          {review ? (
            <div className="grid min-h-0 grid-cols-[16rem_1fr] gap-3 text-xs">
              <div className="max-h-[28rem] space-y-4 overflow-auto">
                {starterShown ? (
                  <section aria-label="Starter upgrade" className="space-y-2">
                    <label className="flex items-center gap-2 font-medium">
                      <Checkbox
                        aria-label="Apply the Starter upgrade"
                        checked={applyStarter}
                        disabled={!starterOffered}
                        onCheckedChange={(value) =>
                          setChosen((prev) => ({
                            ...prev,
                            starter: value === true,
                          }))
                        }
                      />
                      Starter upgrade
                    </label>
                    {!review.starter.applies || !starterPart ? (
                      <p className="text-muted-foreground">
                        This Theme is not a TanStack Start Theme, so the Starter
                        upgrade does not apply to it.
                      </p>
                    ) : (
                      <>
                        {review.starter.optional ? (
                          <div
                            className="space-y-1 rounded-md border p-2"
                            data-starter-optional-pages=""
                          >
                            <label className="flex items-center gap-2 font-medium">
                              <Checkbox
                                aria-label="Add the Starter's new pages"
                                checked={addPages}
                                disabled={!pagesOffered || !applyStarter}
                                onCheckedChange={(value) =>
                                  setChosen((prev) => ({
                                    ...prev,
                                    pages: value === true,
                                  }))
                                }
                              />
                              Add the Starter&apos;s new pages
                            </label>
                            <p className="text-muted-foreground">
                              The Starter now has these pages and this Theme
                              does not. They are added only if you select this.
                            </p>
                            <ul className="font-mono">
                              {review.starter.optional.paths.map((path) => (
                                <li key={path} className="truncate">
                                  {path}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                        <h3 className="font-medium">
                          Changes ({starterPart.changes.length})
                        </h3>
                        {starterPart.changes.length === 0 ? (
                          <p className="text-muted-foreground">
                            No file needs changing. Applying records Starter{" "}
                            {review.currentVersion} for this Theme.
                          </p>
                        ) : (
                          <ChangeList
                            part="starter"
                            changes={starterPart.changes}
                            shown={shownKey}
                            onShow={setShownKey}
                          />
                        )}
                        <h3 className="font-medium">
                          Kept as they are ({starterPart.kept.length})
                        </h3>
                        <KeptList
                          kept={starterPart.kept}
                          text={STARTER_KEPT}
                        />
                      </>
                    )}
                  </section>
                ) : null}
                {catalogShown ? (
                  <section aria-label="Product catalog" className="space-y-2">
                    <label className="flex items-center gap-2 font-medium">
                      <Checkbox
                        aria-label="Apply the product catalog changes"
                        checked={applyCatalog}
                        disabled={!catalogOffered}
                        onCheckedChange={(value) =>
                          setChosen((prev) => ({
                            ...prev,
                            catalog: value === true,
                          }))
                        }
                      />
                      Product catalog
                    </label>
                    <p className="text-muted-foreground">
                      {review.catalog.kind === "install"
                        ? "Adds a product list page (/products) and a product detail page (/products/<slug>) for this store's products. They are not created until you apply this part. Product data is not changed."
                        : review.catalog.kind === "update"
                          ? "Updates catalog files Morph wrote earlier. Product data is not changed."
                          : "Nothing to install or update."}{" "}
                      Applying it does not change the Starter version.
                    </p>
                    <h3 className="font-medium">
                      Changes ({review.catalog.changes.length})
                    </h3>
                    <ChangeList
                      part="catalog"
                      changes={review.catalog.changes}
                      shown={shownKey}
                      onShow={setShownKey}
                    />
                    <h3 className="font-medium">
                      Kept as they are ({review.catalog.kept.length})
                    </h3>
                    <KeptList kept={review.catalog.kept} text={CATALOG_KEPT} />
                  </section>
                ) : null}
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
                (!applyStarter && !applyCatalog) ||
                unsavedCount > 0 ||
                applyMutation.isPending
              }
              onClick={() =>
                review &&
                applyMutation.mutate({
                  reviewed: review,
                  starterDigest:
                    applyStarter && starterPart ? starterPart.digest : null,
                  catalog: applyCatalog,
                })
              }
            >
              {applyMutation.isPending ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : null}
              Apply selected
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
