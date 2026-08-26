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

/** Every field a repeated row may contain. Rows hold values, never more rows. */
const scalarContentFieldSchema = z.discriminatedUnion("type", [
  textContentFieldSchema,
  textareaContentFieldSchema,
  urlContentFieldSchema,
  numberContentFieldSchema,
  booleanContentFieldSchema,
  selectContentFieldSchema,
]);

/** A field that holds one value, which is everything a row may contain. */
export type ThemeScalarContentFieldDefinition = z.infer<
  typeof scalarContentFieldSchema
>;

/** Narrows a definition to the kind a row may contain. */
export function isScalarContentField(
  definition: ThemeContentFieldDefinition,
): definition is ThemeScalarContentFieldDefinition {
  return definition.type !== "array";
}

export const MAX_ARRAY_CONTENT_FIELD_ROWS = 200;

/**
 * A repeated group of fields — the shape behind a list of cards, principles or
 * FAQ entries.
 *
 * Rows are declared as an object keyed by field name, the same way the top
 * level is, so one nesting level reads identically to none.
 *
 * A row may not itself contain an array. Sanity forbids the same thing and
 * recommends wrapping a nested list in an object instead; the reason is that a
 * multidimensional list cannot be presented so an editor can tell which level
 * they are editing. Morph has less need for it than a pure CMS besides: layout
 * nesting belongs in the component's TSX, not in its content shape. The row
 * shape is already an object, so allowing one later is a depth check, not a
 * redesign.
 */
/** Import specifier naming the component one row is rendered by. */
const rowComponentSpecifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^\.{1,2}\/[A-Za-z0-9._\/-]+$/, {
    message: "of must be a relative path to a component in this Theme",
  })
  .refine((value) => !value.includes(".."), {
    message: "of must not leave the Theme workspace",
  });

const arrayContentFieldSchema = z
  .object({
    type: z.literal("array"),
    label: fieldLabelSchema,
    description: fieldDescriptionSchema,
    /**
     * Row shape declared here, for rows rendered inline in the same file.
     * Mutually exclusive with `of`.
     */
    fields: z
      .record(contentFieldKeySchema, scalarContentFieldSchema)
      .refine((fields) => Object.keys(fields).length > 0, {
        message: "array fields must declare at least one row field",
      })
      .refine(
        (fields) => Object.keys(fields).length <= MAX_COMPONENT_CONTENT_FIELDS,
        {
          message: `array fields must declare at most ${MAX_COMPONENT_CONTENT_FIELDS} row fields`,
        },
      )
      .optional(),
    /**
     * Row shape taken from the component that renders one row, for rows
     * extracted into their own file. The component keeps its own declaration
     * and nothing has to be repeated here.
     */
    of: rowComponentSpecifierSchema.optional(),
    minRows: z.number().int().min(0).max(MAX_ARRAY_CONTENT_FIELD_ROWS).optional(),
    maxRows: z.number().int().min(1).max(MAX_ARRAY_CONTENT_FIELD_ROWS).optional(),
  })
  .strict()
  .refine(
    (field) =>
      field.minRows === undefined ||
      field.maxRows === undefined ||
      field.minRows <= field.maxRows,
    { message: "minRows must be less than or equal to maxRows" },
  )
  // Exactly one source for the row shape. Accepting both would leave which one
  // wins to be discovered by experiment, and accepting neither would describe
  // a list whose rows have no fields.
  .refine(
    (field) => Boolean(field.fields) !== Boolean(field.of),
    { message: "array fields must declare either fields or of, not both" },
  );

export const themeContentFieldDefinitionSchema = z.union([
  scalarContentFieldSchema,
  arrayContentFieldSchema,
]);

export type ThemeArrayContentFieldDefinition = z.infer<
  typeof arrayContentFieldSchema
>;

/**
 * Row fields of a repeated field, once its shape is known.
 *
 * `of` is resolved to concrete fields when capabilities are read from the
 * workspace, so anything downstream sees one shape. `null` means the shape was
 * never resolved — the referenced component is missing or declares nothing —
 * and the caller must treat the field as uneditable rather than as empty.
 */
export function arrayRowFields(
  definition: ThemeArrayContentFieldDefinition,
): Record<string, ThemeScalarContentFieldDefinition> | null {
  return definition.fields ?? null;
}

/** Narrows a definition to the repeated kind without re-parsing it. */
export function isArrayContentField(
  definition: ThemeContentFieldDefinition | undefined | null,
): definition is ThemeArrayContentFieldDefinition {
  return definition?.type === "array";
}

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

  if (definition.type === "array") {
    if (!Array.isArray(value)) invalid();
    const rows = value as unknown[];
    if (rows.length > MAX_ARRAY_CONTENT_FIELD_ROWS) invalid();
    if (definition.minRows !== undefined && rows.length < definition.minRows) {
      invalid();
    }
    if (definition.maxRows !== undefined && rows.length > definition.maxRows) {
      invalid();
    }
    const rowFields = arrayRowFields(definition);
    // A list whose row shape never resolved cannot be validated, so nothing may
    // be written to it. Accepting the value unchecked would be the one path
    // that reaches storage without a schema behind it.
    if (!rowFields) invalid();
    for (const [index, row] of rows.entries()) {
      if (typeof row !== "object" || row === null || Array.isArray(row)) {
        invalid();
      }
      const entries = Object.entries(row as Record<string, unknown>);
      for (const [rowKey, rowValue] of entries) {
        // Platform-managed: the row's identity is what instance styles and
        // reordering are keyed by, so it is carried rather than declared.
        if (rowKey === ROW_IDENTITY_KEY) {
          if (typeof rowValue !== "string" || rowValue.length > 200) invalid();
          continue;
        }
        const rowDefinition = rowFields![rowKey];
        // An undeclared key is dropped by the filter, not rejected here: a row
        // may still carry runtime data the Design surface never writes.
        if (!rowDefinition) continue;
        assertThemeContentFieldValue(
          `${fieldKey}.${index}.${rowKey}`,
          rowDefinition,
          rowValue,
        );
      }
    }
    return;
  }

  if (definition.type !== "select") invalid();
  if (
    typeof value !== "string" ||
    !(definition as { options: { value: string }[] }).options.some(
      (option) => option.value === value,
    )
  ) {
    invalid();
  }
}

/** Key a repeated row carries its stable identity under. */
export const ROW_IDENTITY_KEY = "id";

/**
 * Keeps only the declared row fields, plus the row's own identity.
 *
 * Undeclared keys are dropped rather than rejected so a row can still carry
 * data the Design surface never writes, exactly as the top level does.
 */
function filterRow(
  row: Record<string, unknown>,
  definition: ThemeArrayContentFieldDefinition,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const rowFields = arrayRowFields(definition) ?? {};
  const identity = row[ROW_IDENTITY_KEY];
  if (typeof identity === "string") result[ROW_IDENTITY_KEY] = identity;
  for (const [rowKey, rowValue] of Object.entries(row)) {
    if (rowKey === ROW_IDENTITY_KEY) continue;
    if (!rowFields[rowKey]) continue;
    result[rowKey] = rowValue;
  }
  return result;
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
    result[fieldKey] = isArrayContentField(definition)
      ? (value as Record<string, unknown>[]).map((row) =>
          filterRow(row, definition),
        )
      : value;
  }
  return result;
}
