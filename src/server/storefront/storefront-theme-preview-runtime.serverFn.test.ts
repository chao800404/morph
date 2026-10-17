// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { classifyAuthFailure } from "@/lib/auth/auth-failure";

/**
 * The Live Preview runtime a Theme records (R-0, R1), through the real
 * server function handlers and the real `commerceAdminMiddleware`:
 * `createServerFn` is replaced with a stand-in that runs the validator, then
 * each middleware the function declares, then the handler. Only the session
 * lookup and what lies beyond the DAL / preview transport are stubbed.
 */

const state = vi.hoisted(() => ({
  session: null as { user: { id: string; role: string } } | null,
  env: {} as Record<string, unknown>,
}));

const dal = vi.hoisted(() => ({
  setPreviewRuntime: vi.fn(),
  findEditorContext: vi.fn(),
  verifyThemeOwnership: vi.fn(),
  nextTicket: vi.fn(),
  start: vi.fn(),
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
  storefrontThemeDal: {
    setPreviewRuntime: dal.setPreviewRuntime,
    findEditorContext: dal.findEditorContext,
  },
}));
vi.mock("@/lib/storefront/dal/storefront-theme-build.dal", () => ({
  storefrontThemeBuildDal: { verifyThemeOwnership: dal.verifyThemeOwnership },
}));
vi.mock("@/lib/storefront/dal/storefront-preview-content-ticket.dal", () => ({
  storefrontPreviewContentTicketDal: {
    next: dal.nextTicket,
    readDraftVersions: async () => "versions",
  },
}));
vi.mock("@/lib/storefront/dal/storefront-page.dal", () => ({
  storefrontPageDal: { listDraftDocuments: async () => [] },
}));
vi.mock("@/lib/storefront/compiler/theme-preview-content", () => ({
  createThemePreviewContentSnapshot: async () => ({}),
  previewContentDigest: async () => "digest",
}));
vi.mock("./preview-media-urls", () => ({
  withSignedPreviewMedia: async (content: unknown) => content,
}));
vi.mock("@/lib/storefront/storage/theme-storage.server", () => ({
  themeSourceStore: {
    getSourceGeneration: async () => 7,
    getWorkspaceSnapshot: async () => [
      { path: "src/routes/index.tsx", content: "", version: 1 },
    ],
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
    server: { start: dal.start, stop: vi.fn() },
    admitAddress: ({ url }: { url: string }) => ({
      ok: true,
      url,
      origin: new URL(url).origin,
    }),
  }),
}));

const { setThemePreviewRuntime, startThemePreviewServer } =
  await import("./storefront-theme-preview-server.serverFn");

const STOREFRONT = "11111111-1111-4111-8111-111111111111";
const THEME = "22222222-2222-4222-8222-222222222222";

type Result = {
  success: boolean;
  error?: string;
  message: string;
  data?: Record<string, unknown>;
};
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

beforeEach(() => {
  vi.clearAllMocks();
  state.session = { user: { id: "admin-1", role: "admin" } };
  for (const key of Object.keys(state.env)) delete state.env[key];
  dal.verifyThemeOwnership.mockResolvedValue(true);
  dal.nextTicket.mockResolvedValue(1);
  dal.start.mockResolvedValue({
    ok: true,
    url: "http://127.0.0.1:5173/",
    attemptId: "attempt",
    readyMs: 0,
    timings: {},
    hoistedContentFields: [],
  });
});

