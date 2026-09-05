import { Button } from "@/components/ui/button";
import type { ContentFieldOrderNode } from "@/lib/storefront/editor/content-field-order";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import type {
  StorefrontCommentGroupDTO,
  StorefrontCommentThreadDTO,
} from "@/lib/storefront/dto/storefront-comment.dto";
import type { StorefrontThemeFileDTO } from "@/lib/storefront/dto/storefront-theme-file.dto";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import type { StorefrontThemeEditorSearch } from "@/lib/validations/storefront-theme";
import { cn } from "@/lib/utils";
import {
  History,
  Layers3,
  MoreHorizontal,
  Paperclip,
  Plus,
  SendHorizontal,
  WandSparkles,
} from "lucide-react";
import { memo, useCallback, useEffect, useState } from "react";
import { EditorCommentsSidebar } from "./editor-comments-sidebar";
import { scheduleInspectorPreRender } from "./editor-inspector-pre-render";
import {
  EditorStyleInspector,
  type InspectorPropsChangeOptions,
} from "./editor-style-inspector";
import { resolveEditorTemplate } from "./editor-template";
import type { EditorSelectionDescriptor } from "@/lib/storefront/editor/selection-taxonomy";
import type { ThemeInstanceStyleTarget } from "@/lib/storefront/editor/theme-instance-style-source";

type EditorAssistantPanelProps = {
  context: StorefrontThemeEditorDTO;
  search: StorefrontThemeEditorSearch;
  style?: React.CSSProperties;
  className?: string;
  isCommentMode?: boolean;
  themeFiles?: StorefrontThemeFileDTO[];
  selection?: EditorSelectionDescriptor | null;
  /** Preview nodes in document order; orders the Content tab's fields. */
  editableNodes?: readonly ContentFieldOrderNode[];
  activeComputedStyleRevision?: number;
  activeViewport?: StorefrontThemeEditorSearch["viewport"];
  onUpdateThemeFileStyle?: (
    filePath: string,
    elementName: string,
    updater: (prevClasses: string) => string,
    instanceTarget?: ThemeInstanceStyleTarget,
  ) => number | void;
  onPreviewSelectionStyle?: (
    styles: Record<string, string>,
    targetElement: string,
  ) => void;
  onPreviewSelectionField?: (
    fieldKey: string,
    fieldPath: string | null,
    value: string,
  ) => void;
  onRepairThemeLinkBinding?: (
    filePath: string,
    fieldKey: string,
  ) => Promise<boolean> | boolean;
  onSwitchThemeLinkElement?: (
    filePath: string,
    fieldKey: string,
    target: "router" | "anchor",
  ) => Promise<boolean> | boolean;
  commentFilter?: "open" | "resolved";
  onCommentFilterChange?: (filter: "open" | "resolved") => void;
  commentGroups?: StorefrontCommentGroupDTO[];
  activeCommentGroupId?: string | null;
  onSelectCommentGroup?: (groupId: string) => void;
  onCreateCommentGroup?: () => void;
  commentThreads?: StorefrontCommentThreadDTO[];
  activeCommentThreadId?: string | null;
  onSelectCommentThread?: (threadId: string | null) => void;
  previewWidth?: number;
  onSectionPropsChange?: (
    sectionId: string,
    nextProps: Record<string, unknown>,
    options?: InspectorPropsChangeOptions,
  ) => void;
  onJumpToCode?: (filePath: string, line?: number, column?: number) => void;
  onTabChange?: (tab: EditorAssistantPanelTab) => void;
};

export type EditorAssistantPanelTab =
  "chat" | "content" | "styles" | "comments";

export const EDITOR_ASSISTANT_PANEL_TAB_STORAGE_KEY =
  "morph:editor-assistant-panel-tab";

const persistedEditorAssistantPanelTabs = [
  "chat",
  "content",
  "styles",
] as const satisfies readonly EditorAssistantPanelTab[];

type PersistedEditorAssistantPanelTab =
  (typeof persistedEditorAssistantPanelTabs)[number];

