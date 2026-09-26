import { parse as parseModule } from "@babel/parser";
import parseCss from "css-tree/parser";
import walkCss from "css-tree/walker";
import {
  excerptOf,
  publicUrlOccurrences,
  scanPublicUrlReferences,
} from "./public-url-references";

/**
 * The Theme source edits that keep references pointing at `public/` files
 * whose URLs a move changes.
 *
 * Only a reference that can be shown to be the whole URL is rewritten, found
 * through the file's syntax rather than its text:
 *
 * - In TS/JS, a string literal, a JSX attribute string or a template literal
 *   without `${}` that holds the URL alone (a `?query` or `#hash` after it
 *   stays), or holds it as `url(…)` — Tailwind's `bg-[url('/a.png')]`.
 * - In CSS, a `url(…)` or a string that is the URL.
 *
 * Everything else that names the URL is returned as unresolved, with why: a
 * URL put together at runtime, written with escapes, sitting in longer text
 * (a `srcSet`, prose), in a file that does not parse, or in a file type not
 * analysed. As a last net, every place the URL is written out in a file that
 * is neither rewritten, reported nor inside a comment is reported too, so
 * nothing that names the URL goes unmentioned. Page content in Documents and
 * other sites are not seen here; callers say so.
 *
 * Pure, so the editor can preview the plan and the server can compute it
 * again from the files as saved when the move is confirmed.
 */

export type PublicUrlMove = Readonly<{
  /** `/images/hero.png` */
  from: string;
  to: string;
}>;

export type PublicUrlRewrite = Readonly<{
  path: string;
  /** 1-based, in the file before the rewrite. */
  line: number;
  from: string;
  to: string;
  excerpt: string;
}>;

export type PublicUrlUnresolvedReason =
  /** A concatenation, a template with `${}`, or the URL's folder on its own. */
  | "built-at-runtime"
  /** Written with escape sequences the rewrite could not keep. */
  | "escaped"
  /** In a string or text holding more than the URL, such as a `srcSet`. */
  | "inside-longer-text"
  /** The new URL has characters this position would need escaped. */
  | "new-url-needs-escaping"
  /** The file has a syntax error. */
  | "unparsed"
  /** Not TS, JS or CSS. */
  | "unsupported-file";

export type PublicUrlUnresolved = Readonly<{
  path: string;
  line: number;
  /** The URL, or for `built-at-runtime` possibly the folder it shares. */
  url: string;
  excerpt: string;
  reason: PublicUrlUnresolvedReason;
}>;

export type PublicUrlRewritePlan = Readonly<{
  /** Files whose content changes, with that content. */
  writes: ReadonlyArray<{ path: string; content: string }>;
  rewrites: readonly PublicUrlRewrite[];
  unresolved: readonly PublicUrlUnresolved[];
}>;

export type PublicUrlRewritePlanResult =
  | Readonly<{ ok: true; plan: PublicUrlRewritePlan }>
  | Readonly<{ ok: false; reason: string }>;

