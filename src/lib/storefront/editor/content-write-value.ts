/**
 * Content on its way to be stored, with anything JSON cannot carry removed.
 *
 * A section's props are stored as JSON and validated against a JSON schema, so
 * a key whose value is `undefined` is not "absent" — it is a value the schema
 * has no member for. The write is refused, and the same check on the preview
 * bridge drops the update without a word, so the canvas quietly keeps showing
 * the old content while the panel shows the new.
 *
 * The obvious source is an optional field that a normaliser fills in as
 * `undefined`, but the invariant belongs here rather than in each of them:
 * every content write passes through this, and a field type added later
 * cannot reintroduce the problem.
 *
 * `undefined` is dropped rather than turned into `null` because the two mean
 * different things to a component: an absent prop takes its declared default,
 * while `null` is a value the author chose.
 */
export function toStorableContentValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    // A hole in a sparse array reads back as `undefined`, so it is filled with
    // `null` — dropping it would renumber every entry after it. Built by index
    // rather than with `map`, which skips holes and would leave them in place.
    return Array.from({ length: value.length }, (_, index) => {
      const item = value[index];
      return item === undefined ? null : toStorableContentValue(item);
    });
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item === undefined) continue;
      result[key] = toStorableContentValue(item);
    }
    return result;
  }
  return value;
}

/** The same, narrowed to a section's props object. */
export function toStorableContentProps(
  props: Record<string, unknown>,
): Record<string, unknown> {
  return toStorableContentValue(props) as Record<string, unknown>;
}
