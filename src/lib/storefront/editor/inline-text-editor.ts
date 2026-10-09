import {
  INLINE_TEXT_EDIT_MAX_LENGTH,
  inlineTextMatchesStoredValue,
  isInlineTextEditCandidate,
  normalizeInlineTextEditValue,
  shouldNormalizeInlineTextInput,
} from "./inline-text-edit";
import { PREVIEW_EMPTY_TEXT_LINE_ATTRIBUTE } from "./preview-empty-text-layout";
import type { SelectionKind } from "./selection-taxonomy";

/**
 * Editing a field by typing into the page it is rendered on.
 *
 * Extracted from the preview route because a real React preview has to offer
 * the same thing, and the details are where the behaviour lives: what is
 * committed is text rather than the markup a browser invents while editing,
 * an abandoned edit puts the original nodes back rather than a flattened
 * string of them, and a composition in progress is never interrupted.
 *
 * It owns the edit and nothing else. What to do with a committed value, and
 * what needs repositioning when the text changes size, are the caller's.
 */

export type InlineEditTarget = Readonly<{
  element: HTMLElement;
  kind: SelectionKind;
  section: HTMLElement | null;
  sectionId: string | null;
  fieldKey: string | null;
  fieldPath: string | null;
  descendantFields: readonly unknown[];
}>;

export type InlineTextCommit = Readonly<{
  sectionId: string;
  fieldKey: string;
  fieldPath: string;
  value: string;
  /** The text the edit started from, which `begin` matched to the stored value. */
  originalValue: string;
}>;

export type InlineTextEditor = Readonly<{
  /** Returns false when this element is not something that can be typed into. */
  begin(
    target: InlineEditTarget,
    options: { selectionEnabled: boolean },
  ): boolean;
  finish(commit: boolean): void;
  /** The element being edited, so a caller can leave its own handling alone. */
  editingElement(): HTMLElement | null;
  isComposing(): boolean;
}>;

