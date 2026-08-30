import type { Monaco } from "@monaco-editor/react";
import type { editor, Position } from "monaco-editor";
import { suggestTailwindClasses } from "@/lib/storefront/ast/tailwind-class-suggestions";
import {
  DEFAULT_THEME_TYPE_PACKAGE_NAMES,
  getGeneratedThemePackageDeclarations,
  renderThemePackageTypeDeclarations,
} from "./editor-code-package-types";

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

  type ThemeIntrinsicProps = {
    key?: string | number;
    id?: string;
    title?: string;
    role?: string;
    className?: string;
    style?: Record<string, string | number | undefined>;
    children?: unknown;
    "aria-label"?: string;
    "aria-hidden"?: boolean | "true" | "false";
    [attributeName: \`aria-\${string}\`]: string | number | boolean | undefined;
    [attributeName: \`data-\${string}\`]: string | number | boolean | undefined;
    onClick?: (event: unknown) => void;
    onChange?: (event: unknown) => void;
    onSubmit?: (event: unknown) => void;
  };

  interface IntrinsicElements {
    a: ThemeIntrinsicProps & {
      href?: string;
      target?: string;
      rel?: string;
      download?: string | boolean;
    };
    button: ThemeIntrinsicProps & {
      type?: "button" | "submit" | "reset";
      disabled?: boolean;
      name?: string;
      value?: string | number;
    };
    input: ThemeIntrinsicProps & {
      type?: string;
      value?: string | number;
      defaultValue?: string | number;
      placeholder?: string;
      name?: string;
      checked?: boolean;
      disabled?: boolean;
      readOnly?: boolean;
      required?: boolean;
    };
    textarea: ThemeIntrinsicProps & {
      value?: string | number;
      defaultValue?: string | number;
      placeholder?: string;
      rows?: number;
      cols?: number;
      disabled?: boolean;
      readOnly?: boolean;
      required?: boolean;
    };
    img: ThemeIntrinsicProps & {
      src?: string;
      alt?: string;
      width?: string | number;
      height?: string | number;
      loading?: "eager" | "lazy";
    };
    form: ThemeIntrinsicProps & { action?: string; method?: "get" | "post" };
    label: ThemeIntrinsicProps & { htmlFor?: string };
    select: ThemeIntrinsicProps & {
      value?: string | number;
      defaultValue?: string | number;
      name?: string;
      disabled?: boolean;
      required?: boolean;
    };
    option: ThemeIntrinsicProps & {
      value?: string | number;
      label?: string;
      disabled?: boolean;
      selected?: boolean;
    };
    video: ThemeIntrinsicProps & {
      src?: string;
      controls?: boolean;
      autoPlay?: boolean;
      loop?: boolean;
      muted?: boolean;
      poster?: string;
    };
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

declare module "@tanstack/react-router" {
  export type LinkElementProps = {
    key?: string | number;
    href?: string;
    target?: string;
    rel?: string;
    className?: string;
    style?: Record<string, string | number | undefined>;
    id?: string;
    title?: string;
    role?: string;
    children?: unknown;
    onClick?: (event: unknown) => void;
    onMouseEnter?: (event: unknown) => void;
    onMouseLeave?: (event: unknown) => void;
    "aria-label"?: string;
    "aria-current"?: string | boolean;
    "data-storefront-field"?: string;
    "data-storefront-field-path"?: string;
  };

  export type LinkOptions = {
    to?: string;
    from?: string;
    params?: Record<string, unknown>;
    search?: unknown;
    hash?: string;
    state?: unknown;
    mask?: unknown;
    preload?: boolean | "intent" | "viewport" | "render";
    preloadDelay?: number;
    preloadIntentProximity?: number;
    activeOptions?: {
      exact?: boolean;
      includeSearch?: boolean;
      includeHash?: boolean;
      explicitUndefined?: boolean;
    };
    activeProps?: Record<string, unknown> | (() => Record<string, unknown>);
    inactiveProps?: Record<string, unknown> | (() => Record<string, unknown>);
    replace?: boolean;
    resetScroll?: boolean;
    hashScrollIntoView?: boolean;
    viewTransition?: boolean;
    startTransition?: boolean;
    reloadDocument?: boolean;
    unsafeRelative?: "path" | "route";
    disabled?: boolean;
    ignoreBlocker?: boolean;
  };

  export type LinkProps = LinkOptions &
    LinkElementProps & {
      children?: unknown | ((state: { isActive: boolean; isTransitioning: boolean }) => unknown);
    };

  export type HeadContentProps = { assetCrossOrigin?: string };
  export type RouterProviderProps = {
    router: unknown;
    context?: Record<string, unknown>;
    routeTree?: unknown;
    defaultPreload?: boolean | "intent" | "viewport" | "render";
    defaultPreloadDelay?: number;
    basepath?: string;
  };

  export type RouteLocation = {
    href?: string;
    pathname: string;
    search?: Record<string, unknown>;
    searchStr?: string;
    hash?: string;
    state?: unknown;
  };

  export type RouteBeforeLoadContext = {
    location: RouteLocation;
    params?: Record<string, string>;
    search?: Record<string, unknown>;
    context?: Record<string, unknown>;
    preload?: boolean;
    cause?: "preload" | "enter" | "stay";
  };

  export type RouteHeadResult = {
    meta?: readonly Record<string, unknown>[];
    links?: readonly Record<string, unknown>[];
    scripts?: readonly Record<string, unknown>[];
  };

  export type RouteComponent = (props: Record<string, unknown>) => unknown;

  export type RouteAuthoringOptions<
    TContext = Record<string, unknown>,
  > = {
    component?: RouteComponent;
    pendingComponent?: RouteComponent;
    errorComponent?: RouteComponent;
    notFoundComponent?: RouteComponent;
    loader?: (context: RouteBeforeLoadContext) => unknown | Promise<unknown>;
    loaderDeps?: (context: RouteBeforeLoadContext) => Record<string, unknown>;
    beforeLoad?: (
      context: RouteBeforeLoadContext,
    ) => TContext | Promise<TContext>;
    validateSearch?: (search: Record<string, unknown>) => unknown;
    head?: (context: RouteBeforeLoadContext) => RouteHeadResult;
    meta?: (
      context: RouteBeforeLoadContext,
    ) => readonly Record<string, unknown>[];
    links?: (
      context: RouteBeforeLoadContext,
    ) => readonly Record<string, unknown>[];
    scripts?: (
      context: RouteBeforeLoadContext,
    ) => readonly Record<string, unknown>[];
    shellComponent?: (...args: never[]) => unknown;
    staleTime?: number;
    gcTime?: number;
    preload?: boolean;
  };

  export type RouteContextFromOptions<TOptions> =
    TOptions extends {
      beforeLoad?: (...args: infer _Args) => infer TResult;
    }
      ? Awaited<TResult>
      : Record<string, unknown>;

  export type ThemeRoute<TContext = Record<string, unknown>> = {
    useRouteContext: () => TContext;
    useLoaderData: () => unknown;
    useLoaderDeps: () => Record<string, unknown>;
    useSearch: () => Record<string, unknown>;
    useParams: () => Record<string, string>;
    useNavigate: () => (options: LinkOptions) => unknown;
  };

  export type RootRoute<TContext = Record<string, unknown>> = ThemeRoute<TContext>;
  export type RouteOptions<TContext = Record<string, unknown>> =
    RouteAuthoringOptions<TContext>;
  export type ThemeRouter<TRouteTree = unknown> = {
    routeTree: TRouteTree;
  };
  export type RouterOptions = {
    routeTree: unknown;
    context?: Record<string, unknown>;
    defaultPreload?: boolean | "intent" | "viewport" | "render";
    defaultPreloadDelay?: number;
    scrollRestoration?: boolean;
    notFoundMode?: "root" | "fuzzy";
  };

  export const HeadContent: (props: HeadContentProps) => JSX.Element;
  export const Link: (props: LinkProps) => JSX.Element;
  export const Outlet: (props: Record<string, never>) => JSX.Element;
  export const RouterProvider: (props: RouterProviderProps) => JSX.Element;
  export const Scripts: (props: Record<string, never>) => JSX.Element;
}

declare module "@tanstack/react-start" {
  export type ServerFnOptions = {
    method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  };
  export type ServerFnBuilder = {
    validator<T>(validator: (data: T) => T): ServerFnBuilder;
    handler<T>(handler: (context: { data: T }) => T | Promise<T>): ServerFnBuilder;
  };
  export function createServerFn(options?: ServerFnOptions): ServerFnBuilder;
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

const GENERATED_ROUTE_TREE_PATH = "src/routeTree.gen.ts";
const GENERATED_ROUTE_TREE_SOURCE = `
// Generated by the Theme build toolchain. This virtual model exists only so
// relative imports resolve in Code Mode; the build produces the authoritative
// route tree from src/routes/**.
export const routeTree: unknown = undefined as unknown;
`;

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
  const normalizedFiles = new Map<string, ThemeModelFile>();
  for (const file of files) {
    normalizedFiles.set(normalizeThemeFilePath(file.path), file);
  }
  if (!normalizedFiles.has(GENERATED_ROUTE_TREE_PATH)) {
    normalizedFiles.set(GENERATED_ROUTE_TREE_PATH, {
      path: GENERATED_ROUTE_TREE_PATH,
      content: GENERATED_ROUTE_TREE_SOURCE,
    });
  }

  for (const file of normalizedFiles.values()) {
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

export type JsxTagDecorationController = {
  update: () => void;
  dispose: () => void;
};

export function createJsxTagDecorations(
  editorInstance: editor.IStandaloneCodeEditor,
): JsxTagDecorationController {
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

export function configureThemeTypeScript(
  monaco: Monaco,
  packageNames: readonly string[] = DEFAULT_THEME_TYPE_PACKAGE_NAMES,
): void {
  const defaults = monaco.languages.typescript.typescriptDefaults;
  defaults.setEagerModelSync(true);
  defaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
  });
  defaults.setModeConfiguration({
    completionItems: true,
    hovers: true,
    documentSymbols: true,
    definitions: true,
    references: true,
    documentHighlights: true,
    rename: true,
    diagnostics: true,
    signatureHelp: true,
    onTypeFormattingEdits: true,
    codeActions: true,
    inlayHints: true,
  });
  defaults.setInlayHintsOptions?.({
    includeInlayParameterNameHints: "all",
    includeInlayParameterNameHintsWhenArgumentMatchesName: true,
    includeInlayFunctionParameterTypeHints: true,
    includeInlayVariableTypeHints: false,
    includeInlayPropertyDeclarationTypeHints: false,
    includeInlayFunctionLikeReturnTypeHints: false,
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
    [
      MORPH_THEME_DEPENDENCY_TYPES,
      renderThemePackageTypeDeclarations(packageNames),
    ]
      .filter(Boolean)
      .join("\n\n"),
    "file:///node_modules/@types/morph-theme-dependencies/index.d.ts",
  );
  for (const declaration of getGeneratedThemePackageDeclarations(packageNames)) {
    defaults.addExtraLib(
      declaration.content,
      `file://${declaration.path}`,
    );
  }
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
