import type { StorefrontPageDocument } from "@/db/storefront.schema";
import {
  getComponentFilePath,
  parseComponentSource,
} from "@/lib/storefront/ast/theme-ast-transformer";
import {
  sanitizeThemeLinkHref,
  themeLinkAnchorProps,
} from "@/lib/storefront/theme-link";
import { resolveThemeMediaInSlotValues } from "@/lib/storefront/theme-media";
import { cn } from "@/lib/utils";
import { z } from "zod";
import { renderSafeThemeComponent } from "./safe-theme-component-renderer";

type StorefrontSection = StorefrontPageDocument["sections"][number];

type StorefrontDocumentRendererProps = {
  document: StorefrontPageDocument;
  themeFiles?: Array<{ path: string; content: string }>;
};

function resolveSectionStyle(props: Record<string, any>): React.CSSProperties {
  const style: React.CSSProperties = {};
  if (props.backgroundColor) style.backgroundColor = props.backgroundColor;
  if (props.textColor) style.color = props.textColor;
  if (props.textAlign) style.textAlign = props.textAlign;
  if (props.fontFamily) style.fontFamily = props.fontFamily;
  if (props.fontWeight) style.fontWeight = props.fontWeight;
  if (props.lineHeight) {
    style.lineHeight =
      typeof props.lineHeight === "number"
        ? props.lineHeight
        : props.lineHeight;
  }
  if (props.fontSize) {
    style.fontSize =
      typeof props.fontSize === "number"
        ? `${props.fontSize}px`
        : props.fontSize;
  }
  if (
    props.borderRadius !== undefined &&
    props.borderRadius !== null &&
    props.borderRadius !== 0
  ) {
    style.borderRadius =
      typeof props.borderRadius === "number"
        ? `${props.borderRadius}px`
        : props.borderRadius;
  }
  if (props.padding !== undefined && props.padding !== null) {
    style.padding =
      typeof props.padding === "number" ? `${props.padding}px` : props.padding;
  }
  if (props.paddingTop !== undefined && props.paddingTop !== null) {
    style.paddingTop =
      typeof props.paddingTop === "number"
        ? `${props.paddingTop}px`
        : props.paddingTop;
  }
  if (props.paddingBottom !== undefined && props.paddingBottom !== null) {
    style.paddingBottom =
      typeof props.paddingBottom === "number"
        ? `${props.paddingBottom}px`
        : props.paddingBottom;
  }
  if (props.paddingLeft !== undefined && props.paddingLeft !== null) {
    style.paddingLeft =
      typeof props.paddingLeft === "number"
        ? `${props.paddingLeft}px`
        : props.paddingLeft;
  }
  if (props.paddingRight !== undefined && props.paddingRight !== null) {
    style.paddingRight =
      typeof props.paddingRight === "number"
        ? `${props.paddingRight}px`
        : props.paddingRight;
  }
  return style;
}

const linkSchema = z.object({
  actionLabel: z.string().max(100).nullish().default("Explore"),
  actionHref: z.string().max(500).nullish().default("/collections/all"),
  actionTarget: z.enum(["_self", "_blank"]).nullish().default("_self"),
});

const imageSchema = z.object({
  imageSrc: z
    .string()
    .max(2_000)
    .nullish()
    .default("/static/storefront/theme-preview-default.png"),
  imageAlt: z.string().max(200).nullish().default("Storefront image"),
});

const heroSectionPropsSchema = z
  .object({
    eyebrow: z.string().max(100).nullish().default("New collection"),
    heading: z
      .string()
      .max(200)
      .nullish()
      .default("Objects for everyday rituals."),
    description: z
      .string()
      .max(500)
      .nullish()
      .default(
        "Quiet essentials, thoughtfully made for the spaces you call home.",
      ),
  })
  .extend(linkSchema.shape)
  .extend(imageSchema.shape)
  .passthrough();

