import { z } from "zod";

const MAX_THEME_MANIFEST_BYTES = 256 * 1024;
const MAX_THEME_COMPONENTS = 200;
const MAX_COMPONENT_CONTENT_FIELDS = 100;

const componentRefSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);

const contentFieldKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/);

const fieldLabelSchema = z.string().trim().min(1).max(80).optional();
const fieldDescriptionSchema = z.string().trim().min(1).max(240).optional();

const contentStringFieldShape = {
  label: fieldLabelSchema,
  description: fieldDescriptionSchema,
  maxLength: z.number().int().min(1).max(10_000).optional(),
};

const textContentFieldSchema = z
  .object({
    type: z.literal("text"),
    ...contentStringFieldShape,
  })
  .strict();

const textareaContentFieldSchema = z
  .object({
    type: z.literal("textarea"),
    ...contentStringFieldShape,
  })
  .strict();

const urlContentFieldSchema = z
  .object({
    type: z.literal("url"),
    ...contentStringFieldShape,
  })
  .strict();

const numberContentFieldSchema = z
  .object({
    type: z.literal("number"),
    label: fieldLabelSchema,
    description: fieldDescriptionSchema,
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    step: z.number().finite().positive().optional(),
  })
  .strict()
  .refine(
    (field) =>
      field.min === undefined ||
      field.max === undefined ||
      field.min <= field.max,
    { message: "min must be less than or equal to max" },
  );

const booleanContentFieldSchema = z
  .object({
    type: z.literal("boolean"),
    label: fieldLabelSchema,
    description: fieldDescriptionSchema,
  })
  .strict();

const selectOptionSchema = z
  .object({
    label: z.string().trim().min(1).max(80),
    value: z.string().min(1).max(200),
  })
  .strict();

const selectContentFieldSchema = z
  .object({
    type: z.literal("select"),
    label: fieldLabelSchema,
    description: fieldDescriptionSchema,
    options: z.array(selectOptionSchema).min(1).max(50),
  })
  .strict()
  .refine(
    (field) =>
      new Set(field.options.map((option) => option.value)).size ===
      field.options.length,
    { message: "select option values must be unique" },
  );

export const themeContentFieldDefinitionSchema = z.discriminatedUnion("type", [
  textContentFieldSchema,
  textareaContentFieldSchema,
  urlContentFieldSchema,
  numberContentFieldSchema,
  booleanContentFieldSchema,
  selectContentFieldSchema,
]);

export type ThemeContentFieldDefinition = z.infer<
  typeof themeContentFieldDefinitionSchema
>;

export type ThemeComponentContentCapability = Readonly<{
  fields: Readonly<Record<string, ThemeContentFieldDefinition>>;
}>;

export type ThemeContentCapabilities = Readonly<
  Record<string, ThemeComponentContentCapability>
>;

