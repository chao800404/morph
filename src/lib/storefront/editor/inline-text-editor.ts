import {
  INLINE_TEXT_EDIT_MAX_LENGTH,
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
}: {
  onCommit: (commit: InlineTextCommit) => void;
  /** Editing changes how much room the text takes; overlays follow it. */
  onLayoutChanged: () => void;
}): InlineTextEditor {
  let inlineTextEdit: {
    element: HTMLElement;
    item: InlineEditTarget;
    originalValue: string;
    originalChildren: Node[];
    previousContentEditable: string | null;
    previousSpellcheck: string | null;
    isComposing: boolean;
    abortController: AbortController;
  } | null = null;

  const editableElementText = (element: HTMLElement) =>
    normalizeInlineTextEditValue(
      element.innerText ?? element.textContent ?? "",
    );

  const finish = (commit: boolean) => {
    const edit = inlineTextEdit;
    if (!edit) return;
    inlineTextEdit = null;
    edit.abortController.abort();

    const editedValue = editableElementText(edit.element);
    const value = commit ? editedValue : edit.originalValue;
    if (!commit && editedValue !== edit.originalValue) {
      edit.element.replaceChildren(...edit.originalChildren);
    } else if (commit && value !== edit.originalValue) {
      // The persisted contract is text, never the browser-created editing
      // markup (`div`, `br`, or pasted HTML in older engines).
      edit.element.textContent = value;
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
    const value = editableElementText(element);
    if ((element.innerText ?? element.textContent ?? "") !== value) {
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

    finish(false);
    const element = item.element;
    const originalValue = editableElementText(element);
    const abortController = new AbortController();
    inlineTextEdit = {
      element,
      item,
      originalValue,
      originalChildren: Array.from(element.childNodes, (node) =>
        node.cloneNode(true),
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
