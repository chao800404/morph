import type {
  PublicUrlReference,
  PublicUrlScan,
} from "@/lib/storefront/editor/public-url-references";

const SHOWN = 20;

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
