/**
 * The JSON shapes stored in `mode: "json"` columns.
 *
 * Metadata crosses the server/client boundary, so it is constrained to values
 * that survive JSON serialisation. `Record<string, unknown>` would compile but
 * fails TanStack Start's serialisability check at the server function.
 *
 * Lives in its own module rather than in a schema file because every module's
 * tables carry a `metadata` column, and importing it from `product.schema.ts`
 * would make the catalogue a dependency of orders and payments for a type.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type Metadata = Record<string, JsonValue>;
