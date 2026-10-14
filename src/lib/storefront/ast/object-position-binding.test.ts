import { describe, expect, it } from "vitest";
import { STARTER_THEME_V3_NEW_FILES } from "@/lib/storefront/starter-theme-v3-files";
import type { ThemeContentFieldDefinition } from "@/lib/storefront/theme-content-capabilities";
import { resolveObjectPositionTarget } from "./object-position-binding";

const starter = (path: string) =>
  STARTER_THEME_V3_NEW_FILES.find((file) => file.path === path)!.content;

/** The opening tag of the first `<img` in a source, as the preview reports it. */
function imgLocation(source: string, nth = 0) {
  let index = -1;
  for (let i = 0; i <= nth; i += 1) index = source.indexOf("<img", index + 1);
  const before = source.slice(0, index).split("\n");
  return { line: before.length, column: before[before.length - 1]!.length + 1 };
}

const ROW_FIELDS = {
  items: {
    type: "array",
    label: "Items",
    fields: {
      image: { type: "image", label: "Image" },
      imagePosition: { type: "text", label: "Image position", maxLength: 100 },
    },
  },
} as unknown as Record<string, ThemeContentFieldDefinition>;

const TOP_FIELDS = {
  image: { type: "image", label: "Image" },
  imagePosition: { type: "text", label: "Image position", maxLength: 100 },
} as unknown as Record<string, ThemeContentFieldDefinition>;

function resolveRow(
  source: string,
  selectedFieldPath: string | null = "items.1.image",
) {
  return resolveObjectPositionTarget({
    source,
    ...imgLocation(source),
    declaredFields: ROW_FIELDS,
    selectedFieldPath,
  });
}

function resolveTop(
  source: string,
  selectedFieldPath: string | null = "image",
) {
  return resolveObjectPositionTarget({
    source,
    ...imgLocation(source),
    declaredFields: TOP_FIELDS,
    selectedFieldPath,
  });
}

/** A row component in the shape the Starter uses, with one line swapped in. */
function rowSource(
  options: {
    params?: string;
    callback?: string;
    before?: string;
    bodyBefore?: string;
    style?: string;
    extra?: string;
  } = {},
) {
  return `export default function List(${options.params ?? "{ items = [] }"}) {
  ${options.before ?? ""}
  return (
    <div>
      {items.map(${options.callback ?? "(item, index)"} => {
        ${options.bodyBefore ?? ""}
        return (
          <a key={index}>
            <img src={item.image?.src} style={${options.style ?? '{ objectPosition: item.imagePosition ?? "center" }'}} className="size-full object-cover" />
          </a>
        );
      })}
      ${options.extra ?? ""}
    </div>
  );
}`;
}

function topSource(
  options: {
    params?: string;
    before?: string;
    style?: string;
    attributes?: string;
  } = {},
) {
  return `export default function Story(${options.params ?? '{ image, imagePosition = "center" }'}) {
  ${options.before ?? ""}
  return (
    <section>
      <img src={image?.src} style={${options.style ?? "{ objectPosition: imagePosition }"}} ${options.attributes ?? ""} className="size-full object-cover" />
    </section>
  );
}`;
}

describe("the object position control writes the declared field it can prove", () => {
  it("binds the Starter collection rows to items.<row>.imagePosition", () => {
    const source = starter("src/components/CategoryShowcase.tsx");
    const target = resolveObjectPositionTarget({
      source,
      ...imgLocation(source),
      declaredFields: ROW_FIELDS,
      selectedFieldPath: "items.2.image",
    });
    expect(target).toMatchObject({
      kind: "document",
      fieldPath: "items.2.imagePosition",
      fallback: "center",
    });
  });

  it.each([
    ["item.imagePosition", null],
    ["item?.imagePosition", null],
    ['item.imagePosition ?? "top"', "top"],
    ['item?.imagePosition ?? "top"', "top"],
  ])("accepts the row read %s", (read, fallback) => {
    expect(
      resolveRow(rowSource({ style: `{ objectPosition: ${read} }` })),
    ).toEqual(
      expect.objectContaining({
        kind: "document",
        fieldPath: "items.1.imagePosition",
        fallback,
      }),
    );
  });

  it("does not count the names in a props type as uses of the list", () => {
    const typed = `type Row = { imagePosition?: string; image?: { src?: string } };
type ListProps = { items?: Row[] };
${rowSource({ params: "{ items = [] }: ListProps" })}`;
    expect(resolveRow(typed)).toMatchObject({
      kind: "document",
      fieldPath: "items.1.imagePosition",
    });
  });

  it("accepts a top-level prop with a literal default, and one with a literal fallback", () => {
    expect(resolveTop(topSource())).toMatchObject({
      kind: "document",
      fieldPath: "imagePosition",
      fallback: "center",
    });
    expect(
      resolveTop(
        topSource({
          params: "{ image, imagePosition }",
          style: '{ objectPosition: imagePosition ?? "top" }',
        }),
      ),
    ).toMatchObject({
      kind: "document",
      fieldPath: "imagePosition",
      fallback: "top",
    });
  });

  it("does not let an object-fit class count as a position conflict", () => {
    const source = rowSource().replace(
      "object-cover",
      "object-contain object-cover",
    );
    expect(resolveRow(source)).toMatchObject({ kind: "document" });
  });
});

