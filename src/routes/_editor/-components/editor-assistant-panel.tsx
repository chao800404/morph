import { Button } from "@/components/ui/button";
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
import { memo, useCallback, useEffect, useRef, useState } from "react";
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

export type EditorAssistantPanelTab = "chat" | "styles" | "comments";

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
  activeComputedStyleRevision,
  activeViewport,
  onUpdateThemeFileStyle,
  onPreviewSelectionStyle,
  onPreviewSelectionField,
  onSectionPropsChange,
  onJumpToCode,
  onTabChange,
}: EditorAssistantPanelProps) {
  const [tab, setTab] = useState<EditorAssistantPanelTab>("chat");
  const activeTemplate = resolveEditorTemplate(context, search);
  const sections = activeTemplate?.document.sections ?? [];
  const documentSection = sections.find(
    (section) => section.id === search.section,
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
    documentSection ??
    (selection?.sectionId
      ? ({
          id: selection.sectionId,
          type: selection.componentType ?? "custom",
          enabled: true,
          props: {},
        } as NonNullable<typeof documentSection>)
      : undefined);

  const initialSectionRef = useRef(search.section);
  const [isStylesPreRendered, setIsStylesPreRendered] = useState(false);
  const shouldRenderStyles = isStylesPreRendered || tab === "styles";

  useEffect(() => {
    if (isStylesPreRendered || !selectedSection) return;
    return scheduleInspectorPreRender(
      () => setIsStylesPreRendered(true),
      window,
    );
  }, [isStylesPreRendered, selectedSection]);

  useEffect(() => {
    if (tab === "styles" && !isStylesPreRendered) {
      setIsStylesPreRendered(true);
    }
  }, [isStylesPreRendered, tab]);

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

  // Auto-switch to comments tab when switching to Comment Mode
  useEffect(() => {
    if (isCommentMode) {
      setTab("comments");
    } else {
      setTab((prev) => (prev === "comments" ? "styles" : prev));
    }
  }, [isCommentMode]);

  useEffect(() => {
    // Only switch to styles when the user actively selects/changes a section during their session
    if (
      !isCommentMode &&
      search.section &&
      search.section !== initialSectionRef.current
    ) {
      setTab("styles");
    }
    initialSectionRef.current = search.section;
  }, [search.section, isCommentMode]);

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
        <div className="flex items-center gap-1">
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
            <PanelTab
              active={tab === "styles"}
              onClick={() => setTab("styles")}
            >
              Styles
            </PanelTab>
          )}
        </div>
        <div className="flex items-center gap-0.5">
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
          hidden={tab !== "styles"}
          aria-hidden={tab !== "styles"}
        >
          {selectedSection ? (
            <EditorStyleInspector
              section={selectedSection}
              themeFiles={themeFiles}
              selection={selection}
              activeComputedStyleRevision={activeComputedStyleRevision}
              activeViewport={activeViewport ?? search.viewport}
              onUpdateThemeFileStyle={onUpdateThemeFileStyle}
              onPreviewSelectionStyle={onPreviewSelectionStyle}
              onPreviewSelectionField={onPreviewSelectionField}
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
        "h-7 px-2.5 text-xs font-medium transition-colors",
        active
          ? "cursor-default"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </Button>
  );
}
