import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import * as ts from "typescript";
import { STARTER_THEME_CONTENT_MODULE_SOURCE } from "@/lib/storefront/starter-theme-v3-files";
import type { Monaco } from "@monaco-editor/react";
import {
  collectJsxTagSemanticTokens,
  createJsxTagDecorations,
  configureThemeTypeScript,
  disposeThemeWorkspaceModels,
  ensureThemeWorkspaceModels,
  getThemeModelUri,
  registerTailwindCompletionProvider,
  resolveTailwindCompletionContext,
} from "./editor-code-language-support";

describe("collectJsxTagSemanticTokens", () => {
  it("colors matching tags alike and cycles nested depths", () => {
    const source = ["<main>", "  <section><Card /></section>", "</main>"].join(
      String.fromCharCode(10),
    );
    expect(collectJsxTagSemanticTokens(source)).toEqual([
      { line: 0, character: 1, length: 4, tokenType: 0 },
      { line: 1, character: 3, length: 7, tokenType: 1 },
      { line: 1, character: 12, length: 4, tokenType: 2 },
      { line: 1, character: 21, length: 7, tokenType: 1 },
      { line: 2, character: 2, length: 4, tokenType: 0 },
    ]);
  });

  it("assigns matching nested Hero tags to visible depth classes", () => {
    const source = [
      "<section>",
      "  <div>",
      "    <h1>Title</h1>",
      '    <p><a href="#">Read</a></p>',
      "  </div>",
    "</section>",
    ].join(String.fromCharCode(10));
    const tokens = collectJsxTagSemanticTokens(source);

    expect(tokens.map(({ tokenType }) => tokenType)).toEqual([
      0, 1, 2, 2, 2, 3, 3, 2, 1, 0,
    ]);
  });

  it("ignores JSX-looking text inside strings and comments", () => {
    const source = [
      'const text = "<Fake />"; // <Comment />',
      "return <Real />;",
    ].join(String.fromCharCode(10));
    expect(collectJsxTagSemanticTokens(source)).toEqual([
      { line: 1, character: 8, length: 4, tokenType: 0 },
    ]);
  });
});

describe("JSX tag decoration CSS", () => {
  it("scopes all depth colors to Monaco view-line spans with important precedence", () => {
    const css = readFileSync("src/styles.css", "utf8");

    for (const depth of [0, 1, 2, 3, 4, 5]) {
      expect(css).toContain(
        `.monaco-editor .view-lines .view-line span.morph-jsx-tag-${depth}`,
      );
    }
    expect(css.match(/\.monaco-editor \.view-lines \.view-line span\.morph-jsx-tag-[0-5][^}]*!important/g)).toHaveLength(6);
  });
});

describe("createJsxTagDecorations", () => {
  it("uses valid Monaco ranges for first-line and multiline TSX models", () => {
    const contentListener = { dispose: vi.fn() };
    const model = {
      uri: { path: "/morph-theme/store/theme/src/components/Hero.tsx" },
      getValue: () => ["<main>", "  <Card />", "</main>"].join(String.fromCharCode(10)),
      onDidChangeContent: () => contentListener,
    };
    const deltaDecorations = vi.fn((_oldIds: string[], decorations: Array<{
      range: {
        startLineNumber: number;
        startColumn: number;
        endLineNumber: number;
        endColumn: number;
      };
    }>) => {
      for (const decoration of decorations) {
        expect(decoration.range.startLineNumber).toBeGreaterThanOrEqual(1);
        expect(decoration.range.startColumn).toBeGreaterThanOrEqual(1);
        expect(decoration.range.endLineNumber).toBeGreaterThanOrEqual(1);
        expect(decoration.range.endColumn).toBeGreaterThanOrEqual(1);
      }
      return decorations.map((_decoration, index) => String(index));
    });
    const editor = {
      getModel: () => model,
      deltaDecorations,
      onDidChangeModel: () => ({ dispose: vi.fn() }),
    };

    const decorations = createJsxTagDecorations(editor as never);

    expect(deltaDecorations).toHaveBeenCalledTimes(1);
    expect(deltaDecorations.mock.calls[0][1]).toHaveLength(3);
    decorations.dispose();
  });
});

