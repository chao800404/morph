import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import type { StorefrontThemeFileDTO } from "@/lib/storefront/dto/storefront-theme-file.dto";
import type { LucideIcon } from "lucide-react";
import { FileCode2, FileJson, FileText, Paintbrush } from "lucide-react";

export type EditorCodeCommand = Readonly<{
  id: string;
  label: string;
  detail?: string;
  shortcut?: string;
  icon: LucideIcon;
  disabled?: boolean;
  run: () => void;
}>;

export function EditorCodeCommandCenter({
  mode,
  onModeChange,
  files,
  commands,
  onOpenFile,
}: {
  mode: "closed" | "files" | "commands";
  onModeChange: (mode: "closed" | "files" | "commands") => void;
  files: readonly StorefrontThemeFileDTO[];
  commands: readonly EditorCodeCommand[];
  onOpenFile: (path: string) => void;
}) {
  const open = mode !== "closed";

  return (
    <CommandDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onModeChange("closed");
      }}
      title={mode === "files" ? "Quick Open" : "Command Palette"}
      description={
        mode === "files"
          ? "Search files in the Theme workspace"
          : "Search Code workspace commands"
      }
      className="top-[18%] translate-y-0 sm:max-w-2xl"
    >
      <CommandInput
        placeholder={
          mode === "files" ? "Search files by name or path…" : "Type a command…"
        }
      />
      <CommandList className="max-h-[min(28rem,65vh)]">
        <CommandEmpty>
          {mode === "files" ? "No matching files" : "No matching commands"}
        </CommandEmpty>
        {mode === "files" ? (
          <CommandGroup heading="Theme workspace">
            {files.map((file) => {
              const Icon = fileIcon(file.path);
              const name = file.path.slice(file.path.lastIndexOf("/") + 1);
              return (
                <CommandItem
                  key={file.path}
                  value={`${name} ${file.path}`}
                  onSelect={() => {
                    onOpenFile(file.path);
                    onModeChange("closed");
                  }}
                >
                  <Icon className="size-4" />
                  <span className="min-w-0 flex-1 truncate">{name}</span>
                  <span className="max-w-[55%] truncate font-mono text-[10px] text-muted-foreground">
                    {file.path}
                  </span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        ) : (
          <>
            <CommandGroup heading="Code workspace">
              {commands.map((command) => {
                const Icon = command.icon;
                return (
                  <CommandItem
                    key={command.id}
                    value={`${command.label} ${command.detail ?? ""}`}
                    disabled={command.disabled}
                    onSelect={() => {
                      command.run();
                      onModeChange("closed");
                    }}
                  >
                    <Icon className="size-4" />
                    <span>{command.label}</span>
                    {command.detail ? (
                      <span className="truncate text-[10px] text-muted-foreground">
                        {command.detail}
                      </span>
                    ) : null}
                    {command.shortcut ? (
                      <CommandShortcut>{command.shortcut}</CommandShortcut>
                    ) : null}
                  </CommandItem>
                );
              })}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading="Navigation">
              <CommandItem
                value="Quick Open file"
                onSelect={() => onModeChange("files")}
              >
                <FileText className="size-4" />
                <span>Quick Open…</span>
                <CommandShortcut>Ctrl+P</CommandShortcut>
              </CommandItem>
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}

function fileIcon(path: string): LucideIcon {
  if (/\.(tsx?|jsx?)$/.test(path)) return FileCode2;
  if (path.endsWith(".css")) return Paintbrush;
  if (path.endsWith(".json")) return FileJson;
  return FileText;
}
