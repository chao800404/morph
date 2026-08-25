import type { StorefrontPageDocument } from "@/db/storefront.schema";

export const STOREFRONT_STARTER_TEMPLATE_VERSION = 9;

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
    JSON.stringify(document) === JSON.stringify(legacyStarterDocument)
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
              imageSrc,
              imageAlt: "Ceramic vessels arranged on a morning table",
              imagePosition: "30% center",
            },
            {
              title: "Quiet corners",
              caption: "Sculptural forms that give a room its rhythm.",
              href: "/collections/quiet-corners",
              imageSrc,
              imageAlt: "A sculptural ceramic vase in warm light",
              imagePosition: "72% center",
            },
            {
              title: "Soft essentials",
              caption: "Natural textures made for slower evenings.",
              href: "/collections/soft-essentials",
              imageSrc,
              imageAlt: "Folded natural fabric beside ceramic objects",
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
          imageSrc,
          imageAlt: "Timeless ceramic objects in natural light",
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
