import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import type { StorefrontThemeEditorSearch } from "@/lib/validations/storefront-theme";
import { cn } from "@/lib/utils";
import {
  ChevronRight,
  History,
  MoreHorizontal,
  Paperclip,
  Plus,
  SendHorizontal,
  WandSparkles,
} from "lucide-react";
import { memo, useState } from "react";
import {
  resolveEditorTemplate,
  toEditorTemplateSearch,
} from "./editor-template";

type EditorAssistantPanelProps = {
  context: StorefrontThemeEditorDTO;
  search: StorefrontThemeEditorSearch;
  onSearchChange: (next: Partial<StorefrontThemeEditorSearch>) => void;
};

export const EditorAssistantPanel = memo(function EditorAssistantPanel({
  context,
  search,
  onSearchChange,
}: EditorAssistantPanelProps) {
  const [tab, setTab] = useState<"styles" | "chat">("chat");
  const activeTemplate = resolveEditorTemplate(context, search);
  const sections = activeTemplate?.document.sections ?? [];

  return (
    <aside className="m-3 ml-0 grid w-[21rem] min-h-0 grid-rows-[3.25rem_minmax(0,1fr)_auto] overflow-hidden rounded-xl border bg-component shadow-lg max-md:hidden xl:w-[25rem]">
      <header className="flex items-center justify-between border-b px-2.5">
        <div className="flex items-center gap-1">
          <PanelTab active={tab === "styles"} onClick={() => setTab("styles")}>
            Styles
          </PanelTab>
          <PanelTab active={tab === "chat"} onClick={() => setTab("chat")}>
            AI Chat
          </PanelTab>
        </div>
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon" disabled aria-label="New chat">
            <Plus />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled
            aria-label="Chat history"
          >
            <History />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled
            aria-label="More chat actions"
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
              AI authoring is not connected yet
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
          <div className="space-y-4 p-3">
            <Select
              value={activeTemplate?.id}
              onValueChange={(templateId) => {
                const template = context.templates.find(
                  (candidate) => candidate.id === templateId,
                );
                if (template) onSearchChange(toEditorTemplateSearch(template));
              }}
            >
              <SelectTrigger size="sm" aria-label="Template">
                <SelectValue placeholder="Select template" />
              </SelectTrigger>
              <SelectContent align="end">
                {context.templates.map((template) => (
                  <SelectItem key={template.id} value={template.id}>
                    {template.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="space-y-1">
              <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">
                Template sections
              </p>
              {sections.length > 0 ? (
                sections.map((section) => (
                  <button
                    key={section.id}
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      search.section === section.id && "bg-accent",
                    )}
                    onClick={() => onSearchChange({ section: section.id })}
                  >
                    <span className="size-1.5 rounded-full bg-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">
                      {section.type}
                    </span>
                    <ChevronRight className="size-3.5 text-muted-foreground" />
                  </button>
                ))
              ) : (
                <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                  This template has no sections yet.
                </div>
              )}
            </div>
          </div>
        </ScrollArea>
      )}

      <div className="space-y-2 p-3 pt-0">
        <div className="rounded-lg border bg-background p-2 shadow-sm focus-within:ring-2 focus-within:ring-ring/40">
          <Textarea
            rows={2}
            disabled
            placeholder="Add a follow-up..."
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
          AI authoring will use validated draft revisions.
        </p>
      </div>
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