const SCRIPT_FILE = /\.(tsx|ts|jsx|js|mjs|cjs|mts|cts)$/;
const CSS_FILE = /\.css$/;
/** What a `/…` URL may hold to be a move's end at all. */
const URL_SHAPE = /^\/[^\s"'`\\{}<>]+$/;
/** Characters an unquoted CSS `url(…)` or a Tailwind `[…]` would need escaped. */
const UNSAFE_UNQUOTED = /[()[\]\s"'\\]/;
/** What may follow a whole URL and still leave it the same file. */
const URL_SUFFIX = /^[?#]/;
/** A `url(` just before the URL, with an optional opening quote. */
const CSS_URL_OPENING = /url\(\s*(["']?)$/i;

type Edit = { start: number; end: number; text: string };
type Range = { start: number; end: number };

function folderOf(url: string): string | null {
  const slash = url.lastIndexOf("/");
  return slash > 0 ? url.slice(0, slash + 1) : null;
}

function lineAt(text: string, offset: number): number {
  let line = 1;
  for (let index = text.indexOf("\n"); index >= 0 && index < offset;) {
    line += 1;
    index = text.indexOf("\n", index + 1);
  }
  return line;
}

function lineTextAt(text: string, offset: number): string {
  const start = text.lastIndexOf("\n", offset - 1) + 1;
  const end = text.indexOf("\n", offset);
  return text.slice(start, end < 0 ? text.length : end);
}

function replaceRanges(source: string, edits: readonly Edit[]): string {
  return [...edits]
    .sort((left, right) => right.start - left.start)
    .reduce(
      (text, edit) =>
        text.slice(0, edit.start) + edit.text + text.slice(edit.end),
      source,
    );
}

/** How a string is used: on its own, or as a piece of one built at runtime. */
type LiteralUse = "whole" | "piece";

/** One string whose value may name a URL, and where its text sits. */
type Literal = {
  /** The string's value. */
  value: string;
  /** The source text between its delimiters. */
  raw: string;
  /** Offset of `raw` in the file. */
  rawStart: number;
  /** The literal's whole range, delimiters included. */
  range: Range;
  use: LiteralUse;
  /** Whether the URL sits unquoted, so the new one must not need escaping. */
  unquotedCss?: boolean;
};

class FilePlanner {
  readonly edits: Edit[] = [];
  readonly rewrites: PublicUrlRewrite[] = [];
  readonly unresolved: PublicUrlUnresolved[] = [];
  /** Ranges already accounted for, per URL: rewritten, reported or a comment. */
  private readonly covered = new Map<string, Range[]>();
  private readonly comments: Range[] = [];
  private readonly seen = new Set<string>();

  constructor(
    readonly path: string,
    readonly text: string,
    readonly moves: readonly PublicUrlMove[],
  ) {}

  addComment(range: Range) {
    this.comments.push(range);
  }

  private cover(url: string, range: Range) {
    const ranges = this.covered.get(url) ?? [];
    ranges.push(range);
    this.covered.set(url, ranges);
  }

  report(offset: number, url: string, reason: PublicUrlUnresolvedReason) {
    const line = lineAt(this.text, offset);
    const key = `${line}\u0000${url}\u0000${reason}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.unresolved.push({
      path: this.path,
      line,
      url,
      excerpt: excerptOf(lineTextAt(this.text, offset)),
      reason,
    });
  }

  /** Rewrites or reports every URL a string names. */
  literal(literal: Literal) {
    for (const move of this.moves) {
      const inValue = publicUrlOccurrences(literal.value, move.from);
      const inRaw = publicUrlOccurrences(literal.raw, move.from);
      const folder = folderOf(move.from);

      if (literal.use === "piece") {
        // `/images/hero` + ext names this file; `/images/` could be any in it.
        const leadingPiece =
          literal.value.length > 1 &&
          literal.value.startsWith("/") &&
          !literal.value.endsWith("/") &&
          move.from.startsWith(literal.value);
        const names = inValue.length > 0 || inRaw.length > 0 || leadingPiece;
        if (names || (folder !== null && literal.value.includes(folder))) {
          this.report(
            literal.range.start,
            names ? move.from : folder!,
            "built-at-runtime",
          );
          this.cover(move.from, literal.range);
        }
        continue;
      }

      if (inValue.length === 0 && inRaw.length === 0) {
        // A folder named on its own is almost always a base someone adds to.
        if (folder !== null && literal.value === folder) {
          this.report(literal.range.start, folder, "built-at-runtime");
        }
        continue;
      }
      this.cover(move.from, literal.range);
      if (literal.raw !== literal.value) {
        this.report(literal.range.start, move.from, "escaped");
        continue;
      }
      for (const at of inValue) {
        const offset = literal.rawStart + at;
        const after = literal.value.slice(at + move.from.length);
        const before = literal.value.slice(0, at);
        const whole = at === 0 && (after === "" || URL_SUFFIX.test(after));
        const opening = CSS_URL_OPENING.exec(before);
        const inCssUrl =
          !whole &&
          opening !== null &&
          new RegExp(`^${opening[1]}\\s*\\)`).test(after);
        if (!whole && !inCssUrl) {
          this.report(offset, move.from, "inside-longer-text");
          continue;
        }
        const unquoted =
          (whole && literal.unquotedCss) || (inCssUrl && !opening![1]);
        // Tailwind's `[…]` ends at the first `]`, quoted or not.
        const bracketed = inCssUrl && /\[url\(\s*["']?$/i.test(before);
        if ((unquoted || bracketed) && UNSAFE_UNQUOTED.test(move.to)) {
          this.report(offset, move.from, "new-url-needs-escaping");
          continue;
        }
        this.edits.push({
          start: offset,
          end: offset + move.from.length,
          text: move.to,
        });
        this.rewrites.push({
          path: this.path,
          line: lineAt(this.text, offset),
          from: move.from,
          to: move.to,
          excerpt: excerptOf(lineTextAt(this.text, offset)),
        });
      }
    }
  }

  /** Reports every place a URL is written out that nothing above accounted for. */
  finish(reason: PublicUrlUnresolvedReason) {
    for (const move of this.moves) {
      const covered = [
        ...(this.covered.get(move.from) ?? []),
        ...this.comments,
      ];
      for (const at of publicUrlOccurrences(this.text, move.from)) {
        if (covered.some((range) => at >= range.start && at < range.end)) {
          continue;
        }
        this.report(at, move.from, reason);
      }
    }
  }
}

function planScript(planner: FilePlanner): boolean {
  let ast: ReturnType<typeof parseModule>;
  try {
    ast = parseModule(planner.text, {
      sourceType: "module",
      plugins: ["jsx", "typescript"],
    });
  } catch {
    return false;
  }
  for (const comment of ast.comments ?? []) {
    planner.addComment({ start: comment.start!, end: comment.end! });
  }

  const visit = (node: any, piece: boolean) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "StringLiteral") {
      planner.literal({
        value: node.value,
        raw: planner.text.slice(node.start + 1, node.end - 1),
        rawStart: node.start + 1,
        range: { start: node.start, end: node.end },
        use: piece ? "piece" : "whole",
      });
      return;
    }
    if (node.type === "TemplateLiteral") {
      const built = piece || node.expressions.length > 0;
      for (const quasi of node.quasis) {
        planner.literal({
          value: quasi.value.cooked ?? quasi.value.raw,
          raw: quasi.value.raw,
          rawStart: quasi.start,
          range: { start: quasi.start, end: quasi.end },
          use: built ? "piece" : "whole",
        });
      }
      for (const expression of node.expressions) visit(expression, false);
      return;
    }
    const joins =
      (node.type === "BinaryExpression" && node.operator === "+") ||
      (node.type === "AssignmentExpression" && node.operator === "+=");
    for (const key of Object.keys(node)) {
      if (key === "loc" || key === "comments" || key.endsWith("Comments")) {
        continue;
      }
      const value = node[key];
      const childPiece = joins && (key === "left" || key === "right");
      if (Array.isArray(value)) value.forEach((item) => visit(item, false));
      else if (value && typeof value === "object") visit(value, childPiece);
    }
  };
  visit(ast.program, false);
  return true;
}

function planCss(planner: FilePlanner) {
  const text = planner.text;
  const ast = parseCss(text, {
    positions: true,
    parseCustomProperty: true,
    onComment: (_value, loc) =>
      planner.addComment({ start: loc.start.offset, end: loc.end.offset }),
  });
  // css-tree recovers from errors by keeping the text as Raw; a URL left in
  // Raw is caught by the final net, so an error needs no handling of its own.
  walkCss(ast, (node) => {
    if (!node.loc) return;
    const start = node.loc.start.offset;
    const end = node.loc.end.offset;
    const source = text.slice(start, end);
    if (node.type === "Url") {
      const match = /^(url\(\s*(["']?))([\s\S]*?)\2\s*\)$/i.exec(source);
      const opening = match?.[1] ?? "";
      planner.literal({
        value: node.value,
        raw: match ? match[3]! : source,
        rawStart: start + opening.length,
        range: { start, end },
        use: "whole",
        unquotedCss: !match?.[2],
      });
    } else if (node.type === "String") {
      planner.literal({
        value: node.value,
        raw: source.slice(1, -1),
        rawStart: start + 1,
        range: { start, end },
        use: "whole",
      });
    }
  });
}

/** Files that cannot be analysed still say where they name the URL. */
function reportByText(planner: FilePlanner, reason: PublicUrlUnresolvedReason) {
  const scan = scanPublicUrlReferences(
    [{ path: planner.path, content: planner.text }],
    planner.moves.map((move) => move.from),
  );
  for (const reference of scan.possible) {
    const offset = planner.text
      .split("\n")
      .slice(0, reference.line - 1)
      .reduce((sum, line) => sum + line.length + 1, 0);
    planner.report(offset, reference.url, "built-at-runtime");
  }
  planner.finish(reason);
}

export function planPublicUrlRewrites(
  files: readonly { path: string; content: string }[],
  moves: readonly PublicUrlMove[],
): PublicUrlRewritePlanResult {
  const froms = new Set<string>();
  for (const move of moves) {
    if (!URL_SHAPE.test(move.from) || !URL_SHAPE.test(move.to)) {
      return {
        ok: false,
        reason: `"${move.from}" → "${move.to}" is not a /… URL.`,
      };
    }
    if (move.from === move.to) {
      return { ok: false, reason: `"${move.from}" does not change.` };
    }
    if (froms.has(move.from)) {
      return { ok: false, reason: `"${move.from}" is moved twice.` };
    }
    froms.add(move.from);
  }

  const writes: Array<{ path: string; content: string }> = [];
  const rewrites: PublicUrlRewrite[] = [];
  const unresolved: PublicUrlUnresolved[] = [];
  for (const file of files) {
    const planner = new FilePlanner(file.path, file.content, moves);
    if (SCRIPT_FILE.test(file.path)) {
      if (planScript(planner)) planner.finish("inside-longer-text");
      else reportByText(planner, "unparsed");
    } else if (CSS_FILE.test(file.path)) {
      planCss(planner);
      planner.finish("inside-longer-text");
    } else {
      reportByText(planner, "unsupported-file");
    }
    if (planner.edits.length > 0) {
      writes.push({
        path: file.path,
        content: replaceRanges(file.content, planner.edits),
      });
    }
    rewrites.push(...planner.rewrites);
    unresolved.push(
      ...[...planner.unresolved].sort((left, right) => left.line - right.line),
    );
  }
  return { ok: true, plan: { writes, rewrites, unresolved } };
}