describe("resolveTailwindCompletionContext", () => {
  it("resolves the active utility inside a JSX className string", () => {
    const line = '    <section className="flex items-center bg-st">';
    const column = line.indexOf('">') + 1;

    const context = resolveTailwindCompletionContext(line, column);

    expect(context).not.toBeNull();
    expect(context?.query).toBe("bg-st");
    expect([...context!.excludedClasses]).toEqual(["flex", "items-center"]);
    expect(line.slice(context!.startColumn - 1, context!.endColumn - 1)).toBe(
      "bg-st",
    );
  });

  it("supports a static className string wrapped in a JSX expression", () => {
    const line = '    <div className={"lg:grid-cols-"}>';
    const column = line.indexOf('"}') + 1;

    expect(resolveTailwindCompletionContext(line, column)?.query).toBe(
      "lg:grid-cols-",
    );
  });

  it("does not offer Tailwind utilities outside class attributes", () => {
    const line = 'const label = "bg-st";';

    expect(resolveTailwindCompletionContext(line, line.length + 1)).toBeNull();
  });

  it("does not treat a completed className string as an active context", () => {
    const line = '    <div className="flex">content';

    expect(resolveTailwindCompletionContext(line, line.length + 1)).toBeNull();
  });
});

describe("configureThemeTypeScript", () => {
  it("enables TSX parsing without disabling real syntax or semantic diagnostics", () => {
    const setEagerModelSync = vi.fn();
    const setDiagnosticsOptions = vi.fn();
    const setModeConfiguration = vi.fn();
    const setInlayHintsOptions = vi.fn();
    const setCompilerOptions = vi.fn();
    const addExtraLib = vi.fn();
    const monaco = {
      languages: {
        typescript: {
          typescriptDefaults: {
            setEagerModelSync,
            setDiagnosticsOptions,
            setModeConfiguration,
            setInlayHintsOptions,
            setCompilerOptions,
            addExtraLib,
          },
          JsxEmit: { Preserve: 1 },
          ModuleKind: { ESNext: 99 },
          ModuleResolutionKind: { NodeJs: 2 },
          ScriptTarget: { ES2022: 9 },
        },
      },
    } as unknown as Monaco;

    configureThemeTypeScript(monaco);

    expect(setEagerModelSync).toHaveBeenCalledWith(true);
    expect(setDiagnosticsOptions).toHaveBeenCalledWith({
      noSemanticValidation: false,
      noSyntaxValidation: false,
    });
    expect(setModeConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({
        completionItems: true,
        hovers: true,
        signatureHelp: true,
        codeActions: true,
        inlayHints: true,
      }),
    );
    expect(setInlayHintsOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        includeInlayParameterNameHints: "all",
        includeInlayFunctionParameterTypeHints: true,
      }),
    );
    expect(setCompilerOptions).toHaveBeenCalledWith(
      expect.objectContaining({ jsx: 1, noEmit: true }),
    );
    expect(addExtraLib).toHaveBeenCalledTimes(2);
    expect(addExtraLib).toHaveBeenCalledWith(
      expect.stringContaining('declare module "clsx"'),
      "file:///node_modules/@types/morph-theme-dependencies/index.d.ts",
    );
    expect(addExtraLib).toHaveBeenCalledWith(
      expect.stringContaining(
        "export const Link: (props: LinkProps) => JSX.Element;",
      ),
      "file:///node_modules/@types/morph-theme-dependencies/index.d.ts",
    );
    expect(addExtraLib).toHaveBeenCalledWith(
      expect.stringContaining('declare module "@tanstack/react-router"'),
      "file:///node_modules/@types/morph-theme-dependencies/index.d.ts",
    );
    expect(addExtraLib).toHaveBeenCalledWith(
      expect.stringContaining("export type RouteBeforeLoadContext ="),
      "file:///node_modules/@types/morph-theme-dependencies/index.d.ts",
    );
    expect(addExtraLib).toHaveBeenCalledWith(
      expect.stringContaining("shellComponent?:"),
      "file:///node_modules/@types/morph-theme-dependencies/index.d.ts",
    );
    expect(addExtraLib).toHaveBeenCalledWith(
      expect.stringContaining('declare module "@tanstack/react-start"'),
      "file:///node_modules/@types/morph-theme-dependencies/index.d.ts",
    );
    expect(addExtraLib).toHaveBeenCalledWith(
      expect.stringContaining(
        "data-${string}",
      ),
      "file:///node_modules/@morph/theme-jsx/index.d.ts",
    );
  });

  it("types root route context and shell options like TanStack Router", () => {
    const addExtraLib = vi.fn();
    const monaco = {
      languages: {
        typescript: {
          typescriptDefaults: {
            setEagerModelSync: vi.fn(),
            setDiagnosticsOptions: vi.fn(),
            setModeConfiguration: vi.fn(),
            setInlayHintsOptions: vi.fn(),
            setCompilerOptions: vi.fn(),
            addExtraLib,
          },
          JsxEmit: { Preserve: 1 },
          ModuleKind: { ESNext: 99 },
          ModuleResolutionKind: { NodeJs: 2 },
          ScriptTarget: { ES2022: 9 },
        },
      },
    } as unknown as Monaco;

    configureThemeTypeScript(monaco);
    const jsxDeclarations = addExtraLib.mock.calls[0]?.[0] as string;
    const dependencyDeclarations = addExtraLib.mock.calls[1]?.[0] as string;
    const files: Record<string, string> = {
      "/workspace/types.d.ts": `${jsxDeclarations}\n${dependencyDeclarations}`,
      "/workspace/src/morph/content.ts": STARTER_THEME_CONTENT_MODULE_SOURCE,
      "/workspace/src/routeTree.gen.ts": `
        export const routeTree: unknown = undefined as unknown;
      `,
      "/workspace/src/routes/router.ts": `
        import { createRouter } from "@tanstack/react-router";
        import { routeTree } from "../routeTree.gen";

        export function getRouter() {
          return createRouter({ routeTree });
        }

        declare module "@tanstack/react-router" {
          interface Register {
            router: ReturnType<typeof getRouter>;
          }
        }
      `,
      "/workspace/src/routes/_root.tsx": `
        import type { ReactNode } from "react";
        import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
        import { MorphContentProvider, loadContentSlots } from "../morph/content";

        export const Route = createRootRoute({
          beforeLoad: async ({ location }) => ({
            morphContent: await loadContentSlots(location.pathname),
          }),
          component: RootComponent,
          shellComponent: RootDocument,
        });

        function RootComponent() {
          const { morphContent } = Route.useRouteContext();
          return <MorphContentProvider value={morphContent}><Outlet /></MorphContentProvider>;
        }

        function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
          return <html><head><HeadContent /></head><body>{children}<Scripts /></body></html>;
        }
      `,
    };
    const compilerOptions: ts.CompilerOptions = {
      jsx: ts.JsxEmit.Preserve,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      noEmit: true,
      strict: true,
      target: ts.ScriptTarget.ES2022,
      skipLibCheck: true,
      types: [],
    };
    const defaultHost = ts.createCompilerHost(compilerOptions);
    const host: ts.CompilerHost = {
      ...defaultHost,
      fileExists: (fileName) =>
        fileName in files || defaultHost.fileExists(fileName),
      readFile: (fileName) => files[fileName] ?? defaultHost.readFile(fileName),
      getSourceFile: (fileName, languageVersion, onError, shouldCreateNew) => {
        const source = files[fileName];
        return source === undefined
          ? defaultHost.getSourceFile(
              fileName,
              languageVersion,
              onError,
              shouldCreateNew,
            )
          : ts.createSourceFile(fileName, source, languageVersion, true);
      },
      resolveModuleNames: (moduleNames, containingFile) =>
        moduleNames.map((moduleName) => {
          if (moduleName === "../morph/content") {
            return {
              resolvedFileName: "/workspace/src/morph/content.ts",
              extension: ts.Extension.Ts,
            };
          }
          if (moduleName === "../routeTree.gen") {
            return {
              resolvedFileName: "/workspace/src/routeTree.gen.ts",
              extension: ts.Extension.Ts,
            };
          }
          return ts.resolveModuleName(
            moduleName,
            containingFile,
            compilerOptions,
            host,
          ).resolvedModule;
        }),
    };
    const program = ts.createProgram(
      [
        "/workspace/types.d.ts",
        "/workspace/src/routes/router.ts",
        "/workspace/src/routes/_root.tsx",
      ],
      compilerOptions,
      host,
    );
    const diagnostics = [
      ...program.getSyntacticDiagnostics(),
      ...program.getSemanticDiagnostics(),
    ];

    expect(
      diagnostics.map((diagnostic) =>
        ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      ),
    ).toEqual([]);
  });
});

