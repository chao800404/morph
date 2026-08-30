import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  CaseSensitive,
  ChevronDown,
  ChevronRight,
  Replace,
  Regex,
  Search,
  WholeWord,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  findEditorCodeMatches,
  type EditorCodeSearchFile,
  type EditorCodeSearchMatch,
  type EditorCodeSearchOptions,
} from "./editor-code-search";

export function EditorCodeSearchPanel({
  files,
  onOpenMatch,
  onReplaceAll,
}: {
  files: readonly EditorCodeSearchFile[];
  onOpenMatch: (match: EditorCodeSearchMatch) => void;
  onReplaceAll: (
    query: string,
    replacement: string,
    options: EditorCodeSearchOptions,
  ) => number;
}) {
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [showReplace, setShowReplace] = useState(false);
  const [options, setOptions] = useState<EditorCodeSearchOptions>({
    matchCase: false,
    wholeWord: false,
    useRegex: false,
  });
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(
    () => new Set(),
  );
  const matches = useMemo(
    () => findEditorCodeMatches(files, query, options),
    [files, options, query],
  );
  const grouped = useMemo(() => {
    const result = new Map<string, EditorCodeSearchMatch[]>();
    for (const match of matches) {
      result.set(match.path, [...(result.get(match.path) ?? []), match]);
    }
    return [...result.entries()];
  }, [matches]);

  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-label="Search workspace">
      <div className="space-y-1.5 border-b p-2">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            aria-label={showReplace ? "Hide replace" : "Show replace"}
            aria-expanded={showReplace}
            onClick={() => setShowReplace((current) => !current)}
          >
            {showReplace ? <ChevronDown /> : <ChevronRight />}
          </Button>
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search"
              aria-label="Search files"
              className="h-7 pl-7 pr-20 text-xs"
            />
            <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
              <OptionButton
                active={options.matchCase}
                label="Match Case"
                icon={CaseSensitive}
                onClick={() =>
                  setOptions((current) => ({
                    ...current,
                    matchCase: !current.matchCase,
                  }))
                }
              />
              <OptionButton
                active={options.wholeWord}
                label="Match Whole Word"
                icon={WholeWord}
                onClick={() =>
                  setOptions((current) => ({
                    ...current,
                    wholeWord: !current.wholeWord,
                  }))
                }
              />
              <OptionButton
                active={options.useRegex}
                label="Use Regular Expression"
                icon={Regex}
                onClick={() =>
                  setOptions((current) => ({
                    ...current,
                    useRegex: !current.useRegex,
                  }))
                }
              />
            </div>
          </div>
        </div>
        {showReplace ? (
          <div className="flex items-center gap-1 pl-8">
            <Input
              value={replacement}
              onChange={(event) => setReplacement(event.target.value)}
              placeholder="Replace"
              aria-label="Replace with"
              className="h-7 min-w-0 flex-1 text-xs"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              disabled={!query || matches.length === 0}
              aria-label="Replace all"
              title="Replace All"
              onClick={() => onReplaceAll(query, replacement, options)}
            >
              <Replace />
            </Button>
          </div>
        ) : null}
      </div>

      <div className="flex h-8 items-center border-b px-3 text-[10px] text-muted-foreground">
        {query
          ? `${matches.length} result${matches.length === 1 ? "" : "s"} in ${grouped.length} file${grouped.length === 1 ? "" : "s"}`
          : "Search across the Theme workspace"}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {query && matches.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-muted-foreground">
            No results found
          </p>
        ) : (
          <div className="p-1">
            {grouped.map(([path, pathMatches]) => {
              const collapsed = collapsedPaths.has(path);
              const name = path.slice(path.lastIndexOf("/") + 1);
              return (
                <div key={path}>
                  <button
                    type="button"
                    className="flex h-7 w-full min-w-0 items-center gap-1 rounded-sm px-1.5 text-left text-xs hover:bg-muted/60"
                    onClick={() =>
                      setCollapsedPaths((current) => {
                        const next = new Set(current);
                        if (next.has(path)) next.delete(path);
                        else next.add(path);
                        return next;
                      })
                    }
                  >
                    {collapsed ? <ChevronRight /> : <ChevronDown />}
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {name}
                    </span>
                    <span className="rounded bg-muted px-1 font-mono text-[9px] text-muted-foreground">
                      {pathMatches.length}
                    </span>
                  </button>
                  {!collapsed
                    ? pathMatches.map((match, index) => (
                        <button
                          key={`${match.line}:${match.column}:${index}`}
                          type="button"
                          className="flex h-7 w-full min-w-0 items-center gap-2 rounded-sm pl-6 pr-2 text-left font-mono text-[10px] text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                          onClick={() => onOpenMatch(match)}
                          title={`${path}:${match.line}:${match.column}`}
                        >
                          <span className="w-7 shrink-0 text-right tabular-nums opacity-60">
                            {match.line}
                          </span>
                          <span className="truncate">{match.preview}</span>
                        </button>
                      ))
                    : null}
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

function OptionButton({
  active,
  label,
  icon: Icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: typeof CaseSensitive;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      className={cn(
        "flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground",
        active && "bg-accent text-accent-foreground",
      )}
    >
      <Icon className="size-3" />
    </button>
  );
}
