// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createInlineTextEditor,
  type InlineEditTarget,
  type InlineTextCommit,
} from "./inline-text-editor";

function renderedHeading(text: string) {
  const section = document.createElement("section");
  const heading = document.createElement("h2");
  heading.appendChild(document.createTextNode(text));
  section.appendChild(heading);
  document.body.appendChild(section);
  const target: InlineEditTarget = {
    element: heading,
    kind: "heading",
    section,
    sectionId: "hero",
    fieldKey: "title",
    fieldPath: "title",
    descendantFields: [],
  };
  return { heading, target };
}

function editorStoring(stored: unknown) {
  const commits: InlineTextCommit[] = [];
  const editor = createInlineTextEditor({
    onCommit: (commit) => commits.push(commit),
    onLayoutChanged: vi.fn(),
    storedValue: () => stored,
  });
  return { editor, commits };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("editing text in the page", () => {
  it("does not begin on text the Theme changed on its way to the page", () => {
    // content() turned "probe" into "TRANSFORMED:PROBE". Typing over it and
    // saving would store the transformed text.
    const { target, heading } = renderedHeading("TRANSFORMED:PROBE");
    const { editor } = editorStoring("probe");

    expect(editor.begin(target, { selectionEnabled: true })).toBe(false);
    expect(editor.editingElement()).toBeNull();
    expect(heading.hasAttribute("contenteditable")).toBe(false);
  });

  it("does not begin on a field the page stores nothing for", () => {
    // What renders is a default nobody can tie to this field.
    const { target } = renderedHeading("Probe default");
    const { editor } = editorStoring(undefined);

    expect(editor.begin(target, { selectionEnabled: true })).toBe(false);
  });

  it("begins on text that is the stored value", () => {
    const { target, heading } = renderedHeading("Stored title");
    const { editor } = editorStoring("Stored title");

    expect(editor.begin(target, { selectionEnabled: true })).toBe(true);
    expect(editor.editingElement()).toBe(heading);
  });

  it("commits the typed value with the stored value it started from", () => {
    const { target, heading } = renderedHeading("Stored title");
    const { editor, commits } = editorStoring("Stored title");
    editor.begin(target, { selectionEnabled: true });

    heading.textContent = "Edited title";
    editor.finish(true);

    expect(commits).toEqual([
      {
        sectionId: "hero",
        fieldKey: "title",
        fieldPath: "title",
        value: "Edited title",
        originalValue: "Stored title",
      },
    ]);
  });

  it("gives the rendered node back as rendered, for the Theme to render the commit", () => {
    const { target, heading } = renderedHeading("Stored title");
    const rendered = heading.firstChild!;
    const { editor, commits } = editorStoring("Stored title");
    editor.begin(target, { selectionEnabled: true });

    // Editing can replace the node outright, as normalizing typed text does.
    heading.textContent = "Edited title";
    expect(heading.firstChild).not.toBe(rendered);
    editor.finish(true);

    // The framework's node, holding what the framework put there. The typed
    // text is not written onto the page: content() may render it differently,
    // and the editor may refuse it.
    expect(heading.childNodes).toHaveLength(1);
    expect(heading.firstChild).toBe(rendered);
    expect(rendered.textContent).toBe("Stored title");
    expect(commits.map((commit) => commit.value)).toEqual(["Edited title"]);
  });

  it("reads the text the DOM holds, not the text CSS shows", () => {
    // An `uppercase` heading: innerText applies text-transform.
    const { target, heading } = renderedHeading("Mixed Case");
    Object.defineProperty(heading, "innerText", {
      get: () => heading.textContent?.toUpperCase() ?? "",
    });
    const { editor, commits } = editorStoring("Mixed Case");

    expect(editor.begin(target, { selectionEnabled: true })).toBe(true);
    heading.firstChild!.textContent = "Mixed Case edited";
    editor.finish(true);

    expect(commits.map((commit) => commit.value)).toEqual([
      "Mixed Case edited",
    ]);
  });

  it("keeps line breaks typed while editing", () => {
    const { target, heading } = renderedHeading("Line");
    const { editor, commits } = editorStoring("Line");
    editor.begin(target, { selectionEnabled: true });

    heading.replaceChildren(
      document.createTextNode("Line one"),
      document.createElement("br"),
      document.createTextNode("Line two"),
      // The trailing break a browser keeps in an editable line ends nothing.
      document.createElement("br"),
    );
    editor.finish(true);

    expect(commits.map((commit) => commit.value)).toEqual([
      "Line one\nLine two",
    ]);
  });

  it("says so when it refuses text bound to a field", () => {
    const { target } = renderedHeading("TRANSFORMED:PROBE");
    const onRefused = vi.fn();
    const editor = createInlineTextEditor({
      onCommit: vi.fn(),
      onLayoutChanged: vi.fn(),
      storedValue: () => "probe",
      onRefused,
    });

    expect(editor.begin(target, { selectionEnabled: true })).toBe(false);
    expect(onRefused).toHaveBeenCalledExactlyOnceWith(target);
  });

  it("says nothing for something that was never a text field", () => {
    const { target } = renderedHeading("Stored title");
    const onRefused = vi.fn();
    const editor = createInlineTextEditor({
      onCommit: vi.fn(),
      onLayoutChanged: vi.fn(),
      storedValue: () => "Stored title",
      onRefused,
    });

    expect(
      editor.begin(
        { ...target, descendantFields: [{}] },
        { selectionEnabled: true },
      ),
    ).toBe(false);
    expect(onRefused).not.toHaveBeenCalled();
  });

  it("puts the rendered node and its text back when an edit is abandoned", () => {
    const { target, heading } = renderedHeading("Stored title");
    const rendered = heading.firstChild!;
    const { editor, commits } = editorStoring("Stored title");
    editor.begin(target, { selectionEnabled: true });

    heading.textContent = "Discarded";
    editor.finish(false);

    expect(heading.firstChild).toBe(rendered);
    expect(heading.textContent).toBe("Stored title");
    expect(commits).toEqual([]);
  });
});

describe("a page that cannot say what it rendered from", () => {
  it("offers no inline editing, rather than trusting the text", () => {
    const { target } = renderedHeading("Stored title");
    const editor = createInlineTextEditor({
      onCommit: vi.fn(),
      onLayoutChanged: vi.fn(),
    });

    expect(editor.begin(target, { selectionEnabled: true })).toBe(false);
  });
});

describe("an edit the page rendered over", () => {
  it("is dropped without saving or touching what is on the page now", () => {
    const { target, heading } = renderedHeading("Stored title");
    const section = heading.parentElement!;
    const { editor, commits } = editorStoring("Stored title");
    editor.begin(target, { selectionEnabled: true });
    heading.firstChild!.textContent = "Typed into the old render";

    // A hot update or route reload replaces the element under the edit.
    const rerendered = document.createElement("h2");
    rerendered.appendChild(document.createTextNode("Rendered again"));
    section.replaceChild(rerendered, heading);
    editor.finish(true);

    expect(commits).toEqual([]);
    expect(editor.editingElement()).toBeNull();
    expect(section.textContent).toBe("Rendered again");
    expect(section.firstChild).toBe(rerendered);
  });
});

describe("telling the editor an edit is open", () => {
  function editorReporting() {
    const events: string[] = [];
    const editor = createInlineTextEditor({
      onCommit: (commit) => events.push(`commit:${commit.value}`),
      onEditingChange: (editing) => events.push(editing ? "open" : "closed"),
      onLayoutChanged: vi.fn(),
      storedValue: () => "Stored title",
    });
    return { editor, events };
  }

  it("reports the edit open, then its commit before it reports it closed", () => {
    // The editor resolves "finish it" on the close, so the commit has to be
    // in its hands by then.
    const { target, heading } = renderedHeading("Stored title");
    const { editor, events } = editorReporting();

    editor.begin(target, { selectionEnabled: true });
    heading.textContent = "Typed title";
    editor.finish(true);

    expect(events).toEqual(["open", "commit:Typed title", "closed"]);
  });

  it("reports an abandoned edit closed, with nothing committed", () => {
    const { target, heading } = renderedHeading("Stored title");
    const { editor, events } = editorReporting();

    editor.begin(target, { selectionEnabled: true });
    heading.textContent = "Typed title";
    editor.finish(false);

    expect(events).toEqual(["open", "closed"]);
  });

  it("reports nothing for an edit that never began", () => {
    const { target } = renderedHeading("Changed on its way");
    const { editor, events } = editorReporting();

    expect(editor.begin(target, { selectionEnabled: true })).toBe(false);
    editor.finish(true);

    expect(events).toEqual([]);
  });
});
