/**
 * Starter 32 candidate, narrow A step 1 (2026-11-24). NOT shipped: nothing in
 * the product imports this. The acceptance gate
 * (`starter-v32-home-route.acceptance.test.ts`) puts it in place of
 * `src/morph/content.ts` on the real adopted Starter workspace.
 *
 * Only the read source changes against Starter 31's module
 * (`STARTER_THEME_CONTENT_MODULE_SOURCE`): every read goes through one
 * `createServerFn` whose handler calls the hosted SDK, `morph.pages.get` from
 * `@morph/sdk/start`. The module no longer fetches `/_morph/content` itself,
 * calls `getRequest()`, or handles the content origin, the render context or
 * `MORPH_CONTENT_ORIGIN`: the SDK entry owns all of that.
 *
 * Everything the rest of the Theme and Design rely on stays as it is:
 *
 * - the exports and their shapes (`content`, `isSectionHidden`,
 *   `MorphContentProvider`, `loadContentSlots`, `morph`, `MorphContentError`
 *   and the types), so the root route, the layout and the home route are
 *   Starter 31's, byte for byte. Design keeps seeing `content("slot")` and
 *   `!isSectionHidden("slot")` call sites from the trusted content module
 *   (`START_B1_PROFILE`), and both are still functions declared in this file
 *   (`confirmThemeContentModuleFunctionExport`);
 * - `morph.pages.get` throws `MorphContentError` with the same codes.
 *
 * One behaviour changes on purpose (2026-11-24, the read-failure trap): a
 * failed or refused read no longer degrades to empty content on the server,
 * as 31's server branch did. Empty content has no hidden sections, so that
 * fallback rendered every section the author hid with its defaults. Both
 * branches now reject with `MorphContentError` (the module's own words, never
 * the upstream message), and Starter 31's root, unchanged, turns that into
 * the router's error state; a read that succeeds with no content is still
 * empty content. See `starter-v32-content-read-failure.test.ts`.
 *
 * Because it imports `createServerFn` and `@morph/sdk/start`, this module
 * needs the full Start preview (`sourceRequiresStartPreview`).
 */
