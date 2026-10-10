/**
 * Where a newer copy of a Theme file may have come from, as the editor names
 * it when this tab's copy turns out to be out of date.
 *
 * "Another tab" alone was wrong once a folder could be linked with
 * `morph-sync` (docs/local-code-sync.md): an edit saved in that folder lands
 * in the workspace the same way, and an author told it came from another tab
 * looks for a tab that does not exist. The editor cannot tell which of these
 * it was, so every message offers them as possibilities, never as a finding.
 *
 * A plain string with no imports: the server's refusal message uses it too,
 * and must not pull any UI code in for one phrase.
 */
export const POSSIBLE_SAVE_SOURCES = "another tab, another person, or local sync";