describe("setThemePreviewRuntime", () => {
  const input = {
    storefrontId: STOREFRONT,
    themeId: THEME,
    previewRuntime: "start",
    expectedPreviewRuntime: null,
  };

  it("clears the record back to inherited, under the same compare-and-set", async () => {
    dal.setPreviewRuntime.mockResolvedValue({ ok: true, previewRuntime: null });
    const result = await call(setThemePreviewRuntime, {
      ...input,
      previewRuntime: null,
      expectedPreviewRuntime: "start",
    });
    expect(result).toMatchObject({
      success: true,
      data: { previewRuntime: null },
    });
    expect(dal.setPreviewRuntime).toHaveBeenCalledWith({
      storefrontId: STOREFRONT,
      themeId: THEME,
      previewRuntime: null,
      expectedPreviewRuntime: "start",
    });
  });

  it("answers a stale expected value as a conflict, with the value recorded now", async () => {
    dal.setPreviewRuntime.mockResolvedValue({
      ok: false,
      error: "PREVIEW_RUNTIME_CONFLICT",
      previewRuntime: "client",
    });
    const result = await call(setThemePreviewRuntime, input);
    expect(result).toMatchObject({
      success: false,
      error: "PREVIEW_RUNTIME_CONFLICT",
      previewRuntime: "client",
    });
  });

  it("refuses a write that does not say what it expected", async () => {
    const { expectedPreviewRuntime: _omitted, ...blind } = input;
    const result = await call(setThemePreviewRuntime, blind);
    expect(result).toMatchObject({ success: false, error: "INVALID_INPUT" });
    expect(dal.setPreviewRuntime).not.toHaveBeenCalled();
  });

  it("records the runtime for the storefront and Theme asked for", async () => {
    dal.setPreviewRuntime.mockResolvedValue({
      ok: true,
      previewRuntime: "start",
    });
    const result = await call(setThemePreviewRuntime, input);
    expect(result).toMatchObject({
      success: true,
      data: { previewRuntime: "start" },
    });
    expect(dal.setPreviewRuntime).toHaveBeenCalledWith({
      storefrontId: STOREFRONT,
      themeId: THEME,
      previewRuntime: "start",
      expectedPreviewRuntime: null,
    });
  });

  it("refuses a caller who is not signed in, before anything is read", async () => {
    state.session = null;
    expect(await refusalOf(setThemePreviewRuntime, input)).toBe(
      "AUTH_REQUIRED",
    );
    expect(dal.setPreviewRuntime).not.toHaveBeenCalled();
  });

  it("refuses a signed-in account that is not an administrator", async () => {
    state.session = { user: { id: "user-1", role: "user" } };
    expect(await refusalOf(setThemePreviewRuntime, input)).toBe(
      "ACCESS_DENIED",
    );
    expect(dal.setPreviewRuntime).not.toHaveBeenCalled();
  });

  it("answers not found for a Theme this storefront does not have", async () => {
    // The DAL scopes its read and its write by both ids (see its tests).
    dal.setPreviewRuntime.mockResolvedValue(null);
    const result = await call(setThemePreviewRuntime, input);
    expect(result).toMatchObject({ success: false, error: "NOT_FOUND" });
  });

  it.each([["server"], [""], [undefined], ["START"]])(
    "refuses %j as a runtime without writing",
    async (previewRuntime) => {
      const result = await call(setThemePreviewRuntime, {
        ...input,
        previewRuntime,
      });
      expect(result).toMatchObject({ success: false, error: "INVALID_INPUT" });
      expect(dal.setPreviewRuntime).not.toHaveBeenCalled();
    },
  );

  it.each([["server"], [""], ["START"]])(
    "refuses %j as the expected runtime without writing",
    async (expectedPreviewRuntime) => {
      const result = await call(setThemePreviewRuntime, {
        ...input,
        expectedPreviewRuntime,
      });
      expect(result).toMatchObject({ success: false, error: "INVALID_INPUT" });
      expect(dal.setPreviewRuntime).not.toHaveBeenCalled();
    },
  );

  it("refuses ids that are not ids without writing", async () => {
    const result = await call(setThemePreviewRuntime, {
      ...input,
      themeId: "theme-a",
    });
    expect(result).toMatchObject({ success: false, error: "INVALID_INPUT" });
    expect(dal.setPreviewRuntime).not.toHaveBeenCalled();
  });

  it("refuses start for an Astro Theme", async () => {
    dal.setPreviewRuntime.mockResolvedValue({
      ok: false,
      error: "PREVIEW_RUNTIME_UNSUPPORTED",
    });
    const result = await call(setThemePreviewRuntime, input);
    expect(result).toMatchObject({
      success: false,
      error: "PREVIEW_RUNTIME_UNSUPPORTED",
    });
  });
});