export type ThemeContentCapabilityParseResult = Readonly<{
  capabilities: ThemeContentCapabilities;
  sectionComponentRefs: Readonly<Record<string, string>>;
  diagnostics: readonly string[];
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads only bounded Visual Editor content capability metadata from a Theme
 * manifest. Invalid component entries fail closed without disabling unrelated
 * valid components in the same manifest.
 */
export function parseThemeContentCapabilities(
  manifestContent: string | null | undefined,
): ThemeContentCapabilityParseResult {
  if (!manifestContent) {
    return { capabilities: {}, sectionComponentRefs: {}, diagnostics: [] };
  }
  if (manifestContent.length > MAX_THEME_MANIFEST_BYTES) {
    return {
      capabilities: {},
      sectionComponentRefs: {},
      diagnostics: [
        "Theme manifest exceeds the content capability size limit.",
      ],
    };
  }

  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestContent);
  } catch {
    return {
      capabilities: {},
      sectionComponentRefs: {},
      diagnostics: ["Theme manifest is not valid JSON."],
    };
  }

  if (!isRecord(manifest) || !isRecord(manifest.components)) {
    return { capabilities: {}, sectionComponentRefs: {}, diagnostics: [] };
  }

  const componentEntries = Object.entries(manifest.components);
  if (componentEntries.length > MAX_THEME_COMPONENTS) {
    return {
      capabilities: {},
      sectionComponentRefs: {},
      diagnostics: ["Theme manifest exceeds the component capability limit."],
    };
  }

  const capabilities: Record<string, ThemeComponentContentCapability> = {};
  const sectionComponentRefs: Record<string, string> = {};
  const diagnostics: string[] = [];

  for (const [rawComponentRef, rawConfig] of componentEntries) {
    const componentRef = componentRefSchema.safeParse(rawComponentRef);
    if (!componentRef.success) {
      diagnostics.push(`Invalid componentRef: ${rawComponentRef}`);
      continue;
    }
    if (!isRecord(rawConfig) || rawConfig.contentFields === undefined) continue;
    if (!isRecord(rawConfig.contentFields)) {
      diagnostics.push(
        `Invalid contentFields for component: ${componentRef.data}`,
      );
      continue;
    }

    const fieldEntries = Object.entries(rawConfig.contentFields);
    if (fieldEntries.length > MAX_COMPONENT_CONTENT_FIELDS) {
      diagnostics.push(
        `Too many contentFields for component: ${componentRef.data}`,
      );
      continue;
    }

    const fields: Record<string, ThemeContentFieldDefinition> = {};
    for (const [rawFieldKey, rawDefinition] of fieldEntries) {
      const fieldKey = contentFieldKeySchema.safeParse(rawFieldKey);
      const definition =
        themeContentFieldDefinitionSchema.safeParse(rawDefinition);
      if (!fieldKey.success || !definition.success) {
        diagnostics.push(
          `Invalid content field ${rawFieldKey} for component: ${componentRef.data}`,
        );
        continue;
      }
      fields[fieldKey.data] = definition.data;
    }

    capabilities[componentRef.data] = { fields };
  }

  if (isRecord(manifest.sections)) {
    const sectionEntries = Object.entries(manifest.sections);
    if (sectionEntries.length > MAX_THEME_COMPONENTS) {
      diagnostics.push("Theme manifest exceeds the section mapping limit.");
    } else {
      for (const [sectionType, rawSection] of sectionEntries) {
        if (!isRecord(rawSection)) continue;
        const componentRef = componentRefSchema.safeParse(
          rawSection.componentRef,
        );
        if (!componentRef.success || !capabilities[componentRef.data]) {
          continue;
        }
        sectionComponentRefs[sectionType] = componentRef.data;
      }
    }
  }

  return { capabilities, sectionComponentRefs, diagnostics };
}

export function getThemeComponentContentCapability(
  manifestContent: string | null | undefined,
  componentRef: string | null | undefined,
): ThemeComponentContentCapability | null {
  if (!componentRef) return null;
  return (
    parseThemeContentCapabilities(manifestContent).capabilities[componentRef] ??
    null
  );
}

export function getThemeComponentContentCapabilityFromFiles(
  themeFiles: ReadonlyArray<{ path: string; content?: string }> | undefined,
  componentRef: string | null | undefined,
): ThemeComponentContentCapability | null {
  const manifestContent = themeFiles?.find(
    (file) => file.path === "morph.theme.json",
  )?.content;
  return getThemeComponentContentCapability(manifestContent, componentRef);
}

function isSafeContentUrl(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) return true;
  if (
    normalized.startsWith("/") ||
    normalized.startsWith("./") ||
    normalized.startsWith("../") ||
    normalized.startsWith("#")
  ) {
    return true;
  }
  try {
    const url = new URL(normalized);
    return ["http:", "https:", "mailto:", "tel:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function assertThemeContentFieldValue(
  fieldKey: string,
  definition: ThemeContentFieldDefinition,
  value: unknown,
): void {
  const invalid = (): never => {
    throw new Error(`INVALID_THEME_CONTENT_FIELD_VALUE:${fieldKey}`);
  };

  if (
    definition.type === "text" ||
    definition.type === "textarea" ||
    definition.type === "url"
  ) {
    if (typeof value !== "string") invalid();
    const maxLength =
      definition.maxLength ?? (definition.type === "textarea" ? 10_000 : 500);
    if ((value as string).length > maxLength) invalid();
    if (definition.type === "url" && !isSafeContentUrl(value as string)) {
      invalid();
    }
    return;
  }

  if (definition.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) invalid();
    if (definition.min !== undefined && (value as number) < definition.min)
      invalid();
    if (definition.max !== undefined && (value as number) > definition.max)
      invalid();
    return;
  }

  if (definition.type === "boolean") {
    if (typeof value !== "boolean") invalid();
    return;
  }

  if (definition.type !== "select") invalid();
  if (
    typeof value !== "string" ||
    !definition.options.some((option) => option.value === value)
  ) {
    invalid();
  }
}

export function filterThemeContentProps(
  rawProps: Record<string, unknown>,
  capability: ThemeComponentContentCapability,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [fieldKey, value] of Object.entries(rawProps)) {
    const definition = capability.fields[fieldKey];
    if (!definition) continue;
    assertThemeContentFieldValue(fieldKey, definition, value);
    result[fieldKey] = value;
  }
  return result;
}
