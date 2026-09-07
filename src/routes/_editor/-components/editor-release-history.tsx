import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { CheckCircle2, LoaderCircle, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { useCloseOnEscape } from "@/components/dialog/route-form-modal";
import { RouteFullscreenSurface } from "@/components/dialog/route-fullscreen-surface";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  describeReleaseHistory,
  expectedActiveReleaseId,
  type ReleaseHistoryRow,
} from "@/lib/storefront/editor/release-history-view";
import { resolveInlineRename } from "@/lib/storefront/editor/inline-rename";
import {
  MAX_RELEASE_NOTE_LENGTH,
  withReleaseNote,
} from "@/lib/storefront/release-note";
import {
  DataTableCard,
  RowActionsMenu,
  type DataTableColumn,
} from "@/routes/_backend/dashboard/-components/data-table-card";
import {
  activateStorefrontRelease,
  renameStorefrontRelease,
} from "@/server/storefront/storefront-releases.serverFn";
import { storefrontReleaseQueries } from "../-queries/storefront-release.queries";
import { storefrontThemeQueries } from "../-queries/storefront-theme.queries";

interface ReleaseHistoryProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storefrontId: string;
  themeId: string;
  activeReleaseId: string | null;
}

/**
 * Mounts the surface only while it is open.
 *
 * `useCloseOnEscape` listens on the window, so a closed-but-mounted panel would
 * still answer Escape — and this editor already has another surface using the
 * same hook. Unmounting is what keeps one Escape from reaching two of them.
 */
export function EditorReleaseHistoryDialog(props: ReleaseHistoryProps) {
  if (!props.open) return null;
  return <ReleaseHistorySurface {...props} />;
}

