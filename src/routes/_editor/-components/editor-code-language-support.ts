import type { Monaco } from "@monaco-editor/react";
import type { editor, Position } from "monaco-editor";
import { buildThemeRouteRegistry } from "@/lib/storefront/compiler/theme-route-registry";
import {
  collectThemeImportProtectionDiagnosticsForBuild,
} from "@/lib/storefront/compiler/theme-import-protection";
import { readThemePathAliases } from "@/lib/storefront/compiler/theme-path-aliases";
import { suggestTailwindClasses } from "@/lib/storefront/ast/tailwind-class-suggestions";
import {
  DEFAULT_THEME_TYPE_PACKAGE_NAMES,
  getGeneratedThemePackageDeclarations,
  getThemePackageRoot,
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

declare module "react" {
  export type ReactNode = unknown;
  export type ReactElement = JSX.Element;
  export function createContext<T>(value: T): {
    Provider: (props: { value: T; children?: unknown }) => JSX.Element;
  };
  export function useContext<T>(context: unknown): T;
}
`;

const MORPH_THEME_CLSX_TYPES = `
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

const MORPH_THEME_ROUTER_TYPES = `

declare module "@tanstack/react-router" {
  /** Augmented by the Theme router module when it is present in the workspace. */
  export interface Register {}

  /**
   * The real TanStack Router package derives this from the registered router
   * and the generated route tree. Keep the same boundary here so the virtual
   * routeTree.gen.ts model can provide literal path completion in Monaco.
   */
  export type ThemeRoutePath = Register extends { router: infer TRouter }
    ? TRouter extends { routeTree: infer TRouteTree }
      ? TRouteTree extends {
          types: { fileRouteTypes: { to: infer TTo } };
        }
        ? Extract<TTo, string>
        : string
      : string
    : string;

  export type ThemeLinkTo =
    | ThemeRoutePath
    | "."
    | ".."
    | \`./\${string}\`
    | \`../\${string}\`;

  type ThemeRequiredPathParamName<TSegment extends string> =
    TSegment extends "$"
      ? "_splat"
      : TSegment extends \`$\${infer Name}\`
      ? Name extends "" | "*"
        ? never
        : Name
      : never;

  type ThemeOptionalPathParamName<TSegment extends string> =
    TSegment extends \`{-$\${infer Name}}\`
      ? Name extends "" | "*"
        ? never
        : Name
      : never;

  export type ThemePathParamNames<TPath extends string> =
    TPath extends \`\${infer Segment}/\${infer Rest}\`
      ? ThemeRequiredPathParamName<Segment> | ThemePathParamNames<Rest>
      : ThemeRequiredPathParamName<TPath>;

  type ThemeOptionalPathParamNames<TPath extends string> =
    TPath extends \`\${infer Segment}/\${infer Rest}\`
      ? ThemeOptionalPathParamName<Segment> | ThemeOptionalPathParamNames<Rest>
      : ThemeOptionalPathParamName<TPath>;

  export type ThemePathParams<TPath extends string> =
    ([ThemePathParamNames<TPath>] extends [never]
      ? Record<never, never>
      : { [Name in ThemePathParamNames<TPath>]: string | number }) &
    ([ThemeOptionalPathParamNames<TPath>] extends [never]
      ? Record<never, never>
      : { [Name in ThemeOptionalPathParamNames<TPath>]?: string | number });

  type ThemeLinkParams<TTo extends ThemeLinkTo> =
    TTo extends ThemeRoutePath
      ? ThemePathParams<TTo>
      : Record<string, unknown>;

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

  export type LinkOptions<TTo extends ThemeLinkTo = ThemeLinkTo> = {
    to?: TTo;
    from?: ThemeRoutePath;
    params?:
      | ThemeLinkParams<TTo>
      | ((previous: Record<string, unknown>) => ThemeLinkParams<TTo>);
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

  export type LinkProps<TTo extends ThemeLinkTo = ThemeLinkTo> = LinkOptions<TTo> &
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

  export type RouteBeforeLoadContext<TPath extends ThemeRoutePath = ThemeRoutePath> = {
    location: RouteLocation;
    params: ThemePathParams<TPath>;
    search?: Record<string, unknown>;
    context?: Record<string, unknown>;
    preload?: boolean;
    cause?: "preload" | "enter" | "stay";
    abortController?: AbortController;
  };

  export type RouteHeadResult = {
    meta?: readonly Record<string, unknown>[];
    links?: readonly Record<string, unknown>[];
    scripts?: readonly Record<string, unknown>[];
  };

  export type RouteComponent = (props: Record<string, unknown>) => unknown;

  export type ThemeRouteMethod =
    | "ANY"
    | "GET"
    | "POST"
    | "PUT"
    | "PATCH"
    | "DELETE"
    | "OPTIONS"
    | "HEAD";

  export type ThemeRouteMethodResult<TContext = unknown> =
    | Response
    | undefined
    | { isNext: true; context: TContext };

  export type ThemeRouteMethodHandlerContext<
    TPath extends ThemeRoutePath = ThemeRoutePath,
    TContext = Record<string, unknown>,
  > = {
    context: TContext;
    request: Request;
    params: ThemePathParams<TPath>;
    pathname: TPath;
    next: <TNextContext = undefined>(options?: {
      context?: TNextContext;
    }) => { isNext: true; context: TNextContext };
  };

  export type ThemeRouteMethodHandler<
    TPath extends ThemeRoutePath = ThemeRoutePath,
    TContext = Record<string, unknown>,
  > = (
    context: ThemeRouteMethodHandlerContext<TPath, TContext>,
  ) => ThemeRouteMethodResult<TContext> | Promise<ThemeRouteMethodResult<TContext>>;

  export type ThemeRouteMethodBuilderOptions<
    TPath extends ThemeRoutePath = ThemeRoutePath,
    TContext = Record<string, unknown>,
  > = {
    handler?: ThemeRouteMethodHandler<TPath, TContext>;
    middleware?: readonly unknown[];
  };

  export type ThemeRouteServerHandlers<
    TPath extends ThemeRoutePath = ThemeRoutePath,
    TContext = Record<string, unknown>,
  > = Partial<
    Record<
      ThemeRouteMethod,
      | ThemeRouteMethodHandler<TPath, TContext>
      | ThemeRouteMethodBuilderOptions<TPath, TContext>
    >
  >;

  export type ThemeRouteServerOptions<
    TPath extends ThemeRoutePath = ThemeRoutePath,
    TContext = Record<string, unknown>,
  > = {
    middleware?: readonly unknown[];
    handlers?:
      | ThemeRouteServerHandlers<TPath, TContext>
      | ((options: {
          createHandlers: (
            handlers: ThemeRouteServerHandlers<TPath, TContext>,
          ) => ThemeRouteServerHandlers<TPath, TContext>;
        }) => ThemeRouteServerHandlers<TPath, TContext>);
  };

  export type ThemeLazyRouteOptions = {
    component?: RouteComponent;
    pendingComponent?: RouteComponent;
    errorComponent?: RouteComponent;
    notFoundComponent?: RouteComponent;
  };

  export type ThemeRouteUpdateOptions<
    TContext = Record<string, unknown>,
    TPath extends ThemeRoutePath = ThemeRoutePath,
  > = RouteAuthoringOptions<TContext, TPath> & {
    id?: string;
    path?: string;
    getParentRoute?: () => ThemeRoute;
  };

  export type RouteAuthoringOptions<
    TContext = Record<string, unknown>,
    TPath extends ThemeRoutePath = ThemeRoutePath,
  > = {
    component?: RouteComponent;
    pendingComponent?: RouteComponent;
    errorComponent?: RouteComponent;
    notFoundComponent?: RouteComponent;
    loader?: (context: RouteBeforeLoadContext<TPath>) => unknown | Promise<unknown>;
    loaderDeps?: (context: RouteBeforeLoadContext<TPath>) => Record<string, unknown>;
    beforeLoad?: (
      context: RouteBeforeLoadContext<TPath>,
    ) => TContext | Promise<TContext>;
    validateSearch?: (search: Record<string, unknown>) => unknown;
    head?: (context: RouteBeforeLoadContext<TPath>) => RouteHeadResult;
    meta?: (
      context: RouteBeforeLoadContext<TPath>,
    ) => readonly Record<string, unknown>[];
    links?: (
      context: RouteBeforeLoadContext<TPath>,
    ) => readonly Record<string, unknown>[];
    scripts?: (
      context: RouteBeforeLoadContext<TPath>,
    ) => readonly Record<string, unknown>[];
    shellComponent?: (...args: never[]) => unknown;
    staleTime?: number;
    preloadStaleTime?: number;
    gcTime?: number;
    preloadGcTime?: number;
    shouldReload?: boolean | ((context: RouteBeforeLoadContext<TPath>) => boolean);
    caseSensitive?: boolean;
    parseParams?: (params: Record<string, string>) => Record<string, unknown>;
    stringifyParams?: (params: Record<string, unknown>) => Record<string, string>;
    remountDeps?: (context: RouteBeforeLoadContext<TPath>) => unknown;
    headers?:
      | Record<string, string | readonly string[]>
      | ((context: RouteBeforeLoadContext<TPath>) => Record<string, string | readonly string[]>);
    ssr?: boolean | "data-only";
    server?: ThemeRouteServerOptions<TPath, TContext>;
    preload?: boolean;
  };

  export type RouteContextFromOptions<TOptions> =
    TOptions extends {
      beforeLoad?: (...args: infer _Args) => infer TResult;
    }
      ? Awaited<TResult>
      : Record<string, unknown>;

  export type ThemeRoute<
    TContext = Record<string, unknown>,
    TPath extends ThemeRoutePath = ThemeRoutePath,
  > = {
    useRouteContext: () => TContext;
    useLoaderData: () => unknown;
    useLoaderDeps: () => Record<string, unknown>;
    useSearch: () => Record<string, unknown>;
    useParams: () => ThemePathParams<TPath>;
    useNavigate: () => <TTo extends ThemeLinkTo>(options: LinkOptions<TTo>) => unknown;
    update(options?: ThemeRouteUpdateOptions): ThemeRoute;
    addChildren(children: readonly unknown[]): ThemeRoute;
    _addFileChildren(children: Record<string, unknown>): ThemeRoute;
    _addFileTypes<TFileTypes>(types?: TFileTypes): ThemeRoute & {
      types: { fileRouteTypes: TFileTypes };
    };
  };

  export type RootRoute<TContext = Record<string, unknown>> = ThemeRoute<TContext>;
  export type RouteOptions<TContext = Record<string, unknown>> =
    RouteAuthoringOptions<TContext>;
  export type ThemeRouter<TRouteTree = unknown> = {
    routeTree: TRouteTree;
  };
  export type AnyRoute = { types?: unknown; [key: string]: unknown };
  export type RouterOptions = {
    routeTree: unknown;
    history?: unknown;
    context?: Record<string, unknown>;
    defaultPreload?: boolean | "intent" | "viewport" | "render";
    defaultPreloadDelay?: number;
    defaultPreloadStaleTime?: number;
    defaultPreloadGcTime?: number;
    defaultStaleTime?: number;
    defaultGcTime?: number;
    defaultStructuralSharing?: boolean;
    defaultStaleReloadMode?: "old" | "src";
    defaultErrorComponent?: RouteComponent;
    defaultPendingComponent?: RouteComponent;
    defaultNotFoundComponent?: RouteComponent;
    basepath?: string;
    trailingSlash?: "always" | "never" | "preserve";
    caseSensitive?: boolean;
    stringifySearch?: (search: Record<string, unknown>) => string;
    parseSearch?: (search: string) => Record<string, unknown>;
    scrollRestoration?: boolean;
    notFoundMode?: "root" | "fuzzy";
  };

  export function createRootRoute<TContext = Record<string, unknown>>(
    options?: RouteAuthoringOptions<TContext, "/">,
  ): ThemeRoute<TContext>;
  export function createRootRouteWithContext<
    TContext = Record<string, unknown>,
  >(): <TOptions extends RouteAuthoringOptions<TContext, "/"> = RouteAuthoringOptions<TContext, "/">>(
    options?: TOptions,
  ) => ThemeRoute<TContext>;
  export function rootRouteWithContext<
    TContext = Record<string, unknown>,
  >(): <TOptions extends RouteAuthoringOptions<TContext, "/"> = RouteAuthoringOptions<TContext, "/">>(
    options?: TOptions,
  ) => ThemeRoute<TContext>;
  export function createFileRoute<
    TPath extends ThemeRoutePath,
  >(
    path?: TPath,
  ): <TContext = Record<string, unknown>>(
    options?: RouteAuthoringOptions<TContext, TPath>,
  ) => ThemeRoute<TContext, TPath>;
  export function createLazyFileRoute<TPath extends ThemeRoutePath>(
    path: TPath,
  ): (options?: ThemeLazyRouteOptions) => ThemeRoute<Record<string, unknown>, TPath>;
  export function createLazyRoute<TId extends string>(
    id: TId,
  ): (options?: ThemeLazyRouteOptions) => ThemeRoute;
  export function createRoute<TOptions extends RouteAuthoringOptions = RouteAuthoringOptions>(
    options?: TOptions,
  ): ThemeRoute<RouteContextFromOptions<TOptions>>;
  export function getRouteApi<TId extends string>(id: TId): {
    useRouteContext: () => Record<string, unknown>;
    useLoaderData: () => unknown;
    useLoaderDeps: () => Record<string, unknown>;
    useSearch: () => Record<string, unknown>;
    useParams: () => Record<string, string | number | undefined>;
    useNavigate: () => <TTo extends ThemeLinkTo>(options: LinkOptions<TTo>) => unknown;
  };
  export function createRouter(options: RouterOptions): ThemeRouter;

  export const HeadContent: (props: HeadContentProps) => JSX.Element;
  export const Link: <TTo extends ThemeLinkTo = ThemeLinkTo>(
    props: LinkProps<TTo>,
  ) => JSX.Element;
  export const Outlet: (props: Record<string, never>) => JSX.Element;
  export const RouterProvider: (props: RouterProviderProps) => JSX.Element;
  export const Scripts: (props: Record<string, never>) => JSX.Element;
}

`;

const MORPH_THEME_START_TYPES = `
declare module "@tanstack/react-start" {
  export interface Register {}
  export type Method = "GET" | "POST";
  export type ServerFnStrict = boolean | { input?: boolean; output?: boolean };
  export type JsonResponse<T = unknown> = Response & { json(): Promise<T> };
  export type OnRawStreamCallback = (stream: ReadableStream<Uint8Array>) => void;
  export type FrameType = number;
  export type FrameTypeValue = number;
  export type ServerFnOptions = {
    method?: Method;
    strict?: ServerFnStrict;
  };
  export type ServerFnCallOptions<TInput = undefined> = {
    data?: TInput;
    headers?: HeadersInit;
    signal?: AbortSignal;
    fetch?: typeof fetch;
  };
  export type ThemeServerFn<TInput = undefined, TOutput = unknown> =
    ((options?: ServerFnCallOptions<TInput>) => Promise<TOutput>) & {
      url: string;
      method: Method;
    };
  export type ServerFnMiddlewareContext = {
    request?: Request;
    pathname?: string;
    data?: unknown;
    context?: Record<string, unknown>;
    sendContext?: Record<string, unknown>;
    signal?: AbortSignal;
    method?: Method;
    next: (options?: Record<string, unknown>) => unknown;
  };
  export type Middleware = {
    options?: Record<string, unknown>;
    middleware: (middlewares: readonly Middleware[]) => Middleware;
    validator: <TNext>(validator: (data: unknown) => TNext | Promise<TNext>) => Middleware;
    inputValidator: <TNext>(validator: (data: unknown) => TNext | Promise<TNext>) => Middleware;
    client: (handler: (context: ServerFnMiddlewareContext) => unknown) => Middleware;
    server: (handler: (context: ServerFnMiddlewareContext) => unknown) => Middleware;
  };
  export type ServerFnBuilder<TInput = undefined> = {
    <TMethod extends Method = Method>(options?: ServerFnOptions & { method?: TMethod }): ServerFnBuilder<TInput>;
    options: ServerFnOptions;
    validator<TNext>(validator: (data: TInput) => TNext | Promise<TNext>): ServerFnBuilder<TNext>;
    inputValidator<TNext>(validator: (data: TInput) => TNext | Promise<TNext>): ServerFnBuilder<TNext>;
    middleware<TNext extends readonly Middleware[]>(middleware: TNext): ServerFnBuilder<TInput>;
    handler<TOutput>(handler: (context: {
      data: TInput;
      context: Record<string, unknown>;
      request?: Request;
      signal?: AbortSignal;
      method?: Method;
      serverFnMeta?: Record<string, unknown>;
    }) => TOutput | Promise<TOutput>): ThemeServerFn<TInput, TOutput>;
  };
  export function createServerFn<TInput = undefined>(
    options?: ServerFnOptions,
  ): ServerFnBuilder<TInput>;
  export type IsomorphicFn<
    TArgs extends readonly unknown[] = readonly unknown[],
    TServer = undefined,
    TClient = undefined,
  > = (...args: TArgs) => TServer | TClient;
  export type ServerOnlyFn<
    TArgs extends readonly unknown[] = readonly unknown[],
    TServer = unknown,
  > = IsomorphicFn<TArgs, TServer, undefined> & {
    client: <TClient>(implementation: (...args: TArgs) => TClient) => IsomorphicFn<TArgs, TServer, TClient>;
  };
  export type ClientOnlyFn<
    TArgs extends readonly unknown[] = readonly unknown[],
    TClient = unknown,
  > = IsomorphicFn<TArgs, undefined, TClient> & {
    server: <TServer>(implementation: (...args: TArgs) => TServer) => IsomorphicFn<TArgs, TServer, TClient>;
  };
  export type IsomorphicFnBase = {
    server: <TArgs extends readonly unknown[], TServer>(implementation: (...args: TArgs) => TServer) => ServerOnlyFn<TArgs, TServer>;
    client: <TArgs extends readonly unknown[], TClient>(implementation: (...args: TArgs) => TClient) => ClientOnlyFn<TArgs, TClient>;
  };
  export function createIsomorphicFn(): IsomorphicFnBase;
  export function createServerOnlyFn<TArgs extends readonly unknown[], TServer>(implementation: (...args: TArgs) => TServer): ServerOnlyFn<TArgs, TServer>;
  export function createClientOnlyFn<TArgs extends readonly unknown[], TClient>(implementation: (...args: TArgs) => TClient): ClientOnlyFn<TArgs, TClient>;
  export function createMiddleware<TOptions extends { type?: "request" | "function" } = { type?: "request" | "function" }>(options?: TOptions): Middleware;
  export function createCsrfMiddleware<TOptions = Record<string, unknown>>(options?: TOptions): Middleware;
  export const csrfSymbol: unique symbol;
  export function getCsrfRequestValidationResult(...args: readonly unknown[]): unknown;
  export function isCsrfRequestAllowed(...args: readonly unknown[]): boolean;
  export function execValidator(...args: readonly unknown[]): Promise<unknown>;
  export function flattenMiddlewares<T>(middlewares: readonly T[], maxDepth?: number): T[];
  export function executeMiddleware(...args: readonly unknown[]): Promise<unknown>;
  export const TSS_FORMDATA_CONTEXT: unique symbol;
  export const TSS_SERVER_FUNCTION: unique symbol;
  export const TSS_CONTENT_TYPE_FRAMED: string;
  export const TSS_CONTENT_TYPE_FRAMED_VERSIONED: string;
  export const TSS_FRAMED_PROTOCOL_VERSION: number;
  export const FRAME_HEADER_SIZE: number;
  export const TSS_SERVER_FUNCTION_FACTORY: unique symbol;
  export const X_TSS_SERIALIZED: string;
  export const X_TSS_RAW_RESPONSE: string;
  export const X_TSS_CONTEXT: string;
  export function validateFramedProtocolVersion(...args: readonly unknown[]): boolean;
  export type ServerFn<TInput = unknown, TOutput = unknown> = ThemeServerFn<TInput, TOutput>;
  export type AnyServerFn = ServerFn<unknown, unknown>;
  export type StartInstanceOptions = {
    serializationAdapters?: readonly unknown[];
    defaultSsr?: unknown;
    requestMiddleware?: readonly Middleware[];
    functionMiddleware?: readonly Middleware[];
    serverFns?: { fetch?: typeof fetch };
  };
  export type StartInstance = {
    getOptions: () => StartInstanceOptions | Promise<StartInstanceOptions>;
    createMiddleware: typeof createMiddleware;
  };
  export function createStart(
    getOptions?: StartInstanceOptions | (() => StartInstanceOptions | Promise<StartInstanceOptions>),
  ): StartInstance;
  export function useServerFn<TInput = undefined, TOutput = unknown>(fn: ThemeServerFn<TInput, TOutput>): ThemeServerFn<TInput, TOutput>;
  export function hydrate(...args: readonly unknown[]): unknown;
  export function json<T>(value: T, init?: ResponseInit): Response;
  export function mergeHeaders(...headers: readonly unknown[]): Headers;
  export const RawStream: unknown;
  export function getRouterInstance(): unknown;
  export function getGlobalStartContext(): Record<string, unknown>;
  export function getDefaultSerovalPlugins(...args: readonly unknown[]): readonly unknown[];
  export function safeObjectMerge<T extends Record<string, unknown>, U extends Record<string, unknown>>(left: T, right: U): T & U;
  export function createNullProtoObject<T extends object = Record<string, unknown>>(): T;
  export function trackPostProcessPromise<T>(promise: Promise<T>): Promise<T>;
  export const defaultStreamHandler: unknown;
  export const defaultRenderHandler: unknown;
  export function StartServer(props?: { router?: unknown }): JSX.Element;
  export function StartClient(): JSX.Element;
  export function hydrateStart(...args: readonly unknown[]): unknown;
  export type HydrationWhen = unknown;
  export type HydrateOptions = {
    when: HydrationWhen;
    fallback?: unknown;
    onHydrated?: () => void;
    prefetch?: unknown;
    split?: boolean;
  };
  export type HydrateProps = HydrateOptions & { children: unknown };
  export const Hydrate: (props: HydrateProps) => JSX.Element;
}

declare module "@tanstack/react-start/server" {
  export type RequestHeaderName = string;
  export type ResponseHeaderName = string;
  export type RequestOptions<TRegister = unknown> = {
    context?: Record<string, unknown>;
    method?: string;
    request?: Request;
    onEarlyHints?: (...args: readonly unknown[]) => void;
    responseLinkHeader?: boolean | Record<string, unknown>;
    inlineCss?: boolean;
  };
  export type RequestHandler<TRegister = unknown> = (
    request: Request,
    options?: RequestOptions<TRegister>,
  ) => Response | Promise<Response>;
  export type HandlerCallback<TRegister = unknown> = (...args: readonly unknown[]) => unknown;
  export type CreateStartHandlerOptions = {
    handler: HandlerCallback;
    transformAssets?: unknown;
  };
  export function createStartHandler<TRegister = unknown>(
    callbackOrOptions: HandlerCallback | CreateStartHandlerOptions,
  ): RequestHandler<TRegister>;
  export function createRequestHandler<TRegister = unknown>(
    callback: HandlerCallback,
  ): RequestHandler<TRegister>;
  export function requestHandler<TRegister = unknown>(
    handler: RequestHandler<TRegister>,
  ): (request: Request, options?: RequestOptions<TRegister>) => Response | Promise<Response>;
  export function defineHandlerCallback<TCallback extends HandlerCallback>(callback: TCallback): TCallback;
  export function attachRouterServerSsrUtils<THandler>(handler: THandler): THandler;
  export function transformReadableStreamWithRouter<TStream>(router: unknown, stream: TStream, options?: Record<string, unknown>): TStream;
  export function transformPipeableStreamWithRouter<TStream>(router: unknown, stream: TStream, options?: Record<string, unknown>): TStream;
  export const HEADERS: Readonly<Record<string, string>>;
  export const VIRTUAL_MODULES: Readonly<Record<string, string>>;
  export function getRequest(): Request;
  export function getRequestHeaders(): Headers;
  export function getRequestHeader(name: RequestHeaderName): string | undefined;
  export function getRequestIP(options?: { xForwardedFor?: boolean }): string | undefined;
  export function getRequestHost(options?: { xForwardedHost?: boolean }): string;
  export function getRequestUrl(options?: { xForwardedHost?: boolean; xForwardedProto?: boolean }): URL;
  export function getRequestProtocol(options?: { xForwardedProto?: boolean }): string;
  export function setResponseHeaders(headers: HeadersInit): void;
  export function getResponseHeaders(): Headers;
  export function getResponseHeader(name: ResponseHeaderName): string | undefined;
  export function setResponseHeader(name: ResponseHeaderName, value: string | string[]): void;
  export function removeResponseHeader(name: ResponseHeaderName): void;
  export function clearResponseHeaders(headerNames?: readonly string[]): void;
  export function getResponseStatus(): number;
  export function setResponseStatus(code?: number, text?: string): void;
  export function getCookies(): Record<string, string>;
  export function getCookie(name: string): string | undefined;
  export function setCookie(name: string, value: string, options?: Record<string, unknown>): void;
  export function deleteCookie(name: string, options?: Record<string, unknown>): void;
  export function getResponse(): { status?: number; statusText?: string; headers: Headers; errHeaders: Headers };
  export function getValidatedQuery<TSchema>(schema: TSchema): Promise<unknown>;
  export const StartServer: (props?: Record<string, unknown>) => JSX.Element;
  export const defaultStreamHandler: unknown;
  export const defaultRenderHandler: unknown;
  export type SessionConfig = Record<string, unknown>;
  export type EarlyHint = Record<string, unknown>;
  export type EarlyHintsEvent = Record<string, unknown>;
  export type EarlyHintsPhase = "static" | "dynamic";
  export type OnEarlyHints = (event: EarlyHintsEvent) => void;
}

declare module "@tanstack/react-start/client" {
  export function StartClient(): JSX.Element;
  export function hydrateStart(...args: readonly unknown[]): unknown;
  export const Hydrate: (props: import("@tanstack/react-start").HydrateProps) => JSX.Element;
}

declare module "@tanstack/react-start/hydration" {
  export type HydrationCondition = unknown;
  export type HydrationInteractionEvent = unknown;
  export type HydrationInteractionEvents = Record<string, unknown>;
  export type HydrationPrefetchContext = unknown;
  export type HydrationPrefetchFunction = (context: unknown) => unknown;
  export type HydrationPrefetchStrategy = Record<string, unknown>;
  export type HydrationPrefetchWaitReason = unknown;
  export type HydrationStrategy = Record<string, unknown>;
  export type HydrationWhen = unknown;
  export type VisibleHydrationOptions = Record<string, unknown>;
  export function condition(...args: readonly unknown[]): HydrationStrategy;
  export function interaction(...args: readonly unknown[]): HydrationStrategy;
  export function media(...args: readonly unknown[]): HydrationStrategy;
  export function idle(...args: readonly unknown[]): HydrationStrategy;
  export function load(...args: readonly unknown[]): HydrationStrategy;
  export function never(...args: readonly unknown[]): HydrationStrategy;
  export function visible(...args: readonly unknown[]): HydrationStrategy;
}

declare module "@tanstack/react-start/server-entry" {
  export type ServerEntry = { fetch: import("@tanstack/react-start/server").RequestHandler };
  export function createServerEntry(entry: ServerEntry): ServerEntry;
  const serverEntry: ServerEntry;
  export default serverEntry;
}

declare module "@tanstack/react-start/client-rpc" {
  export function createClientRpc(...args: readonly unknown[]): unknown;
  export function createServerRpc(...args: readonly unknown[]): unknown;
  export function createSsrRpc(...args: readonly unknown[]): unknown;
  export function createFromReadableStream(...args: readonly unknown[]): Promise<import("react").ReactNode>;
  export function createFromFetch(...args: readonly unknown[]): Promise<import("react").ReactNode>;
  export function renderServerComponent(...args: readonly unknown[]): Promise<unknown>;
  export function createCompositeComponent(...args: readonly unknown[]): Promise<unknown>;
  export const CompositeComponent: (props: Record<string, unknown>) => JSX.Element;
}

declare module "@tanstack/react-start/server-rpc" {
  export function createServerRpc(...args: readonly unknown[]): unknown;
}

declare module "@tanstack/react-start/ssr-rpc" {
  export function createSsrRpc(...args: readonly unknown[]): unknown;
}

declare module "@tanstack/react-start/rsc" {
  export function createFromReadableStream(...args: readonly unknown[]): Promise<import("react").ReactNode>;
  export function createFromFetch(...args: readonly unknown[]): Promise<import("react").ReactNode>;
  export function renderServerComponent(...args: readonly unknown[]): Promise<unknown>;
  export function createCompositeComponent(...args: readonly unknown[]): Promise<unknown>;
  export const CompositeComponent: (props: Record<string, unknown>) => JSX.Element;
}

declare module "@tanstack/react-start/rsc/serialization/server" {
  export function rscSerializationAdapter(...args: readonly unknown[]): readonly unknown[];
}

declare module "@tanstack/react-start/rsc/serialization/client" {
  export function rscSerializationAdapter(...args: readonly unknown[]): readonly unknown[];
}

declare module "@tanstack/react-start/plugin/vite" {
  export function tanstackStart(...args: readonly unknown[]): readonly unknown[];
}

declare module "@tanstack/react-start/plugin/rsbuild" {
  export function tanstackStart(...args: readonly unknown[]): unknown;
}

declare module "@tanstack/react-start/rsbuild/browser-decode" {
  export function createFromReadableStream(...args: readonly unknown[]): Promise<import("react").ReactNode>;
  export function createFromFetch(...args: readonly unknown[]): Promise<import("react").ReactNode>;
}

declare module "@tanstack/react-start/rsbuild/ssr-decode" {
  export function createFromReadableStream(...args: readonly unknown[]): Promise<import("react").ReactNode>;
}

declare module "@tanstack/react-start/server-only" {}
declare module "@tanstack/react-start/client-only" {}
`;

const MORPH_THEME_ROUTE_AUGMENTATION_TYPES = `
export {};

declare module "@tanstack/react-router" {
  export type ThemeRoutePath = Register extends { router: infer TRouter }
    ? TRouter extends { routeTree: infer TRouteTree }
      ? TRouteTree extends {
          types: { fileRouteTypes: { to: infer TTo } };
        }
        ? Extract<TTo, string>
        : string
      : string
    : string;

  export type ThemeLinkTo =
    | ThemeRoutePath
    | "."
    | ".."
    | \`./\${string}\`
    | \`../\${string}\`;

  type ThemeRequiredPathParamName<TSegment extends string> =
    TSegment extends "$"
      ? "_splat"
      : TSegment extends \`$\${infer Name}\`
      ? Name extends "" | "*"
        ? never
        : Name
      : never;

  type ThemeOptionalPathParamName<TSegment extends string> =
    TSegment extends \`{-$\${infer Name}}\`
      ? Name extends "" | "*"
        ? never
        : Name
      : never;

  export type ThemePathParamNames<TPath extends string> =
    TPath extends \`\${infer Segment}/\${infer Rest}\`
      ? ThemeRequiredPathParamName<Segment> | ThemePathParamNames<Rest>
      : ThemeRequiredPathParamName<TPath>;

  type ThemeOptionalPathParamNames<TPath extends string> =
    TPath extends \`\${infer Segment}/\${infer Rest}\`
      ? ThemeOptionalPathParamName<Segment> | ThemeOptionalPathParamNames<Rest>
      : ThemeOptionalPathParamName<TPath>;

  export type ThemePathParams<TPath extends string> =
    ([ThemePathParamNames<TPath>] extends [never]
      ? Record<never, never>
      : { [Name in ThemePathParamNames<TPath>]: string | number }) &
    ([ThemeOptionalPathParamNames<TPath>] extends [never]
      ? Record<never, never>
      : { [Name in ThemeOptionalPathParamNames<TPath>]?: string | number });
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

type ThemeTypeScriptExtraLibDisposable = {
  dispose: () => void;
};

/**
 * Monaco keeps extra libs on the shared TypeScript defaults object. Dispose the
 * previous set before reconfiguring so HMR/theme switches cannot leave stale
 * ambient modules behind and make otherwise valid imports appear broken.
 */
const themeTypeScriptExtraLibs = new WeakMap<
  object,
  ThemeTypeScriptExtraLibDisposable[]
>();

/** The read-only route tree model exposed by Code Mode. */
export const GENERATED_ROUTE_TREE_PATH = "src/routeTree.gen.ts";

export type ThemeRouteEditorDiagnostic = Readonly<{
  id: string;
  path: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  message: string;
  source: string;
  severity: "error" | "warning";
}>;

/**
 * Turn source-derived route registry diagnostics into the same shape used by
 * the Code Mode Problems panel. Monaco's TypeScript worker cannot know about
 * file-convention rules such as duplicate routes or stale route literals, so
 * those diagnostics must be surfaced alongside its normal markers.
 */
export function collectThemeRouteDiagnostics(
  files: readonly ThemeModelFile[],
): ThemeRouteEditorDiagnostic[] {
  const registry = buildThemeRouteRegistry(files);
  return registry.diagnostics.map((diagnostic) => ({
    id: `tanstack-route:${diagnostic.code}:${diagnostic.sourcePath ?? "workspace"}:${diagnostic.message}`,
    path: diagnostic.sourcePath ?? GENERATED_ROUTE_TREE_PATH,
    line: 1,
    column: 1,
    endLine: 1,
    endColumn: 1,
    message: `[${diagnostic.code}] ${diagnostic.message}`,
    source: "TanStack Router",
    severity: diagnostic.level,
  }));
}

/**
 * Surface the same client/server import boundaries used by the isolated
 * builders in Code Mode. This keeps an invalid `.server`/`.client` import
 * visible before the user starts a build, without disabling Monaco's normal
 * semantic diagnostics.
 */
export function collectThemeImportProtectionEditorDiagnostics(
  files: readonly ThemeModelFile[],
): ThemeRouteEditorDiagnostic[] {
  const pathAliasConfig = readThemePathAliases(
    files.map((file) => ({ path: file.path, content: file.content })),
  );
  const manifest = files.find((file) => file.path === "morph.theme.json");
  let entry = "src/pages/index.tsx";
  let hasStartRuntime = false;
  if (manifest) {
    try {
      const parsed: unknown = JSON.parse(manifest.content);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>;
        if (typeof record.entry === "string") entry = record.entry;
        const router = record.router;
        if (router && typeof router === "object" && !Array.isArray(router)) {
          hasStartRuntime =
            (router as Record<string, unknown>).framework === "tanstack-start";
        }
      }
    } catch {
      // The manifest scanner reports malformed JSON separately.
    }
  }
  const importDiagnostics = collectThemeImportProtectionDiagnosticsForBuild(files, {
    entry,
    hasStartRuntime,
  }).map((diagnostic) => ({
    id: `tanstack-import:${diagnostic.target}:${diagnostic.code}:${diagnostic.filePath}:${diagnostic.line}:${diagnostic.column}:${diagnostic.importSource}`,
    path: diagnostic.filePath,
    line: diagnostic.line,
    column: diagnostic.column,
    endLine: diagnostic.line,
    endColumn: diagnostic.column + Math.max(1, diagnostic.importSource.length),
    message: `[${diagnostic.code}] ${diagnostic.message}`,
    source: "TanStack Start",
    severity: "error" as const,
  }));
  const aliasDiagnostics = pathAliasConfig.diagnostics.map((diagnostic) => ({
    id: `tanstack-path-alias:${diagnostic.filePath}:${diagnostic.message}`,
    path: diagnostic.filePath,
    line: diagnostic.line,
    column: diagnostic.column,
    endLine: diagnostic.line,
    endColumn: diagnostic.column + 1,
    message: `[${diagnostic.code}] ${diagnostic.message}`,
    source: "TypeScript paths",
    severity: "error" as const,
  }));
  return [...aliasDiagnostics, ...importDiagnostics];
}

/**
 * Render the editor-only shape of TanStack's generated route tree.
 *
 * The production build still owns the real routeTree.gen.ts artifact. This
 * virtual model is deliberately type-only: it gives Monaco the same literal
 * route union that VS Code gets from TanStack's route generator without
 * executing customer code or making generated files authorable.
 */
export function renderGeneratedRouteTreeSource(
  files: readonly ThemeModelFile[],
): string {
  const registry = buildThemeRouteRegistry(files);
  const routeEntries = registry.routes.filter(
    (route) => route.kind === "route" && !route.isPathless,
  );
  const routePaths = [
    ...new Set(
      registry.routes
        .map((route) => route.path)
        .filter((path) => path.startsWith("/")),
    ),
  ];
  const normalizedRoutePaths = routePaths.length > 0 ? routePaths : ["/"];
  const pathType = normalizedRoutePaths
    .map((path) => JSON.stringify(path))
    .join(" | ");
  const fullRoutePaths = [
    ...new Set(
      registry.routes
        .map((route) => route.fullPath ?? route.path)
        .filter((path) => path.startsWith("/")),
    ),
  ];
  const normalizedFullRoutePaths =
    fullRoutePaths.length > 0 ? fullRoutePaths : ["/"];
  const fullPathType = normalizedFullRoutePaths
    .map((path) => JSON.stringify(path))
    .join(" | ");

  const nameCounts = new Map<string, number>();
  const namedRoutes = registry.routes.map((route) => {
    if (route.kind === "root") {
      return {
        route,
        importName: "rootRouteImport",
        variableName: "rootRouteImport",
      };
    }
    const relativePath = route.sourcePath
      .replace(/^src\/routes\//, "")
      .replace(/\.[cm]?[jt]sx?$/, "");
    const baseName =
      relativePath
        .split("/")
        .flatMap((segment) => segment.split(/[^A-Za-z0-9]+/))
        .filter(Boolean)
        .map((segment) => `${segment[0]!.toUpperCase()}${segment.slice(1)}`)
        .join("") || "Route";
    const count = nameCounts.get(baseName) ?? 0;
    nameCounts.set(baseName, count + 1);
    const uniqueName = count === 0 ? baseName : `${baseName}${count + 1}`;
    return {
      route,
      importName: `${uniqueName}RouteImport`,
      variableName: `${uniqueName}Route`,
    };
  });
  const namedRouteBySourcePath = new Map(
    namedRoutes.map((entry) => [entry.route.sourcePath, entry]),
  );
  const rootSourcePath =
    namedRoutes.find((entry) => entry.route.kind === "root")?.route
      .sourcePath ?? null;
  const parentBySourcePath = new Map<string, string | null>();
  for (const entry of namedRoutes) {
    if (entry.route.kind === "root") continue;
    if (entry.route.parentSourcePath !== undefined) {
      parentBySourcePath.set(
        entry.route.sourcePath,
        entry.route.parentSourcePath === rootSourcePath
          ? null
          : entry.route.parentSourcePath,
      );
      continue;
    }
    let parent: typeof entry | undefined;
    let parentLength = -1;
    for (const candidate of namedRoutes) {
      if (
        candidate.route.kind !== "route" ||
        candidate.route.sourcePath === entry.route.sourcePath
      ) {
        continue;
      }
      const candidatePath = candidate.route.path.replace(/\/$/, "");
      if (
        !candidatePath ||
        !(
          entry.route.path === `${candidatePath}/` ||
          entry.route.path.startsWith(`${candidatePath}/`)
        ) ||
        candidatePath.length <= parentLength
      ) {
        continue;
      }
      parent = candidate;
      parentLength = candidatePath.length;
    }
    parentBySourcePath.set(
      entry.route.sourcePath,
      parent?.route.sourcePath ?? null,
    );
  }
  const relativeRoutePath = (entry: (typeof namedRoutes)[number]): string => {
    if (entry.route.kind === "root") return "/";
    if (entry.route.isPathless) return "";
    const parentSourcePath = parentBySourcePath.get(entry.route.sourcePath);
    const parent = parentSourcePath
      ? namedRouteBySourcePath.get(parentSourcePath)
      : undefined;
    if (!parent) return entry.route.path;
    const parentPath = parent.route.path.replace(/\/$/, "");
    return entry.route.path.slice(parentPath.length) || "/";
  };
  const relativeRouteId = (entry: (typeof namedRoutes)[number]): string => {
    if (entry.route.kind === "root") return "/";
    const parentSourcePath = parentBySourcePath.get(entry.route.sourcePath);
    const parent = parentSourcePath
      ? namedRouteBySourcePath.get(parentSourcePath)
      : undefined;
    const routeId = entry.route.routeId ?? entry.route.path;
    if (!parent) return routeId;
    if (
      entry.route.isIndex &&
      entry.route.path.replace(/\/$/, "") ===
        parent.route.path.replace(/\/$/, "")
    ) {
      return "/";
    }
    const parentId = (parent.route.routeId ?? parent.route.path).replace(
      /\/$/,
      "",
    );
    if (!parentId || parentId === "/") return routeId;
    return routeId.startsWith(`${parentId}/`)
      ? routeId.slice(parentId.length) || "/"
      : routeId;
  };
  const routeImports = namedRoutes
    .map((entry) => {
      const sourcePath = entry.route.sourcePath.replace(/^src\//, "");
      // TypeScript's module resolver treats TanStack's `$param` and
      // `{-$optional}` route tokens as path syntax when the extension is
      // omitted. Keep the extension for those imports so Monaco can resolve
      // the authored model exactly as the build workspace does.
      const modulePath = /[${}]/.test(sourcePath)
        ? sourcePath
        : sourcePath.replace(/\.[cm]?[jt]sx?$/, "");
      return `import { Route as ${entry.importName} } from "./${modulePath}";`;
    })
    .join("\n");
  const childrenByParent = new Map<
    string | null,
    (typeof namedRoutes)[number][]
  >();
  for (const entry of namedRoutes) {
    if (entry.route.kind === "root") continue;
    const parent = parentBySourcePath.get(entry.route.sourcePath) ?? null;
    const children = childrenByParent.get(parent) ?? [];
    children.push(entry);
    childrenByParent.set(parent, children);
  }
  const childrenOf = (entry: (typeof namedRoutes)[number]) =>
    childrenByParent.get(entry.route.sourcePath) ?? [];
  const routesWithChildren = new Set(
    namedRoutes
      .filter((entry) => childrenOf(entry).length > 0)
      .map((entry) => entry.route.sourcePath),
  );
  const resolvedRouteVariableName = (
    route: (typeof namedRoutes)[number]["route"],
  ): string =>
    routesWithChildren.has(route.sourcePath)
      ? `${namedRouteBySourcePath.get(route.sourcePath)?.variableName ?? "Route"}WithChildren`
      : (namedRouteBySourcePath.get(route.sourcePath)?.variableName ?? "Route");
  const renderRouteWithChildren = (
    entry: (typeof namedRoutes)[number],
  ): string =>
    childrenOf(entry).length > 0
      ? `${entry.variableName}WithChildren`
      : entry.variableName;
  const routeWithChildrenDeclarations: string[] = [];
  const emittedChildrenDeclarations = new Set<string>();
  const emitChildrenDeclaration = (entry: (typeof namedRoutes)[number]) => {
    if (emittedChildrenDeclarations.has(entry.route.sourcePath)) return;
    const children = childrenOf(entry);
    for (const child of children) {
      if (childrenOf(child).length > 0) emitChildrenDeclaration(child);
    }
    if (children.length === 0) return;
    emittedChildrenDeclarations.add(entry.route.sourcePath);
    const childEntries = children
      .map(
        (child) =>
          `  ${child.variableName}: ${renderRouteWithChildren(child)}`,
      )
      .join(",\n");
    routeWithChildrenDeclarations.push(
      `const ${entry.variableName}WithChildren = ${entry.variableName}._addFileChildren({\n${childEntries}\n});`,
    );
  };
  for (const entry of namedRoutes) {
    emitChildrenDeclaration(entry);
  }
  const routeUpdates = namedRoutes
    .filter((entry) => entry.route.kind === "route")
    .map((entry) => {
      const parentSourcePath = parentBySourcePath.get(entry.route.sourcePath);
      const parent = parentSourcePath
        ? namedRouteBySourcePath.get(parentSourcePath)
        : undefined;
      const parentName = parent?.variableName ?? "rootRouteImport";
      const routePath = relativeRoutePath(entry);
      const routeId = relativeRouteId(entry);
      const pathProperty = entry.route.isPathless
        ? ""
        : `\n  path: ${JSON.stringify(routePath)},`;
      return `const ${entry.variableName} = ${entry.importName}.update({
  id: ${JSON.stringify(routeId)},${pathProperty}
  getParentRoute: () => ${parentName},
})`;
    })
    .join("\n");
  const fullPathRouteEntries = [
    ...new Map(
      routeEntries.map((route) => [route.fullPath ?? route.path, route] as const),
    ).values(),
  ];
  const fileRoutesByFullPath = fullPathRouteEntries
    .map((route) => {
      const named = namedRouteBySourcePath.get(route.sourcePath);
      return named
        ? `  ${JSON.stringify(route.fullPath ?? route.path)}: typeof ${resolvedRouteVariableName(route)}`
        : "";
    })
    .filter(Boolean)
    .join("\n");
  const toRouteEntries = [
    ...new Map(
      routeEntries.map((route) => {
        const key = route.path;
        const previous = routeEntries.find(
          (candidate) => candidate !== route && candidate.path === key,
        );
        return [
          key,
          previous?.isIndex && !route.isIndex
            ? previous
            : route.isIndex || !previous
              ? route
              : previous,
        ] as const;
      }),
    ).values(),
  ];
  const fileRoutesByTo = toRouteEntries
    .map((route) => {
      const named = namedRouteBySourcePath.get(route.sourcePath);
      return named
        ? `  ${JSON.stringify(route.path)}: typeof ${resolvedRouteVariableName(route)}`
        : "";
    })
    .filter(Boolean)
    .join("\n");
  const fileRoutesById = namedRoutes
    .map(
      (entry) =>
        `  ${JSON.stringify(entry.route.kind === "root" ? "__root__" : (entry.route.routeId ?? entry.route.id))}: typeof ${entry.route.kind === "root" ? entry.variableName : resolvedRouteVariableName(entry.route)}`,
    )
    .join("\n");
  const fileRoutesByPath = registry.routes
    .filter((route) => route.kind === "route")
    .map((route) => {
      const named = namedRouteBySourcePath.get(route.sourcePath);
      if (!named) return "";
      // TanStack keys FileRoutesByPath by the internal file-route id, not the
      // public URL. This distinction matters for pathless layouts such as
      // `_marketing.about.tsx`: the URL is `/about`, while the route id is
      // `/_marketing/about`.
      const routeKey = route.routeId ?? route.id;
      const parentSourcePath = parentBySourcePath.get(route.sourcePath);
      const parent = parentSourcePath
        ? namedRouteBySourcePath.get(parentSourcePath)
        : undefined;
      return `    ${JSON.stringify(routeKey)}: {
      id: ${JSON.stringify(routeKey)};
      path: ${JSON.stringify(relativeRoutePath(named))};
      fullPath: ${JSON.stringify(route.fullPath ?? route.path)};
      preLoaderRoute: typeof ${named.importName};
      parentRoute: typeof ${parent?.variableName ?? "rootRouteImport"};
    }`;
    })
    .filter(Boolean)
    .join("\n");
  const rootChildren = (childrenByParent.get(null) ?? [])
    .map(
      (entry) => `  ${entry.variableName}: ${renderRouteWithChildren(entry)}`,
    )
    .join(",\n");
  const routeTreeExpression = rootChildren
    ? `rootRouteImport._addFileChildren({
${rootChildren}
})._addFileTypes<ThemeRouteFileTypes>()`
    : "rootRouteImport as unknown as ThemeRouteTree";

  return `/* eslint-disable */

// Generated by the Theme build toolchain. This virtual model exists only in Code Mode.
// The production build produces the authoritative route tree from src/routes/**.
// It mirrors TanStack Router's generated routeTree.gen.ts shape and is never persisted.
${routeImports}

${routeUpdates}

${routeWithChildrenDeclarations.join("\n")}

export interface FileRoutesByFullPath {
${fileRoutesByFullPath}
}
export interface FileRoutesByTo {
${fileRoutesByTo}
}
export interface FileRoutesById {
${fileRoutesById}
}
export type ThemeRoutePath = ${pathType};
export type ThemeRouteFullPath = ${fullPathType};

export type ThemeRouteFileTypes = {
  fileRoutesByFullPath: FileRoutesByFullPath;
  fullPaths: ThemeRouteFullPath;
  fileRoutesByTo: FileRoutesByTo;
  to: ThemeRoutePath;
  id: keyof FileRoutesById;
  fileRoutesById: FileRoutesById;
};

import type { AnyRoute } from "@tanstack/react-router";

// TanStack's route generator adds this module augmentation to the real
// routeTree.gen.ts. Keeping it in the virtual model is what makes
// createFileRoute("/about") type-check in an authored route before a build.
declare module "@tanstack/react-router" {
  interface FileRoutesByPath {
${fileRoutesByPath}
  }
}

export type ThemeRouteTree = AnyRoute & {
  types: { fileRouteTypes: ThemeRouteFileTypes };
};

export const routeTree: ThemeRouteTree = ${routeTreeExpression};
`;
}

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
  normalizedFiles.set(GENERATED_ROUTE_TREE_PATH, {
    ...(normalizedFiles.get(GENERATED_ROUTE_TREE_PATH) ?? {
      path: GENERATED_ROUTE_TREE_PATH,
      content: "",
    }),
    content: renderGeneratedRouteTreeSource(
      [...normalizedFiles.values()].filter(
        (file) => file.path !== GENERATED_ROUTE_TREE_PATH,
      ),
    ),
  });

  for (const file of normalizedFiles.values()) {
    const uri = monaco.Uri.parse(getThemeModelUri(scope, file.path));
    const existingModel = monaco.editor.getModel(uri);
    if (existingModel) {
      if (
        file.path === GENERATED_ROUTE_TREE_PATH &&
        typeof existingModel.getValue === "function" &&
        typeof existingModel.setValue === "function" &&
        existingModel.getValue() !== file.content
      ) {
        existingModel.setValue(file.content);
      }
      continue;
    }
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

export type ThemeRouteCompletionContext = {
  /** Text already typed inside the route literal. */
  query: string;
  /** Monaco's 1-based replacement range. */
  startColumn: number;
  endColumn: number;
};

/**
 * Finds the route literal contexts that TanStack Router normally gets from
 * the generated `FileRoutesByPath` types.  Monaco's TypeScript worker can
 * validate the union, but it does not consistently offer string-literal
 * completions while a JSX attribute is still being typed.  This small
 * provider is derived from the same route registry, so it never becomes a
 * second manually maintained route list.
 */
export function resolveThemeRouteCompletionContext(
  line: string,
  column: number,
): ThemeRouteCompletionContext | null {
  const beforeCursor = line.slice(0, Math.max(0, column - 1));
  const matches = [
    /(?:\bto|\bfrom)\s*[:=]\s*(?:\{\s*)?(["'])([^"']*)$/,
    /\b(?:createFileRoute|createLazyFileRoute)\s*\(\s*(["'])([^"']*)$/,
  ];
  const match = matches
    .map((pattern) => beforeCursor.match(pattern))
    .find((candidate): candidate is RegExpMatchArray => Boolean(candidate));
  if (!match) return null;

  const query = match[2] ?? "";
  return {
    query,
    startColumn: column - query.length,
    endColumn: column,
  };
}

export function registerTanStackRouteCompletionProvider(
  monaco: Monaco,
  getFiles: () => readonly ThemeModelFile[],
) {
  // Monaco's language registry is optional in the lightweight editor host and
  // in tests.  Keep the provider a no-op there instead of making editor mount
  // fail when only the core text model is available.
  if (
    !monaco.languages ||
    typeof monaco.languages.registerCompletionItemProvider !== "function"
  ) {
    return {
      dispose() {
        // No registration was created.
      },
    };
  }

  const provider = {
    triggerCharacters: ["\"", "'", "/", "$"],
    provideCompletionItems(
      model: editor.ITextModel,
      position: Position,
    ) {
      if (!/\.(?:jsx|tsx|js|ts)$/.test(model.uri.path)) {
        return { suggestions: [] };
      }
      const line = model.getLineContent(position.lineNumber);
      const context = resolveThemeRouteCompletionContext(
        line,
        position.column,
      );
      if (!context) return { suggestions: [] };

      const registry = buildThemeRouteRegistry(getFiles());
      const routePaths = [
        ...new Set(
          registry.routes
            .filter((route) => route.kind === "route" && !route.isPathless)
            .map((route) => route.path),
        ),
      ];
      const suggestions = routePaths
        .filter((path) => path.startsWith(context.query))
        .sort((left, right) => {
          const leftExact = left === context.query ? 0 : 1;
          const rightExact = right === context.query ? 0 : 1;
          return leftExact - rightExact || left.localeCompare(right);
        })
        .map((routePath, index) => ({
          label: routePath,
          kind: monaco.languages.CompletionItemKind.Reference,
          insertText: routePath,
          filterText: routePath,
          detail: "TanStack Start route",
          documentation: `Route discovered from ${
            registry.routes.find((route) => route.path === routePath)
              ?.sourcePath ?? "src/routes/**"
          }`,
          range: new monaco.Range(
            position.lineNumber,
            context.startColumn,
            position.lineNumber,
            context.endColumn,
          ),
          sortText: String(index).padStart(4, "0"),
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

export function configureThemeTypeScript(
  monaco: Monaco,
  packageNames: readonly string[] = DEFAULT_THEME_TYPE_PACKAGE_NAMES,
  workspaceScope?: ThemeModelScope,
  workspaceFiles: readonly ThemeModelFile[] = [],
): void {
  const defaults = monaco.languages.typescript.typescriptDefaults;
  const previousExtraLibs = themeTypeScriptExtraLibs.get(defaults);
  previousExtraLibs?.forEach((disposable) => disposable.dispose());
  const currentExtraLibs: ThemeTypeScriptExtraLibDisposable[] = [];
  const addExtraLib = (content: string, filePath: string) => {
    const disposable = defaults.addExtraLib(content, filePath);
    if (disposable && typeof disposable.dispose === "function") {
      currentExtraLibs.push(disposable);
    }
  };
  themeTypeScriptExtraLibs.set(defaults, currentExtraLibs);
  const generatedDeclarations =
    getGeneratedThemePackageDeclarations(packageNames);
  const generatedRoots = new Set(
    generatedDeclarations.flatMap((declaration) => {
      const rootMatch = declaration.path.match(
        /^\/node_modules\/((?:@[^/]+\/[^/]+|[^/]+))\.d\.(?:ts|mts|cts)$/,
      );
      return rootMatch?.[1] ? [rootMatch[1]] : [];
    }),
  );
  const hasGeneratedRoot = (packageName: string) =>
    generatedRoots.has(getThemePackageRoot(packageName));
  const compactPackageNames = packageNames.filter(
    (packageName) => !hasGeneratedRoot(packageName),
  );
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
  const pathAliasConfig = readThemePathAliases(
    workspaceFiles.map((file) => ({
      path: file.path,
      content: file.content,
    })),
  );
  const workspaceBaseUrl = workspaceScope &&
    pathAliasConfig.sourcePath &&
    (pathAliasConfig.baseUrl || Object.keys(pathAliasConfig.paths).length > 0)
    ? getThemeModelUri(workspaceScope, pathAliasConfig.baseUrl).replace(
        /^file:\/\//,
        "",
      )
    : undefined;
  defaults.setCompilerOptions({
    allowJs: true,
    allowNonTsExtensions: true,
    allowSyntheticDefaultImports: true,
    esModuleInterop: true,
    jsx:
      monaco.languages.typescript.JsxEmit.ReactJSX ??
      monaco.languages.typescript.JsxEmit.Preserve,
    jsxImportSource: "react",
    module: monaco.languages.typescript.ModuleKind.ESNext,
    moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
    noEmit: true,
    noImplicitAny: true,
    skipLibCheck: true,
    strict: true,
    strictNullChecks: true,
    target: monaco.languages.typescript.ScriptTarget.ES2022,
    ...(workspaceBaseUrl
      ? {
          baseUrl: workspaceBaseUrl,
          paths: pathAliasConfig.paths,
        }
      : {}),
  });
  if (!hasGeneratedRoot("react")) {
    addExtraLib(
      MORPH_THEME_JSX_TYPES,
      "file:///node_modules/@morph/theme-jsx/index.d.ts",
    );
  }
  const fallbackDependencyTypes = [
    hasGeneratedRoot("clsx") ? "" : MORPH_THEME_CLSX_TYPES,
    hasGeneratedRoot("@tanstack/react-router")
      ? MORPH_THEME_ROUTE_AUGMENTATION_TYPES
      : MORPH_THEME_ROUTER_TYPES,
    hasGeneratedRoot("@tanstack/react-start") ? "" : MORPH_THEME_START_TYPES,
    renderThemePackageTypeDeclarations(compactPackageNames),
  ]
    .filter(Boolean)
    .join("\n\n");
  addExtraLib(
    fallbackDependencyTypes,
    "file:///node_modules/@types/morph-theme-dependencies/index.d.ts",
  );
  for (const declaration of generatedDeclarations) {
    const declarationUri = workspaceScope
      ? getThemeModelUri(workspaceScope, declaration.path.replace(/^\/+/, ""))
      : `file://${declaration.path}`;
    addExtraLib(declaration.content, declarationUri);
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
