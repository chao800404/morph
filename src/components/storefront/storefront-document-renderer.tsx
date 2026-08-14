import type { StorefrontPageDocument } from "@/db/storefront.schema";
import { z } from "zod";

type StorefrontSection = StorefrontPageDocument["sections"][number];

type StorefrontDocumentRendererProps = {
  document: StorefrontPageDocument;
};

const linkSchema = z.object({
  actionLabel: z.string().max(100),
  actionHref: z.string().max(500),
});

const imageSchema = z.object({
  imageSrc: z.string().max(2_000),
  imageAlt: z.string().max(200),
});

const heroSectionPropsSchema = z
  .object({
    eyebrow: z.string().max(100),
    heading: z.string().max(200),
    description: z.string().max(500),
  })
  .extend(linkSchema.shape)
  .extend(imageSchema.shape);

const editorialIntroPropsSchema = z.object({
  label: z.string().max(100),
  heading: z.string().max(200),
  body: z.string().max(700),
});

const categoryShowcasePropsSchema = z.object({
  heading: z.string().max(200),
  items: z
    .array(
      z.object({
        title: z.string().max(150),
        caption: z.string().max(300),
        href: z.string().max(500),
        imageSrc: z.string().max(2_000),
        imageAlt: z.string().max(200),
        imagePosition: z.string().max(100),
      }),
    )
    .min(1)
    .max(6),
});

const imageWithTextPropsSchema = z
  .object({
    eyebrow: z.string().max(100),
    heading: z.string().max(200),
    body: z.string().max(700),
    imagePosition: z.string().max(100),
  })
  .extend(linkSchema.shape)
  .extend(imageSchema.shape);

const principlesPropsSchema = z.object({
  items: z
    .array(
      z.object({
        number: z.string().max(20),
        title: z.string().max(150),
        body: z.string().max(400),
      }),
    )
    .min(1)
    .max(6),
});

const newsletterPropsSchema = z.object({
  eyebrow: z.string().max(100),
  heading: z.string().max(200),
  body: z.string().max(500),
  placeholder: z.string().max(100),
  actionLabel: z.string().max(100),
});

export function StorefrontDocumentRenderer({
  document,
}: StorefrontDocumentRendererProps) {
  const enabledSections = document.sections.filter((section) => section.enabled);

  if (enabledSections.length === 0) return <EmptyStorefront />;

  return <main>{enabledSections.map(renderSection)}</main>;
}

function renderSection(section: StorefrontSection) {
  const sectionSchemas = {
    hero: heroSectionPropsSchema,
    "editorial-intro": editorialIntroPropsSchema,
    "category-showcase": categoryShowcasePropsSchema,
    "image-with-text": imageWithTextPropsSchema,
    principles: principlesPropsSchema,
    newsletter: newsletterPropsSchema,
  } as const;
  const schema = sectionSchemas[section.type as keyof typeof sectionSchemas];

  if (!schema) return <UnsupportedSection key={section.id} section={section} />;
  const parsed = schema.safeParse(section.props);
  if (!parsed.success) return <UnsupportedSection key={section.id} section={section} />;

  // The registry schemas differ by section, while the selected renderer is
  // narrowed by the same runtime key. The explicit branches preserve that link.
  switch (section.type) {
    case "hero":
      return <StorefrontHero key={section.id} sectionId={section.id} {...heroSectionPropsSchema.parse(section.props)} />;
    case "editorial-intro":
      return <EditorialIntro key={section.id} sectionId={section.id} {...editorialIntroPropsSchema.parse(section.props)} />;
    case "category-showcase":
      return <CategoryShowcase key={section.id} sectionId={section.id} {...categoryShowcasePropsSchema.parse(section.props)} />;
    case "image-with-text":
      return <ImageWithText key={section.id} sectionId={section.id} {...imageWithTextPropsSchema.parse(section.props)} />;
    case "principles":
      return <Principles key={section.id} sectionId={section.id} {...principlesPropsSchema.parse(section.props)} />;
    case "newsletter":
      return <Newsletter key={section.id} sectionId={section.id} {...newsletterPropsSchema.parse(section.props)} />;
    default:
      return <UnsupportedSection key={section.id} section={section} />;
  }
}

