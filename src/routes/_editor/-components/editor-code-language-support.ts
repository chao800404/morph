import type { Monaco } from "@monaco-editor/react";
import type { editor, Position } from "monaco-editor";
import { suggestTailwindClasses } from "@/lib/storefront/ast/tailwind-class-suggestions";

const MORPH_THEME_JSX_TYPES = `
declare namespace JSX {
  interface Element {
    readonly __morphThemeJsxElement?: never;
  }

  interface ElementChildrenAttribute {
    children: unknown;
  }

  interface IntrinsicAttributes {
    key?: string | number;
  }

  interface IntrinsicElements {
    [elementName: string]: {
      children?: unknown;
      className?: string;
      style?: Record<string, string | number | undefined>;
      [attributeName: string]: unknown;
    };
  }
}
`;

const MORPH_THEME_DEPENDENCY_TYPES = `
declare module "clsx" {
  export type ClassValue =
    | string
    | number
    | bigint
    | null
    | boolean
    | undefined
    | ClassDictionary
    | ClassArray;

  export interface ClassDictionary {
    [id: string]: unknown;
  }

  export interface ClassArray extends Array<ClassValue> {}

  export function clsx(...inputs: ClassValue[]): string;
  export default clsx;
}
`;

type ThemeModelFile = {
  path: string;
  content: string;
};

type ThemeModelScope = {
  storefrontId: string;
  themeId: string;
};

function normalizeThemeFilePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

export function getThemeModelUri(scope: ThemeModelScope, path: string): string {
  const workspaceId = [scope.storefrontId, scope.themeId]
    .map(encodeURIComponent)
    .join("/");
  return `file:///morph-theme/${workspaceId}/${normalizeThemeFilePath(path)}`;
}

function getThemeModelLanguage(path: string): string {
  if (path.endsWith(".tsx") || path.endsWith(".ts")) return "typescript";
  if (path.endsWith(".jsx") || path.endsWith(".js")) return "javascript";
  if (path.endsWith(".css")) return "css";
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".html")) return "html";
  return "plaintext";
}

export function ensureThemeWorkspaceModels(
  monaco: Monaco,
  scope: ThemeModelScope,
  files: readonly ThemeModelFile[],
): void {
  for (const file of files) {
    const uri = monaco.Uri.parse(getThemeModelUri(scope, file.path));
    if (monaco.editor.getModel(uri)) continue;
    monaco.editor.createModel(
      file.content,
      getThemeModelLanguage(file.path),
      uri,
    );
  }
}

export function disposeThemeWorkspaceModels(
  monaco: Monaco,
  scope: ThemeModelScope,
): void {
  const workspacePrefix = getThemeModelUri(scope, "");
  for (const model of monaco.editor.getModels()) {
    if (model.uri.toString().startsWith(workspacePrefix)) {
      model.dispose();
    }
  }
}

export const JSX_TAG_DEPTH_COUNT = 6;

export type JsxTagSemanticToken = {
  line: number;
  character: number;
  length: number;
  tokenType: number;
};

function isJsxTagNameStart(value: string | undefined): boolean {
  return value !== undefined && /[A-Za-z_$]/.test(value);
}

function isJsxTagNamePart(value: string | undefined): boolean {
  return value !== undefined && /[A-Za-z0-9_$.:\-]/.test(value);
}

function positionAt(
  offset: number,
  lineStarts: number[],
): { line: number; character: number } {
  let low = 0;
  let high = lineStarts.length;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (lineStarts[middle] <= offset) low = middle;
    else high = middle;
  }
  return { line: low, character: offset - lineStarts[low] };
}

export function collectJsxTagSemanticTokens(
  source: string,
): JsxTagSemanticToken[] {
  const tokens: JsxTagSemanticToken[] = [];
  const stack: string[] = [];
  const lineStarts = [0];
  for (let offset = 0; offset < source.length; offset += 1) {
    if (source[offset] === "\n") lineStarts.push(offset + 1);
  }
  let index = 0;
  const templateQuote = String.fromCharCode(96);
  const skipQuoted = (quote: string) => {
    index += 1;
    while (index < source.length) {
      if (source[index] === "\\") {
        index += 2;
        continue;
      }
      const current = source[index++];
      if (current === quote) break;
    }
  };

  while (index < source.length) {
    const char = source[index];
    if (char === '"' || char === "'" || char === templateQuote) {
      skipQuoted(char);
      continue;
    }
    if (char === "/" && source[index + 1] === "/") {
      const end = source.indexOf("\n", index + 2);
      index = end < 0 ? source.length : end;
      continue;
    }
    if (char === "/" && source[index + 1] === "*") {
      const end = source.indexOf("*/", index + 2);
      index = end < 0 ? source.length : end + 2;
      continue;
    }
    if (char !== "<") {
      index += 1;
      continue;
    }

    const isClosing = source[index + 1] === "/";
    const previous = source[index - 1];
    if (
      !isClosing &&
      previous !== undefined &&
      /[A-Za-z0-9_$)\]]/.test(previous)
    ) {
      index += 1;
      continue;
    }
    const nameStart = index + (isClosing ? 2 : 1);
    if (source[nameStart] === ">") {
      if (isClosing) stack.pop();
      else stack.push("");
      index = nameStart + 1;
      continue;
    }
    if (!isJsxTagNameStart(source[nameStart])) {
      index += 1;
      continue;
    }

    let nameEnd = nameStart + 1;
    while (isJsxTagNamePart(source[nameEnd])) nameEnd += 1;
    let close = nameEnd;
    let quote: string | null = null;
    while (close < source.length) {
      const current = source[close];
      if (quote) {
        if (current === "\\") close += 2;
        else {
          if (current === quote) quote = null;
          close += 1;
        }
        continue;
      }
      if (current === '"' || current === "'") quote = current;
      else if (current === ">") break;
      close += 1;
    }
    if (close >= source.length) {
      index += 1;
      continue;
    }

    const name = source.slice(nameStart, nameEnd);
    const depth = isClosing
      ? Math.max(0, stack.lastIndexOf(name))
      : stack.length;
    tokens.push({
      ...positionAt(nameStart, lineStarts),
      length: name.length,
      tokenType: depth % JSX_TAG_DEPTH_COUNT,
    });
    const selfClosing = source.slice(nameEnd, close).trimEnd().endsWith("/");
    if (isClosing) {
      const matching = stack.lastIndexOf(name);
      if (matching >= 0) stack.splice(matching, 1);
    } else if (!selfClosing) stack.push(name);
    index = close + 1;
  }
  return tokens;
}

