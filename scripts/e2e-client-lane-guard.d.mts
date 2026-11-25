/**
 * Types for the parts of the client lane's guard that the seed
 * (`scripts/client-lane-theme/seed.ts`), the spec helper
 * (`e2e/helpers/client-lane-theme.ts`) and their tests read. Plain JavaScript
 * because the runner is.
 */
export declare const CLIENT_LANE_THEMES_VAR: "MORPH_E2E_CLIENT_LANE_THEMES";
export declare const CLIENT_LANE_USES_VAR: "MORPH_E2E_CLIENT_LANE_USES";
export declare const CLIENT_LANE_STARTER_VERSION: 31;
export declare const CLIENT_LANE_STARTER_FIXTURE: string;

export type ClientLaneSlot =
  | "editor"
  | "selection-field/typing"
  | "selection-field/adopting"
  | "selection-field/adopted-after-move"
  | "selection-field/return-paths"
  | "selection-field/keyboard-append-1"
  | "selection-field/keyboard-append-2";

export declare const CLIENT_LANE_THEME_SLOTS: readonly ClientLaneSlot[];

export type FileDigest = {
  path: string;
  mimeType: unknown;
  encoding: unknown;
  isEntry: boolean;
  sha256: string;
};

export declare function contentSha256(content: string): string;
export declare function fixtureFileDigests(fixtureText: string): FileDigest[];
export declare function readFixtureFileDigests(root?: string): FileDigest[];
export declare function clientLaneThemeRefusal(
  theme: unknown,
  expected: readonly FileDigest[],
): string | null;
export declare function clientLaneEditorPath(theme: {
  storefrontId: string;
  themeId: string;
  indexTemplateId: string;
}): string;