export function createInlineTextEditor({
  onCommit,
  onLayoutChanged,
  storedValue,
  onRefused,
}: {
  onCommit: (commit: InlineTextCommit) => void;
  /** Editing changes how much room the text takes; overlays follow it. */
  onLayoutChanged: () => void;
  /**
   * The value the page's content holds for the target's field, as the page
   * was rendered from it. Editing starts only when the text on the canvas is
   * exactly that value (`inlineTextMatchesStoredValue`). A caller that cannot
   * say gets no inline editing at all.
   */
  storedValue?: (target: InlineEditTarget) => unknown;
  /**
   * A double click landed on text bound to a field, and it is not the stored
   * value, so it cannot be typed over. The author is told where to edit it.
   */
  onRefused?: (target: InlineEditTarget) => void;
}): InlineTextEditor {
  let inlineTextEdit: {
    element: HTMLElement;
    item: InlineEditTarget;
    originalValue: string;
    /**
     * The nodes the page rendered, by reference, with each text node's data.
     *
     * Put back when the edit ends, so the framework that rendered them still
     * owns what is on the page: replacing them with copies or a fresh text
     * node leaves it updating nodes that are no longer attached, and the
     * canvas keeps the edited text whatever the content renders next.
     */
    originalChildren: Node[];
    originalTexts: Map<Node, string>;
    previousContentEditable: string | null;
    previousSpellcheck: string | null;
    isComposing: boolean;
    abortController: AbortController;
  } | null = null;

  /**
   * The element's text as the DOM holds it.
   *
   * Not `innerText`: that applies CSS, so an `uppercase` heading reads in
   * capitals. It would never match the stored value, and an edit would store
   * the capitals. Line breaks typed while editing still count: a `br` that is
   * not the last thing in its line, and a block the browser wrapped a line in.
   */
  const plainText = (element: HTMLElement): string => {
    let text = "";
    const walk = (parent: Node) => {
      const children = Array.from(parent.childNodes);
      children.forEach((child, index) => {
        if (child.nodeType === 3) {
          text += child.textContent ?? "";
        } else if (child.nodeName === "BR") {
          if (index < children.length - 1) text += "\n";
        } else {
          if (
            (child.nodeName === "DIV" || child.nodeName === "P") &&
            text !== ""
          ) {
            text += "\n";
          }
          walk(child);
        }
      });
    };
    walk(element);
    return text;
  };
  const editableElementText = (element: HTMLElement) =>
    normalizeInlineTextEditValue(plainText(element));

  const finish = (commit: boolean) => {
    const edit = inlineTextEdit;
    if (!edit) return;
    inlineTextEdit = null;
    edit.abortController.abort();

    // The page rendered again under the edit (a hot update, a route reload,
    // a remount) and the element left it. What is on the page now is the
    // framework's: putting the old nodes back would hide it, and what was
    // typed belongs to a rendering that no longer exists. Nothing is saved.
    if (!edit.element.isConnected) {
      onLayoutChanged();
      return;
    }

    const editedValue = editableElementText(edit.element);
    const value = commit ? editedValue : edit.originalValue;
    const childNodes = Array.from(edit.element.childNodes);
    const childrenReplaced =
      childNodes.length !== edit.originalChildren.length ||
      childNodes.some((node, index) => node !== edit.originalChildren[index]);
    // The page goes back to what it rendered, committed or not. A committed
    // value reaches the page the way every content change does, through the
    // Theme's own rendering: the text typed here is not what `content()` may
    // make of it, and the editor may still refuse the write.
    if (editedValue !== edit.originalValue || childrenReplaced) {
      for (const [node, data] of edit.originalTexts) node.textContent = data;
      edit.element.replaceChildren(...edit.originalChildren);
    }
    edit.element.removeAttribute("data-storefront-editor-inline-editing");
    if (edit.previousContentEditable === null) {
      edit.element.removeAttribute("contenteditable");
    } else {
      edit.element.setAttribute(
        "contenteditable",
        edit.previousContentEditable,
      );
    }
    if (edit.previousSpellcheck === null) {
      edit.element.removeAttribute("spellcheck");
    } else {
      edit.element.setAttribute("spellcheck", edit.previousSpellcheck);
    }

    onLayoutChanged();
    if (
      commit &&
      value !== edit.originalValue &&
      edit.item.sectionId &&
      edit.item.fieldKey &&
      edit.item.fieldPath
    ) {
      onCommit({
        sectionId: edit.item.sectionId,
        fieldKey: edit.item.fieldKey,
        fieldPath: edit.item.fieldPath,
        value,
        originalValue: edit.originalValue,
      });
    }
  };

  const insertPlainTextAtSelection = (text: string) => {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  };

  const normalizeEditableElement = (element: HTMLElement) => {
    const raw = plainText(element);
    const value = normalizeInlineTextEditValue(raw);
    // The persisted contract is text, never the markup a browser invents
    // while editing (`div`, `br`, or pasted HTML in older engines).
    const hasMarkup = Array.from(element.childNodes).some(
      (node) => node.nodeType !== 3,
    );
    if (raw !== value || hasMarkup) {
      element.textContent = value;
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    onLayoutChanged();
  };

  const begin = (
    item: InlineEditTarget,
    options: { selectionEnabled: boolean },
  ) => {
    const kind = item.kind;
    if (
      !isInlineTextEditCandidate({
        selectionEnabled: options.selectionEnabled,
        kind,
        sectionId: item.sectionId,
        fieldKey: item.fieldKey,
        fieldPath: item.fieldPath,
        descendantFieldCount: item.descendantFields.length,
        isSection: item.element === item.section,
      })
    ) {
      return false;
    }
    // Rendered text that is not the stored value cannot be typed over: what
    // was typed would be saved in its place (see the predicate).
    if (
      !inlineTextMatchesStoredValue(
        editableElementText(item.element),
        storedValue?.(item),
      )
    ) {
      onRefused?.(item);
      return false;
    }

    finish(false);
    const element = item.element;
    const originalValue = editableElementText(element);
    const abortController = new AbortController();
    const originalChildren = Array.from(element.childNodes);
    inlineTextEdit = {
      element,
      item,
      originalValue,
      originalChildren,
      originalTexts: new Map(
        originalChildren
          .filter((node) => node.nodeType === 3)
          .map((node): [Node, string] => [node, node.textContent ?? ""]),
      ),
      previousContentEditable: element.getAttribute("contenteditable"),
      previousSpellcheck: element.getAttribute("spellcheck"),
      isComposing: false,
      abortController,
    };

    element.setAttribute("data-storefront-editor-inline-editing", "true");
    element.removeAttribute(PREVIEW_EMPTY_TEXT_LINE_ATTRIBUTE);
    element.setAttribute("contenteditable", "plaintext-only");
    element.setAttribute("spellcheck", "true");

    element.addEventListener(
      "compositionstart",
      () => {
        if (inlineTextEdit?.element === element)
          inlineTextEdit.isComposing = true;
      },
      { signal: abortController.signal },
    );
    element.addEventListener(
      "compositionend",
      () => {
        if (inlineTextEdit?.element === element) {
          inlineTextEdit.isComposing = false;
          normalizeEditableElement(element);
        }
      },
      { signal: abortController.signal },
    );
    for (const eventName of ["pointerdown", "click", "dblclick"] as const) {
      element.addEventListener(eventName, (event) => event.stopPropagation(), {
        signal: abortController.signal,
      });
    }
    element.addEventListener(
      "keydown",
      (event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          finish(false);
          return;
        }
        if (
          event.key === "Enter" &&
          !event.shiftKey &&
          !event.isComposing &&
          !inlineTextEdit?.isComposing
        ) {
          event.preventDefault();
          finish(true);
        }
      },
      { capture: true, signal: abortController.signal },
    );
    element.addEventListener(
      "paste",
      (event) => {
        event.preventDefault();
        event.stopPropagation();
        const remaining = Math.max(
          0,
          INLINE_TEXT_EDIT_MAX_LENGTH - editableElementText(element).length,
        );
        insertPlainTextAtSelection(
          normalizeInlineTextEditValue(
            event.clipboardData?.getData("text/plain") ?? "",
          ).slice(0, remaining),
        );
        onLayoutChanged();
      },
      { signal: abortController.signal },
    );
    element.addEventListener(
      "input",
      (event) => {
        if (
          !shouldNormalizeInlineTextInput(
            inlineTextEdit?.isComposing ?? false,
            event instanceof InputEvent && event.isComposing,
          )
        ) {
          // Replacing textContent during an active composition destroys the
          // browser's marked range and drops partially composed CJK text.
          onLayoutChanged();
          return;
        }
        normalizeEditableElement(element);
      },
      { signal: abortController.signal },
    );
    element.addEventListener("blur", () => finish(true), {
      signal: abortController.signal,
    });

    element.focus({ preventScroll: true });
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection?.removeAllRanges();
    selection?.addRange(range);
    onLayoutChanged();
    return true;
  };
  return {
    begin,
    finish,
    editingElement: () => inlineTextEdit?.element ?? null,
    isComposing: () => inlineTextEdit?.isComposing ?? false,
  };
}
