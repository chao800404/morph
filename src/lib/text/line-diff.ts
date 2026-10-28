export type LineDiffRow = {
  kind: "same" | "added" | "removed";
  text: string;
};

/** Past this many line pairs the table is not built; callers show both texts. */
export const LINE_DIFF_MAX_CELLS = 2_000_000;

function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * The lines one text keeps, drops and gains against another, in order. A
 * longest-common-subsequence table, which is plenty for files a person reads
 * in a dialog. Null when the texts are too long for that, so nothing is
 * shown that only looks like a diff.
 */
export function diffLines(before: string, after: string): LineDiffRow[] | null {
  const a = splitLines(before);
  const b = splitLines(after);
  if ((a.length + 1) * (b.length + 1) > LINE_DIFF_MAX_CELLS) return null;

  const width = b.length + 1;
  const lcs = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i * width + j] =
        a[i] === b[j]
          ? lcs[(i + 1) * width + j + 1] + 1
          : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    }
  }

  const rows: LineDiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      rows.push({ kind: "same", text: a[i] });
      i += 1;
      j += 1;
    } else if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) {
      rows.push({ kind: "removed", text: a[i] });
      i += 1;
    } else {
      rows.push({ kind: "added", text: b[j] });
      j += 1;
    }
  }
  for (; i < a.length; i += 1) rows.push({ kind: "removed", text: a[i] });
  for (; j < b.length; j += 1) rows.push({ kind: "added", text: b[j] });
  return rows;
}