const editorialIntroPropsSchema = z
  .object({
    label: z.string().max(100).nullish().default("About"),
    heading: z
      .string()
      .max(200)
      .nullish()
      .default("Fewer things. Better chosen."),
    body: z
      .string()
      .max(700)
      .nullish()
      .default("Crafted with intention for long-lasting quality."),
  })
  .passthrough();

const categoryShowcasePropsSchema = z
  .object({
    heading: z.string().max(200).nullish().default("Shop by collection"),
    items: z
      .array(
        z.object({
          title: z.string().max(150).nullish().default("Collection"),
          caption: z.string().max(300).nullish().default(""),
          href: z.string().max(500).nullish().default("/collections/all"),
          imageSrc: z
            .string()
            .max(2_000)
            .nullish()
            .default("/static/storefront/theme-preview-default.png"),
          imageAlt: z.string().max(200).nullish().default("Category image"),
          imagePosition: z.string().max(100).nullish().default("center"),
        }),
      )
      .nullish()
      .default([]),
  })
  .passthrough();

const imageWithTextPropsSchema = z
  .object({
    eyebrow: z.string().max(100).nullish().default(""),
    heading: z.string().max(200).nullish().default("Story"),
    body: z.string().max(700).nullish().default(""),
    imagePosition: z.string().max(100).nullish().default("center"),
  })
  .extend(linkSchema.shape)
  .extend(imageSchema.shape)
  .passthrough();

const principlesPropsSchema = z
  .object({
    items: z
      .array(
        z.object({
          id: z.string().max(120).nullish(),
          number: z.string().max(20).nullish().default("01"),
          title: z.string().max(150).nullish().default(""),
          body: z.string().max(400).nullish().default(""),
        }),
      )
      .nullish()
      .default([]),
  })
  .passthrough();

const newsletterPropsSchema = z
  .object({
    eyebrow: z.string().max(100).nullish().default("Stay connected"),
    heading: z.string().max(200).nullish().default("Join our newsletter"),
    body: z.string().max(500).nullish().default(""),
    placeholder: z.string().max(100).nullish().default("Enter your email"),
    actionLabel: z.string().max(100).nullish().default("Subscribe"),
  })
  .passthrough();

export function StorefrontDocumentRenderer({
  document,
  themeFiles,
}: StorefrontDocumentRendererProps) {
  const enabledSections = (document.sections ?? []).filter(
    (section) => section.enabled !== false,
  );

  if (enabledSections.length === 0) return <EmptyStorefront />;

  return (
    <main>
      {enabledSections.map((section) => renderSection(section, themeFiles))}
    </main>
  );
}

function renderSection(
  section: StorefrontSection,
  themeFiles?: Array<{ path: string; content: string }>,
) {
  const sectionSchemas = {
    hero: heroSectionPropsSchema,
    "editorial-intro": editorialIntroPropsSchema,
    "category-showcase": categoryShowcasePropsSchema,
    "image-with-text": imageWithTextPropsSchema,
    principles: principlesPropsSchema,
    newsletter: newsletterPropsSchema,
  } as const;
  const schema = sectionSchemas[section.type as keyof typeof sectionSchemas];

  const rawProps = resolveThemeMediaInSlotValues(
    (section.props ?? {}) as Record<string, any>,
  );
  const parsed = schema ? schema.safeParse(rawProps) : null;
  const parsedData = parsed?.success ? parsed.data : rawProps;
  const componentPath = getComponentFilePath(
    section.type,
    themeFiles,
    section.componentRef ?? undefined,
  );
  const componentFile = componentPath
    ? themeFiles?.find((file) => file.path === componentPath)
    : null;

  if (componentPath && componentFile && themeFiles) {
    const rendered = renderSafeThemeComponent({
      files: themeFiles,
      sourcePath: componentPath,
      props: parsedData as Record<string, unknown>,
      section: {
        sectionId: section.id,
        sectionType: section.type,
        componentRef: section.componentRef,
      },
    });
    if (rendered.success) return rendered.node;
    return (
      <ThemeComponentDiagnostic
        key={section.id}
        section={section}
        sourcePath={componentPath}
        diagnostics={rendered.diagnostics}
      />
    );
  }

  switch (section.type) {
    case "hero":
      return (
        <StorefrontHero
          key={section.id}
          sectionId={section.id}
          componentRef={section.componentRef}
          rawProps={rawProps}
          themeFiles={themeFiles}
          {...(parsedData as any)}
        />
      );
    case "editorial-intro":
      return (
        <EditorialIntro
          key={section.id}
          sectionId={section.id}
          rawProps={rawProps}
          {...(parsedData as any)}
        />
      );
    case "category-showcase":
      return (
        <CategoryShowcase
          key={section.id}
          sectionId={section.id}
          rawProps={rawProps}
          {...(parsedData as any)}
        />
      );
    case "image-with-text":
      return (
        <ImageWithText
          key={section.id}
          sectionId={section.id}
          rawProps={rawProps}
          {...(parsedData as any)}
        />
      );
    case "principles":
      return (
        <Principles
          key={section.id}
          sectionId={section.id}
          componentRef={section.componentRef}
          rawProps={rawProps}
          themeFiles={themeFiles}
          {...(parsedData as any)}
        />
      );
    case "newsletter":
      return (
        <Newsletter
          key={section.id}
          sectionId={section.id}
          rawProps={rawProps}
          {...(parsedData as any)}
        />
      );
    default:
      return <UnsupportedSection key={section.id} section={section} />;
  }
}