describe("theme workspace Monaco models", () => {
  it("uses one isolated file URI tree so relative imports can resolve", () => {
    expect(
      getThemeModelUri(
        { storefrontId: "store 1", themeId: "theme/1" },
        "src\\pages\\index.tsx",
      ),
    ).toBe("file:///morph-theme/store%201/theme%2F1/src/pages/index.tsx");
  });

  it("preloads every source file once and disposes only the current workspace", () => {
    const existingModels = new Map<
      string,
      { dispose: ReturnType<typeof vi.fn> }
    >();
    const createModel = vi.fn(
      (_content: string, _language: string, uri: { toString(): string }) => {
        existingModels.set(uri.toString(), { dispose: vi.fn() });
      },
    );
    const monaco = {
      Uri: {
        parse: vi.fn((value: string) => ({ toString: () => value })),
      },
      editor: {
        getModel: (uri: { toString(): string }) =>
          existingModels.get(uri.toString()),
        getModels: () =>
          [...existingModels.entries()].map(([value, model]) => ({
            uri: { toString: () => value },
            dispose: model.dispose,
          })),
        createModel,
      },
    } as unknown as Monaco;
    const scope = { storefrontId: "store-1", themeId: "theme-1" };
    const files = [
      { path: "src/pages/index.tsx", content: "export default null" },
      { path: "src/components/Hero.tsx", content: "export default null" },
    ];

    ensureThemeWorkspaceModels(monaco, scope, files);
    ensureThemeWorkspaceModels(monaco, scope, files);
    expect(createModel).toHaveBeenCalledTimes(3);
    expect(createModel).toHaveBeenCalledWith(
      expect.stringContaining("export const routeTree"),
      "typescript",
      expect.objectContaining({
        toString: expect.any(Function),
      }),
    );

    existingModels.set("file:///morph-theme/other/theme/src/index.tsx", {
      dispose: vi.fn(),
    });
    disposeThemeWorkspaceModels(monaco, scope);

    expect(
      existingModels.get(
        "file:///morph-theme/store-1/theme-1/src/pages/index.tsx",
      )?.dispose,
    ).toHaveBeenCalledOnce();
    expect(
      existingModels.get("file:///morph-theme/other/theme/src/index.tsx")
        ?.dispose,
    ).not.toHaveBeenCalled();
  });
});