function ReleaseHistorySurface({
  onOpenChange,
  storefrontId,
  themeId,
  activeReleaseId,
}: ReleaseHistoryProps) {
  const queryClient = useQueryClient();
  useCloseOnEscape(() => onOpenChange(false));

  // The shared pager writes the page into the URL, so this reads it back from
  // there rather than holding a second copy that could disagree with it.
  const search = useSearch({ strict: false }) as { releasePage?: number };
  const page = search.releasePage ?? 1;

  const history = useQuery(
    storefrontReleaseQueries.history(storefrontId, page),
  );
  const rows = describeReleaseHistory(
    history.data?.releases ?? [],
    activeReleaseId,
  );

  // A note is written at publish time, when what changed is not always clear
  // yet. Renaming afterwards is what keeps the list honest instead of frozen.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftNote, setDraftNote] = useState("");

  /**
   * Focuses the field after the menu has finished closing.
   *
   * `autoFocus` is not enough: the menu item that opens this editor returns
   * focus to its own trigger when it closes, and that restore runs after the
   * input has mounted — so the field appeared, took focus, and lost it again
   * before anyone could type. Waiting a frame puts this after the restore.
   *
   * The text is selected because renaming usually means replacing, not
   * appending to what is already there.
   */
  const renameFieldRef = useRef<HTMLInputElement | null>(null);
  /**
   * Whether the field has actually held focus yet.
   */
  const renameFocusedRef = useRef(false);
  /**
   * Timestamp when edit mode was entered.
   *
   * Guards against the dropdown menu closing race condition: Radix's exit
   * transition and focus cleanup can trigger an immediate blur event right as
   * the field opens (within ~150ms). Blurs during this transition window are
   * ignored so the input doesn't flash and instantly disappear.
   */
  const editingStartedAtRef = useRef(0);

  useEffect(() => {
    if (!editingId) {
      renameFocusedRef.current = false;
      return;
    }
    editingStartedAtRef.current = Date.now();
    renameFocusedRef.current = false;

    const frame = requestAnimationFrame(() => {
      renameFieldRef.current?.focus();
      renameFieldRef.current?.select();
    });
    // Radix dropdown menu close animation takes ~150ms and can restore focus on exit;
    // ensure focus stays firmly in the input field after menu dismissal finishes.
    const timer = setTimeout(() => {
      renameFieldRef.current?.focus();
    }, 150);

    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [editingId]);

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: storefrontReleaseQueries.all(),
    });
  }, [queryClient]);

  /**
   * Whether this edit has already been decided.
   *
   * Closing the field also blurs it, so without this the blur handler runs a
   * second time after Enter or Escape — committing a value Escape rejected, or
   * sending the same rename twice.
   */
  const settledRef = useRef(false);
  const cancelRename = useCallback(() => {
    settledRef.current = true;
    setEditingId(null);
  }, []);

  const rename = useMutation({
    mutationFn: async (input: { releaseId: string; note: string }) => {
      const result = await renameStorefrontRelease({
        data: { storefrontId, themeId, ...input },
      });
      if (!result.success) throw new Error(result.message);
      return result.data;
    },
    onMutate: async (newRelease) => {
      const queryKey = storefrontReleaseQueries.history(storefrontId, page).queryKey;
      // Cancel outgoing queries so they don't overwrite optimistic data
      await queryClient.cancelQueries({ queryKey: storefrontReleaseQueries.all() });

      // Snapshot previous query data for rollback on failure
      const previousData = queryClient.getQueryData(queryKey);

      // Optimistically update the query cache immediately
      if (previousData) {
        queryClient.setQueryData(queryKey, {
          ...previousData,
          releases: previousData.releases.map((release) =>
            release.id === newRelease.releaseId
              ? {
                  ...release,
                  metadata: withReleaseNote(release.metadata, newRelease.note),
                }
              : release,
          ),
        });
      }

      return { previousData, queryKey };
    },
    onError: (error: Error, _newRelease, context) => {
      // Roll back to previous data if the server update fails
      if (context?.previousData) {
        queryClient.setQueryData(context.queryKey, context.previousData);
      }
      toast.error(error.message);
    },
    onSettled: () => {
      // Ensure local state is in sync with server
      invalidate();
    },
  });

  const activate = useMutation({
    mutationFn: async (releaseId: string) => {
      const result = await activateStorefrontRelease({
        data: {
          storefrontId,
          releaseId,
          expectedActiveReleaseId: expectedActiveReleaseId(
            rows,
            activeReleaseId,
          ),
        },
      });
      if (!result.success) throw new Error(result.message);
      return result.data;
    },
    onSuccess: async () => {
      toast.success("Release activated. Production now serves this version.");
      invalidate();
      await queryClient.invalidateQueries({
        queryKey: storefrontThemeQueries.detail(storefrontId, themeId).queryKey,
      });
    },
    onError: (error: Error) => {
      toast.error(error.message);
      // A rejected activation usually means someone else moved the pointer, so
      // the list this view was built from is the part that is out of date.
      invalidate();
    },
  });

  const commitRename = useCallback(
    (releaseId: string) => {
      const outcome = resolveInlineRename({
        settled: settledRef.current,
        draft: draftNote,
        current: rows.find((row) => row.id === releaseId)?.note ?? null,
      });

      if (outcome.action === "ignore") {
        settledRef.current = false;
        return;
      }
      settledRef.current = true;
      if (outcome.action === "close") {
        setEditingId(null);
        return;
      }
      // Immediately close the input field so the optimistically updated row appears without waiting
      setEditingId(null);
      rename.mutate({ releaseId, note: outcome.note });
    },
    [draftNote, rename, rows],
  );

  const columns: DataTableColumn<ReleaseHistoryRow>[] = [
    {
      key: "description",
      header: "Description",
      className: "w-[25%]",
      cell: (row) =>
        editingId === row.id ? (
          /* No Save button. A one-line rename commits on Enter or on leaving
             the field and abandons on Escape, which is how renaming behaves
             everywhere else — a button here doubled the width of a cell that
             has to fit inside a table column, and it broke the row's layout. */
          <Input
            ref={renameFieldRef}
            value={draftNote}
            maxLength={MAX_RELEASE_NOTE_LENGTH}
            aria-label={`Description for release ${row.label}`}
            disabled={rename.isPending}
            onChange={(event) => setDraftNote(event.target.value)}
            onFocus={() => {
              renameFocusedRef.current = true;
            }}
            onBlur={() => {
              // Ignore spurious blurs during the initial transition while the dropdown
              // menu is closing/restoring focus (within 300ms of entering edit mode).
              if (Date.now() - editingStartedAtRef.current < 300) {
                requestAnimationFrame(() => {
                  renameFieldRef.current?.focus();
                });
                return;
              }
              if (!renameFocusedRef.current) return;
              commitRename(row.id);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitRename(row.id);
              }
              if (event.key === "Escape") {
                // Stopped so the surrounding surface does not also close.
                event.stopPropagation();
                cancelRename();
              }
            }}
            className="h-7 w-full text-sm"
          />
        ) : (
          <div className="truncate font-medium text-foreground">
            {row.note ?? (
              <span className="font-normal text-muted-foreground">Untitled</span>
            )}
          </div>
        ),
    },
    {
      key: "id",
      header: "ID",
      className: "w-[15%]",
      // Its own column because it is what matches a release to a build or a
      // log line, which a description cannot do.
      cell: (row) => (
        <code className="text-xs text-muted-foreground">{row.label}</code>
      ),
    },
    {
      key: "status",
      header: "Status",
      className: "w-[17%]",
      // One control for all three states, so they read as one scale rather
      // than a filled badge beside an outlined one beside bare text. The dot
      // colour is what distinguishes them, which is how status reads
      // everywhere else in the dashboard.
      cell: (row) =>
        row.isActive ? (
          <StatusBadge color="green" title={row.blockedReason}>
            Live
          </StatusBadge>
        ) : row.isInvalidated ? (
          // Carries the full reason, which used to sit in the actions column.
          // This is the cell that answers "why can I not activate it", so it
          // is where the explanation belongs.
          <StatusBadge color="red" title={row.blockedReason}>
            Invalidated
          </StatusBadge>
        ) : (
          <StatusBadge color="grey">Available</StatusBadge>
        ),
    },
    {
      key: "content",
      header: "Content",
      className: "w-[12%]",
      cell: (row) =>
        row.hasPublishedContent ? (
          <CheckCircle2
            className="size-3.5 text-muted-foreground"
            aria-label="Includes published content"
          />
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key: "published",
      header: "Published",
      className: "w-[21%]",
      cell: (row) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {new Date(row.createdAt).toLocaleString()}
        </span>
      ),
    },
  ];

  return (
    <RouteFullscreenSurface
      label="Release history"
      onClose={() => onOpenChange(false)}
      bodyClassName="overflow-hidden p-0"
    >
      <DataTableCard
        label="Releases"
        hideHeader
        layout="fill"
        className="h-full rounded-none ring-0"
        tableClassName="table-fixed"
        rowActionsClassName="w-[10%]"
        searchScope="release"
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        isPending={history.isPending}
        errorMessage={
          history.isError
            ? history.error instanceof Error
              ? history.error.message
              : "Failed to load release history."
            : null
        }
        onRetry={() => void history.refetch()}
        emptyTitle="No releases yet"
        emptyDescription="Publishing this theme creates the first one. Activating a release switches production to its immutable build."
        pagination={history.data?.pagination}
        // Renders the menu itself, because the card treats this as a
        // replacement for it — returning only the Activate button took Rename
        // away from every row that had one.
        //
        // Activate stays a visible button rather than a menu item: it is the
        // reason this panel exists, and burying the primary action of a screen
        // one click deeper to sit beside a rename is the wrong trade. Why a row
        // has no button is already in its Status.
        renderRowActions={(row) => (
          <div className="flex items-center justify-end gap-1">
            {row.canActivate ? (
              <Button
                type="button"
                size="xs"
                variant="outline"
                className="gap-1.5"
                disabled={activate.isPending}
                onClick={() => activate.mutate(row.id)}
              >
                {activate.isPending && activate.variables === row.id ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="size-3.5" />
                )}
                Activate
              </Button>
            ) : null}
            <RowActionsMenu
              // Rename reveals a field in this row and focuses it, so the menu
              // must not take focus back on the way out.
              keepsFocusOnClose
              actions={[
                {
                  label: "Rename",
                  onSelect: () => {
                    settledRef.current = false;
                    editingStartedAtRef.current = Date.now();
                    setDraftNote(row.note ?? "");
                    setEditingId(row.id);
                  },
                },
              ]}
            />
          </div>
        )}
      />
    </RouteFullscreenSurface>
  );
}
