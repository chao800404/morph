/**
 * Where Theme source names a `public/` file by its URL, found before a move
 * or a deletion changes that URL — so the author sees what would break
 * before choosing, not after.
 *
 * Only what can be read off the text: a URL written out whole is a known
 * reference, with its line. A URL put together at runtime — a template
 * literal, a concatenation — cannot be resolved here, so a line that holds
 * the file's folder beside one is reported as a possible reference rather
 * than left out. Page content stored in Documents is not searched. Nothing
 * here may therefore say "no references": the caller says what was not
 * checked.
 */

export type PublicUrlReference = Readonly<{
  /** The URL found, e.g. `/images/hero.png`. */
  url: string;
  path: string;
  /** 1-based. */
  line: number;
  excerpt: string;
}>;

export type PublicUrlScan = Readonly<{
  known: PublicUrlReference[];
  /** Lines that may build one of the URLs; `url` is the folder they share. */
  possible: PublicUrlReference[];
}>;

/** Characters that continue a URL path, so a match inside a longer one is not one. */
const URL_PATH_CHARACTER = /[A-Za-z0-9._~%\-/]/;
/** Characters that would make the match part of something before it, a host or a word. */
const URL_PREFIX_CHARACTER = /[A-Za-z0-9._~%\-]/;
const EXCERPT_LENGTH = 120;

function excerptOf(line: string): string {
  const trimmed = line.trim();
  return trimmed.length > EXCERPT_LENGTH
    ? `${trimmed.slice(0, EXCERPT_LENGTH - 1)}…`
    : trimmed;
}

function occursAlone(line: string, url: string): boolean {
  let from = 0;
  for (;;) {
    const at = line.indexOf(url, from);
    if (at < 0) return false;
    const before = at > 0 ? line[at - 1]! : "";
    const after = line[at + url.length] ?? "";
    if (
      !(before && URL_PREFIX_CHARACTER.test(before)) &&
      !(after && URL_PATH_CHARACTER.test(after))
    ) {
      return true;
    }
    from = at + 1;
  }
}

function folderOf(url: string): string | null {
  const slash = url.lastIndexOf("/");
  return slash > 0 ? url.slice(0, slash + 1) : null;
}

/** Whether a line puts a string together at runtime. */
function buildsAString(line: string): boolean {
  return line.includes("${") || /["'`]\s*\+|\+\s*["'`]/.test(line);
}

export function scanPublicUrlReferences(
  files: readonly { path: string; content: string }[],
  urls: readonly string[],
): PublicUrlScan {
  const wanted = [...new Set(urls)].filter(Boolean);
  const folders = [
    ...new Set(
      wanted.map(folderOf).filter((folder): folder is string => !!folder),
    ),
  ];
  const known: PublicUrlReference[] = [];
  const possible: PublicUrlReference[] = [];

  for (const file of files) {
    const lines = file.content.split("\n");
    lines.forEach((line, index) => {
      let named = false;
      for (const url of wanted) {
        if (occursAlone(line, url)) {
          named = true;
          known.push({
            url,
            path: file.path,
            line: index + 1,
            excerpt: excerptOf(line),
          });
        }
      }
      if (named || !buildsAString(line)) return;
      for (const folder of folders) {
        if (line.includes(folder)) {
          possible.push({
            url: folder,
            path: file.path,
            line: index + 1,
            excerpt: excerptOf(line),
          });
          break;
        }
      }
    });
  }
  return { known, possible };
}
