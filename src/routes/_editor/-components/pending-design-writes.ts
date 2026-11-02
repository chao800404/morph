/**
 * What each pending Design write of a file was, kept with the text it wrote.
 *
 * A Design write that does not land at once (a source conflict, a pause, an
 * unanswered send) stays in the workspace, and is sent again later — by Save
 * my changes, a resume, a check of an unanswered save, or Code saving the
 * file. Sent again, it must go as the operation it was (a Design element
 * edit, a code default, a section structure edit), for the server or the
 * structure lock to judge it again, never as a plain save of its text.
 *
 * Kept free of React and of the server, beside `theme-file-save-queue`, so
 * the rules about who owns a record and when it ends can be stated as tests.
 */
import type { DesignElementOperation } from "@/lib/storefront/compiler/design-element-operation";
import type { CodeDefaultWriteProof } from "@/lib/validations/storefront-theme-file";

export type PendingDesignOrigin =
  | { kind: "structure-edit" }
  | { kind: "design-element"; designElement: DesignElementOperation }
  | { kind: "code-default"; codeDefault: CodeDefaultWriteProof };

export type PendingDesignWrite = Readonly<{
  content: string;
  origin: PendingDesignOrigin;
  /** The save-queue revision of the send that recorded it. */
  revision: number;
}>;

/** Who is sending a file's text, as far as its pending Design write goes. */
export type PendingDesignSender = {
  /** The operation the caller names for this send, if any. */
  origin: PendingDesignOrigin | null;
  /**
   * The author changed this file in Code mode, typing in it, and Code is
   * saving that. Code saving text it did not get from the author is not.
   */
  codeEdit?: boolean;
  /**
   * The author takes the file over in Code (Keep Mine): its text goes as a
   * plain save even if a Design write wrote it.
   */
  codeOverwrite?: boolean;
};

/**
 * How a send of a file's text goes:
 * - `plain`: no Design write of the file is pending; an ordinary save.
 * - `operation`: as this operation — the one the sender names, or the
 *   pending write whose very text this is, sent again.
 * - `code`: the author's own text in Code (a rewrite, or Keep Mine); a plain
 *   save that ends the pending write.
 * - `held`: other text on top of a pending Design write, from a sender that
 *   is not the author in Code. Sent as a plain save it would carry the
 *   Design write's change unchecked, so it is not sent: the draft is kept
 *   until the pending write is settled.
 */
export type PendingDesignVerdict =
  | { kind: "plain" }
  | { kind: "operation"; origin: PendingDesignOrigin }
  | { kind: "code" }
  | { kind: "held"; pending: PendingDesignWrite };

export type PendingDesignWrites = {
  verdict: (
    path: string,
    content: string,
    sender: PendingDesignSender,
  ) => PendingDesignVerdict;
  /**
   * Records a send once its revision is claimed: an operation owns the
   * record; the author's own text in Code ends it. Never called for `held`.
   */
  sent: (
    path: string,
    content: string,
    verdict: PendingDesignVerdict,
    revision: number,
  ) => void;
  /** A send landed: its own record ends, never a newer send's. */
  landed: (path: string, revision: number) => void;
  /** What the server holds was found to be this text: its record ends. */
  heldByServer: (path: string, content: string) => void;
  get: (path: string) => PendingDesignWrite | undefined;
  /** Every pending write's text, by path: what Code's save-all must leave. */
  texts: () => Map<string, string>;
};

export function createPendingDesignWrites(): PendingDesignWrites {
  const records = new Map<string, PendingDesignWrite>();
  return {
    verdict: (path, content, sender) => {
      if (sender.origin) return { kind: "operation", origin: sender.origin };
      if (sender.codeOverwrite) return { kind: "code" };
      const pending = records.get(path);
      if (!pending) return { kind: "plain" };
      if (pending.content === content) {
        return { kind: "operation", origin: pending.origin };
      }
      return sender.codeEdit ? { kind: "code" } : { kind: "held", pending };
    },
    sent: (path, content, verdict, revision) => {
      if (verdict.kind === "operation") {
        records.set(path, { content, origin: verdict.origin, revision });
      } else if (verdict.kind === "code") {
        records.delete(path);
      }
    },
    landed: (path, revision) => {
      if (records.get(path)?.revision === revision) records.delete(path);
    },
    heldByServer: (path, content) => {
      if (records.get(path)?.content === content) records.delete(path);
    },
    get: (path) => records.get(path),
    texts: () =>
      new Map(
        Array.from(records, ([path, pending]) => [path, pending.content]),
      ),
  };
}

/** The save options that send `origin` again as itself. */
export function saveOptionsForOrigin(origin: PendingDesignOrigin): {
  structureEdit?: boolean;
  operation?: "code-default" | "design-element";
  designElement?: DesignElementOperation;
  codeDefault?: CodeDefaultWriteProof;
} {
  switch (origin.kind) {
    case "structure-edit":
      return { structureEdit: true };
    case "design-element":
      return {
        operation: "design-element",
        designElement: origin.designElement,
      };
    case "code-default":
      return { operation: "code-default", codeDefault: origin.codeDefault };
  }
}
