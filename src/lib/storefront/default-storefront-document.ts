import type { StorefrontPageDocument } from "@/db/storefront.schema";

/**
 * Starter workspace revision.
 *
 * A Theme only re-runs the Starter upgrade while its stored
 * `starterTemplateVersion` is below this number, so adding an upgrade rule
 * without bumping this leaves every existing Theme on the old files with no way
 * to reach the new ones.
 *
 * 10: root route owns the document shell (`shellComponent`, `HeadContent`,
 *     `Scripts`, global stylesheet import). Without it a build previews
 *     correctly but serves production SSR with no <html>, <head> or stylesheet.
 * 11: content slots. The home route reads each section through
 *     `content("slot")` and the platform-owned `src/morph/content.ts` is
 *     seeded. Without it authored content stays in the Document and never
 *     reaches the rendered component.
 * 15: image content is stored as `{ image: { src, alt } }` and untouched
 *     Starter component sources are upgraded to consume the grouped value.
 * 16: the layout shell stops forwarding its own `storeName` and
 *     `copyrightText` into Header and Footer, so the default props the
 *     inspector patches are what render; Header and Footer generations that
 *     the byte-exact catalog previously could not match are upgraded to the
 *     sources that declare their full `contentFields`.
 * 17: header and footer content moves out of the component source and into a
 *     `layout` template document, which the shell reads through the same
 *     `content("slot")` contract a route uses and the runtime merges into
 *     every path.
 * 18: the starter stops writing its own `data-storefront-field` markers, which
 *     the renderer derives, and routes every destination through a shared
 *     `src/morph/link.tsx` so each entry picks `<Link>` or `<a>` from its own
 *     address instead of the whole list sharing one element.
 * 19: `src/morph/content-fields.ts` states the shape a `contentFields`
 *     declaration has to take, so a mistake in one is reported where it is
 *     written rather than becoming a field that never appears.
 * 20: remove redundant manifest contentFields for untouched Starter components
 *     that already declare their fields in source; retain authored fallbacks.
 */
export const STOREFRONT_STARTER_TEMPLATE_VERSION = 20;

const imageSrc = "/static/storefront/theme-preview-default.png";

const legacyStarterDocument: StorefrontPageDocument = {
  version: 1,
  sections: [
    {
      id: "starter-hero",
      type: "hero",
      enabled: true,
      props: {
        eyebrow: "New collection",
        heading: "Objects for everyday rituals.",
        description:
          "Quiet essentials, thoughtfully made for the spaces you call home.",
        actionLabel: "Explore the collection",
        actionHref: "/collections/new",
        image: {
          src: imageSrc,
          alt: "A neutral collection of ceramic objects",
        },
      },
    },
  ],
};

const legacyStarterDocumentV14: StorefrontPageDocument = {
  version: 1,
  sections: [
    {
      id: "starter-hero",
      type: "hero",
      enabled: true,
      props: {
        eyebrow: "New collection",
        heading: "Objects for everyday rituals.",
        description:
          "Quiet essentials, thoughtfully made for the spaces you call home.",
        actionLabel: "Explore the collection",
        actionHref: "/collections/new",
        imageSrc,
        imageAlt: "A neutral collection of ceramic objects",
      },
    },
  ],
};

export function isUpgradeableStarterHomeDocument(
  document: StorefrontPageDocument,
): boolean {
  return (
    document.sections.length === 0 ||
    JSON.stringify(document) === JSON.stringify(legacyStarterDocument) ||
    JSON.stringify(document) === JSON.stringify(legacyStarterDocumentV14)
  );
}

