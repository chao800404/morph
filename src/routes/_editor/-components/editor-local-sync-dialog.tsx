import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { issueThemeSyncToken } from "@/server/storefront/theme-sync.serverFn";
import { useMutation } from "@tanstack/react-query";
import { Check, Copy, FolderSync } from "lucide-react";
import { useState } from "react";

/**
 * "Link local folder": issues the token `morph-sync` uses to keep a folder on
 * this admin's machine in step with the Theme (docs/local-code-sync.md), and
 * shows the commands to run. The token is shown once, here; Morph keeps only
 * its hash. Issuing again replaces the one this admin held for the Theme.
 */
export function EditorLocalSyncDialog({
  open,
  onOpenChange,
  storefrontId,
  themeId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storefrontId: string;
  themeId: string;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const issue = useMutation({
    mutationFn: async () => {
      const result = await issueThemeSyncToken({ data: { storefrontId, themeId } });
      if (!result.success) throw new Error(result.message);
      return result.data;
    },
  });

  const copy = (key: string, text: string) => {
    void navigator.clipboard?.writeText(text).then(() => setCopied(key));
  };

  const issued = issue.data;
  // The token is pasted at the prompt, not put on the command line, where it
  // would stay in shell history.
  const linkCommand = issued
    ? `pnpm morph:sync link --dir <your folder> --origin ${issued.origin}`
    : "";
  const startCommand = "pnpm morph:sync start --dir <your folder>";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          issue.reset();
          setCopied(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderSync className="size-4 text-primary" />
            Link local folder
          </DialogTitle>
          <DialogDescription>
            Keep a folder on your machine in step with this Theme&apos;s code,
            both ways. Edits there appear here; edits here, in Code or Design,
            are written there. When both sides change one file, both copies
            are kept and you choose.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-2 space-y-3 text-xs">
          {!issued ? (
            <>
              <p className="text-muted-foreground">
                The token lets the folder read and write this Theme&apos;s source
                files only, for 30 days. Creating one replaces any token you
                already have for this Theme.
              </p>
              <Button
                size="sm"
                disabled={issue.isPending}
                onClick={() => issue.mutate()}
              >
                {issue.isPending ? "Creating…" : "Create token"}
              </Button>
              {issue.isError ? (
                <p role="alert" className="text-destructive">
                  {issue.error instanceof Error
                    ? issue.error.message
                    : "The token could not be created."}
                </p>
              ) : null}
            </>
          ) : (
            <>
              <p className="text-muted-foreground">
                Run these from the Morph repository. The token is shown only
                now; it is valid until{" "}
                {new Date(issued.expiresAt).toLocaleDateString()}.
              </p>
              <CommandLine
                label="1. Link the folder"
                text={linkCommand}
                copied={copied === "link"}
                onCopy={() => copy("link", linkCommand)}
              />
              <CommandLine
                label="2. Paste this token when asked"
                text={issued.token}
                copied={copied === "token"}
                onCopy={() => copy("token", issued.token)}
              />
              <CommandLine
                label="3. Start syncing"
                text={startCommand}
                copied={copied === "start"}
                onCopy={() => copy("start", startCommand)}
              />
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CommandLine({
  label,
  text,
  copied,
  onCopy,
}: {
  label: string;
  text: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="space-y-1">
      <div className="font-medium">{label}</div>
      <div className="flex items-start gap-2 rounded-md border bg-muted/30 p-2">
        <code className="min-w-0 flex-1 break-all font-mono text-[11px]">
          {text}
        </code>
        <Button
          size="icon"
          variant="ghost"
          className="size-6 shrink-0"
          aria-label={`Copy: ${label}`}
          onClick={onCopy}
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
        </Button>
      </div>
    </div>
  );
}
