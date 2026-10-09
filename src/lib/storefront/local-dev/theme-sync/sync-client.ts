import { z } from "zod";
import {
  THEME_SYNC_API_PATH,
  themeSyncGenerationSchema,
  themeSyncListSchema,
  themeSyncReadResponseSchema,
  themeSyncSaveResponseSchema,
  themeSyncWhoamiSchema,
  type ThemeSyncApiError,
  type ThemeSyncList,
  type ThemeSyncReadResponse,
  type ThemeSyncSaveRequest,
  type ThemeSyncSaveResponse,
  type ThemeSyncWhoami,
} from "./sync-protocol";

/** A refusal from the sync API, with its code. */
export class ThemeSyncApiRefusal extends Error {
  constructor(
    readonly status: number,
    readonly code: ThemeSyncApiError | "UNEXPECTED_RESPONSE",
    message: string,
    readonly detail: unknown = null,
  ) {
    super(message);
    this.name = "ThemeSyncApiRefusal";
  }

  get isConflict(): boolean {
    return (
      this.code === "SOURCE_GENERATION_CONFLICT" ||
      this.code === "FILE_VERSION_CONFLICT"
    );
  }
}

export type ThemeSyncClient = Readonly<{
  whoami(): Promise<ThemeSyncWhoami>;
  generation(): Promise<number>;
  list(): Promise<ThemeSyncList>;
  read(paths: readonly string[]): Promise<ThemeSyncReadResponse>;
  save(request: ThemeSyncSaveRequest): Promise<ThemeSyncSaveResponse>;
  logout(): Promise<void>;
}>;

const refusalSchema = z
  .object({ error: z.string(), message: z.string() })
  .passthrough();

/**
 * The sync API over `fetch`. The token goes in the Authorization header and
 * nowhere else; redirects are not followed, so it is never re-sent to an
 * address the server named.
 */
export function createThemeSyncClient(options: {
  origin: string;
  token: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): ThemeSyncClient {
  const doFetch = options.fetch ?? fetch;
  const base = new URL(THEME_SYNC_API_PATH, options.origin);

  async function call<T>(
    route: string,
    schema: z.ZodType<T>,
    init: { method: "GET" | "POST"; body?: unknown } = { method: "GET" },
  ): Promise<T> {
    const response = await doFetch(new URL(route, base), {
      method: init.method,
      redirect: "manual",
      signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
      headers: {
        authorization: `Bearer ${options.token}`,
        accept: "application/json",
        ...(init.body === undefined
          ? {}
          : { "content-type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (!response.ok) {
      const refusal = refusalSchema.safeParse(body);
      throw new ThemeSyncApiRefusal(
        response.status,
        refusal.success
          ? (refusal.data.error as ThemeSyncApiError)
          : "UNEXPECTED_RESPONSE",
        refusal.success
          ? refusal.data.message
          : `The sync API answered ${response.status}.`,
        body,
      );
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new ThemeSyncApiRefusal(
        response.status,
        "UNEXPECTED_RESPONSE",
        `The sync API answered ${route} with something this version of morph-sync does not read.`,
      );
    }
    return parsed.data;
  }

  return {
    whoami: () => call("whoami", themeSyncWhoamiSchema),
    generation: async () =>
      (await call("generation", themeSyncGenerationSchema)).sourceGeneration,
    list: () => call("files", themeSyncListSchema),
    read: (paths) =>
      call("files/read", themeSyncReadResponseSchema, {
        method: "POST",
        body: { paths },
      }),
    save: (request) =>
      call("files/save", themeSyncSaveResponseSchema, {
        method: "POST",
        body: request,
      }),
    logout: async () => {
      await call("logout", z.unknown(), { method: "POST" });
    },
  };
}