function isPersistedEditorAssistantPanelTab(
  value: string | null | undefined,
): value is PersistedEditorAssistantPanelTab {
  return persistedEditorAssistantPanelTabs.some((tab) => tab === value);
}

/** Narrows a stored value to a tab that may be restored. */
export function readEditorAssistantPanelTab(
  value: string | null | undefined,
): EditorAssistantPanelTab {
  return isPersistedEditorAssistantPanelTab(value) ? value : "chat";
}

/**
 * The last inspector tab, for a client that has no server-provided value.
 *
 * Not used to seed the first render. The server cannot read `localStorage`, so
 * rendering the stored tab on the client's first pass and the default on the
 * server is a hydration mismatch — React discards the server tree and rebuilds
 * it. The tab therefore travels in a cookie, exactly as the panel widths do,
 * and this remains only as the fallback for a client that somehow has one and
 * not the other. Comment mode is transient and is never persisted.
 */
export function readStoredEditorAssistantPanelTab(): EditorAssistantPanelTab {
  if (typeof window === "undefined") return "chat";

  try {
    return readEditorAssistantPanelTab(
      window.localStorage.getItem(EDITOR_ASSISTANT_PANEL_TAB_STORAGE_KEY),
    );
  } catch {
    return "chat";
  }
}

export function persistEditorAssistantPanelTab(tab: EditorAssistantPanelTab) {
  if (
    typeof window === "undefined" ||
    !isPersistedEditorAssistantPanelTab(tab)
  ) {
    return;
  }

  try {
    window.localStorage.setItem(EDITOR_ASSISTANT_PANEL_TAB_STORAGE_KEY, tab);
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
  try {
    // Also a cookie, so the server renders the same tab the client will. This
    // is what the panel widths already do, and what keeps the first paint from
    // being thrown away.
    document.cookie = `${EDITOR_ASSISTANT_PANEL_TAB_STORAGE_KEY}=${tab}; path=/; max-age=31536000; SameSite=Lax`;
  } catch {
    // See above.
  }
}

export const EditorAssistantPanel = memo(function EditorAssistantPanel({
  context,
  search,
  style,
  className,
  isCommentMode = false,
  commentFilter = "open",
  onCommentFilterChange,
  commentGroups = [],
  activeCommentGroupId = null,
  onSelectCommentGroup,
  onCreateCommentGroup,
  commentThreads = [],
  activeCommentThreadId = null,
  onSelectCommentThread,
  previewWidth,
  themeFiles,
  selection,
  editableNodes,
  activeComputedStyleRevision,
  activeViewport,
  onUpdateThemeFileStyle,
  onPreviewSelectionStyle,
  onPreviewSelectionField,
  onRepairThemeLinkBinding,
  onSwitchThemeLinkElement,
  onSectionPropsChange,
  onJumpToCode,
  onTabChange,
}: EditorAssistantPanelProps) {
  // Seeded from the value the server already resolved, so both renders agree.
  const [tab, setTab] = useState<EditorAssistantPanelTab>(() =>
    readEditorAssistantPanelTab(context.panelTab),
  );
  const activeTemplate = resolveEditorTemplate(context, search);
  const sections = activeTemplate?.document.sections ?? [];
  const documentSection = sections.find(
    (section) => section.id === search.section,
  );
  const selectionSection = sections.find(
    (section) => section.id === selection?.sectionId,
  );
  /**
   * Section the inspector renders for.
   *
   * A component authored purely in code has no Document section, so requiring
   * one would leave the Styles panel empty for exactly the components a
   * customer writes themselves. Style edits do not need the Document — they are
   * patched into the Theme source — so a selection-derived stand-in is enough
   * to inspect and restyle it. Content fields stay empty because there is no
   * Document slot to write values into yet.
   */
  const selectedSection: typeof documentSection =
    selectionSection ??
    documentSection ??
    (selection?.sectionId
      ? ({
          id: selection.sectionId,
          type: selection.componentType ?? "custom",
          enabled: true,
          props: {},
        } as NonNullable<typeof documentSection>)
      : undefined);

  const [isStylesPreRendered, setIsStylesPreRendered] = useState(false);
  const isInspectorTab = tab === "styles" || tab === "content";
  const shouldRenderStyles = isStylesPreRendered || isInspectorTab;

  useEffect(() => {
    if (isStylesPreRendered || !selectedSection) return;
    return scheduleInspectorPreRender(
      () => setIsStylesPreRendered(true),
      window,
    );
  }, [isStylesPreRendered, selectedSection]);

  useEffect(() => {
    if (isInspectorTab && !isStylesPreRendered) {
      setIsStylesPreRendered(true);
    }
  }, [isInspectorTab, isStylesPreRendered]);

  const handleInspectorPropsChange = useCallback(
    (
      nextProps: Record<string, unknown>,
      options?: InspectorPropsChangeOptions,
    ) => {
      // Never write content for a stand-in: there is no Document section to
      // receive it, and the server would reject the mutation anyway.
      if (documentSection) {
        onSectionPropsChange?.(documentSection.id, nextProps, options);
      }
    },
    [documentSection, onSectionPropsChange],
  );

  useEffect(() => {
    onTabChange?.(tab);
  }, [onTabChange, tab]);

  useEffect(() => {
    persistEditorAssistantPanelTab(tab);
  }, [tab]);

  // Auto-switch to comments tab when switching to Comment Mode
  useEffect(() => {
    if (isCommentMode) {
      setTab("comments");
    } else {
      setTab((prev) => (prev === "comments" ? "styles" : prev));
    }
  }, [isCommentMode]);

  return (
    <aside
      data-editor-inspector-panel
      style={style}
      className={cn(
        "m-3 ml-0 grid min-h-0 shrink-0 grid-cols-1 overflow-hidden rounded-xl border bg-component shadow-lg max-md:hidden",
        tab === "chat"
          ? "grid-rows-[3.25rem_minmax(0,1fr)_auto]"
          : "grid-rows-[3.25rem_minmax(0,1fr)]",
        className,
      )}
    >
      <header className="flex items-center justify-between border-b px-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <PanelTab active={tab === "chat"} onClick={() => setTab("chat")}>
            Agent
          </PanelTab>

          {isCommentMode ? (
            <PanelTab
              active={tab === "comments"}
              onClick={() => setTab("comments")}
            >
              Comments
            </PanelTab>
          ) : (
            <>
              {/* Content edits the Page/Template Document; Styles edits the
                  Theme Source. Rule §2 keeps those apart, and one scrolling
                  panel gave no clue which source of truth a field wrote to. */}
              <PanelTab
                active={tab === "content"}
                onClick={() => setTab("content")}
              >
                Content
              </PanelTab>
              <PanelTab
                active={tab === "styles"}
                onClick={() => setTab("styles")}
              >
                Styles
              </PanelTab>
            </>
          )}
        </div>
        {/* Never squeezed by the tab row: the actions keep their size and the
            tabs, which are sized to their labels, take whatever is left. */}
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            disabled={tab !== "comments" && !onCreateCommentGroup}
            aria-label={
              tab === "comments" ? "Create comment group" : "New agent session"
            }
            title={
              tab === "comments"
                ? "Create comment group (+)"
                : "New agent session"
            }
            onClick={tab === "comments" ? onCreateCommentGroup : undefined}
          >
            <Plus />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled
            aria-label="Agent history"
          >
            <History />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled
            aria-label="More agent actions"
          >
            <MoreHorizontal />
          </Button>
        </div>
      </header>

      {tab === "chat" ? (
        <ScrollArea className="min-h-0">
          <div className="flex min-h-64 flex-col items-center justify-center px-6 py-10 text-center">
            <div className="flex size-10 items-center justify-center rounded-lg border bg-background shadow-xs">
              <WandSparkles className="size-4 text-muted-foreground" />
            </div>
            <h3 className="mt-4 text-sm font-medium">
              AI Agent is not connected yet
            </h3>
            <p className="mt-1.5 max-w-64 text-xs leading-relaxed text-muted-foreground">
              When enabled, prompts will create validated draft revisions for
              {` ${context.storefront.name}`}. Nothing has been generated or
              proposed yet.
            </p>
          </div>
        </ScrollArea>
      ) : tab === "comments" ? (
        activeTemplate ? (
          <EditorCommentsSidebar
            storefrontId={context.storefront.id}
            themeId={context.theme.id}
            templateId={activeTemplate.id}
            filter={commentFilter}
            onFilterChange={onCommentFilterChange}
            groups={commentGroups}
            activeGroupId={activeCommentGroupId}
            onSelectGroup={(groupId) => onSelectCommentGroup?.(groupId)}
            threads={commentThreads}
            activeThreadId={activeCommentThreadId}
            onSelectThread={(threadId) => onSelectCommentThread?.(threadId)}
            previewWidth={previewWidth}
            onCreateGroup={onCreateCommentGroup}
          />
        ) : (
          <div className="flex min-h-64 flex-col items-center justify-center px-6 py-10 text-center text-muted-foreground">
            <p className="text-xs">No active template</p>
          </div>
        )
      ) : null}

      {shouldRenderStyles ? (
        <ScrollArea
          className="min-h-0"
          hidden={!isInspectorTab}
          aria-hidden={!isInspectorTab}
        >
          {selectedSection ? (
            <EditorStyleInspector
              view={tab === "content" ? "content" : "styles"}
              section={selectedSection}
              themeFiles={themeFiles}
              selection={selection}
              editableNodes={editableNodes}
              activeComputedStyleRevision={activeComputedStyleRevision}
              activeViewport={activeViewport ?? search.viewport}
              onUpdateThemeFileStyle={onUpdateThemeFileStyle}
              onPreviewSelectionStyle={onPreviewSelectionStyle}
              onPreviewSelectionField={onPreviewSelectionField}
              onRepairThemeLinkBinding={onRepairThemeLinkBinding}
              onSwitchThemeLinkElement={onSwitchThemeLinkElement}
              onPropsChange={handleInspectorPropsChange}
              onJumpToCode={onJumpToCode}
            />
          ) : (
            <div className="flex min-h-64 flex-col items-center justify-center px-6 py-10 text-center">
              <div className="flex size-10 items-center justify-center rounded-lg border bg-background shadow-xs">
                <Layers3 className="size-4 text-muted-foreground" />
              </div>
              <h3 className="mt-4 text-sm font-medium">Select a component</h3>
              <p className="mt-1.5 max-w-64 text-xs leading-relaxed text-muted-foreground">
                Click any component or section on the canvas to inspect and edit
                its design properties.
              </p>
            </div>
          )}
        </ScrollArea>
      ) : null}

      {tab === "chat" ? (
        <div className="space-y-2 p-3 pt-0">
          <div className="rounded-lg border bg-background p-2 shadow-sm focus-within:ring-2 focus-within:ring-ring/40">
            <Textarea
              rows={2}
              disabled
              placeholder="Ask Agent to design or edit storefront..."
              className="min-h-14 resize-none border-0 bg-transparent px-1 py-1 shadow-none focus-visible:ring-0"
            />
            <div className="mt-1 flex items-center justify-between">
              <Button
                variant="ghost"
                size="icon"
                disabled
                aria-label="Attach file"
              >
                <Paperclip />
              </Button>
              <Button
                size="icon"
                disabled
                aria-label="Send prompt"
                rounded="full"
              >
                <SendHorizontal />
              </Button>
            </div>
          </div>
          <p className="text-center text-[11px] text-muted-foreground">
            Agent authoring will use validated draft revisions.
          </p>
        </div>
      ) : null}
    </aside>
  );
});

function PanelTab({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant={active ? "toolbarActive" : "ghost"}
      size="xs"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        // Sized to its label, not stretched: `flex-1` made three short words
        // span the whole panel header, so each tab was several times wider
        // than its text and the row stopped reading as a set of tabs.
        "h-7 min-w-0 px-2 text-xs font-medium transition-colors",
        active
          ? "cursor-default"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </Button>
  );
}
