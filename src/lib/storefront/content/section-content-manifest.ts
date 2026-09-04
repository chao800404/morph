/**
 * Platform content-field allowlists for built-in section components.
 *
 * This is content policy, not data access: it decides which props a section is
 * allowed to persist. It lived in the theme DAL, which put ~430 lines of static
 * domain rules behind a module whose job is D1 aggregate reads and writes.
 *
 * These manifests are a compatibility adapter. A capability declared in a
 * theme's own persisted manifest wins; these apply only while starter and
 * customer themes migrate to Theme-level `contentFields`.
 */
import {
  filterThemeContentProps,
  type ThemeContentCapabilities,
} from "@/lib/storefront/theme-content-capabilities";

export interface ComponentContentManifest {
  allowedContentFields: Set<string>;
}

export const COMPONENT_CONTENT_MANIFESTS: Record<
  string,
  ComponentContentManifest
> = {
  // Hero components
  "hero.default": {
    allowedContentFields: new Set([
      "eyebrow",
      "label",
      "heading",
      "subheading",
      "description",
      "title",
      "subtitle",
      "badge",
      "badgeText",
      "actionLabel",
      "actionHref",
      "secondaryActionLabel",
      "secondaryActionHref",
      "buttonText",
      "buttonLink",
      "imageSrc",
      "imageAlt",
      "backgroundMedia",
    ]),
  },
  "hero.split": {
    allowedContentFields: new Set([
      "eyebrow",
      "label",
      "heading",
      "subheading",
      "description",
      "title",
      "subtitle",
      "badge",
      "badgeText",
      "actionLabel",
      "actionHref",
      "secondaryActionLabel",
      "secondaryActionHref",
      "imageSrc",
      "imageAlt",
    ]),
  },
  "hero.minimal": {
    allowedContentFields: new Set([
      "eyebrow",
      "label",
      "heading",
      "subheading",
      "title",
      "subtitle",
      "actionLabel",
      "actionHref",
    ]),
  },
  "hero.video": {
    allowedContentFields: new Set([
      "eyebrow",
      "label",
      "heading",
      "subheading",
      "description",
      "title",
      "subtitle",
      "videoSrc",
      "posterSrc",
      "autoplay",
      "loop",
      "muted",
      "actionLabel",
      "actionHref",
    ]),
  },
  "hero.3d": {
    allowedContentFields: new Set([
      "eyebrow",
      "label",
      "heading",
      "subheading",
      "description",
      "modelSrc",
      "environmentSrc",
      "actionLabel",
      "actionHref",
    ]),
  },

  // Editorial intro
  "editorial-intro.default": {
    allowedContentFields: new Set([
      "label",
      "eyebrow",
      "heading",
      "subheading",
      "body",
      "description",
      "actionLabel",
      "actionHref",
    ]),
  },

  // Category showcase
  "category-showcase.default": {
    allowedContentFields: new Set([
      "label",
      "eyebrow",
      "heading",
      "subheading",
      "description",
      "title",
      "subtitle",
      "categories",
      "items",
      "actionLabel",
      "actionHref",
    ]),
  },

  // Image with text
  "image-with-text.default": {
    allowedContentFields: new Set([
      "eyebrow",
      "label",
      "heading",
      "subheading",
      "body",
      "description",
      "imageSrc",
      "imageAlt",
      "imagePosition",
      "actionLabel",
      "actionHref",
    ]),
  },

  // Principles
  "principles.default": {
    allowedContentFields: new Set([
      "label",
      "eyebrow",
      "heading",
      "subheading",
      "description",
      "items",
    ]),
  },

  // Header components
  "header.default": {
    allowedContentFields: new Set([
      "logoText",
      "logoSrc",
      "logoAlt",
      "storeName",
      "navItems",
      "menuItems",
      "showCart",
      "showSearch",
      "announcementText",
    ]),
  },
  "header.minimal": {
    allowedContentFields: new Set([
      "logoText",
      "logoSrc",
      "storeName",
      "navItems",
      "showCart",
    ]),
  },
  "header.centered": {
    allowedContentFields: new Set([
      "logoText",
      "logoSrc",
      "logoAlt",
      "storeName",
      "navItems",
      "menuItems",
      "showCart",
      "showSearch",
    ]),
  },

  // Footer components
  "footer.default": {
    allowedContentFields: new Set([
      "copyrightText",
      "brandText",
      "storeName",
      "columns",
      "links",
      "socialLinks",
      "showNewsletter",
    ]),
  },
  "footer.minimal": {
    allowedContentFields: new Set([
      "copyrightText",
      "brandText",
      "storeName",
      "links",
    ]),
  },
  "footer.multi-column": {
    allowedContentFields: new Set([
      "copyrightText",
      "brandText",
      "storeName",
      "columns",
      "links",
      "socialLinks",
      "showNewsletter",
      "newsletterHeading",
      "newsletterPlaceholder",
    ]),
  },

  // Products
  "featured-products.default": {
    allowedContentFields: new Set([
      "title",
      "subtitle",
      "heading",
      "subheading",
      "collectionId",
      "productLimit",
      "columns",
      "showPrice",
      "actionLabel",
      "actionHref",
    ]),
  },
  "featured-products.carousel": {
    allowedContentFields: new Set([
      "title",
      "subtitle",
      "heading",
      "subheading",
      "collectionId",
      "productLimit",
      "autoPlay",
      "showPrice",
    ]),
  },
  "featured-products.grid": {
    allowedContentFields: new Set([
      "title",
      "subtitle",
      "heading",
      "subheading",
      "collectionId",
      "productLimit",
      "columns",
      "showPrice",
    ]),
  },
  "product-detail.default": {
    allowedContentFields: new Set([
      "showVendor",
      "showSku",
      "showShare",
      "galleryPosition",
    ]),
  },
  "product-detail.gallery": {
    allowedContentFields: new Set([
      "showVendor",
      "showSku",
      "showShare",
      "layout",
      "thumbnailPosition",
    ]),
  },
  "product-grid.default": {
    allowedContentFields: new Set([
      "title",
      "heading",
      "collectionId",
      "itemsPerPage",
      "columns",
      "showFilters",
      "showSort",
    ]),
  },

  // Content / Banners / Showcase / Newsletter
  "banner.default": {
    allowedContentFields: new Set([
      "eyebrow",
      "heading",
      "subheading",
      "description",
      "imageSrc",
      "imageAlt",
      "actionLabel",
      "actionHref",
    ]),
  },
  "banner.announcement": {
    allowedContentFields: new Set([
      "text",
      "linkHref",
      "linkLabel",
      "dismissible",
    ]),
  },
  "newsletter.default": {
    allowedContentFields: new Set([
      "eyebrow",
      "label",
      "heading",
      "subheading",
      "body",
      "description",
      "buttonText",
      "actionLabel",
      "placeholder",
      "note",
      "disclaimer",
    ]),
  },
  "rich-text.default": {
    allowedContentFields: new Set([
      "eyebrow",
      "heading",
      "subheading",
      "body",
      "content",
      "html",
    ]),
  },
  "showcase.default": {
    allowedContentFields: new Set([
      "title",
      "subtitle",
      "heading",
      "description",
      "items",
      "imageSrc",
      "imageAlt",
      "actionLabel",
      "actionHref",
    ]),
  },
  "showcase.immersive": {
    allowedContentFields: new Set([
      "title",
      "subtitle",
      "heading",
      "description",
      "items",
      "mediaSrc",
      "actionLabel",
      "actionHref",
    ]),
  },
};