export function createDefaultStorefrontHomeDocument(): StorefrontPageDocument {
  return {
    version: 1,
    sections: [
      {
        ...legacyStarterDocument.sections[0]!,
        componentRef: "hero.default",
      },
      {
        id: "starter-introduction",
        type: "editorial-intro",
        componentRef: "editorial-intro.default",
        enabled: true,
        props: {
          label: "Considered living",
          heading: "Fewer things. Better chosen.",
          body: "We bring together useful objects with lasting character—pieces selected for honest materials, quiet form, and the pleasure of daily use.",
        },
      },
      {
        id: "starter-categories",
        type: "category-showcase",
        componentRef: "category-showcase.default",
        enabled: true,
        props: {
          heading: "Shop by ritual",
          items: [
            {
              title: "The morning table",
              caption: "Cups, carafes, and objects for an unhurried start.",
              href: "/collections/morning-table",
              image: {
                src: imageSrc,
                alt: "Ceramic vessels arranged on a morning table",
              },
              imagePosition: "30% center",
            },
            {
              title: "Quiet corners",
              caption: "Sculptural forms that give a room its rhythm.",
              href: "/collections/quiet-corners",
              image: {
                src: imageSrc,
                alt: "A sculptural ceramic vase in warm light",
              },
              imagePosition: "72% center",
            },
            {
              title: "Soft essentials",
              caption: "Natural textures made for slower evenings.",
              href: "/collections/soft-essentials",
              image: {
                src: imageSrc,
                alt: "Folded natural fabric beside ceramic objects",
              },
              imagePosition: "95% center",
            },
          ],
        },
      },
      {
        id: "starter-story",
        type: "image-with-text",
        componentRef: "image-with-text.default",
        enabled: true,
        props: {
          eyebrow: "Our point of view",
          heading: "Made to be kept, not replaced.",
          body: "We look for objects that age gracefully and makers who understand restraint. The result is a collection that feels personal from the first day and more familiar with every year.",
          actionLabel: "Read our story",
          actionHref: "/pages/about",
          image: {
            src: imageSrc,
            alt: "Timeless ceramic objects in natural light",
          },
          imagePosition: "center center",
        },
      },
      {
        id: "starter-principles",
        type: "principles",
        componentRef: "principles.default",
        enabled: true,
        props: {
          label: "Why we choose differently",
          items: [
            {
              id: "principle-natural-materials",
              number: "01",
              title: "Natural materials",
              body: "Tactile surfaces and honest finishes selected to age with character.",
            },
            {
              id: "principle-thoughtful-sourcing",
              number: "02",
              title: "Thoughtful sourcing",
              body: "Small-batch makers and considered production wherever possible.",
            },
            {
              id: "principle-everyday-usefulness",
              number: "03",
              title: "Everyday usefulness",
              body: "Beautiful forms designed to earn a permanent place in your routine.",
            },
          ],
        },
      },
      {
        id: "starter-newsletter",
        type: "newsletter",
        componentRef: "newsletter.default",
        enabled: true,
        props: {
          eyebrow: "Notes from the studio",
          heading: "A quieter kind of inbox.",
          body: "New objects, maker stories, and thoughtful ideas for the home—sent occasionally.",
          placeholder: "Email address",
          actionLabel: "Subscribe",
        },
      },
    ],
  };
}

/** Slot the layout shell reads its header content from. */
export const STOREFRONT_LAYOUT_HEADER_SLOT_ID = "starter-header";

/** Slot the layout shell reads its footer content from. */
export const STOREFRONT_LAYOUT_FOOTER_SLOT_ID = "starter-footer";

/**
 * Content of the shell every route renders inside.
 *
 * Seeded with what the components declare as their own defaults so adopting
 * the document changes nothing on the page: the values move from the source to
 * the Document, and the rendered result is byte-identical until an author
 * edits one. Held apart from the page documents because it belongs to every
 * path at once — the same reason the editor labels these rows "All pages".
 */
export function createDefaultStorefrontLayoutDocument(): StorefrontPageDocument {
  return {
    version: 1,
    sections: [
      {
        id: STOREFRONT_LAYOUT_HEADER_SLOT_ID,
        type: "header",
        componentRef: "header.default",
        enabled: true,
        props: {
          storeName: "Online Store",
          navItems: [
            { label: "Shop", link: { href: "/collections/all" } },
            { label: "About", link: { href: "/pages/about" } },
            { label: "Journal", link: { href: "/blogs/journal" } },
          ],
          cartLabel: "Cart (0)",
          cartLink: { href: "/cart" },
        },
      },
      {
        id: STOREFRONT_LAYOUT_FOOTER_SLOT_ID,
        type: "footer",
        componentRef: "footer.default",
        enabled: true,
        props: {
          storeName: "Online Store",
          copyrightText: "© Online Store",
          tagline:
            "Objects with lasting character for thoughtful, everyday living.",
          exploreHeading: "Explore",
          exploreItems: [
            { label: "Shop all", link: { href: "/collections/all" } },
            { label: "Our story", link: { href: "/pages/about" } },
            { label: "Journal", link: { href: "/blogs/journal" } },
          ],
          helpHeading: "Help",
          helpItems: [
            { label: "Contact", link: { href: "/pages/contact" } },
            { label: "Shipping", link: { href: "/pages/shipping" } },
            { label: "Returns", link: { href: "/pages/returns" } },
          ],
        },
      },
    ],
  };
}