function ThemeComponentDiagnostic({
  section,
  sourcePath,
  diagnostics,
}: {
  section: StorefrontSection;
  sourcePath: string;
  diagnostics: string[];
}) {
  return (
    <section
      data-storefront-section-id={section.id}
      data-storefront-section-type={section.type}
      data-morph-source-file={sourcePath}
      data-storefront-theme-component-diagnostic
      className="border border-amber-300 bg-amber-50 px-6 py-8 text-amber-950"
    >
      <p className="font-semibold">Theme component preview unavailable</p>
      <p className="mt-2 text-sm">
        {diagnostics[0] ??
          "The component uses syntax that is not supported by the safe Design preview."}
      </p>
    </section>
  );
}

function StorefrontHero({
  sectionId,
  componentRef,
  rawProps,
  themeFiles,
  eyebrow,
  heading,
  description,
  actionLabel,
  actionHref,
  actionTarget,
  imageSrc,
  imageAlt,
}: {
  sectionId: string;
  componentRef?: string | null;
  rawProps?: Record<string, any>;
  themeFiles?: Array<{ path: string; content: string }>;
  eyebrow?: string | null;
  heading?: string | null;
  description?: string | null;
  actionLabel?: string | null;
  actionHref?: string | null;
  actionTarget?: string | null;
  imageSrc?: string | null;
  imageAlt?: string | null;
}) {
  const componentPath =
    getComponentFilePath("hero", themeFiles, componentRef ?? undefined) ??
    "src/components/Hero.tsx";
  const heroFile = themeFiles?.find((f) => f.path === componentPath);
  const heroAst = heroFile?.content
    ? parseComponentSource(heroFile.content)
    : null;
  // Presentation SSOT: when TSX source exists, Tailwind classes from source govern layout/style without inline style overrides
  const customStyle = heroFile
    ? undefined
    : resolveSectionStyle(rawProps ?? {});
  const customClass = heroFile
    ? undefined
    : (rawProps?.className ?? rawProps?.customClass);

  const sectionClassName =
    heroAst?.elements["section"]?.className ||
    heroAst?.elements["root"]?.className ||
    "grid min-h-[42rem] bg-stone-100 lg:min-h-[50rem] lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]";

  const eyebrowClassName =
    heroAst?.elements["eyebrow"]?.className ||
    "text-xs font-medium uppercase tracking-[0.24em] text-stone-500";

  const headingClassName =
    heroAst?.elements["heading"]?.className ||
    "mt-6 font-serif text-[clamp(3.25rem,7vw,7rem)] leading-[0.88] tracking-[-0.055em] text-stone-950";

  const contentClassName = heroAst?.elements["content"]?.className || "max-w-xl";

  const descriptionClassName =
    heroAst?.elements["description"]?.className ||
    "mt-7 max-w-md text-base leading-7 text-stone-600";

  const actionClassName =
    heroAst?.elements["action"]?.className ||
    "inline-flex items-center justify-center rounded-md bg-stone-900 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-stone-800";

  const imageContainerClassName =
    heroAst?.elements["image"]?.className ||
    "min-h-[30rem] overflow-hidden lg:min-h-0";

  const displayEyebrow =
    eyebrow ?? heroAst?.defaultProps.eyebrow ?? "New collection";
  const displayHeading =
    heading ?? heroAst?.defaultProps.heading ?? "Objects for everyday rituals.";
  const displayDescription =
    description ??
    heroAst?.defaultProps.description ??
    "Quiet essentials, thoughtfully made for the spaces you call home.";
  const displayActionLabel =
    actionLabel ??
    heroAst?.defaultProps.actionLabel ??
    "Explore the collection";
  const displayActionHref = sanitizeThemeLinkHref(
    actionHref ?? heroAst?.defaultProps.actionHref ?? "/collections/new",
  );
  const actionAnchorProps = themeLinkAnchorProps(
    displayActionHref,
    actionTarget ?? heroAst?.defaultProps.actionTarget,
  );
  const displayImageSrc =
    imageSrc ||
    heroAst?.defaultProps.imageSrc ||
    "/static/storefront/theme-preview-default.png";
  const displayImageAlt =
    imageAlt ||
    heroAst?.defaultProps.imageAlt ||
    "A neutral collection of ceramic objects";

  return (
    <section
      data-storefront-section-id={sectionId}
      data-storefront-section-type="hero"
      data-morph-source-file={componentPath}
      data-morph-component="Hero"
      data-morph-component-ref={componentRef ?? "hero.default"}
      data-morph-node={heroAst?.elements["section"]?.nodeId}
      style={customStyle}
      className={cn(sectionClassName, customClass)}
    >
      <div className="flex items-center px-[clamp(1.75rem,6vw,6rem)] py-20">
        <div
          data-morph-node={heroAst?.elements["content"]?.nodeId}
          data-morph-element="content"
          className={contentClassName}
        >
          <p
            data-storefront-component="eyebrow"
            data-storefront-field="eyebrow"
            data-morph-node={heroAst?.elements["eyebrow"]?.nodeId}
            data-morph-element="eyebrow"
            className={eyebrowClassName}
          >
            {displayEyebrow}
          </p>
          <h1
            data-storefront-component="heading"
            data-storefront-field="heading"
            data-morph-node={heroAst?.elements["heading"]?.nodeId}
            data-morph-element="heading"
            className={headingClassName}
          >
            {displayHeading}
          </h1>
          <p
            data-storefront-component="description"
            data-storefront-field="description"
            data-morph-node={heroAst?.elements["description"]?.nodeId}
            data-morph-element="description"
            className={descriptionClassName}
          >
            {displayDescription}
          </p>
          <div className="mt-8">
            <a
              href={displayActionHref}
              {...actionAnchorProps}
              data-storefront-component="button"
              data-storefront-field="actionLabel"
              data-morph-node={heroAst?.elements["action"]?.nodeId}
              data-morph-element="action"
              className={actionClassName}
            >
              {displayActionLabel}
            </a>
          </div>
        </div>
      </div>
      <div
        data-storefront-component="image"
        data-storefront-field="imageSrc"
        data-morph-node={heroAst?.elements["image"]?.nodeId}
        data-morph-element="image"
        className={imageContainerClassName}
      >
        <img
          src={displayImageSrc}
          alt={displayImageAlt}
          className="size-full object-cover"
        />
      </div>
    </section>
  );
}