describe("registerTailwindCompletionProvider", () => {
  it("returns ranked Tailwind suggestions for the current class token", () => {
    let provider:
      | {
          provideCompletionItems: (
            model: { uri: { path: string }; getLineContent: () => string },
            position: { lineNumber: number; column: number },
          ) => { suggestions: Array<{ label: string; insertText: string }> };
        }
      | undefined;
    const monaco = {
      Range: class {
        constructor(
          readonly startLineNumber: number,
          readonly startColumn: number,
          readonly endLineNumber: number,
          readonly endColumn: number,
        ) {}
      },
      languages: {
        CompletionItemKind: { Value: 12 },
        registerCompletionItemProvider: vi.fn(
          (_language: string, nextProvider: typeof provider) => {
            provider = nextProvider;
            return { dispose: vi.fn() };
          },
        ),
      },
    } as unknown as Monaco;

    registerTailwindCompletionProvider(monaco);
    expect(
      monaco.languages.registerCompletionItemProvider,
    ).toHaveBeenCalledTimes(2);
    const line = '<div className="flex bg-st';
    const result = provider!.provideCompletionItems(
      { uri: { path: "/src/Hero.tsx" }, getLineContent: () => line },
      { lineNumber: 1, column: line.length + 1 },
    );

    expect(result.suggestions[0]).toMatchObject({
      label: "bg-stone-50",
      insertText: "bg-stone-50",
    });
    expect(result.suggestions.some(({ label }) => label === "flex")).toBe(
      false,
    );
  });
});
