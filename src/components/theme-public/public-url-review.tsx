import type {
  PublicUrlReference,
  PublicUrlScan,
} from "@/lib/storefront/editor/public-url-references";
import type {
  PublicUrlRewritePlan,
  PublicUrlUnresolvedReason,
} from "@/lib/storefront/editor/public-url-rewrite";

const SHOWN = 20;

const UNRESOLVED_REASON: Record<PublicUrlUnresolvedReason, string> = {
  "built-at-runtime": "built at runtime",
  escaped: "written with escapes",
  "inside-longer-text": "inside longer text",
  "new-url-needs-escaping": "the new URL would need escaping here",
  unparsed: "the file has a syntax error",
  "unsupported-file": "this file type is not analysed",
};

function UrlChanges({
  changes,
}: {
  changes: readonly { from: string; to: string | null }[];
}) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-foreground">
        {changes.some((change) => change.to === null)
          ? "These URLs stop working"
          : "These URLs change"}
      </div>
      <ul className="max-h-32 space-y-0.5 overflow-auto font-mono text-[11px]">
        {changes.slice(0, SHOWN).map((change) => (
          <li key={change.from} data-public-url-change={change.from}>
            {change.from}
            {change.to ? ` → ${change.to}` : " (removed)"}
          </li>
        ))}
        {changes.length > SHOWN ? (
          <li className="text-muted-foreground">
            and {changes.length - SHOWN} more
          </li>
        ) : null}
      </ul>
    </div>
  );
}

/**
 * A move whose URL references can follow it: the references it updates,
 * and every one it does not, with why. Like `PublicUrlReview`, it never
 * claims that nothing else names the URLs.
 */
export function PublicUrlRewriteReview({
  changes,
  plan,
}: {
  changes: readonly { from: string; to: string }[];
  plan: PublicUrlRewritePlan;
}) {
  return (
    <div className="space-y-3 text-left" data-public-url-rewrite-review>
      <UrlChanges changes={changes} />
      {plan.rewrites.length > 0 ? (
        <div className="space-y-1">
          <div className="text-xs font-medium text-foreground">
            Updated in Theme source ({plan.rewrites.length})
          </div>
          <ul className="max-h-40 space-y-1 overflow-auto rounded-md border bg-muted/30 p-2">
            {plan.rewrites.slice(0, SHOWN).map((rewrite) => (
              <li
                key={`${rewrite.path}:${rewrite.line}:${rewrite.from}`}
                className="text-[11px]"
                data-public-url-rewrite={`${rewrite.path}:${rewrite.line}`}
              >
                <span className="font-mono text-foreground">
                  {rewrite.path}:{rewrite.line}
                </span>
                <span className="ml-2 font-mono text-muted-foreground">
                  {rewrite.excerpt}
                </span>
              </li>
            ))}
            {plan.rewrites.length > SHOWN ? (
              <li className="text-[11px] text-muted-foreground">
                and {plan.rewrites.length - SHOWN} more
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
      {plan.unresolved.length > 0 ? (
        <div className="space-y-1">
          <div className="text-xs font-medium text-foreground">
            Not updated — these may break ({plan.unresolved.length})
          </div>
          <ul className="max-h-40 space-y-1 overflow-auto rounded-md border border-amber-500/40 bg-amber-500/5 p-2">
            {plan.unresolved.slice(0, SHOWN).map((item) => (
              <li
                key={`${item.path}:${item.line}:${item.url}:${item.reason}`}
                className="text-[11px]"
                data-public-url-unresolved={item.reason}
              >
                <span className="font-mono text-foreground">
                  {item.path}:{item.line}
                </span>
                <span className="ml-2 text-muted-foreground">
                  {UNRESOLVED_REASON[item.reason]}
                </span>
                <div className="font-mono text-muted-foreground">
                  {item.excerpt}
                </div>
              </li>
            ))}
            {plan.unresolved.length > SHOWN ? (
              <li className="text-[11px] text-muted-foreground">
                and {plan.unresolved.length - SHOWN} more
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
      <p className="text-[11px] text-muted-foreground">
        {plan.rewrites.length === 0 && plan.unresolved.length === 0
          ? "No URL written out in full was found in Theme source. "
          : ""}
        Page content and other sites that link to these URLs are not checked, so
        there may be more. Changes go to the draft; the live site changes when
        you publish.
      </p>
    </div>
  );
}

function ReferenceList({
  title,
  references,
  kind,
}: {
  title: string;
  references: readonly PublicUrlReference[];
  kind: "known" | "possible";
}) {
  if (references.length === 0) return null;
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-foreground">{title}</div>
      <ul className="max-h-40 space-y-1 overflow-auto rounded-md border bg-muted/30 p-2">
        {references.slice(0, SHOWN).map((reference) => (
          <li
            key={`${reference.path}:${reference.line}:${reference.url}`}
            className="text-[11px]"
            data-public-url-reference={kind}
          >
            <span className="font-mono text-foreground">
              {reference.path}:{reference.line}
            </span>
            <span className="ml-2 font-mono text-muted-foreground">
              {reference.excerpt}
            </span>
          </li>
        ))}
        {references.length > SHOWN ? (
          <li className="text-[11px] text-muted-foreground">
            and {references.length - SHOWN} more
          </li>
        ) : null}
      </ul>
    </div>
  );
}

/**
 * What a move or a deletion would do to the URLs of `public/` files, shown
 * before it happens: each URL that changes or goes away, where Theme source
 * names it, and what was not searched. It never says there are no
 * references — only that none were found written out in Theme source.
 */
export function PublicUrlReview({
  changes,
  scan,
}: {
  /** `to: null` for a URL that goes away. */
  changes: readonly { from: string; to: string | null }[];
  scan: PublicUrlScan;
}) {
  return (
    <div className="space-y-3 text-left" data-public-url-review>
      <UrlChanges changes={changes} />
      <ReferenceList
        title="Theme source that names them — these break"
        references={scan.known}
        kind="known"
      />
      <ReferenceList
        title="Lines that may build them at runtime — check these"
        references={scan.possible}
        kind="possible"
      />
      <p className="text-[11px] text-muted-foreground">
        {scan.known.length === 0
          ? "No URL written out in full was found in Theme source. "
          : ""}
        URLs built at runtime and page content are not checked, so there may be
        more.
      </p>
    </div>
  );
}