function StorefrontHero({ sectionId, eyebrow, heading, description, actionLabel, actionHref, imageSrc, imageAlt }: z.infer<typeof heroSectionPropsSchema> & { sectionId: string }) {
  return (
    <section data-storefront-section-id={sectionId} className="grid min-h-[42rem] bg-stone-100 lg:min-h-[50rem] lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]">
      <div className="flex items-center px-[clamp(1.75rem,6vw,6rem)] py-20">
        <div className="max-w-xl">
          <p className="text-xs font-medium uppercase tracking-[0.24em] text-stone-500">{eyebrow}</p>
          <h1 className="mt-6 font-serif text-[clamp(3.25rem,7vw,7rem)] leading-[0.88] tracking-[-0.055em] text-stone-950">{heading}</h1>
          <p className="mt-7 max-w-md text-base leading-7 text-stone-600">{description}</p>
          <StorefrontLink href={actionHref}>{actionLabel}</StorefrontLink>
        </div>
      </div>
      <div className="min-h-[30rem] overflow-hidden lg:min-h-0">
        <img src={imageSrc} alt={imageAlt} className="size-full object-cover" />
      </div>
    </section>
  );
}

function EditorialIntro({ sectionId, label, heading, body }: z.infer<typeof editorialIntroPropsSchema> & { sectionId: string }) {
  return (
    <section data-storefront-section-id={sectionId} className="bg-stone-50 px-[clamp(1.75rem,7vw,7rem)] py-[clamp(6rem,12vw,11rem)]">
      <div className="grid gap-10 border-t border-stone-300 pt-8 lg:grid-cols-[0.55fr_1.45fr]">
        <p className="text-xs font-medium uppercase tracking-[0.22em] text-stone-500">{label}</p>
        <div>
          <h2 className="max-w-4xl font-serif text-[clamp(3rem,6vw,6.5rem)] leading-[0.92] tracking-[-0.045em] text-stone-950">{heading}</h2>
          <p className="ml-auto mt-10 max-w-xl text-lg leading-8 text-stone-600">{body}</p>
        </div>
      </div>
    </section>
  );
}

