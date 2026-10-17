// @vitest-environment node
import { describe, expect, expectTypeOf, it, vi } from "vitest";

/**
 * The public surface of `@morph/sdk` and `@morph/sdk/start`, locked.
 *
 * The platform injects the current SDK into every preview and every new
 * build, so a Theme built yesterday is built against today's SDK on its next
 * build. Changes to these two entry points are additive only (README.md,
 * "Compatibility contract"). This file fails on a removal or a rename:
 *
 * - runtime names, method names and error codes: `pnpm test`;
 * - type names and method signatures: `pnpm typecheck` (`expectTypeOf` and
 *   the `import type` list below are checked by the compiler, not at run
 *   time).
 *
 * Adding to the surface means adding to the lists here, deliberately.
 */
vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => {
    throw new Error("No Start request in this test.");
  },
}));

import * as core from "../src/index";
import type {
  Morph,
  MorphError,
  MorphErrorCode,
  MorphErrorResource,
  MorphFetch,
  MorphOptions,
  MorphPage,
  MorphPagination,
  MorphProduct,
  MorphProductAsset,
  MorphProductList,
  MorphProductListItem,
  MorphProductListParams,
  MorphProductResult,
  MorphStoreContext,
} from "../src/index";
import * as start from "./index";

const CORE_RUNTIME_EXPORTS = ["MorphError", "createMorph", "isMorphError"];
const START_RUNTIME_EXPORTS = [
  ...CORE_RUNTIME_EXPORTS,
  "MORPH_CONTENT_ORIGIN_HEADER",
  "contentOriginFor",
  "morph",
  "morphForRequest",
].sort();

/** Every code, in the order errors.ts declares them. Stable: never renamed. */
const ERROR_CODES = [
  "no_content_source",
  "invalid_content_origin",
  "invalid_path",
  "store_unreachable",
  "content_not_found",
  "store_error",
  "redirect_refused",
  "invalid_response",
  "response_too_large",
  "reserved_slot",
  "invalid_request",
  "invalid_store_context",
] as const;

// The compiler refuses this literal if a code is removed or renamed (excess
// key) or added (missing key) without updating the list above.
const EVERY_CODE: Record<MorphErrorCode, true> = {
  no_content_source: true,
  invalid_content_origin: true,
  invalid_path: true,
  store_unreachable: true,
  content_not_found: true,
  store_error: true,
  redirect_refused: true,
  invalid_response: true,
  response_too_large: true,
  reserved_slot: true,
  invalid_request: true,
  invalid_store_context: true,
};

describe("@morph/sdk public surface", () => {
  it("exports exactly these runtime names", () => {
    expect(Object.keys(core).sort()).toEqual(CORE_RUNTIME_EXPORTS);
  });

  it("returns a reader with exactly these methods", () => {
    const reader = core.createMorph({ baseUrl: "https://shop.example.com" });
    expect(Object.keys(reader).sort()).toEqual(["pages", "products"]);
    expect(Object.keys(reader.pages).sort()).toEqual(["get", "isHidden"]);
    expect(Object.keys(reader.products).sort()).toEqual(["get", "list"]);
  });

  it("keeps every error code, each with its own message", () => {
    expect(Object.keys(EVERY_CODE)).toEqual([...ERROR_CODES]);
    for (const code of ERROR_CODES) {
      const error = new core.MorphError(code, null);
      expect(error.code).toBe(code);
      // A code dropped from the message table would construct with none.
      expect(error.message, code).not.toBe("");
      expect(core.isMorphError(error)).toBe(true);
    }
  });

  it("keeps these signatures (checked by the compiler)", () => {
    expectTypeOf(core.createMorph).toEqualTypeOf<
      (options: MorphOptions) => Morph
    >();
    expectTypeOf<MorphOptions>().toEqualTypeOf<
      Readonly<{ baseUrl: string; fetch?: MorphFetch }>
    >();
    expectTypeOf<Morph["pages"]["get"]>().toEqualTypeOf<
      (path: string) => Promise<MorphPage>
    >();
    expectTypeOf<Morph["pages"]["isHidden"]>().toEqualTypeOf<
      (page: MorphPage, slotId: string) => boolean
    >();
    expectTypeOf<Morph["products"]["list"]>().toEqualTypeOf<
      (params?: MorphProductListParams) => Promise<MorphProductList>
    >();
    expectTypeOf<Morph["products"]["get"]>().toEqualTypeOf<
      (handle: string) => Promise<MorphProductResult | null>
    >();
    expectTypeOf<MorphError["code"]>().toEqualTypeOf<MorphErrorCode>();
    expectTypeOf<MorphError["resource"]>().toEqualTypeOf<MorphErrorResource>();
    expectTypeOf<MorphError["status"]>().toEqualTypeOf<number | null>();
    expectTypeOf<MorphErrorResource>().toEqualTypeOf<
      "page" | "product" | null
    >();
    // Named so the type list above is used; a removed type fails the import.
    expectTypeOf<
      [
        MorphPagination,
        MorphProduct,
        MorphProductAsset,
        MorphProductListItem,
        MorphStoreContext,
      ]
    >().not.toBeNever();
  });
});

describe("@morph/sdk/start public surface", () => {
  it("exports exactly these runtime names: the core's, and the Start entry's own", () => {
    expect(Object.keys(start).sort()).toEqual(START_RUNTIME_EXPORTS);
  });

  it("re-exports the core's values, not copies of them", () => {
    expect(start.createMorph).toBe(core.createMorph);
    expect(start.MorphError).toBe(core.MorphError);
    expect(start.isMorphError).toBe(core.isMorphError);
  });

  it("keeps the request-scoped reader's methods and the header name", () => {
    expect(start.MORPH_CONTENT_ORIGIN_HEADER).toBe("x-morph-content-origin");
    expect(Object.keys(start.morph).sort()).toEqual(["pages", "products"]);
    expect(Object.keys(start.morph.pages).sort()).toEqual(["get", "isHidden"]);
    expect(Object.keys(start.morph.products).sort()).toEqual(["get", "list"]);
  });

  it("keeps these signatures (checked by the compiler)", () => {
    expectTypeOf(start.morph).toEqualTypeOf<Morph>();
    expectTypeOf(start.contentOriginFor).toEqualTypeOf<
      (request: Request, development?: boolean) => string
    >();
    expectTypeOf(start.morphForRequest).returns.toEqualTypeOf<Morph>();
  });
});
