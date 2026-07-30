import { describe, expect, it } from "vitest";
import {
  parseMetadataEntries,
  serializeMetadataEntries,
} from "./metadata-field";

/**
 * Metadata travels as a JSON object string, so the two ends of that transport
 * are where it can silently lose data.
 */
describe("parseMetadataEntries", () => {
  it("reads an object into ordered pairs", () => {
    expect(parseMetadataEntries('{"a":"1","b":"2"}')).toEqual([
      { key: "a", value: "1" },
      { key: "b", value: "2" },
    ]);
  });

  it("shows a non-string value as JSON rather than dropping it", () => {
    // An import or a direct API call can write numbers, booleans or objects;
    // rendering those as `[object Object]` would look like an empty field.
    expect(parseMetadataEntries('{"n":42,"o":{"x":1}}')).toEqual([
      { key: "n", value: "42" },
      { key: "o", value: '{"x":1}' },
    ]);
  });

  it("returns nothing for input that is not a JSON object", () => {
    expect(parseMetadataEntries(undefined)).toEqual([]);
    expect(parseMetadataEntries("")).toEqual([]);
    expect(parseMetadataEntries("not json")).toEqual([]);
    expect(parseMetadataEntries('["a"]')).toEqual([]);
    expect(parseMetadataEntries("null")).toEqual([]);
  });
});

describe("serializeMetadataEntries", () => {
  it("drops blank keys", () => {
    expect(
      serializeMetadataEntries([
        { key: "a", value: "1" },
        { key: "  ", value: "ignored" },
      ]),
    ).toBe('{"a":"1"}');
  });

  it("keeps the last value when a key repeats", () => {
    // An object cannot hold both; keeping the first would contradict the row
    // the editor shows last.
    expect(
      serializeMetadataEntries([
        { key: "a", value: "first" },
        { key: "a", value: "second" },
      ]),
    ).toBe('{"a":"second"}');
  });

  it("round-trips through parse", () => {
    const entries = [{ key: "supplier", value: "acme" }];
    expect(parseMetadataEntries(serializeMetadataEntries(entries))).toEqual(
      entries,
    );
  });
});