function CategoryShowcase({ sectionId, heading, items }: z.infer<typeof categoryShowcasePropsSchema> & { sectionId: string }) {
  return (
    <section data-storefront-section-id={sectionId} className="bg-stone-900 px-[clamp(1.25rem,4vw,4rem)] py-[clamp(5rem,9vw,9rem)] text-stone-100">
      <div className="mb-12 flex items-end justify-between border-b border-stone-700 pb-6">
        <h2 className="font-serif text-[clamp(2.5rem,5vw,5rem)] tracking-[-0.04em]">{heading}</h2>
        <span className="hidden text-xs uppercase tracking-[0.2em] text-stone-400 sm:block">The collection</span>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {items.map((item, index) => (
          <a key={item.href} href={item.href} className="group block border-t border-stone-700 pt-4 lg:border-t-0 lg:pt-0">
            <div className="aspect-[4/5] overflow-hidden bg-stone-800">
              <img src={item.imageSrc} alt={item.imageAlt} style={{ objectPosition: item.imagePosition }} className="size-full object-cover opacity-80 transition-transform duration-500 ease-out group-hover:scale-[1.025]" />
            </div>
            <div className="flex gap-5 py-5">
              <span className="pt-1 text-xs text-stone-500">0{index + 1}</span>
              <div>
                <h3 className="font-serif text-2xl">{item.title}</h3>
                <p className="mt-2 max-w-xs text-sm leading-6 text-stone-400">{item.caption}</p>
              </div>
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}

function ImageWithText({ sectionId, eyebrow, heading, body, actionLabel, actionHref, imageSrc, imageAlt, imagePosition }: z.infer<typeof imageWithTextPropsSchema> & { sectionId: string }) {
  return (
    <section data-storefront-section-id={sectionId} className="grid bg-[#d8d0c3] lg:grid-cols-2">
      <div className="min-h-[32rem] overflow-hidden lg:min-h-[52rem]">
        <img src={imageSrc} alt={imageAlt} style={{ objectPosition: imagePosition }} className="size-full scale-110 object-cover" />
      </div>
      <div className="flex items-center px-[clamp(2rem,7vw,7rem)] py-20">
        <div className="max-w-xl">
          <p className="text-xs font-medium uppercase tracking-[0.22em] text-stone-600">{eyebrow}</p>
          <h2 className="mt-5 font-serif text-[clamp(3rem,5vw,5.5rem)] leading-[0.94] tracking-[-0.045em] text-stone-950">{heading}</h2>
          <p className="mt-7 text-base leading-7 text-stone-700">{body}</p>
          <StorefrontLink href={actionHref}>{actionLabel}</StorefrontLink>
        </div>
      </div>
    </section>
  );
}

function Principles({ sectionId, items }: z.infer<typeof principlesPropsSchema> & { sectionId: string }) {
  return (
    <section data-storefront-section-id={sectionId} className="bg-stone-50 px-[clamp(1.75rem,6vw,6rem)] py-[clamp(6rem,10vw,9rem)]">
      <p className="mb-14 text-xs font-medium uppercase tracking-[0.22em] text-stone-500">Why we choose differently</p>
      <div className="grid border-t border-stone-300 lg:grid-cols-3">
        {items.map((item) => (
          <article key={item.number} className="border-b border-stone-300 py-8 lg:border-b-0 lg:border-r lg:px-8 lg:first:pl-0 lg:last:border-r-0">
            <span className="text-xs text-stone-400">{item.number}</span>
            <h3 className="mt-12 font-serif text-3xl tracking-tight text-stone-950">{item.title}</h3>
            <p className="mt-4 max-w-sm text-sm leading-6 text-stone-600">{item.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function Newsletter({ sectionId, eyebrow, heading, body, placeholder, actionLabel }: z.infer<typeof newsletterPropsSchema> & { sectionId: string }) {
  return (
    <section data-storefront-section-id={sectionId} className="bg-[#b7ad9d] px-[clamp(1.75rem,8vw,8rem)] py-[clamp(6rem,11vw,10rem)]">
      <div className="mx-auto max-w-4xl text-center">
        <p className="text-xs font-medium uppercase tracking-[0.24em] text-stone-700">{eyebrow}</p>
        <h2 className="mt-6 font-serif text-[clamp(3rem,6vw,6rem)] leading-[0.92] tracking-[-0.045em] text-stone-950">{heading}</h2>
        <p className="mx-auto mt-6 max-w-lg text-base leading-7 text-stone-700">{body}</p>
        <div className="mx-auto mt-10 flex max-w-xl border-b border-stone-800 py-3 text-left" aria-label={`${placeholder}. ${actionLabel}`}>
          <span className="flex-1 text-sm text-stone-700">{placeholder}</span>
          <span className="text-sm font-medium text-stone-950">{actionLabel}</span>
        </div>
      </div>
    </section>
  );
}

function StorefrontLink({ href, children }: { href: string; children: string }) {
  return <a href={href} className="mt-9 inline-flex border-b border-current pb-1 text-sm font-medium">{children}</a>;
}

function EmptyStorefront() {
  return (
    <main><section className="flex min-h-[70svh] items-center justify-center px-6 py-20 text-center"><div className="max-w-md"><p className="text-xs font-medium uppercase tracking-[0.18em] text-neutral-500">Empty template</p><h1 className="mt-3 font-serif text-4xl tracking-tight text-neutral-900">Start with your first section</h1><p className="mt-3 text-sm leading-6 text-neutral-600">Published content will appear here after sections are added to the template document.</p></div></section></main>
  );
}

function UnsupportedSection({ section }: { section: StorefrontSection }) {
  return (
    <section data-storefront-section-id={section.id} className="border-b border-neutral-200 px-6 py-16 sm:px-10"><div className="mx-auto max-w-5xl"><p className="text-xs font-medium uppercase tracking-[0.16em] text-neutral-500">Unsupported section</p><h2 className="mt-2 text-xl font-semibold text-neutral-900">{section.type}</h2><p className="mt-2 max-w-xl text-sm leading-6 text-neutral-600">This section exists in the template document but does not have a registered storefront renderer yet.</p></div></section>
  );
}
