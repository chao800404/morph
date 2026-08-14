import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import type { StorefrontThemeEditorSearch } from "@/lib/validations/storefront-theme";
import { cn } from "@/lib/utils";
import {
  CircleOff,
  History,
  Layers3,
  MoreHorizontal,
  Paperclip,
  Plus,
  SendHorizontal,
  WandSparkles,
} from "lucide-react";
import { memo, useState } from "react";
import { resolveEditorTemplate } from "./editor-template";

type EditorAssistantPanelProps = {
  context: StorefrontThemeEditorDTO;
  search: StorefrontThemeEditorSearch;
};

export const EditorAssistantPanel = memo(function EditorAssistantPanel({
  context,
  search,
}: EditorAssistantPanelProps) {
  const [tab, setTab] = useState<"styles" | "chat">("chat");
  const activeTemplate = resolveEditorTemplate(context, search);
  const sections = activeTemplate?.document.sections ?? [];
  const selectedSection = sections.find(
    (section) => section.id === search.section,
  );

  return (
    <aside
      className={cn(
        "m-3 ml-0 grid w-[21rem] min-h-0 overflow-hidden rounded-xl border bg-component shadow-lg max-md:hidden xl:w-[25rem]",
        tab === "chat"
          ? "grid-rows-[3.25rem_minmax(0,1fr)_auto]"
          : "grid-rows-[3.25rem_minmax(0,1fr)]",
      )}
    >
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
          {selectedSection ? (
            <SectionSettings section={selectedSection} />
          ) : (
            <div className="flex min-h-64 flex-col items-center justify-center px-6 py-10 text-center">
              <div className="flex size-10 items-center justify-center rounded-lg border bg-background shadow-xs">
                <Layers3 className="size-4 text-muted-foreground" />
              </div>
              <h3 className="mt-4 text-sm font-medium">Select a section</h3>
              <p className="mt-1.5 max-w-64 text-xs leading-relaxed text-muted-foreground">
                Choose a section from the left sidebar to inspect its current
                settings.
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
      ) : null}
    </aside>
  );
});

type EditorSection = NonNullable<
  StorefrontThemeEditorDTO["templates"][number]
>["document"]["sections"][number];

function SectionSettings({ section }: { section: EditorSection }) {
  const properties = Object.entries(section.props);

  return (
    <div className="space-y-4 p-3">
      <div className="rounded-lg border bg-background p-3 shadow-xs">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{section.type}</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {section.id}
            </p>
          </div>
          <span
            className={cn(
              "rounded-full px-2 py-1 text-[11px] font-medium",
              section.enabled
                ? "bg-primary/10 text-primary"
                : "bg-muted text-muted-foreground",
            )}
          >
            {section.enabled ? "Enabled" : "Hidden"}
          </span>
        </div>
      </div>

      <div className="space-y-2">
        <p className="px-1 text-xs font-medium text-muted-foreground">
          Section properties
        </p>
        {properties.length > 0 ? (
          properties.map(([name, value]) => (
            <div
              key={name}
              className="rounded-lg border bg-background px-3 py-2.5 shadow-xs"
            >
              <p className="text-xs font-medium">{formatPropertyName(name)}</p>
              <p className="mt-1 line-clamp-3 break-words text-xs leading-relaxed text-muted-foreground">
                {formatPropertyValue(value)}
              </p>
            </div>
          ))
        ) : (
          <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
            This section has no configurable properties.
          </div>
        )}
      </div>

      <div className="flex gap-2 rounded-lg border border-dashed p-3 text-xs leading-relaxed text-muted-foreground">
        <CircleOff className="mt-0.5 size-3.5 shrink-0" />
        Editing stays read-only until draft revisions and publish validation are
        connected.
      </div>
    </div>
  );
}

function formatPropertyName(name: string) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/^./, (character) => character.toUpperCase());
}

function formatPropertyValue(value: unknown) {
  if (typeof value === "string") return value || "—";
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) return `${value.length} items`;
  return "Configured object";
}

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
