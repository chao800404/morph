import { readFileSync } from "node:fs";
import { posix } from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as ts from "typescript";
import { GENERATED_THEME_PACKAGE_DECLARATIONS } from "./editor-code-package-types.generated";
import type { Monaco } from "@monaco-editor/react";
import {
  collectJsxTagSemanticTokens,
  collectThemeRouteDiagnostics,
  createJsxTagDecorations,
  configureThemeTypeScript,
  disposeThemeWorkspaceModels,
  ensureThemeWorkspaceModels,
  getThemeModelUri,
  renderGeneratedRouteTreeSource,
  registerTailwindCompletionProvider,
  registerTanStackRouteCompletionProvider,
  resolveThemeRouteCompletionContext,
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
    expect(
      css.match(
        /\.monaco-editor \.view-lines \.view-line span\.morph-jsx-tag-[0-5][^}]*!important/g,
      ),
    ).toHaveLength(6);
  });
});

describe("createJsxTagDecorations", () => {
  it("uses valid Monaco ranges for first-line and multiline TSX models", () => {
    const contentListener = { dispose: vi.fn() };
    const model = {
      uri: { path: "/morph-theme/store/theme/src/components/Hero.tsx" },
      getValue: () =>
        ["<main>", "  <Card />", "</main>"].join(String.fromCharCode(10)),
      onDidChangeContent: () => contentListener,
    };
    const deltaDecorations = vi.fn(
      (
        _oldIds: string[],
        decorations: Array<{
          range: {
            startLineNumber: number;
            startColumn: number;
            endLineNumber: number;
            endColumn: number;
          };
        }>,
      ) => {
        for (const decoration of decorations) {
          expect(decoration.range.startLineNumber).toBeGreaterThanOrEqual(1);
          expect(decoration.range.startColumn).toBeGreaterThanOrEqual(1);
          expect(decoration.range.endLineNumber).toBeGreaterThanOrEqual(1);
          expect(decoration.range.endColumn).toBeGreaterThanOrEqual(1);
        }
        return decorations.map((_decoration, index) => String(index));
      },
    );
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

describe("resolveThemeRouteCompletionContext", () => {
  it("finds Link and createFileRoute route literals", () => {
    const linkLine = '<Link to="/products/">';
    expect(
      resolveThemeRouteCompletionContext(
        linkLine,
        linkLine.indexOf('">') + 1,
      ),
    ).toMatchObject({ query: "/products/" });

    const expressionLine = '<Link to={"/products/';
    expect(
      resolveThemeRouteCompletionContext(
        expressionLine,
        expressionLine.length + 1,
      ),
    ).toMatchObject({ query: "/products/" });

    const routeLine = 'export const Route = createFileRoute("/ab';
    expect(
      resolveThemeRouteCompletionContext(routeLine, routeLine.length + 1),
    ).toMatchObject({ query: "/ab" });
  });

  it("does not treat ordinary strings as route contexts", () => {
    const line = 'const value = "/about";';
    expect(resolveThemeRouteCompletionContext(line, line.length + 1)).toBeNull();
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
    expect(addExtraLib).toHaveBeenCalledTimes(
      1 + GENERATED_THEME_PACKAGE_DECLARATIONS.length,
    );
    expect(addExtraLib).toHaveBeenCalledWith(
      expect.stringContaining('declare module "@tanstack/react-router"'),
      "file:///node_modules/@types/morph-theme-dependencies/index.d.ts",
    );
    expect(addExtraLib).toHaveBeenCalledWith(
      expect.stringContaining("export type ThemeLinkTo ="),
      "file:///node_modules/@types/morph-theme-dependencies/index.d.ts",
    );
    expect(addExtraLib).not.toHaveBeenCalledWith(
      expect.any(String),
      "file:///node_modules/@morph/theme-jsx/index.d.ts",
    );
  });

  it("passes the Theme tsconfig path aliases to Monaco's TypeScript worker", () => {
    const setCompilerOptions = vi.fn();
    const monaco = {
      languages: {
        typescript: {
          typescriptDefaults: {
            setEagerModelSync: vi.fn(),
            setDiagnosticsOptions: vi.fn(),
            setModeConfiguration: vi.fn(),
            setCompilerOptions,
            addExtraLib: vi.fn(() => ({ dispose: vi.fn() })),
          },
          JsxEmit: { Preserve: 1 },
          ModuleKind: { ESNext: 99 },
          ModuleResolutionKind: { NodeJs: 2 },
          ScriptTarget: { ES2022: 9 },
        },
      },
    } as unknown as Monaco;

    configureThemeTypeScript(
      monaco,
      [],
      { storefrontId: "storefront", themeId: "theme" },
      [
        {
          path: "tsconfig.json",
          content: JSON.stringify({
            compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } },
          }),
        },
      ],
    );

    expect(setCompilerOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: "/morph-theme/storefront/theme/",
        paths: { "@/*": ["src/*"] },
      }),
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

    configureThemeTypeScript(monaco, []);
    const jsxDeclarations = addExtraLib.mock.calls.find(
      ([, uri]) => uri === "file:///node_modules/@morph/theme-jsx/index.d.ts",
    )?.[0] as string;
    const dependencyDeclarations = addExtraLib.mock.calls.find(
      ([, uri]) =>
        uri ===
        "file:///node_modules/@types/morph-theme-dependencies/index.d.ts",
    )?.[0] as string;
    const files: Record<string, string> = {
      "/workspace/types.d.ts": `${jsxDeclarations}\n${dependencyDeclarations}`,
      "/workspace/src/morph/content.ts": `
        export type MorphContentSlots = Record<string, Record<string, unknown>>;
        export const MorphContentProvider = (props: { value: MorphContentSlots; children?: unknown }): JSX.Element => props.children as JSX.Element;
        export const loadContentSlots = async (_pathname: string): Promise<MorphContentSlots> => ({});
      `,
      "/workspace/src/routeTree.gen.ts": renderGeneratedRouteTreeSource([
        {
          path: "src/routes/__root.tsx",
          content: `export const Route = createRootRoute({ component: Root });`,
        },
        {
          path: "src/routes/about.tsx",
          content: `export const Route = createFileRoute("/about")({ component: About });`,
        },
        {
          path: "src/routes/_marketing.tsx",
          content: `export const Route = createFileRoute("/_marketing")({});`,
        },
        {
          path: "src/routes/_marketing.about.tsx",
          content: `export const Route = createFileRoute("/_marketing/about")({});`,
        },
        {
          path: "src/routes/products/$id.tsx",
          content: `export const Route = createFileRoute("/products/$id")({ component: Product });`,
        },
        {
          path: "src/routes/files/$.tsx",
          content: `export const Route = createFileRoute("/files/$")({});`,
        },
        {
          path: "src/routes/docs/{-$section}.tsx",
          content: `export const Route = createFileRoute("/docs/{-$section}")({});`,
        },
      ]),
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
      "/workspace/src/routes/__root.tsx": `
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

        function RootDocument({ children }: Readonly<{ children: unknown }>) {
          return <html><head><HeadContent /></head><body>{children}<Scripts /></body></html>;
        }
      `,
      "/workspace/src/routes/about.tsx": `
        import { createFileRoute } from "@tanstack/react-router";

        export const Route = createFileRoute("/about")({
          component: AboutRoute,
          ssr: "data-only",
          preloadStaleTime: 10_000,
          preloadGcTime: 20_000,
          shouldReload: ({ params }) => params !== undefined,
          parseParams: (params) => ({ id: params.id ?? "" }),
          stringifyParams: (params) => ({ id: String(params.id ?? "") }),
          remountDeps: ({ location }) => location.pathname,
          server: {
            handlers: ({ createHandlers }) =>
              createHandlers({
                GET: async ({ request, params, pathname, context, next }) => {
                  void request;
                  void params;
                  void pathname;
                  void context;
                  void next;
                  return new Response("ok");
                },
                POST: {
                  handler: ({ request }) => {
                    void request;
                    return new Response("created");
                  },
                  middleware: [],
                },
              }),
          },
        });

        function AboutRoute() {
          return <main>About</main>;
        }
      `,
      "/workspace/src/routes/_marketing.tsx": `
        import { Outlet, createFileRoute } from "@tanstack/react-router";
        export const Route = createFileRoute("/_marketing")({
          component: MarketingLayout,
        });
        function MarketingLayout() {
          return <><Outlet /></>;
        }
      `,
      "/workspace/src/routes/_marketing.about.tsx": `
        import { createFileRoute } from "@tanstack/react-router";
        export const Route = createFileRoute("/_marketing/about")({
          component: MarketingAbout,
        });
        function MarketingAbout() {
          return <main>About</main>;
        }
      `,
      "/workspace/src/routes/products/$id.tsx": `
        import { createFileRoute } from "@tanstack/react-router";
        export const Route = createFileRoute("/products/$id")({
          component: Product,
        });
        function Product() {
          return <main>Product</main>;
        }
      `,
      "/workspace/src/routes/files/$.tsx": `
        import { createFileRoute } from "@tanstack/react-router";
        export const Route = createFileRoute("/files/$")({});
      `,
      "/workspace/src/routes/docs/{-$section}.tsx": `
        import { createFileRoute } from "@tanstack/react-router";
        export const Route = createFileRoute("/docs/{-$section}")({});
      `,
      "/workspace/src/components/Hero.tsx": `
        import { Link } from "@tanstack/react-router";
        export function Hero() {
          return <><Link to="/about">About</Link><Link to="/products/$id" params={{ id: "1" }}>Product</Link><Link to="/about">Marketing</Link></>;
        }
      `,
    };
    for (const declaration of GENERATED_THEME_PACKAGE_DECLARATIONS) {
      files[`/workspace${declaration.path}`] = declaration.content;
    }
    const compilerOptions: ts.CompilerOptions = {
      jsx: ts.JsxEmit.Preserve,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      noEmit: true,
      strict: true,
      target: ts.ScriptTarget.ES2022,
      skipLibCheck: false,
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
          if (moduleName.startsWith(".")) {
            const basePath = posix.normalize(
              posix.join(posix.dirname(containingFile), moduleName),
            );
            const runtimeDeclarationPath = basePath.endsWith(".cjs")
              ? `${basePath.slice(0, -4)}.d.cts`
              : basePath.endsWith(".js")
                ? `${basePath.slice(0, -3)}.d.ts`
                : undefined;
            const relativeFileName = [
              basePath,
              `${basePath}.ts`,
              `${basePath}.tsx`,
              `${basePath}.d.ts`,
              `${basePath}.d.mts`,
              `${basePath}.d.cts`,
              `${basePath}/index.d.ts`,
              `${basePath}/index.d.mts`,
              `${basePath}/index.d.cts`,
              runtimeDeclarationPath,
            ].find(
              (fileName): fileName is string =>
                fileName !== undefined && fileName in files,
            );
            if (relativeFileName) {
              return {
                resolvedFileName: relativeFileName,
                extension: relativeFileName.endsWith(".d.cts")
                  ? ts.Extension.Dts
                  : ts.Extension.Dts,
              };
            }
          }
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
          if (
            [
              "react",
              "@tanstack/react-router",
              "@tanstack/react-start",
              "@tanstack/react-start/server",
            ].includes(moduleName)
          ) {
            return undefined;
          }
          const generatedModule =
            files[`/workspace/node_modules/${moduleName}.d.ts`];
          if (generatedModule !== undefined) {
            return {
              resolvedFileName: `/workspace/node_modules/${moduleName}.d.ts`,
              extension: ts.Extension.Dts,
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
        "/workspace/src/routes/__root.tsx",
        "/workspace/src/routes/about.tsx",
        "/workspace/src/routes/_marketing.tsx",
        "/workspace/src/routes/_marketing.about.tsx",
        "/workspace/src/routes/files/$.tsx",
        "/workspace/src/routes/docs/{-$section}.tsx",
        "/workspace/src/components/Hero.tsx",
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

    files["/workspace/src/components/InvalidLink.tsx"] = `
      import { Link } from "@tanstack/react-router";
      export function InvalidLink() {
        return <Link to="/products/$id" params={{ slug: "1" }}>Missing</Link>;
      }
    `;
    const invalidProgram = ts.createProgram(
      [
        "/workspace/types.d.ts",
        "/workspace/src/routes/router.ts",
        "/workspace/src/components/InvalidLink.tsx",
      ],
      compilerOptions,
      host,
    );
    const invalidDiagnostics = invalidProgram
      .getSemanticDiagnostics()
      .map((diagnostic) =>
        ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      );
    expect(invalidDiagnostics).toEqual(
      expect.arrayContaining([
        expect.stringContaining("'slug' does not exist"),
      ]),
    );

    files["/workspace/src/components/ValidSpecialParams.tsx"] = `
      import { Link } from "@tanstack/react-router";
      export function ValidSpecialParams() {
        return <>
          <Link to="/files/$" params={{ _splat: "docs/readme" }}>Splat</Link>
          <Link to="/docs/{-$section}" params={{}}>Docs</Link>
          <Link to="/docs/{-$section}" params={{ section: "guides" }}>Guides</Link>
        </>;
      }
    `;
    const specialParamsProgram = ts.createProgram(
      [
        "/workspace/types.d.ts",
        "/workspace/src/routeTree.gen.ts",
        "/workspace/src/routes/router.ts",
        "/workspace/src/components/ValidSpecialParams.tsx",
      ],
      compilerOptions,
      host,
    );
    expect(
      specialParamsProgram
        .getSemanticDiagnostics()
        .map((diagnostic) =>
          ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
        ),
    ).toEqual([]);
  }, 30_000);

  it("provides a safe fallback for Start server and route APIs when package declarations are unavailable", () => {
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

    configureThemeTypeScript(monaco, []);
    const declarations = Object.fromEntries(
      addExtraLib.mock.calls.map(([content, uri]) => [uri, content]),
    ) as Record<string, string>;
    const files: Record<string, string> = {
      "/workspace/types.d.ts": `${declarations["file:///node_modules/@morph/theme-jsx/index.d.ts"]}\n${declarations["file:///node_modules/@types/morph-theme-dependencies/index.d.ts"]}`,
      "/workspace/src/routes/api.tsx": `
        import {
          createFileRoute,
          createLazyFileRoute,
          createRootRouteWithContext,
        } from "@tanstack/react-router";
        import {
          Hydrate,
          createClientOnlyFn,
          createCsrfMiddleware,
          createIsomorphicFn,
          createMiddleware,
          createServerFn,
          createServerOnlyFn,
          createStart,
          StartClient as RootStartClient,
          StartServer,
          createClientOnlyFn as RootCreateClientOnlyFn,
          defaultRenderHandler,
          defaultStreamHandler,
          getDefaultSerovalPlugins,
          safeObjectMerge,
          createNullProtoObject,
          trackPostProcessPromise,
          FRAME_HEADER_SIZE,
          TSS_SERVER_FUNCTION_FACTORY,
          flattenMiddlewares,
          executeMiddleware,
          useServerFn,
        } from "@tanstack/react-start";
        import { StartClient, hydrateStart } from "@tanstack/react-start/client";
        import type { FrameType } from "@tanstack/react-start";
        import { condition, idle, interaction, load, media, never, visible } from "@tanstack/react-start/hydration";
        import { createServerEntry } from "@tanstack/react-start/server-entry";
        import { createClientRpc } from "@tanstack/react-start/client-rpc";
        import { createFromFetch } from "@tanstack/react-start/rsc";
        import { tanstackStart } from "@tanstack/react-start/plugin/vite";
        import {
          getRequestUrl,
          setResponseHeader,
          createStartHandler,
          createRequestHandler,
          requestHandler,
          defineHandlerCallback,
          attachRouterServerSsrUtils,
          transformReadableStreamWithRouter,
          transformPipeableStreamWithRouter,
          HEADERS,
          VIRTUAL_MODULES,
        } from "@tanstack/react-start/server";

        const loadGreeting = createServerFn<{ id: string }>()
          .validator((data) => data)
          .handler(({ data, request, context }) => {
            void request;
            void context;
            return data.id;
          });
        const callGreeting = useServerFn(loadGreeting);
        const clientOnly = createClientOnlyFn((value: string) => value);
        const serverOnly = createServerOnlyFn((value: string) => value);
        const isomorphic = createIsomorphicFn()
          .server((value: string) => value)
          .client((value: string) => value);
        const middleware = createMiddleware({});
        const csrf = createCsrfMiddleware({});
        const requestMiddleware = createMiddleware({ type: "request" }).server(({ request, pathname, context, next }) => {
          void request;
          void pathname;
          void context;
          return next();
        });
        const functionMiddleware = createMiddleware({ type: "function" })
          .validator((data) => data)
          .client(({ data, next }) => {
            void data;
            return next();
          })
          .server(({ data, next }) => {
            void data;
            return next();
          });
        const postGreeting = createServerFn({ method: "POST" })
          .middleware([functionMiddleware])
          .handler(({ data, signal, method }) => {
            void data;
            void signal;
            void method;
            return "created";
          });
        const start = createStart({});
        const startFromFactory = createStart(() => ({}));
        const serverEntry = createServerEntry({ fetch: async () => new Response("ok") });
        const LazyRoute = createLazyFileRoute("/api")({
          component: ApiRoute,
        });
        const RootRoute = createRootRouteWithContext<{ requestId: string }>()({});
        void callGreeting;
        void clientOnly;
        void serverOnly;
        void isomorphic;
        void middleware;
        void csrf;
        void requestMiddleware;
        void functionMiddleware;
        void postGreeting({ data: undefined });
        void postGreeting.url;
        void start;
        void startFromFactory;
        void serverEntry;
        void RootStartClient;
        void StartServer;
        void RootCreateClientOnlyFn;
        void defaultRenderHandler;
        void defaultStreamHandler;
        void getDefaultSerovalPlugins;
        void safeObjectMerge;
        void createNullProtoObject;
        void trackPostProcessPromise;
        void FRAME_HEADER_SIZE;
        void TSS_SERVER_FUNCTION_FACTORY;
        void flattenMiddlewares;
        void executeMiddleware;
        void createClientRpc;
        void createFromFetch;
        void tanstackStart;
        void StartClient;
        void hydrateStart;
        void getRequestUrl;
        void setResponseHeader;
        void createStartHandler;
        void createRequestHandler;
        void requestHandler;
        void defineHandlerCallback;
        void attachRouterServerSsrUtils;
        void transformReadableStreamWithRouter;
        void transformPipeableStreamWithRouter;
        void HEADERS;
        void VIRTUAL_MODULES;
        type FrameTypeCheck = FrameType;
        void condition;
        void idle;
        void interaction;
        void load;
        void media;
        void never;
        void visible;
        void LazyRoute;
        void RootRoute;

        export const Route = createFileRoute("/api")({
          component: ApiRoute,
          ssr: "data-only",
          server: {
            handlers: ({ createHandlers }) =>
              createHandlers({
                GET: async ({ request, params, pathname, context, next }) => {
                  void request;
                  void params;
                  void pathname;
                  void context;
                  void next;
                  return new Response("ok");
                },
                POST: {
                  handler: ({ request }) => {
                    void request;
                    return new Response("created");
                  },
                  middleware: [],
                },
              }),
          },
        });

        function ApiRoute() {
          return <Hydrate when={{}}><main>API</main></Hydrate>;
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
      skipLibCheck: false,
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
    };
    const program = ts.createProgram(
      ["/workspace/types.d.ts", "/workspace/src/routes/api.tsx"],
      compilerOptions,
      host,
    );
    expect(
      [...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()].map(
        (diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      ),
    ).toEqual([]);
  }, 30_000);

  it("mirrors TanStack's FileRoutesByPath augmentation for new routes", () => {
    const source = renderGeneratedRouteTreeSource([
      {
        path: "src/routes/__root.tsx",
        content: `export const Route = createRootRoute({ component: Root });`,
      },
      {
        path: "src/routes/about.tsx",
        content: `export const Route = createFileRoute("/about")({});`,
      },
      {
        path: "src/routes/posts.tsx",
        content: `export const Route = createFileRoute("/posts")({});`,
      },
      {
        path: "src/routes/posts/index.tsx",
        content: `export const Route = createFileRoute("/posts/")({});`,
      },
    ]);

    expect(source).toContain(
      'import { Route as rootRouteImport } from "./routes/__root";',
    );
    expect(source).toContain(
      'import { Route as AboutRouteImport } from "./routes/about";',
    );
    expect(source).toContain("export interface FileRoutesByFullPath");
    expect(source).toContain("_addFileChildren");
    expect(source).toContain("interface FileRoutesByPath");
    expect(source).toContain('"/about": {');
    expect(source).toContain("to: ThemeRoutePath");
    expect(source).toContain('"__root__": typeof rootRouteImport');
    expect(source).toContain('"/posts/": typeof PostsIndexRoute');
    expect(source).toContain('"/posts": typeof PostsRouteWithChildren');
  });

  it("keeps internal ids separate from public paths for pathless layouts", () => {
    const source = renderGeneratedRouteTreeSource([
      {
        path: "src/routes/__root.tsx",
        content: `export const Route = createRootRoute({});`,
      },
      {
        path: "src/routes/_marketing.tsx",
        content: `export const Route = createFileRoute("/_marketing")({});`,
      },
      {
        path: "src/routes/_marketing.about.tsx",
        content: `export const Route = createFileRoute("/_marketing/about")({});`,
      },
    ]);

    expect(source).toContain('"/_marketing/about": {');
    expect(source).toContain('path: "";');
    expect(source).toContain('fullPath: "/about";');
    expect(source).toContain(
      "preLoaderRoute: typeof MarketingAboutRouteImport;",
    );
    expect(source).toContain("parentRoute: typeof MarketingRoute;");
  });

  it("mounts generated package declarations inside the isolated Theme workspace", () => {
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
    const scope = { storefrontId: "store-1", themeId: "theme-1" };

    configureThemeTypeScript(
      monaco,
      ["react", "@tanstack/react-router"],
      scope,
    );

    expect(addExtraLib).toHaveBeenCalledWith(
      expect.any(String),
      "file:///morph-theme/store-1/theme-1/node_modules/react.d.ts",
    );
    expect(addExtraLib).toHaveBeenCalledWith(
      expect.any(String),
      "file:///morph-theme/store-1/theme-1/node_modules/@tanstack/react-router.d.ts",
    );
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

describe("collectThemeRouteDiagnostics", () => {
  it("surfaces route convention diagnostics with an editor location", () => {
    const diagnostics = collectThemeRouteDiagnostics([
      {
        path: "src/routes/__root.tsx",
        content: `export const Route = createRootRoute({});`,
      },
      {
        path: "src/routes/about.tsx",
        content: `export const Route = createFileRoute("/company")({});`,
      },
      {
        path: "src/routes/company.tsx",
        content: `export const Route = createFileRoute("/company")({});`,
      },
    ]);

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "src/routes/about.tsx",
          line: 1,
          column: 1,
          severity: "warning",
          source: "TanStack Router",
          message: expect.stringContaining("ROUTE_PATH_MISMATCH"),
        }),
        expect.objectContaining({
          path: "src/routes/company.tsx",
          severity: "error",
          message: expect.stringContaining("DUPLICATE_ROUTE_PATH"),
        }),
      ]),
    );
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

describe("registerTanStackRouteCompletionProvider", () => {
  it("derives Link path suggestions from the current route files", () => {
    let provider:
      | {
          provideCompletionItems: (
            model: {
              uri: { path: string };
              getLineContent: (lineNumber: number) => string;
            },
            position: { lineNumber: number; column: number },
          ) => {
            suggestions: Array<{
              label: string;
              insertText: string;
              detail: string;
            }>;
          }
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
        CompletionItemKind: { Reference: 17 },
        registerCompletionItemProvider: vi.fn(
          (_language: string, nextProvider: typeof provider) => {
            provider = nextProvider;
            return { dispose: vi.fn() };
          },
        ),
      },
    } as unknown as Monaco;

    registerTanStackRouteCompletionProvider(monaco, () => [
      {
        path: "src/routes/__root.tsx",
        content: "export const Route = createRootRoute({});",
      },
      {
        path: "src/routes/about.tsx",
        content: 'export const Route = createFileRoute("/about")({});',
      },
      {
        path: "src/routes/products/$id.tsx",
        content: 'export const Route = createFileRoute("/products/$id")({});',
      },
    ]);

    const line = '<Link to="/a';
    const result = provider!.provideCompletionItems(
      { uri: { path: "/src/components/Hero.tsx" }, getLineContent: () => line },
      { lineNumber: 1, column: line.length + 1 },
    );
    expect(result.suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "/about",
          insertText: "/about",
          detail: "TanStack Start route",
        }),
      ]),
    );
    expect(result.suggestions).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ label: "/products/$id" })]),
    );
  });
});