function EditorialIntro({
  sectionId,
  rawProps,
  label,
  heading,
  body,
}: {
  sectionId: string;
  rawProps?: Record<string, any>;
  label?: string | null;
  heading?: string | null;
  body?: string | null;
}) {
  const customStyle = resolveSectionStyle(rawProps ?? {});
  const customClass = rawProps?.className ?? rawProps?.customClass;

  return (
    <section
      data-storefront-section-id={sectionId}
      data-storefront-section-type="editorial-intro"
      data-morph-source-file="src/components/EditorialIntro.tsx"
      data-morph-component="EditorialIntro"
      style={customStyle}
      className={cn(
        "bg-stone-50 px-[clamp(1.75rem,7vw,7rem)] py-[clamp(6rem,12vw,11rem)]",
        customClass,
      )}
    >
      <div className="grid gap-10 border-t border-stone-300 pt-8 lg:grid-cols-[0.55fr_1.45fr]">
        <p
          data-storefront-component="label"
          data-storefront-field="label"
          className="text-xs font-medium uppercase tracking-[0.22em] text-stone-500"
        >
          {label ?? "About"}
        </p>
        <div>
          <h2
            data-storefront-component="heading"
            data-storefront-field="heading"
            className="max-w-4xl font-serif text-[clamp(3rem,6vw,6.5rem)] leading-[0.92] tracking-[-0.045em] text-stone-950"
          >
            {heading ?? "Fewer things. Better chosen."}
          </h2>
          <p
            data-storefront-component="body"
            data-storefront-field="body"
            className="ml-auto mt-10 max-w-xl text-lg leading-8 text-stone-600"
          >
            {body ?? ""}
          </p>
        </div>
      </div>
    </section>
  );
}