describe("the runtime startThemePreviewServer starts the preview with", () => {
  const editorContext = (previewRuntime: "client" | "start" | null) => ({
    storefront: { id: STOREFRONT },
    theme: { id: THEME, framework: null, previewRuntime },
    templates: [],
  });

  // recorded × MORPH_THEME_PREVIEW_RUNTIME → what the transport is given
  // (`client` is passed as nothing, as before) and the refresh it implies.
  it.each([
    ["start", "start", "start", "router"],
    ["start", undefined, "start", "router"],
    ["client", "start", undefined, null],
    ["client", undefined, undefined, null],
    [null, "start", "start", "router"],
    [null, undefined, undefined, null],
  ] as const)(
    "recorded %s, deployment %s: starts with %s",
    async (recorded, deployment, expected, contentRefresh) => {
      if (deployment) state.env.MORPH_THEME_PREVIEW_RUNTIME = deployment;
      dal.findEditorContext.mockResolvedValue(editorContext(recorded));

      const result = await call(startThemePreviewServer, {
        storefrontId: STOREFRONT,
        themeId: THEME,
      });

      expect(result).toMatchObject({ success: true });
      expect(result.data?.contentRefresh).toBe(contentRefresh);
      expect(dal.start).toHaveBeenCalledTimes(1);
      const startInput = dal.start.mock.calls[0]![0] as Record<string, unknown>;
      if (expected) expect(startInput.previewRuntime).toBe(expected);
      else expect(startInput).not.toHaveProperty("previewRuntime");
    },
  );

  it("reports a recorded Start preview that fails to start, and never falls back to client", async () => {
    // Recorded start, deployment unset: nothing would select Start but the
    // record, so a fallback would be indistinguishable from success.
    dal.findEditorContext.mockResolvedValue(editorContext("start"));
    dal.start.mockResolvedValue({
      ok: false,
      stage: "preview-server-start",
      errorMessage:
        "PREVIEW_SERVER_EXITED: Vite exited before it was ready to serve.",
      logs: ["boom"],
      attemptId: "attempt",
    });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const result = await call(startThemePreviewServer, {
        storefrontId: STOREFRONT,
        themeId: THEME,
      });

      // The existing failure path: the stage as the error, a reference to
      // the logged cause in the message.
      expect(result).toMatchObject({
        success: false,
        error: "preview-server-start",
      });
      expect(result.message).toMatch(
        /^Could not start the Live Preview server\. \(reference [0-9a-f]{8}\)$/,
      );
      expect(dal.start).toHaveBeenCalledTimes(1);
      expect(
        (dal.start.mock.calls[0]![0] as Record<string, unknown>).previewRuntime,
      ).toBe("start");
      // The record is the author's; a failed start does not touch it.
      expect(dal.setPreviewRuntime).not.toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });

  it("reads the record only behind the session and the storefront check", async () => {
    state.session = null;
    expect(
      await refusalOf(startThemePreviewServer, {
        storefrontId: STOREFRONT,
        themeId: THEME,
      }),
    ).toBe("AUTH_REQUIRED");
    expect(dal.findEditorContext).not.toHaveBeenCalled();

    state.session = { user: { id: "admin-1", role: "admin" } };
    dal.verifyThemeOwnership.mockResolvedValue(false);
    const result = await call(startThemePreviewServer, {
      storefrontId: STOREFRONT,
      themeId: THEME,
    });
    expect(result).toMatchObject({ success: false, error: "NOT_FOUND" });
    expect(dal.findEditorContext).not.toHaveBeenCalled();
    expect(dal.start).not.toHaveBeenCalled();
  });
});
