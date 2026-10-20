// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { classifyAuthFailure } from "@/lib/auth/auth-failure";

/**
 * Who may put draft content into a Live Preview, through the real server
 * function handlers and the real `commerceAdminMiddleware`.
 *
 * `startThemePreviewServer` and `syncThemePreviewContent` are the two paths
 * that read the drafts and hand them to a preview, where Theme code reads
 * them through the SDK. Each is refused before any side effect when:
 *
 * - nobody is signed in (`AUTH_REQUIRED`);
 * - the account is signed in but is not an administrator (`ACCESS_DENIED`);
 * - the Theme is not one of that storefront's live Themes. That is what
 *   "ownership" means in this product: the authorisation model is the admin
 *   role, and `storefrontThemeBuildDal.verifyThemeOwnership` checks the Theme
 *   belongs to the storefront and is not deleted
 *   (storefront-theme-build.dal.ts, called first by `takePreviewContentTicket`
 *   in storefront-theme-preview-server.serverFn.ts).
 *
 * "No side effect" is asserted against everything those paths would touch:
 * the content ticket (the only database write before the drafts are read),
 * the draft reads, the snapshot, the workspace, and the preview transport's
 * start and content write.
 *
 * `createServerFn` is replaced with a stand-in that runs the validator, then
 * each middleware the function declares, then the handler, as in
 * storefront-theme-preview-runtime.serverFn.test.ts.
 */

const state = vi.hoisted(() => ({
  session: null as { user: { id: string; role: string } } | null,
  env: {} as Record<string, unknown>,
}));

const spies = vi.hoisted(() => ({
  verifyThemeOwnership: vi.fn(),
  nextTicket: vi.fn(),
  readDraftVersions: vi.fn(),
  findEditorContext: vi.fn(),
  listDraftDocuments: vi.fn(),
  createSnapshot: vi.fn(),
  getWorkspaceSnapshot: vi.fn(),
  start: vi.fn(),
  writeContent: vi.fn(),
}));

vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-start")>();
  type Validator = (data: unknown) => unknown;
  type Middleware = {
    options: {
      server: (args: {
        next: (options?: { context?: object }) => Promise<unknown>;
        context: object;
      }) => Promise<unknown>;
    };
  };
  type Handler = (args: { data: unknown; context: object }) => unknown;
  function builder(
    validator: Validator = (data) => data,
    middlewares: readonly Middleware[] = [],
  ) {
    return {
      validator: (next: Validator) => builder(next, middlewares),
      middleware: (next: readonly Middleware[]) =>
        builder(validator, [...middlewares, ...next]),
      handler:
        (handler: Handler) =>
        async ({ data }: { data: unknown }) => {
          const validated = validator(data);
          const run = async (
            index: number,
            context: object,
          ): Promise<unknown> =>
            index === middlewares.length
              ? handler({ data: validated, context })
              : middlewares[index]!.options.server({
                  context,
                  next: (options) =>
                    run(index + 1, { ...context, ...options?.context }),
                });
          return run(0, {});
        },
    };
  }
  return { ...actual, createServerFn: () => builder() };
});
vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => new Request("http://localhost/_serverFn/x"),
}));
vi.mock("../auth/helpers", () => ({
  getAuthWithAdmin: () => ({
    api: { getSession: async () => state.session },
  }),
}));
vi.mock("cloudflare:workers", () => ({ env: state.env }));

vi.mock("@/lib/storefront/dal/storefront-theme.dal", () => ({
  storefrontThemeDal: { findEditorContext: spies.findEditorContext },
}));
vi.mock("@/lib/storefront/dal/storefront-theme-build.dal", () => ({
  storefrontThemeBuildDal: {
    verifyThemeOwnership: spies.verifyThemeOwnership,
  },
}));
vi.mock("@/lib/storefront/dal/storefront-preview-content-ticket.dal", () => ({
  storefrontPreviewContentTicketDal: {
    next: spies.nextTicket,
    readDraftVersions: spies.readDraftVersions,
  },
}));
vi.mock("@/lib/storefront/dal/storefront-page.dal", () => ({
  storefrontPageDal: { listDraftDocuments: spies.listDraftDocuments },
}));
vi.mock("@/lib/storefront/compiler/theme-preview-content", () => ({
  createThemePreviewContentSnapshot: spies.createSnapshot,
  previewContentDigest: async () => "digest",
}));
vi.mock("./preview-media-urls", () => ({
  withSignedPreviewMedia: async (content: unknown) => content,
}));
vi.mock("@/lib/storefront/storage/theme-storage.server", () => ({
  themeSourceStore: {
    getSourceGeneration: async () => 7,
    getWorkspaceSnapshot: spies.getWorkspaceSnapshot,
    readBinaryFile: async () => new Uint8Array(),
  },
}));
vi.mock("@/lib/storefront/service/theme-preview-workspace-files", () => ({
  themePreviewWorkspaceInput: () => ({
    files: [],
    entry: "src/routes/index.tsx",
    fileVersions: {},
    loadBinary: async () => new Uint8Array(),
  }),
  themePreviewEntry: (entry: string) => ({ ok: true, entry }),
}));
vi.mock("@/lib/storefront/service/theme-build-service.factory", () => ({
  astroThemesEnabled: () => false,
}));
vi.mock("@/lib/storefront/service/theme-preview-server.factory", () => ({
  createServerThemePreviewServer: () => ({
    enabled: true,
    kind: "local-sidecar",
    previewHostname: "127.0.0.1",
    server: { start: spies.start, stop: vi.fn() },
    writeContent: spies.writeContent,
    admitAddress: ({ url }: { url: string }) => ({
      ok: true,
      url,
      origin: new URL(url).origin,
    }),
  }),
}));

