import type { ZodType, z } from "zod";

/**
 * The shape every server function returns.
 *
 * Server functions here never throw for an expected failure — a missing record
 * or a duplicate handle is data the form has to render, and a thrown error
 * reaches the client as an opaque `Server Fn Error!`. Only the auth middleware
 * throws, because "not signed in" is not something a form can show inline.
 *
 * Written as a discriminated union so `if (!result.success) return` narrows
 * `data` to the real type afterwards, which the hand-rolled object literals in
 * the product module do not do.
 */
export type FieldErrors = Record<string, string[]>;

/**
 * The failure half is **not** generic.
 *
 * It was, briefly, and every handler stopped compiling: a handler returning
 * `ok(…)` on one path and `fail(…)` on another produces the union of both, and
 * with `fail<TData>` the unconstrained `TData` widened `data` to `unknown` —
 * which TanStack Start rejects as unserialisable. A failure has no data, so it
 * has no type parameter to infer.
 */
export interface ServerFailure {
  success: false;
  message: string;
  data: null;
  error?: string;
  errors?: FieldErrors;
}

export type ServerResult<TData> =
  { success: true; message: string; data: TData } | ServerFailure;

export const ok = <TData>(
  message: string,
  data: TData,
): { success: true; message: string; data: TData } => ({
  success: true,
  message,
  data,
});

export const fail = (
  message: string,
  options: { error?: string; errors?: FieldErrors } = {},
): ServerFailure => ({
  success: false,
  message,
  data: null,
  ...options,
});

/**
 * The catch block, once.
 *
 * `scope` is logged, not returned: a raw database message can name columns and
 * constraints, and the dashboard is not where that belongs. The message is
 * still forwarded because these are admin-only surfaces and a swallowed cause
 * makes D1 failures unreadable — see rules.md on `Failed query:`.
 */
export const failure = (
  scope: string,
  error: unknown,
  code: string,
  fallback: string,
): ServerFailure => {
  console.error(`${scope}:`, error);
  return fail(error instanceof Error ? error.message : fallback, {
    error: code,
  });
};

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export const paginationOf = (
  total: number,
  page: number,
  limit: number,
): Pagination => ({
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit),
});

/**
 * Validates server function input without throwing.
 *
 * `.validator((data) => schema.parse(data))` throws a `ZodError`, and a
 * validator throws *before* the handler runs — so the handler's `try/catch`,
 * which turns every domain failure into a readable `fail(...)`, never sees it.
 * h3 wraps whatever escapes into `{"status":500,"unhandled":true,
 * "message":"HTTPError"}`: no field, no reason, and a 500 for what is really a
 * rejected request. That is the same opaque-error problem this module exists to
 * prevent, one layer earlier.
 *
 * Returning the failure instead keeps it inside the union every caller already
 * handles, and carries the field errors along so the reason is visible.
 */
export function parseInput<TSchema extends ZodType>(
  schema: TSchema,
  data: unknown,
): { success: true; message: string; data: z.infer<TSchema> } | ServerFailure {
  const result = schema.safeParse(data);
  if (result.success) return ok("Input accepted", result.data);

  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : "_";
    (errors[key] ??= []).push(issue.message);
  }
  return fail(result.error.issues[0]?.message ?? "Invalid input", {
    error: "INVALID_INPUT",
    errors,
  });
}
