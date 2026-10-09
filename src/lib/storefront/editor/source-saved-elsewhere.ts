/**
 * Where a newer copy of a Theme file can have come from, as the editor names
 * it when this tab's copy turns out to be out of date.
 *
 * "Another tab" alone was wrong once a folder could be linked with
 * `morph-sync` (docs/local-code-sync.md): an edit saved in that folder lands
 * in the workspace the same way, and an author told it came from another tab
 * looks for a tab that does not exist. One phrase, so every notice says the
 * same thing.
 */
export const SOURCE_SAVED_ELSEWHERE = "another tab, another person, or local sync";