export const STARTER_V32_CANDIDATE_CONTENT_MODULE_SOURCE = `import { createIsomorphicFn, createServerFn } from "@tanstack/react-start";
import { morph as hostedMorph } from "@morph/sdk/start";
import { createContext, useContext } from "react";

export type MorphContentSlots = Record<string, Record<string, unknown>>;

export type MorphContent = {
  slots: MorphContentSlots;
  /** Sections the author hid. Absent slots are not the same thing. */
  hiddenSlots: string[];
};

const MorphContentContext = createContext<MorphContent>({
  slots: {},
  hiddenSlots: [],
});

export const MorphContentProvider = MorphContentContext.Provider;

/** Reads the stored values for one content slot. */
export function content(slotId: string): Record<string, unknown> {
  return useContext(MorphContentContext).slots[slotId] ?? {};
}

/**
 * Whether the author hid this section.
 *
 * Spreading props cannot cancel a render, so the route has to ask. A slot with
 * no stored values is not hidden - it just has none, and the component's
 * defaults are the right answer for it.
 */
export function isSectionHidden(slotId: string): boolean {
  return useContext(MorphContentContext).hiddenSlots.includes(slotId);
}

/**
 * One page's published content: each slot's values under its slot id, ready to
 * spread onto a section. Sections the author hid are listed in _hidden, which
 * no slot id can be called because ids never start with an underscore.
 */
export type MorphPage = {
  readonly _hidden: readonly string[];
  readonly [slotId: string]: any;
};

/**
 * The one read of a page's content. A server function, so it always runs on
 * the server: during a server render inside the request being served, and on
 * in-site navigation as a request of its own. Either way the platform names
 * that request's content source and release, and the SDK reads them from it;
 * this module never sees an address.
 */
const readPage = createServerFn({ method: "GET" })
  .inputValidator((path: unknown) => {
    if (typeof path !== "string") throw new Error("A page path is a string.");
    return path;
  })
  .handler(({ data }) => hostedMorph.pages.get(data));

/**
 * The page as the root hands it down: slot values, and the hidden list apart.
 * A page without a usable hidden list is not a page with nothing hidden.
 */
function toContent(page: MorphPage): MorphContent {
  if (!page || typeof page !== "object" || !Array.isArray(page._hidden)
    || !page._hidden.every((slot: unknown) => typeof slot === "string")) {
    throw new MorphContentError("invalid_response");
  }
  const slots: MorphContentSlots = {};
  for (const [slotId, values] of Object.entries(page)) {
    if (slotId !== "_hidden") slots[slotId] = values;
  }
  return { slots, hiddenSlots: [...page._hidden] };
}

/**
 * Loads the published content for one route.
 *
 * Two answers are kept apart. A read that succeeds with no content is empty
 * content: nothing stored, nothing hidden, and the components' defaults are
 * right. A read that fails or is refused says nothing about the page, not
 * even which sections the author hid, so it is never answered with empty
 * content: on the server as in the browser it rejects with MorphContentError,
 * the root's beforeLoad rejects with it, and the router shows its error state
 * (a server render answers 500) instead of the layout and the sections. A
 * hidden section must not come back with its defaults because a read failed.
 */
export const loadContentSlots = createIsomorphicFn()
  .client(async (pathname: string): Promise<MorphContent> => {
    try {
      return toContent(await readPage({ data: pathname }));
    } catch (error) {
      throw contentError(error);
    }
  })
  .server(async (pathname: string): Promise<MorphContent> => {
    try {
      return toContent(await readPage({ data: pathname }));
    } catch (error) {
      throw contentError(error);
    }
  });

/**
 * Why a page could not be read. A closed set, so a route can show something
 * specific for the cases it understands and treat the rest alike.
 */
export type MorphContentErrorCode =
  | "no_content_source"
  | "invalid_content_origin"
  | "invalid_path"
  | "store_unreachable"
  | "content_not_found"
  | "store_error"
  | "redirect_refused"
  | "invalid_response"
  | "response_too_large"
  | "reserved_slot";

/**
 * The words for each code. Written here and not taken from the store's
 * answer, so what reaches a browser is never an upstream response, an address
 * or a stack.
 */
const MORPH_CONTENT_MESSAGES: Record<MorphContentErrorCode, string> = {
  no_content_source:
    "No content source. Run inside Morph, or while developing set MORPH_CONTENT_ORIGIN to your store address, for example https://your-store.example.",
  invalid_content_origin: "The content source address is not usable.",
  invalid_path: "A page path starts with / and is at most 500 characters.",
  store_unreachable: "The content service could not be reached.",
  content_not_found: "The store has no content for this page.",
  store_error: "The content service reported an error.",
  redirect_refused: "The content service redirected, which is not followed.",
  invalid_response: "The content service sent a response that could not be used.",
  response_too_large: "The content service response was too large.",
  reserved_slot: "The content service sent a slot named _hidden, which is reserved.",
};

/** Raised when a page cannot be read. The caller decides what to show instead. */
export class MorphContentError extends Error {
  readonly code: MorphContentErrorCode;
  constructor(code: MorphContentErrorCode, message?: string) {
    super(message ?? MORPH_CONTENT_MESSAGES[code]);
    this.name = "MorphContentError";
    this.code = code;
  }
}

function isMorphContentErrorCode(value: unknown): value is MorphContentErrorCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(MORPH_CONTENT_MESSAGES, value);
}

/** The SDK's refusal as this module's error, by its code; anything else is the store's. */
function contentError(error: unknown): MorphContentError {
  const code = error && typeof error === "object" && "code" in error
    ? (error as { code: unknown }).code
    : null;
  return new MorphContentError(isMorphContentErrorCode(code) ? code : "store_error");
}

export const morph = {
  pages: {
    /**
     * const home = await morph.pages.get("/home");
     * <Hero {...home.hero} />
     */
    get(path: string): Promise<MorphPage> {
      if (typeof path !== "string" || !path.startsWith("/") || path.length > 500) {
        return Promise.reject(new MorphContentError("invalid_path"));
      }
      return readPage({ data: path }).then(
        (page) => page,
        (error: unknown) => {
          throw contentError(error);
        },
      );
    },
    /** Whether the author hid this section on the page. */
    isHidden(page: MorphPage, slotId: string): boolean {
      return page._hidden.includes(slotId);
    },
  },
};
`;
