import {
  describeTextPromotionRefusal,
  type TextPromotionAnalysis,
} from "@/lib/storefront/editor/text-promotion";

/**
 * What the Content tab says about fixed text written in the component.
 *
 * Read-only for now: it names the text and whether it could become a field on
 * this page, and why not when it cannot. The conversion itself needs the
 * source rewrite and the Document override written as one operation, and
 * until that exists there is no button that would pretend to do it.
 */
export function EditorCodeTextNotice({
  analysis,
}: {
  analysis: TextPromotionAnalysis;
}) {
  const text = analysis.text;
  return (
    <div
      className="rounded-xl border border-dashed p-3"
      data-testid="editor-code-text-notice"
      data-status={analysis.status}
    >
      <p className="text-xs font-medium">Written in code</p>
      {text ? (
        <p className="mt-1.5 line-clamp-3 break-words rounded-md bg-muted px-2 py-1.5 text-xs">
          {text}
        </p>
      ) : null}
      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
        {analysis.status === "convertible"
          ? analysis.callSite.scope === "layout"
            ? "This text can become a field of this section. The section is part of the layout, so its value is shared by every page."
            : "This text can become a field of this section, with its current text as the default."
          : `Edit it in Code. ${describeTextPromotionRefusal(analysis.reason)}`}
      </p>
    </div>
  );
}