describe("the object position control is unavailable where it cannot prove the field", () => {
  it("leaves the Starter story image alone: its position prop is not declared", () => {
    const source = starter("src/components/ImageWithText.tsx");
    expect(
      resolveObjectPositionTarget({
        source,
        ...imgLocation(source),
        declaredFields: { image: { type: "image", label: "Image" } } as never,
        selectedFieldPath: "image",
      }),
    ).toEqual({ kind: "unavailable", reason: "field-not-declared" });
  });

  it("leaves an image with no inline position alone (class edits are not proven yet)", () => {
    const source = rowSource().replace(/ style=\{[^}]*\}\}/, "");
    expect(resolveRow(source)).toEqual({
      kind: "unavailable",
      reason: "no-inline-position",
    });
  });

  it.each([
    ["the row parameter reassigned", { bodyBefore: "item = { ...item };" }],
    ["the field written", { bodyBefore: 'item.imagePosition = "top";' }],
    ["the field deleted", { bodyBefore: "delete item.imagePosition;" }],
    [
      "the row handed to Object.assign",
      { bodyBefore: "Object.assign(item, {});" },
    ],
    [
      "the row handed to an unknown function",
      { bodyBefore: "normalize(item);" },
    ],
    ["a method called on the row", { bodyBefore: "item.reset();" }],
    ["the row aliased", { bodyBefore: "const it = item;" }],
    [
      "a field destructured off the row",
      { bodyBefore: "const { imagePosition } = item;" },
    ],
    [
      "the row name redeclared inside",
      { bodyBefore: "{ const item = other; }" },
    ],
    [
      "a destructured row parameter",
      { callback: "({ imagePosition }, index)" },
    ],
    ["the list reassigned", { before: "items = items.slice();" }],
    ["the list sorted", { before: "items.sort();" }],
    ["the list reversed", { before: "items.reverse();" }],
    ["the list spliced", { before: "items.splice(0, 1);" }],
    ["the list pushed to", { before: "items.push({});" }],
    ["the list handed to an unknown function", { before: "normalize(items);" }],
    ["the list read for another purpose", { extra: "{items.length}" }],
    ["the list iterated with forEach", { before: "items.forEach(mutate);" }],
    ["the list aliased", { before: "const rows = items;" }],
    [
      "a second map that writes rows",
      {
        extra:
          '{items.map((row) => { row.imagePosition = "x"; return null; })}',
      },
    ],
    [
      "the list declared twice",
      { before: "function other(items) { return items; }" },
    ],
    [
      "the list read off props",
      { params: "props", before: "const items = props.items;" },
    ],
  ])("refuses %s", (_name, options) => {
    expect(resolveRow(rowSource(options))).toEqual({
      kind: "unavailable",
      reason: "binding-unproven",
    });
  });

  it.each([
    ["`||`", '{ objectPosition: item.imagePosition || "center" }'],
    [
      "a non-literal fallback",
      "{ objectPosition: item.imagePosition ?? defaults.position }",
    ],
    [
      "a conditional",
      '{ objectPosition: item.imagePosition ? item.imagePosition : "center" }',
    ],
    ["a template", "{ objectPosition: `${item.imagePosition}` }"],
    ["a call", "{ objectPosition: position(item) }"],
    ["a computed key", '{ objectPosition: item["imagePosition"] }'],
    ["a nested read", "{ objectPosition: item.image.position }"],
    [
      "a spread in the style",
      "{ ...item.style, objectPosition: item.imagePosition }",
    ],
    ["a style object from elsewhere", "styles"],
    [
      "two positions",
      "{ objectPosition: item.imagePosition, ['objectPosition']: 'top' }",
    ],
  ])("refuses %s as the position", (_name, style) => {
    expect(resolveRow(rowSource({ style }))).toMatchObject({
      kind: "unavailable",
    });
  });

  it("refuses an element that also takes a spread", () => {
    expect(resolveTop(topSource({ attributes: "{...rest}" }))).toEqual({
      kind: "unavailable",
      reason: "position-not-a-field-read",
    });
  });

  it.each([
    ["reassigned", 'imagePosition = "top";'],
    ["aliased", "const position = imagePosition;"],
    ["handed to a function", "track(imagePosition);"],
    [
      "declared again",
      'function x() { const imagePosition = "top"; return imagePosition; }',
    ],
  ])("refuses a top-level prop that is %s", (_name, before) => {
    expect(resolveTop(topSource({ before }))).toEqual({
      kind: "unavailable",
      reason: "binding-unproven",
    });
  });

  it("refuses a top-level default that is not a literal", () => {
    expect(
      resolveTop(
        topSource({ params: "{ image, imagePosition = DEFAULT_POSITION }" }),
      ),
    ).toEqual({ kind: "unavailable", reason: "position-not-a-field-read" });
  });

  it("refuses a position read in a helper inside the row", () => {
    const source = rowSource({
      bodyBefore:
        "const Img = () => <img src={item.image?.src} style={{ objectPosition: item.imagePosition }} />;",
    });
    // The first <img> is the helper's: drawn by a function the map does not own.
    expect(resolveRow(source)).toMatchObject({ kind: "unavailable" });
  });

  it("refuses a row read that is not the selected list's row", () => {
    expect(resolveRow(rowSource(), "image")).toEqual({
      kind: "unavailable",
      reason: "row-unconfirmed",
    });
    expect(resolveRow(rowSource(), "other.1.image")).toEqual({
      kind: "unavailable",
      reason: "row-unconfirmed",
    });
    expect(resolveRow(rowSource(), null)).toEqual({
      kind: "unavailable",
      reason: "row-unconfirmed",
    });
  });

  it("refuses a top-level read when the selection is a row", () => {
    expect(resolveTop(topSource(), "items.0.image")).toEqual({
      kind: "unavailable",
      reason: "row-unconfirmed",
    });
  });

  it("refuses when the declared field is not text or select", () => {
    expect(
      resolveObjectPositionTarget({
        source: topSource(),
        ...imgLocation(topSource()),
        declaredFields: {
          image: { type: "image", label: "Image" },
          imagePosition: { type: "image", label: "Image position" },
        } as never,
        selectedFieldPath: "image",
      }),
    ).toEqual({ kind: "unavailable", reason: "field-not-declared" });
  });

  it("refuses a location that is not an element in this source", () => {
    expect(
      resolveObjectPositionTarget({
        source: topSource(),
        line: 1,
        column: 1,
        declaredFields: TOP_FIELDS,
        selectedFieldPath: "image",
      }),
    ).toEqual({ kind: "unavailable", reason: "source-unreadable" });
  });
});
// A destructuring assignment writes every name in its pattern: `[item] = …`
// replaces the row as surely as `item = …`, and `({ x: item.imagePosition } =
// …)` writes the field. Each is a write the binding must refuse.
describe("the object position control refuses writes made by destructuring", () => {
  it.each([
    [
      "the row replaced by an array pattern",
      { bodyBefore: "[item] = others;" },
    ],
    [
      "the row replaced by an object pattern",
      { bodyBefore: "({ item } = holder);" },
    ],
    [
      "the field written by an object pattern",
      { bodyBefore: "({ position: item.imagePosition } = defaults);" },
    ],
    [
      "the field written by an array pattern",
      { bodyBefore: '[item.imagePosition] = ["top"];' },
    ],
    [
      "the field written by a nested pattern default",
      { bodyBefore: '({ a: [item.imagePosition = "top"] } = source);' },
    ],
    [
      "the row replaced in a for-of pattern",
      { bodyBefore: "for ([item] of pairs) {}" },
    ],
    ["the list replaced by an array pattern", { before: "[items] = [other];" }],
    [
      "the list replaced by an object pattern",
      { before: "({ items } = other);" },
    ],
    ["the list replaced by a rest pattern", { before: "[...items] = other;" }],
  ])("refuses %s", (_name, options) => {
    expect(resolveRow(rowSource(options))).toEqual({
      kind: "unavailable",
      reason: "binding-unproven",
    });
  });

  it.each([
    ["an array pattern", '[imagePosition] = ["top"];'],
    ["an object pattern", "({ imagePosition } = other);"],
    ["a renamed object pattern", "({ position: imagePosition } = other);"],
    ["a pattern default", '[imagePosition = "top"] = [];'],
  ])("refuses a top-level prop rewritten by %s", (_name, before) => {
    expect(resolveTop(topSource({ before }))).toEqual({
      kind: "unavailable",
      reason: "binding-unproven",
    });
  });
});
