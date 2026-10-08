import type { StorefrontPageDocument } from "@/db/storefront.schema";
import {
  DEFAULT_FOOTER_EXPLORE_ITEM_IDS,
  DEFAULT_FOOTER_HELP_ITEM_IDS,
  DEFAULT_HEADER_NAV_ITEM_IDS,
} from "./default-row-ids";

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
 * 21: remove the remaining hand-written data-storefront-field markers from
 *     untouched Starter component source; preview binding stays compiler-owned.
 * 22: remove every marker the compiler derives, in place, from source an author
 *     has edited too — the byte-exact replacements above can never reach it.
 * 23: give the Header's navigation map an index, without which its rows carry
 *     no field path and the editor cannot tell one link from another.
 * 24: make a Header row the link itself; the hand-written span around each one
 *     was standing in for a wrapper the compiler now decides.
 * 25: key a repeated row by the identity Morph stores for it rather than its
 *     position, so reordering does not carry one row's DOM node into another.
 * 27: move an untouched Starter home route onto page-owned section copies, so
 *     its sections stay editable while the section library they came from
 *     stays template source Design mode does not write.
 */
export const STOREFRONT_STARTER_TEMPLATE_VERSION = 27;

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
        componentRef: "src/components/Hero.tsx",
      },
      {
        id: "starter-introduction",
        type: "editorial-intro",
        componentRef: "src/components/EditorialIntro.tsx",
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
        componentRef: "src/components/CategoryShowcase.tsx",
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
        componentRef: "src/components/ImageWithText.tsx",
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
        componentRef: "src/components/Principles.tsx",
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
        componentRef: "src/components/Newsletter.tsx",
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
 * path at once — the same reason the editor labels these rows "Global".
 */
export function createDefaultStorefrontLayoutDocument(): StorefrontPageDocument {
  return {
    version: 1,
    sections: [
      {
        id: STOREFRONT_LAYOUT_HEADER_SLOT_ID,
        type: "header",
        componentRef: "src/components/Header.tsx",
        enabled: true,
        props: {
          storeName: "Online Store",
          navItems: [
            {
              id: DEFAULT_HEADER_NAV_ITEM_IDS[0],
              label: "Shop",
              link: { href: "/collections/all" },
            },
            {
              id: DEFAULT_HEADER_NAV_ITEM_IDS[1],
              label: "About",
              link: { href: "/pages/about" },
            },
            {
              id: DEFAULT_HEADER_NAV_ITEM_IDS[2],
              label: "Journal",
              link: { href: "/blogs/journal" },
            },
          ],
          cartLabel: "Cart (0)",
          cartLink: { href: "/cart" },
        },
      },
      {
        id: STOREFRONT_LAYOUT_FOOTER_SLOT_ID,
        type: "footer",
        componentRef: "src/components/Footer.tsx",
        enabled: true,
        props: {
          storeName: "Online Store",
          copyrightText: "© Online Store",
          tagline:
            "Objects with lasting character for thoughtful, everyday living.",
          exploreHeading: "Explore",
          exploreItems: [
            {
              id: DEFAULT_FOOTER_EXPLORE_ITEM_IDS[0],
              label: "Shop all",
              link: { href: "/collections/all" },
            },
            {
              id: DEFAULT_FOOTER_EXPLORE_ITEM_IDS[1],
              label: "Our story",
              link: { href: "/pages/about" },
            },
            {
              id: DEFAULT_FOOTER_EXPLORE_ITEM_IDS[2],
              label: "Journal",
              link: { href: "/blogs/journal" },
            },
          ],
          helpHeading: "Help",
          helpItems: [
            {
              id: DEFAULT_FOOTER_HELP_ITEM_IDS[0],
              label: "Contact",
              link: { href: "/pages/contact" },
            },
            {
              id: DEFAULT_FOOTER_HELP_ITEM_IDS[1],
              label: "Shipping",
              link: { href: "/pages/shipping" },
            },
            {
              id: DEFAULT_FOOTER_HELP_ITEM_IDS[2],
              label: "Returns",
              link: { href: "/pages/returns" },
            },
          ],
        },
      },
    ],
  };
}