export const JSX_TAG_DECORATION_CLASSES = [
  "morph-jsx-tag-0",
  "morph-jsx-tag-1",
  "morph-jsx-tag-2",
  "morph-jsx-tag-3",
  "morph-jsx-tag-4",
  "morph-jsx-tag-5",
] as const;

export function createJsxTagDecorations(editorInstance: editor.IStandaloneCodeEditor) {
  let decorationIds: string[] = [];
  let contentDisposable: { dispose: () => void } | null = null;

  const update = () => {
    contentDisposable?.dispose();
    contentDisposable = null;
    const model = editorInstance.getModel();
    const tokens =
      model && /\.(?:jsx|tsx)$/.test(model.uri?.path ?? "")
        ? collectJsxTagSemanticTokens(model.getValue())
        : [];
    decorationIds = editorInstance.deltaDecorations(
      decorationIds,
      tokens.map((token) => ({
        range: {
          startLineNumber: token.line + 1,
          startColumn: token.character + 1,
          endLineNumber: token.line + 1,
          endColumn: token.character + token.length + 1,
        },
        options: {
          inlineClassName: JSX_TAG_DECORATION_CLASSES[token.tokenType],
        },
      })),
    );
    if (model) contentDisposable = model.onDidChangeContent(update);
  };

  update();
  const modelDisposable = editorInstance.onDidChangeModel(update);
  return {
    update,
    dispose: () => {
      contentDisposable?.dispose();
      modelDisposable.dispose();
      decorationIds = editorInstance.deltaDecorations(decorationIds, []);
    },
  };
}

export type TailwindCompletionContext = {
  query: string;
  excludedClasses: ReadonlySet<string>;
  startColumn: number;
  endColumn: number;
};

export function resolveTailwindCompletionContext(
  line: string,
  column: number,
): TailwindCompletionContext | null {
  const beforeCursor = line.slice(0, Math.max(0, column - 1));
  const match = beforeCursor.match(
    /(?:className|class)\s*=\s*(?:\{\s*)?(["'])([^"']*)$/,
  );
  if (!match) return null;

  const classValue = match[2];
  const tokens = classValue.split(/\s+/);
  const query = tokens.at(-1) ?? "";
  const excludedClasses = new Set(tokens.slice(0, -1).filter(Boolean));

  return {
    query,
    excludedClasses,
    startColumn: column - query.length,
    endColumn: column,
  };
}

export function configureThemeTypeScript(monaco: Monaco): void {
  const defaults = monaco.languages.typescript.typescriptDefaults;
  defaults.setEagerModelSync(true);
  defaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
  });
  defaults.setCompilerOptions({
    allowJs: true,
    allowNonTsExtensions: true,
    allowSyntheticDefaultImports: true,
    esModuleInterop: true,
    jsx: monaco.languages.typescript.JsxEmit.Preserve,
    module: monaco.languages.typescript.ModuleKind.ESNext,
    moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
    noEmit: true,
    target: monaco.languages.typescript.ScriptTarget.ES2022,
  });
  defaults.addExtraLib(
    MORPH_THEME_JSX_TYPES,
    "file:///node_modules/@morph/theme-jsx/index.d.ts",
  );
  defaults.addExtraLib(
    MORPH_THEME_DEPENDENCY_TYPES,
    "file:///node_modules/@types/morph-theme-dependencies/index.d.ts",
  );
}

export function registerTailwindCompletionProvider(monaco: Monaco) {
  const provider = {
    triggerCharacters: ["-", ":", "/", "["],
    provideCompletionItems(model: editor.ITextModel, position: Position) {
      if (!/\.(?:jsx|tsx)$/.test(model.uri.path)) {
        return { suggestions: [] };
      }

      const context = resolveTailwindCompletionContext(
        model.getLineContent(position.lineNumber),
        position.column,
      );
      if (!context) return { suggestions: [] };

      const range = new monaco.Range(
        position.lineNumber,
        context.startColumn,
        position.lineNumber,
        context.endColumn,
      );
      const suggestions = suggestTailwindClasses(
        context.query,
        context.excludedClasses,
      ).map((suggestion, index) => ({
        label: suggestion.value,
        kind: monaco.languages.CompletionItemKind.Value,
        insertText: suggestion.value,
        detail: `Tailwind CSS · ${suggestion.group}`,
        range,
        sortText: String(index).padStart(3, "0"),
      }));

      return { suggestions };
    },
  };
  const registrations = ["typescript", "javascript"].map((language) =>
    monaco.languages.registerCompletionItemProvider(language, provider),
  );

  return {
    dispose() {
      registrations.forEach((registration) => registration.dispose());
    },
  };
}
