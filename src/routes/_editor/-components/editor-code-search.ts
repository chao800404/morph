export type EditorCodeSearchOptions = Readonly<{
  matchCase: boolean;
  wholeWord: boolean;
  useRegex: boolean;
}>;

export type EditorCodeSearchFile = Readonly<{
  path: string;
  content: string;
}>;

export type EditorCodeSearchMatch = Readonly<{
  path: string;
  line: number;
  column: number;
  endColumn: number;
  preview: string;
  match: string;
}>;

export type EditorCodeReplacement = Readonly<{
  path: string;
  content: string;
  replacementCount: number;
}>;

const MAX_WORKSPACE_MATCHES = 1_000;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createSearchExpression(
  query: string,
  options: EditorCodeSearchOptions,
): RegExp | null {
  if (!query) return null;
  const source = options.useRegex ? query : escapeRegExp(query);
  const bounded = options.wholeWord ? `\\b(?:${source})\\b` : source;
  try {
    return new RegExp(bounded, options.matchCase ? "g" : "gi");
  } catch {
    return null;
  }
}

function lineAndColumn(content: string, offset: number) {
  const prefix = content.slice(0, offset);
  const lines = prefix.split("\n");
  return {
    line: lines.length,
    column: (lines.at(-1)?.length ?? 0) + 1,
  };
}

export function findEditorCodeMatches(
  files: readonly EditorCodeSearchFile[],
  query: string,
  options: EditorCodeSearchOptions,
  limit = MAX_WORKSPACE_MATCHES,
): EditorCodeSearchMatch[] {
  const expression = createSearchExpression(query, options);
  if (!expression) return [];

  const results: EditorCodeSearchMatch[] = [];
  for (const file of files) {
    expression.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = expression.exec(file.content))) {
      const position = lineAndColumn(file.content, match.index);
      const lineStart = file.content.lastIndexOf("\n", match.index - 1) + 1;
      const nextLineBreak = file.content.indexOf("\n", match.index);
      const lineEnd = nextLineBreak < 0 ? file.content.length : nextLineBreak;
      results.push({
        path: file.path,
        line: position.line,
        column: position.column,
        endColumn: position.column + match[0].length,
        preview: file.content.slice(lineStart, lineEnd).trim(),
        match: match[0],
      });
      if (results.length >= limit) return results;
      if (match[0].length === 0) expression.lastIndex += 1;
    }
  }
  return results;
}

export function replaceEditorCodeMatches(
  files: readonly EditorCodeSearchFile[],
  query: string,
  replacement: string,
  options: EditorCodeSearchOptions,
): EditorCodeReplacement[] {
  const expression = createSearchExpression(query, options);
  if (!expression) return [];

  const replacements: EditorCodeReplacement[] = [];
  for (const file of files) {
    expression.lastIndex = 0;
    const replacementCount = Array.from(
      file.content.matchAll(expression),
    ).length;
    expression.lastIndex = 0;
    const content = file.content.replace(expression, replacement);
    if (replacementCount > 0 && content !== file.content) {
      replacements.push({ path: file.path, content, replacementCount });
    }
  }
  return replacements;
}
