import type { CurrencyDTO } from "@/lib/currency/dto/currency.dto";
import type { AdminApiAccess } from "./orders";
import { z } from "zod";

export type AdminCurrenciesApiDependencies = {
  authorize(request: Request): Promise<AdminApiAccess>;
  listCurrencies(): Promise<CurrencyDTO[]>;
};

const querySchema = z
  .object({
    q: z.string().trim().max(100).optional(),
    code: z.string().trim().toLowerCase().length(3).optional(),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    order: z.enum(["code", "-code", "name", "-name"]).default("code"),
  })
  .strict();

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "private, no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });

const error = (code: string, message: string, status: number) =>
  json({ error: code, message }, status);

const isAdmin = (
  access: AdminApiAccess,
): access is { allowed: true; userId: string; role: "admin" } =>
  Boolean(access.allowed && access.userId && access.role === "admin");

const apiCurrency = (currency: CurrencyDTO) => ({
  code: currency.code,
  symbol: currency.symbol,
  symbol_native: currency.symbolNative,
  name: currency.name,
  decimal_digits: currency.decimalDigits,
  rounding: currency.rounding,
});

/** Medusa-shaped read-only Admin API for the platform currency catalogue. */
export async function handleAdminCurrenciesRequest(
  request: Request,
  path: string,
  dependencies: AdminCurrenciesApiDependencies,
): Promise<Response> {
  let access: AdminApiAccess;
  try {
    access = await dependencies.authorize(request);
  } catch {
    return error("UNAUTHORIZED", "A signed-in commerce user is required", 401);
  }
  if (!access.allowed)
    return error(access.error, access.message, access.status);
  if (!isAdmin(access))
    return error("FORBIDDEN", "Administrator access is required", 403);

  if (path !== "currencies" && !path.startsWith("currencies/"))
    return error("NOT_FOUND", "Admin API route not found", 404);
  if (request.method !== "GET")
    return new Response(
      JSON.stringify({ error: "METHOD_NOT_ALLOWED", message: "Use GET" }),
      {
        status: 405,
        headers: {
          allow: "GET",
          "cache-control": "private, no-store",
          "content-type": "application/json; charset=utf-8",
          "x-content-type-options": "nosniff",
        },
      },
    );

  try {
    const currencies = await dependencies.listCurrencies();
    const currencyCode = path.slice("currencies/".length).toLowerCase();
    if (path !== "currencies") {
      const currency = currencies.find((item) => item.code === currencyCode);
      return currency
        ? json({ currency: apiCurrency(currency) })
        : error("NOT_FOUND", "Currency not found", 404);
    }

    const parsed = querySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    );
    if (!parsed.success)
      return json(
        {
          error: "INVALID_REQUEST",
          message: "Invalid currency query",
          details: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    const term = parsed.data.q?.toLowerCase();
    const order = parsed.data.order;
    const filtered = currencies
      .filter(
        (currency) =>
          (!parsed.data.code || currency.code === parsed.data.code) &&
          (!term ||
            currency.code.includes(term) ||
            currency.name.toLowerCase().includes(term)),
      )
      .sort((left, right) => {
        const comparison = order.endsWith("name")
          ? left.name.localeCompare(right.name)
          : left.code.localeCompare(right.code);
        return order.startsWith("-") ? -comparison : comparison;
      });
    return json({
      currencies: filtered
        .slice(parsed.data.offset, parsed.data.offset + parsed.data.limit)
        .map(apiCurrency),
      count: filtered.length,
      offset: parsed.data.offset,
      limit: parsed.data.limit,
    });
  } catch {
    return error("INTERNAL_ERROR", "Currencies could not be loaded", 500);
  }
}
