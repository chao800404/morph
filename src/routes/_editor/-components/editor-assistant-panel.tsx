import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
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
import { memo, useEffect, useState } from "react";
import { EditorStyleInspector } from "./editor-style-inspector";
import { resolveEditorTemplate } from "./editor-template";

type EditorAssistantPanelProps = {
  context: StorefrontThemeEditorDTO;
  search: StorefrontThemeEditorSearch;
  style?: React.CSSProperties;
  className?: string;
  onSectionPropsChange?: (
    sectionId: string,
    nextProps: Record<string, unknown>,
  ) => void;
  onSectionToggleEnabled?: (sectionId: string, enabled: boolean) => void;
};

export const EditorAssistantPanel = memo(function EditorAssistantPanel({
  context,
  search,
  style,
  className,
  onSectionPropsChange,
  onSectionToggleEnabled,
}: EditorAssistantPanelProps) {
  const [tab, setTab] = useState<"chat" | "styles">("chat");
  const activeTemplate = resolveEditorTemplate(context, search);
  const sections = activeTemplate?.document.sections ?? [];
  const selectedSection = sections.find(
    (section) => section.id === search.section,
  );

  useEffect(() => {
    if (search.section) {
      setTab("styles");
    }
  }, [search.section]);

  return (
    <aside
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
          <PanelTab active={tab === "styles"} onClick={() => setTab("styles")}>
            Styles
          </PanelTab>
        </div>
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon" disabled aria-label="New agent session">
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
      ) : (
        <ScrollArea className="min-h-0">
          {selectedSection ? (
            <EditorStyleInspector
              section={selectedSection}
              onPropsChange={(nextProps) =>
                onSectionPropsChange?.(selectedSection.id, nextProps)
              }
              onToggleEnabled={(enabled) =>
                onSectionToggleEnabled?.(selectedSection.id, enabled)
              }
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
      )}

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
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active && "bg-muted font-medium text-foreground shadow-xs",
      )}
    >
      {children}
    </button>
  );
}