export const SECTION_TYPE_DEFAULT_MANIFESTS: Record<string, string> = {
  hero: "hero.default",
  "editorial-intro": "editorial-intro.default",
  "category-showcase": "category-showcase.default",
  "image-with-text": "image-with-text.default",
  principles: "principles.default",
  newsletter: "newsletter.default",
  header: "header.default",
  footer: "footer.default",
  "featured-products": "featured-products.default",
  "product-detail": "product-detail.default",
  "product-grid": "product-grid.default",
  banner: "banner.default",
  "rich-text": "rich-text.default",
  showcase: "showcase.default",
};

export function filterSectionContentProps(
  sectionType: string,
  rawProps: Record<string, unknown>,
  componentRef?: string | null,
  themeCapabilities?: ThemeContentCapabilities,
): Record<string, unknown> {
  // A capability declared in the persisted Theme Workspace manifest is
  // authoritative for that componentRef. The client cannot supply this
  // capability as part of the content mutation.
  if (componentRef) {
    const themeCapability = themeCapabilities?.[componentRef];
    if (themeCapability) {
      return filterThemeContentProps(rawProps, themeCapability);
    }

    // Existing platform manifests remain a compatibility adapter while
    // starter and customer themes migrate to Theme-level contentFields.
    const manifest = COMPONENT_CONTENT_MANIFESTS[componentRef];
    if (!manifest) return {};
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rawProps)) {
      if (manifest.allowedContentFields.has(k)) {
        result[k] = v;
      }
    }
    return result;
  }

  // If componentRef is omitted, fall back to SECTION_TYPE_DEFAULT_MANIFESTS[sectionType]
  const defaultManifestKey = SECTION_TYPE_DEFAULT_MANIFESTS[sectionType];
  const manifest = defaultManifestKey
    ? COMPONENT_CONTENT_MANIFESTS[defaultManifestKey]
    : null;

  if (manifest) {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rawProps)) {
      if (manifest.allowedContentFields.has(k)) {
        result[k] = v;
      }
    }
    return result;
  }

  // Unknown sectionType: strict reject
  return {};
}
