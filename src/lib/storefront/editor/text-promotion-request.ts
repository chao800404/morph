/**
 * What the Content tab asks for when the author makes fixed text editable,
 * and what it hears back.
 *
 * `shared` is not a failure: the component reaches more than this section,
 * and the author chooses between a copy for this page — the default — and
 * changing the shared component after reading everything it reaches.
 */

export type TextPromotionRequest = Readonly<{
  sectionId: string;
  componentSourcePath: string;
  targetKey: string;
  fieldName: string;
  value: string;
  confirmedImpact?: readonly string[];
}>;

export type TextPromotionOutcome =
  | Readonly<{ status: "promoted"; fieldName: string }>
  | Readonly<{ status: "shared"; impact: readonly string[] }>
  | Readonly<{ status: "failed"; message: string }>;
