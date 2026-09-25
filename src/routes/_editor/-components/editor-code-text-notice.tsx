import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  describeTextPromotionRefusal,
  type TextPromotionAnalysis,
} from "@/lib/storefront/editor/text-promotion";
import { isValidTextFieldName } from "@/lib/storefront/editor/text-promotion-rewrite";
import type {
  TextPromotionOutcome,
  TextPromotionRequest,
} from "@/lib/storefront/editor/text-promotion-request";

/**
 * What the Content tab says about fixed text written in the component, and
 * the way to make it editable.
 *
 * Making it editable writes the component once — the text becomes a prop
 * whose default is the text — and stores the author's version as this page's
 * value. The field name is the author's to confirm, since it is what they
 * will see in Code from then on. A component shared with anything else is not
 * changed on the first press: the author is shown everything it reaches, and
 * a copy for this page is the first way out offered.
 */

type Phase =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "shared"; impact: readonly string[] }
  | { kind: "copied" }
  | { kind: "failed"; message: string };

export function EditorCodeTextNotice({
  analysis,
  sectionId,
  componentSourcePath,
  targetKey,
  onPromote,
  onCreatePageCopy,
}: {
  analysis: TextPromotionAnalysis;
  sectionId?: string;
  componentSourcePath?: string;
  targetKey?: string;
  onPromote?: (request: TextPromotionRequest) => Promise<TextPromotionOutcome>;
  onCreatePageCopy?: (
    sectionId: string,
  ) => Promise<{ success: boolean; message?: string }>;
}) {
  const text = analysis.text;
  const convertible = analysis.status === "convertible";
  const [value, setValue] = useState(text ?? "");
  const [fieldName, setFieldName] = useState(
    convertible ? analysis.suggestedName : "",
  );
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const nameProblem = !convertible
    ? null
    : !isValidTextFieldName(fieldName)
      ? "Use letters and digits, starting with a letter."
      : analysis.reservedNames.includes(fieldName)
        ? "The component already uses this name."
        : null;
  const canPromote =
    convertible &&
    onPromote !== undefined &&
    sectionId !== undefined &&
    componentSourcePath !== undefined &&
    targetKey !== undefined;

  const promote = async (confirmedImpact?: readonly string[]) => {
    if (!canPromote || nameProblem) return;
    setPhase({ kind: "saving" });
    const outcome = await onPromote({
      sectionId,
      componentSourcePath,
      targetKey,
      fieldName,
      value,
      confirmedImpact,
    });
    if (outcome.status === "shared") {
      setPhase({ kind: "shared", impact: outcome.impact });
    } else if (outcome.status === "failed") {
      setPhase({ kind: "failed", message: outcome.message });
    } else {
      setPhase({ kind: "idle" });
    }
  };

  const createCopy = async () => {
    if (!onCreatePageCopy || !sectionId) return;
    setPhase({ kind: "saving" });
    const result = await onCreatePageCopy(sectionId);
    setPhase(
      result.success
        ? { kind: "copied" }
        : {
            kind: "failed",
            message: result.message ?? "The copy could not be created.",
          },
    );
  };

  const saving = phase.kind === "saving";
  const isLayout = convertible && analysis.callSite.scope === "layout";

  return (
    <div
      className="rounded-xl border border-dashed p-3"
      data-testid="editor-code-text-notice"
      data-status={analysis.status}
    >
      <p className="text-xs font-medium">Written in code</p>
      {text && !canPromote ? (
        <p className="mt-1.5 line-clamp-3 break-words rounded-md bg-muted px-2 py-1.5 text-xs">
          {text}
        </p>
      ) : null}
      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
        {analysis.status === "convertible"
          ? isLayout
            ? "This text can become a field of this section. The section is part of the layout, so its value is shared by every page."
            : "This text can become a field of this section, with its current text as the default."
          : `Edit it in Code. ${describeTextPromotionRefusal(analysis.reason)}`}
      </p>

      {canPromote ? (
        <div className="mt-3 space-y-2.5">
          <label className="block space-y-1">
            <span className="text-[11px] text-muted-foreground">Text</span>
            <Textarea
              value={value}
              onChange={(event) => setValue(event.target.value)}
              rows={2}
              disabled={saving}
              className="text-xs"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[11px] text-muted-foreground">
              Field name
            </span>
            <Input
              value={fieldName}
              onChange={(event) => {
                setFieldName(event.target.value.trim());
                if (phase.kind !== "saving") setPhase({ kind: "idle" });
              }}
              disabled={saving}
              aria-invalid={nameProblem !== null}
              className="h-8 font-mono text-xs"
            />
            {nameProblem ? (
              <span className="block text-[11px] text-destructive">
                {nameProblem}
              </span>
            ) : null}
          </label>

          {phase.kind === "shared" ? (
            <div
              className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2"
              data-testid="editor-code-text-shared"
            >
              <p className="text-[11px] leading-relaxed">
                This component is shared. Making the text editable adds the
                field everywhere below; each keeps showing its current text.
              </p>
              <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-muted-foreground">
                {phase.impact.map((item) => (
                  <li key={item} className="break-all">
                    {item}
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                {!isLayout && onCreatePageCopy ? (
                  <Button size="sm" onClick={() => void createCopy()}>
                    Create page copy
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void promote(phase.impact)}
                >
                  Change shared component
                </Button>
              </div>
            </div>
          ) : (
            <Button
              size="sm"
              className="w-full"
              disabled={saving || nameProblem !== null}
              onClick={() => void promote()}
            >
              {saving ? "Saving…" : "Make editable"}
            </Button>
          )}

          {phase.kind === "copied" ? (
            <p className="text-[11px] text-muted-foreground">
              Created a copy for this page. Select the text again to make it
              editable there.
            </p>
          ) : null}
          {phase.kind === "failed" ? (
            <p className="text-[11px] text-destructive" role="alert">
              {phase.message}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