const { startThemePreviewServer, syncThemePreviewContent } =
  await import("./storefront-theme-preview-server.serverFn");

const STOREFRONT = "11111111-1111-4111-8111-111111111111";
const THEME = "22222222-2222-4222-8222-222222222222";
const INPUT = { storefrontId: STOREFRONT, themeId: THEME };

type Result = { success: boolean; error?: string; message: string };
const call = (fn: unknown, data: unknown) =>
  (fn as (args: { data: unknown }) => Promise<Result>)({ data });

/** The auth refusal a call ended in, or null when it reached its handler. */
async function refusalOf(fn: unknown, data: unknown) {
  try {
    await call(fn, data);
    return null;
  } catch (error) {
    return classifyAuthFailure(error);
  }
}

/** Nothing a refused call may have done. */
function expectNoSideEffects() {
  expect(spies.nextTicket).not.toHaveBeenCalled();
  expect(spies.readDraftVersions).not.toHaveBeenCalled();
  expect(spies.findEditorContext).not.toHaveBeenCalled();
  expect(spies.listDraftDocuments).not.toHaveBeenCalled();
  expect(spies.createSnapshot).not.toHaveBeenCalled();
  expect(spies.getWorkspaceSnapshot).not.toHaveBeenCalled();
  expect(spies.start).not.toHaveBeenCalled();
  expect(spies.writeContent).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  state.session = { user: { id: "admin-1", role: "admin" } };
  for (const key of Object.keys(state.env)) delete state.env[key];
  spies.verifyThemeOwnership.mockResolvedValue(true);
  spies.nextTicket.mockResolvedValue(1);
  spies.readDraftVersions.mockResolvedValue("versions");
  spies.findEditorContext.mockResolvedValue({
    storefront: { id: STOREFRONT },
    theme: { id: THEME, framework: null, previewRuntime: null },
    templates: [],
  });
  spies.listDraftDocuments.mockResolvedValue([]);
  spies.createSnapshot.mockResolvedValue({ templates: {}, pages: {} });
  spies.getWorkspaceSnapshot.mockResolvedValue([
    { path: "src/routes/index.tsx", content: "", version: 1 },
  ]);
  spies.start.mockResolvedValue({
    ok: true,
    url: "http://127.0.0.1:5173/",
    attemptId: "attempt",
    readyMs: 0,
    timings: {},
    hoistedContentFields: [],
  });
  spies.writeContent.mockResolvedValue({ applied: true, ticket: 1 });
});

describe.each([
  ["startThemePreviewServer", () => startThemePreviewServer],
  ["syncThemePreviewContent", () => syncThemePreviewContent],
] as const)("%s: who may put drafts into a Live Preview", (_name, fn) => {
  it("refuses a caller who is not signed in, with no side effect", async () => {
    state.session = null;
    expect(await refusalOf(fn(), INPUT)).toBe("AUTH_REQUIRED");
    expect(spies.verifyThemeOwnership).not.toHaveBeenCalled();
    expectNoSideEffects();
  });

  it("refuses a signed-in account that is not an administrator, with no side effect", async () => {
    state.session = { user: { id: "user-1", role: "user" } };
    expect(await refusalOf(fn(), INPUT)).toBe("ACCESS_DENIED");
    expect(spies.verifyThemeOwnership).not.toHaveBeenCalled();
    expectNoSideEffects();
  });

  it("refuses an administrator for a Theme the storefront does not have, with no side effect", async () => {
    // Covers a Theme of another storefront, a deleted Theme and an id that
    // does not exist: the DAL answers all three with false.
    spies.verifyThemeOwnership.mockResolvedValue(false);
    const result = await call(fn(), INPUT);
    expect(result).toMatchObject({ success: false, error: "NOT_FOUND" });
    expect(spies.verifyThemeOwnership).toHaveBeenCalledWith(STOREFRONT, THEME);
    expectNoSideEffects();
  });

  it("lets an administrator through for the storefront's own Theme (control)", async () => {
    const result = await call(fn(), INPUT);
    expect(result).toMatchObject({ success: true });
    expect(spies.verifyThemeOwnership).toHaveBeenCalledWith(STOREFRONT, THEME);
    expect(spies.nextTicket).toHaveBeenCalledTimes(1);
    expect(spies.findEditorContext).toHaveBeenCalledWith(STOREFRONT, THEME);
    // Exactly one of the two transport effects, the one this path owns.
    expect(
      spies.start.mock.calls.length + spies.writeContent.mock.calls.length,
    ).toBe(1);
  });
});