function CategoryShowcase({
  sectionId,
  rawProps,
  heading,
  items,
}: {
  sectionId: string;
  rawProps?: Record<string, any>;
  heading?: string | null;
  items?: Array<{
    title?: string | null;
    caption?: string | null;
    href?: string | null;
    imageSrc?: string | null;
    imageAlt?: string | null;
    imagePosition?: string | null;
  }> | null;
}) {
  const customStyle = resolveSectionStyle(rawProps ?? {});
  const customClass = rawProps?.className ?? rawProps?.customClass;
  const displayHeading = heading || "Shop by collection";
  const displayItems = items ?? [];

  return (
    <section
      data-storefront-section-id={sectionId}
      data-storefront-section-type="category-showcase"
      data-morph-source-file="src/components/CategoryShowcase.tsx"
      data-morph-component="CategoryShowcase"
      style={customStyle}
      className={cn(
        "bg-stone-900 px-[clamp(1.25rem,4vw,4rem)] py-[clamp(5rem,9vw,9rem)] text-stone-100",
        customClass,
      )}
    >
      <div className="mb-12 flex items-end justify-between border-b border-stone-700 pb-6">
        <h2
          data-storefront-component="heading"
          data-storefront-field="heading"
          className="font-serif text-[clamp(2.5rem,5vw,5rem)] tracking-[-0.04em]"
        >
          {displayHeading}
        </h2>
        <span
          data-storefront-component="badge"
          className="hidden text-xs uppercase tracking-[0.2em] text-stone-400 sm:block"
        >
          The collection
        </span>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {displayItems.map((item, index) => (
          <a
            key={item.href ?? index}
            href={item.href ?? "#"}
            data-storefront-component="collection-item"
            data-storefront-field="items"
            data-storefront-field-path={`items.${index}`}
            className="group block border-t border-stone-700 pt-4 lg:border-t-0 lg:pt-0"
          >
            <div className="aspect-[4/5] overflow-hidden bg-stone-800">
              <img
                data-storefront-component="image"
                data-storefront-field="imageSrc"
                data-storefront-field-path={`items.${index}.imageSrc`}
                src={
                  item.imageSrc ??
                  "/static/storefront/theme-preview-default.png"
                }
                data-storefront-field-alt={`items.${index}.imageAlt`}
                alt={item.imageAlt ?? "Collection item"}
                style={{
                  objectPosition: (item.imagePosition as any) ?? "center",
                }}
                className="size-full object-cover opacity-80 transition-transform duration-500 ease-out group-hover:scale-[1.025]"
              />
            </div>
            <div className="flex gap-5 py-5">
              <span className="pt-1 text-xs text-stone-500">0{index + 1}</span>
              <div>
                <h3
                  data-storefront-component="title"
                  data-storefront-field="title"
                  data-storefront-field-path={`items.${index}.title`}
                  className="font-serif text-2xl"
                >
                  {item.title ?? "Collection"}
                </h3>
                <p
                  data-storefront-component="caption"
                  data-storefront-field="caption"
                  data-storefront-field-path={`items.${index}.caption`}
                  className="mt-2 max-w-xs text-sm leading-6 text-stone-400"
                >
                  {item.caption ?? ""}
                </p>
              </div>
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}

function ImageWithText({
  sectionId,
  rawProps,
  eyebrow,
  heading,
  body,
  actionLabel,
  actionHref,
  actionTarget,
  imageSrc,
  imageAlt,
  imagePosition,
}: {
  sectionId: string;
  rawProps?: Record<string, any>;
  eyebrow?: string | null;
  heading?: string | null;
  body?: string | null;
  actionLabel?: string | null;
  actionHref?: string | null;
  actionTarget?: string | null;
  imageSrc?: string | null;
  imageAlt?: string | null;
  imagePosition?: string | null;
}) {
  const customStyle = resolveSectionStyle(rawProps ?? {});
  const customClass = rawProps?.className ?? rawProps?.customClass;

  return (
    <section
      data-storefront-section-id={sectionId}
      data-storefront-section-type="image-with-text"
      data-morph-source-file="src/components/Hero.tsx"
      data-morph-component="ImageWithText"
      style={customStyle}
      className={cn("grid bg-[#d8d0c3] lg:grid-cols-2", customClass)}
    >
      <div
        data-storefront-component="image"
        data-storefront-field="imageSrc"
        className="min-h-[32rem] overflow-hidden lg:min-h-[52rem]"
      >
        <img
          src={imageSrc ?? "/static/storefront/theme-preview-default.png"}
          alt={imageAlt ?? "Image with text"}
          style={{ objectPosition: (imagePosition as any) ?? "center" }}
          className="size-full scale-110 object-cover"
        />
      </div>
      <div className="flex items-center px-[clamp(2rem,7vw,7rem)] py-20">
        <div className="max-w-xl">
          <p
            data-storefront-component="eyebrow"
            data-storefront-field="eyebrow"
            className="text-xs font-medium uppercase tracking-[0.22em] text-stone-600"
          >
            {eyebrow ?? ""}
          </p>
          <h2
            data-storefront-component="heading"
            data-storefront-field="heading"
            className="mt-5 font-serif text-[clamp(3rem,5vw,5.5rem)] leading-[0.94] tracking-[-0.045em] text-stone-950"
          >
            {heading ?? "Story"}
          </h2>
          <p
            data-storefront-component="body"
            data-storefront-field="body"
            className="mt-7 text-base leading-7 text-stone-700"
          >
            {body ?? ""}
          </p>
          <StorefrontLink
            href={actionHref}
            target={actionTarget}
            field="actionLabel"
          >
            {actionLabel ?? "Explore"}
          </StorefrontLink>
        </div>
      </div>
    </section>
  );
}

function Principles({
  sectionId,
  componentRef,
  rawProps,
  themeFiles,
  items,
}: {
  sectionId: string;
  componentRef?: string | null;
  rawProps?: Record<string, any>;
  themeFiles?: Array<{ path: string; content: string }>;
  items?: Array<{
    id?: string | null;
    number?: string | null;
    title?: string | null;
    body?: string | null;
  }> | null;
}) {
  const componentPath =
    getComponentFilePath("principles", themeFiles, componentRef ?? undefined) ??
    "src/components/Principles.tsx";
  const principlesFile = themeFiles?.find((f) => f.path === componentPath);
  const principlesAst = principlesFile?.content
    ? parseComponentSource(principlesFile.content)
    : null;
  const customStyle = principlesFile
    ? undefined
    : resolveSectionStyle(rawProps ?? {});
  const customClass = principlesFile
    ? undefined
    : (rawProps?.className ?? rawProps?.customClass);
  const displayItems = items ?? [];

  const sectionClassName =
    principlesAst?.elements["section"]?.className ??
    principlesAst?.elements["root"]?.className ??
    "bg-stone-50 px-[clamp(1.75rem,6vw,6rem)] py-[clamp(6rem,10vw,9rem)]";
  const labelClassName =
    principlesAst?.elements.label?.className ??
    "mb-14 text-xs font-medium uppercase tracking-[0.22em] text-stone-500";
  const gridClassName =
    principlesAst?.elements.grid?.className ??
    "grid border-t border-stone-300 lg:grid-cols-3";
  const cardClassName =
    principlesAst?.elements["principle-card"]?.className ??
    "border-b border-stone-300 py-8 lg:border-b-0 lg:border-r lg:px-8 lg:first:pl-0 lg:last:border-r-0";
  const numberClassName =
    principlesAst?.elements.number?.className ?? "text-xs text-stone-400";
  const titleClassName =
    principlesAst?.elements.title?.className ??
    "mt-12 font-serif text-3xl tracking-tight text-stone-950";
  const bodyClassName =
    principlesAst?.elements.body?.className ??
    "mt-4 max-w-sm text-sm leading-6 text-stone-600";
  const instanceClassName = (
    itemId: string | null | undefined,
    nodeId: string,
  ) =>
    itemId ? principlesAst?.instanceClasses[`${itemId}:${nodeId}`] : undefined;

  return (
    <section
      data-storefront-section-id={sectionId}
      data-storefront-section-type="principles"
      data-morph-source-file={componentPath}
      data-morph-component="Principles"
      data-morph-component-ref={componentRef ?? "principles.default"}
      data-morph-node={principlesAst?.elements.section?.nodeId}
      style={customStyle}
      className={cn(sectionClassName, customClass)}
    >
      <p
        data-storefront-component="label"
        data-morph-node={principlesAst?.elements.label?.nodeId}
        data-morph-element="label"
        className={labelClassName}
      >
        Why we choose differently
      </p>
      <div
        data-storefront-component="grid"
        data-morph-node={principlesAst?.elements.grid?.nodeId}
        data-morph-element="grid"
        className={gridClassName}
      >
        {displayItems.map((item, idx) => (
          <article
            key={item.id ?? item.number ?? idx}
            data-storefront-item-id={item.id ?? undefined}
            data-storefront-component="principle-item"
            data-storefront-field="items"
            data-storefront-field-path={`items.${idx}`}
            data-morph-node={principlesAst?.elements["principle-card"]?.nodeId}
            data-morph-element="principle-card"
            className={cn(
              cardClassName,
              instanceClassName(item.id, "principle-card"),
            )}
          >
            <span
              data-storefront-component="number"
              data-storefront-field="number"
              data-storefront-field-path={`items.${idx}.number`}
              data-morph-node={principlesAst?.elements.number?.nodeId}
              data-morph-element="number"
              className={cn(
                numberClassName,
                instanceClassName(item.id, "principle-number"),
              )}
            >
              {item.number ?? `0${idx + 1}`}
            </span>
            <h3
              data-storefront-component="title"
              data-storefront-field="title"
              data-storefront-field-path={`items.${idx}.title`}
              data-morph-node={principlesAst?.elements.title?.nodeId}
              data-morph-element="title"
              className={cn(
                titleClassName,
                instanceClassName(item.id, "principle-title"),
              )}
            >
              {item.title ?? ""}
            </h3>
            <p
              data-storefront-component="body"
              data-storefront-field="body"
              data-storefront-field-path={`items.${idx}.body`}
              data-morph-node={principlesAst?.elements.body?.nodeId}
              data-morph-element="body"
              className={cn(
                bodyClassName,
                instanceClassName(item.id, "principle-body"),
              )}
            >
              {item.body ?? ""}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

function Newsletter({
  sectionId,
  rawProps,
  eyebrow,
  heading,
  body,
  placeholder,
  actionLabel,
}: {
  sectionId: string;
  rawProps?: Record<string, any>;
  eyebrow?: string | null;
  heading?: string | null;
  body?: string | null;
  placeholder?: string | null;
  actionLabel?: string | null;
}) {
  const customStyle = resolveSectionStyle(rawProps ?? {});
  const customClass = rawProps?.className ?? rawProps?.customClass;

  return (
    <section
      data-storefront-section-id={sectionId}
      data-storefront-section-type="newsletter"
      data-morph-source-file="src/pages/index.tsx"
      data-morph-component="Newsletter"
      style={customStyle}
      className={cn(
        "bg-[#b7ad9d] px-[clamp(1.75rem,8vw,8rem)] py-[clamp(6rem,11vw,10rem)]",
        customClass,
      )}
    >
      <div className="mx-auto max-w-4xl text-center">
        <p
          data-storefront-component="eyebrow"
          data-storefront-field="eyebrow"
          className="text-xs font-medium uppercase tracking-[0.24em] text-stone-700"
        >
          {eyebrow ?? "Stay connected"}
        </p>
        <h2
          data-storefront-component="heading"
          data-storefront-field="heading"
          className="mt-6 font-serif text-[clamp(3rem,6vw,6rem)] leading-[0.92] tracking-[-0.045em] text-stone-950"
        >
          {heading ?? "Join our newsletter"}
        </h2>
        <p
          data-storefront-component="body"
          data-storefront-field="body"
          className="mx-auto mt-6 max-w-lg text-base leading-7 text-stone-700"
        >
          {body ?? ""}
        </p>
        <div
          className="mx-auto mt-10 flex max-w-xl border-b border-stone-800 py-3 text-left"
          aria-label={`${placeholder ?? "Email"}. ${actionLabel ?? "Subscribe"}`}
        >
          <span
            data-storefront-component="input"
            data-storefront-field="placeholder"
            className="flex-1 text-sm text-stone-700"
          >
            {placeholder ?? "Enter your email"}
          </span>
          <span
            data-storefront-component="button"
            data-storefront-field="actionLabel"
            className="text-sm font-medium text-stone-950"
          >
            {actionLabel ?? "Subscribe"}
          </span>
        </div>
      </div>
    </section>
  );
}

function StorefrontLink({
  href,
  target,
  children,
  field = "actionLabel",
}: {
  href?: string | null;
  target?: unknown;
  children?: React.ReactNode;
  field?: string;
}) {
  if (!children) return null;
  const safeHref = sanitizeThemeLinkHref(href);
  return (
    <a
      href={safeHref || "#"}
      {...themeLinkAnchorProps(safeHref, target)}
      data-storefront-component="button"
      data-storefront-field={field}
      className="mt-9 inline-flex border-b border-current pb-1 text-sm font-medium"
    >
      {children}
    </a>
  );
}

function EmptyStorefront() {
  return (
    <main>
      <section className="flex min-h-[70svh] items-center justify-center px-6 py-20 text-center">
        <div className="max-w-md">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-neutral-500">
            Empty template
          </p>
          <h1 className="mt-3 font-serif text-4xl tracking-tight text-neutral-900">
            Start with your first section
          </h1>
          <p className="mt-3 text-sm leading-6 text-neutral-600">
            Published content will appear here after sections are added to the
            template document.
          </p>
        </div>
      </section>
    </main>
  );
}

function UnsupportedSection({ section }: { section: StorefrontSection }) {
  return (
    <section
      data-storefront-section-id={section.id}
      className="border-b border-neutral-200 px-6 py-16 sm:px-10"
    >
      <div className="mx-auto max-w-5xl">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-neutral-500">
          Unsupported section
        </p>
        <h2 className="mt-2 text-xl font-semibold text-neutral-900">
          {section.type}
        </h2>
        <p className="mt-2 max-w-xl text-sm leading-6 text-neutral-600">
          This section exists in the template document but does not have a
          registered storefront renderer yet.
        </p>
      </div>
    </section>
  );
}
