import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  AlertTriangle,
  Braces,
  CheckCircle2,
  X,
} from "lucide-react";

export type EditorCodeDiagnostic = Readonly<{
  id: string;
  path: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  message: string;
  source?: string;
  severity: "error" | "warning" | "info";
}>;

export function EditorCodeStatusPanel({
  open,
  activeTab,
  onActiveTabChange,
  onClose,
  diagnostics,
  output,
  onOpenDiagnostic,
}: {
  open: boolean;
  activeTab: "problems" | "output";
  onActiveTabChange: (tab: "problems" | "output") => void;
  onClose: () => void;
  diagnostics: readonly EditorCodeDiagnostic[];
  output: readonly string[];
  onOpenDiagnostic: (diagnostic: EditorCodeDiagnostic) => void;
}) {
  if (!open) return null;
  const errorCount = diagnostics.filter(
    (item) => item.severity === "error",
  ).length;
  const warningCount = diagnostics.filter(
    (item) => item.severity === "warning",
  ).length;

  return (
    <section
      className="flex h-48 shrink-0 flex-col border-t bg-background"
      aria-label="Code panel"
    >
      <header className="flex h-9 shrink-0 items-center gap-1 border-b px-2">
        <PanelTab
          active={activeTab === "problems"}
          onClick={() => onActiveTabChange("problems")}
        >
          Problems
          <span className="rounded bg-muted px-1 text-[9px] tabular-nums">
            {diagnostics.length}
          </span>
        </PanelTab>
        <PanelTab
          active={activeTab === "output"}
          onClick={() => onActiveTabChange("output")}
        >
          Output
        </PanelTab>
        <div className="ml-auto flex items-center gap-2 text-[10px] text-muted-foreground">
          {errorCount > 0 ? (
            <span className="flex items-center gap-1">
              <AlertCircle className="size-3 text-destructive" /> {errorCount}
            </span>
          ) : null}
          {warningCount > 0 ? (
            <span className="flex items-center gap-1">
              <AlertTriangle className="size-3 text-amber-500" /> {warningCount}
            </span>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label="Close panel"
            onClick={onClose}
          >
            <X />
          </Button>
        </div>
      </header>
      <ScrollArea className="min-h-0 flex-1">
        {activeTab === "problems" ? (
          diagnostics.length > 0 ? (
            <div className="py-1">
              {diagnostics.map((diagnostic) => {
                const Icon =
                  diagnostic.severity === "error"
                    ? AlertCircle
                    : diagnostic.severity === "warning"
                      ? AlertTriangle
                      : Braces;
                return (
                  <button
                    key={diagnostic.id}
                    type="button"
                    className="flex min-h-7 w-full min-w-0 items-start gap-2 px-3 py-1 text-left text-xs hover:bg-muted/60"
                    onClick={() => onOpenDiagnostic(diagnostic)}
                  >
                    <Icon
                      className={cn(
                        "mt-0.5 size-3.5 shrink-0",
                        diagnostic.severity === "error"
                          ? "text-destructive"
                          : diagnostic.severity === "warning"
                            ? "text-amber-500"
                            : "text-blue-500",
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {diagnostic.message}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {diagnostic.path}:{diagnostic.line}:{diagnostic.column}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="flex h-28 items-center justify-center gap-2 text-xs text-muted-foreground">
              <CheckCircle2 className="size-4 text-emerald-500" />
              No problems detected
            </div>
          )
        ) : output.length > 0 ? (
          <pre className="whitespace-pre-wrap px-3 py-2 font-mono text-[11px] leading-5 text-foreground/80">
            {output.join("\n")}
          </pre>
        ) : (
          <div className="flex h-28 items-center justify-center text-xs text-muted-foreground">
            Workspace output will appear here
          </div>
        )}
      </ScrollArea>
    </section>
  );
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
      className={cn(
        "relative flex h-8 items-center gap-1.5 px-2 text-[11px] uppercase tracking-wide text-muted-foreground hover:text-foreground",
        active &&
          "text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-px after:bg-primary",
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
