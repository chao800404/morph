import { describe, expect, it } from "vitest";
import {
  isThemeSectionSourcePath,
  listThemeSectionEntries,
  readThemePageSectionEntry,
  readThemeSectionEntry,
  THEME_PAGE_SECTION_FOLDER_PATH,
  THEME_SECTION_FOLDER_PATH,
} from "./theme-section-convention";

const folder = THEME_SECTION_FOLDER_PATH;

describe("the section folder entry rule", () => {
  it("accepts a component file directly in the folder", () => {
    expect(readThemeSectionEntry(`${folder}/Hero.tsx`)).toEqual({
      componentSourcePath: `${folder}/Hero.tsx`,
      componentName: "Hero",
      componentRef: `${folder}/Hero.tsx`,
      sectionType: "hero",
    });
  });

  it("names an index entry after its folder, not after `index`", () => {
    // The route's import binds this name, so `Index` would be the one binding
    // no author would recognise as the section they wrote.
    const entry = readThemeSectionEntry(
      `${folder}/featured-collection/index.tsx`,
    );

    expect(entry?.componentName).toBe("FeaturedCollection");
    expect(entry?.sectionType).toBe("featured-collection");
    expect(entry?.componentSourcePath).toBe(
      `${folder}/featured-collection/index.tsx`,
    );
  });

  it("accepts .jsx entries", () => {
    expect(readThemeSectionEntry(`${folder}/Hero.jsx`)?.componentName).toBe(
      "Hero",
    );
    expect(
      readThemeSectionEntry(`${folder}/hero/index.jsx`)?.componentName,
    ).toBe("Hero");
  });

  it("derives one name from either spelling of the same section", () => {
    const flat = readThemeSectionEntry(`${folder}/HeroBanner.tsx`);
    const folded = readThemeSectionEntry(`${folder}/hero-banner/index.tsx`);

    expect(flat?.componentName).toBe(folded?.componentName);
    expect(flat?.sectionType).toBe(folded?.sectionType);
  });
});

describe("what the convention refuses", () => {
  it("refuses a component that is not in the folder", () => {
    expect(readThemeSectionEntry("src/components/Hero.tsx")).toBeNull();
    expect(
      readThemeSectionEntry("src/components/sections-extra/Hero.tsx"),
    ).toBeNull();
  });

  it("refuses a file nested deeper than one folder", () => {
    // A helper Hero is built from is not a block an author can put on a page.
    // Were depth enough to qualify, the list would fill with them.
    expect(readThemeSectionEntry(`${folder}/hero/parts/Aside.tsx`)).toBeNull();
  });

  it("refuses a non-index file inside a subfolder", () => {
    expect(readThemeSectionEntry(`${folder}/hero/Hero.tsx`)).toBeNull();
  });

  it("refuses a root index, which is a barrel rather than a section", () => {
    expect(readThemeSectionEntry(`${folder}/index.tsx`)).toBeNull();
    expect(readThemeSectionEntry(`${folder}/index.jsx`)).toBeNull();
  });

  it("refuses a test that sits beside the component it tests", () => {
    // This repository colocates tests, so the convention has to exclude them
    // or a section and its test both appear in Add section.
    expect(readThemeSectionEntry(`${folder}/Hero.test.tsx`)).toBeNull();
    expect(readThemeSectionEntry(`${folder}/Hero.spec.tsx`)).toBeNull();
  });

  it("refuses a file with nothing to render", () => {
    expect(readThemeSectionEntry(`${folder}/Hero.ts`)).toBeNull();
    expect(readThemeSectionEntry(`${folder}/hero/index.ts`)).toBeNull();
  });

  it("refuses the folder itself and an empty path", () => {
    expect(readThemeSectionEntry(folder)).toBeNull();
    expect(readThemeSectionEntry(`${folder}/`)).toBeNull();
    expect(readThemeSectionEntry("")).toBeNull();
  });

  it("refuses a name no import could bind", () => {
    // `2-columns` derives `2Columns`, and a generated import of it would not
    // parse. Refusing is what keeps Add section from writing broken source.
    expect(readThemeSectionEntry(`${folder}/2-columns.tsx`)).toBeNull();
    expect(readThemeSectionEntry(`${folder}/2-columns/index.tsx`)).toBeNull();
  });
});

describe("reading a path the workspace spells differently", () => {
  it("accepts a backslash separator and a redundant prefix", () => {
    expect(
      readThemeSectionEntry("src\\components\\sections\\Hero.tsx")
        ?.componentSourcePath,
    ).toBe(`${folder}/Hero.tsx`);
    expect(readThemeSectionEntry(`./${folder}/Hero.tsx`)?.componentName).toBe(
      "Hero",
    );
  });
});

describe("listing the entries among a Theme's files", () => {
  it("keeps only the entries and orders them by section type", () => {
    const entries = listThemeSectionEntries([
      { path: "morph.theme.json" },
      { path: "src/routes/index.tsx" },
      { path: `${folder}/Newsletter.tsx` },
      { path: `${folder}/Hero.tsx` },
      { path: `${folder}/Hero.test.tsx` },
      { path: `${folder}/hero/parts/Aside.tsx` },
      { path: `${folder}/featured-collection/index.tsx` },
    ]);

    expect(entries.map((entry) => entry.sectionType)).toEqual([
      "featured-collection",
      "hero",
      "newsletter",
    ]);
  });

  it("lists a file once when the input repeats it", () => {
    const entries = listThemeSectionEntries([
      { path: `${folder}/Hero.tsx` },
      { path: `${folder}/Hero.tsx` },
    ]);

    expect(entries).toHaveLength(1);
  });

  it("returns nothing for a Theme that has not adopted the convention", () => {
    expect(
      listThemeSectionEntries([
        { path: "src/components/Hero.tsx" },
        { path: "src/routes/index.tsx" },
      ]),
    ).toEqual([]);
  });
});

describe("page-owned section source recognition", () => {
  const pageFolder = THEME_PAGE_SECTION_FOLDER_PATH;

  it("recognizes direct and folder copy entry paths", () => {
    expect(readThemePageSectionEntry(`${pageFolder}/home/Hero.tsx`)).toEqual({
      componentSourcePath: `${pageFolder}/home/Hero.tsx`,
      componentName: "Hero",
      componentRef: `${pageFolder}/home/Hero.tsx`,
      sectionType: "hero",
    });
    expect(
      readThemePageSectionEntry(`${pageFolder}/home/featured/index.tsx`)
        ?.componentName,
    ).toBe("Featured");
  });

  it("does not treat copied child files as section entries", () => {
    expect(
      readThemePageSectionEntry(`${pageFolder}/home/featured/Card.tsx`),
    ).toBeNull();
    expect(isThemeSectionSourcePath(`${pageFolder}/home/Hero.tsx`)).toBe(true);
  });
});
