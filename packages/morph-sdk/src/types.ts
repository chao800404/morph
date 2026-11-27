/**
 * Shapes of Morph's public read responses, as the SDK hands them back.
 *
 * Declared here rather than imported: the SDK talks to Morph over HTTP only
 * and must not depend on Morph's server code. A test on the server side
 * checks that the server's DTOs still fit these.
 */

/**
 * One page's published content: each slot's values under its slot id, ready
 * to spread onto a section. Sections the author hid are listed in `_hidden`,
 * which no slot id can be called because slot ids never start with `_`.
 *
 * The same shape as the Starter's `MorphPage`.
 *
 * Which sections it holds depends on the read (`MorphPageReadOptions`): by
 * default the shared layout's sections and the page's own, in one slot
 * namespace; with `{ scope: "page" }` the page's own only.
 */
export type MorphPage = {
  readonly _hidden: readonly string[];
  readonly [slotId: string]: any;
};

/**
 * The shared layout's published content as one page renders it
 * (`layouts.get`): the sections the layout declares, such as the header and
 * footer, with no section of the page's own. The same shape as `MorphPage`,
 * so `isHidden` reads it the same way: a section hidden on that page, by the
 * layout or by the page itself, is in `_hidden` and has no values.
 */
export type MorphLayout = MorphPage;

/** How `layouts.get` reads the layout. */
export type MorphLayoutReadOptions = Readonly<{
  /**
   * The page being rendered, as `pages.get` takes it. Required: layout and
   * page share one slot namespace, so a page can hide a layout section, and
   * only the page's own read can say so. A path with no Document of its own
   * reads the layout as the author left it.
   */
  path: string;
}>;

/**
 * Which shared layout to read. One exists today, `"default"`: the store's
 * single layout Document. Any other name is refused before anything is sent
 * (`invalid_request`).
 */
export type MorphLayoutName = "default";

/** How `pages.get` reads a page. */
export type MorphPageReadOptions = Readonly<{
  /**
   * Omitted: the shared layout's sections and the page's own, merged as
   * every existing Theme reads them (a page section wins over a layout one
   * with the same id, and a section either hides stays hidden).
   *
   * `"page"`: the page's own Document only, without the layout's sections;
   * read those with `layouts.get("default", { path })`. A section id the layout hides
   * stays hidden here too, as in the merged read (one slot namespace). A path with no Document of its
   * own has no page-only sections: `{ _hidden: [] }`.
   */
  scope?: "page";
}>;

/** The store a catalog answer was scoped to, as the Store API reports it. */
export type MorphStoreContext = Readonly<{
  storeId: string;
  storefrontId: string | null;
  salesChannelId: string;
  regionId: string | null;
  currencyCode: string | null;
  automaticTaxes: boolean;
  isTaxInclusive: boolean;
  countryCode: string | null;
  localeCode: string | null;
}>;

export type MorphProductListItem = Readonly<{
  id: string;
  title: string;
  handle: string;
  subtitle: string | null;
  description: string | null;
  /**
   * In the entry's media URL mode (README.md): from `createMorph`, a Morph
   * path is made absolute against the base URL; from `@morph/sdk/start`, it
   * stays as Morph sent it.
   */
  thumbnailUrl: string | null;
  collectionId: string | null;
  collectionTitle: string | null;
  updatedAt: string;
}>;

export type MorphProductAsset = Readonly<{
  id: string;
  name: string;
  url: string;
}>;

export type MorphProduct = MorphProductListItem &
  Readonly<{
    assets: readonly MorphProductAsset[];
    options: readonly Readonly<{
      id: string;
      title: string;
      values: readonly Readonly<{ id: string; value: string }>[];
    }>[];
    variants: readonly Readonly<{
      id: string;
      title: string;
      sku: string | null;
      allowBackorder: boolean;
      availableQuantity: number;
      optionValueIds: readonly string[];
      assets: readonly MorphProductAsset[];
      price: Readonly<{
        currencyCode: string;
        amount: number;
        originalAmount: number;
        priceListType: "sale" | "override" | null;
      }> | null;
    }>[];
  }>;

/** Only the parameters the Store API supports today. */
export type MorphProductListParams = Readonly<{
  /** Matches part of a title or handle. At most 200 characters. */
  q?: string;
  /** 1–10000. The service defaults to 1. */
  page?: number;
  /** 1–100. The service defaults to 20. */
  limit?: number;
  /** By last update. The service defaults to `desc`. */
  order?: "asc" | "desc";
}>;

export type MorphPagination = Readonly<{
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}>;

export type MorphProductList = Readonly<{
  products: readonly MorphProductListItem[];
  pagination: MorphPagination;
  context: MorphStoreContext;
}>;

export type MorphProductResult = Readonly<{
  product: MorphProduct;
  context: MorphStoreContext;
}>;

export type MorphFetch = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

export type MorphOptions = Readonly<{
  /**
   * The origin Morph serves the store's content on, e.g.
   * `https://shop.example.com` (one trailing `/` is accepted). In v0 this is
   * the merchant domain, which must have a published Theme release.
   */
  baseUrl: string;
  /** Defaults to the global `fetch`. */
  fetch?: MorphFetch;
}>;

export type Morph = Readonly<{
  pages: Readonly<{
    /**
     * Published content for one path. Server side only in v0: called where
     * `window` and `document` exist, it throws `invalid_content_origin`
     * before sending anything.
     *
     * Without `options`, the merged read: the shared layout's sections and
     * the page's own (`MorphPageReadOptions`). With `{ scope: "page" }`, the
     * page's own only. An option it does not know throws `invalid_request`.
     * A scoped read is refused (`invalid_response`) by a content source
     * that does not support it, never answered with merged content.
     */
    get(path: string, options?: MorphPageReadOptions): Promise<MorphPage>;
    /** Whether the author hid this section on the page. */
    isHidden(page: MorphPage, slotId: string): boolean;
  }>;
  layouts: Readonly<{
    /**
     * The shared layout's published content as the page at `options.path`
     * renders it (`MorphLayout`), from the same source, release and render
     * context as `pages.get`. Server side only, read only, failing with the
     * same errors as `pages.get` (resource `"page"`): a missing or bad path
     * throws `invalid_path`; a name other than `"default"`, or options that
     * are not `{ path }`, throw `invalid_request`.
     */
    get(
      name: MorphLayoutName,
      options: MorphLayoutReadOptions,
    ): Promise<MorphLayout>;
    /** Whether the author hid this section in the layout. */
    isHidden(layout: MorphLayout, slotId: string): boolean;
  }>;
  products: Readonly<{
    list(params?: MorphProductListParams): Promise<MorphProductList>;
    /** `null` only when the store has no such product. */
    get(handle: string): Promise<MorphProductResult | null>;
  }>;
}>;
