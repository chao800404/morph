/**
 * Configuration for click outside detection
 * Define which elements should be excluded from triggering click outside behavior
 */

export interface ClickOutsideExclusion {
    /** CSS selector or role attribute */
    selector: string;
    /** Description of what this exclusion is for */
    description: string;
}

/**
 * List of elements that should be excluded from click outside detection
 * Add new exclusions here when adding new field types with portals/overlays
 */
export const CLICK_OUTSIDE_EXCLUSIONS: ClickOutsideExclusion[] = [
    {
        selector: '[role="listbox"]',
        description: "Select dropdown (Radix UI)",
    },
    {
        selector: "[data-radix-select-content]",
        description: "Select content wrapper",
    },
    {
        selector: "[data-radix-popper-content-wrapper]",
        description: "Radix Popper wrapper",
    },
    {
        selector: '[role="alertdialog"]',
        description: "Alert dialog",
    },
    {
        selector: '[role="dialog"]',
        description: "Generic dialog",
    },
    {
        selector: "[data-radix-dialog-content]",
        description: "Dialog content",
    },
    // Add more exclusions here as needed
    // Example for future field types:
    // {
    //     selector: '[role="combobox"]',
    //     description: "Combobox dropdown",
    // },
    // {
    //     selector: '[data-radix-popover-content]',
    //     description: "Popover content",
    // },
];

/**
 * Check if a click target should be excluded from click outside detection
 * @param target - The click event target
 * @returns true if the target should be excluded
 */
export const isClickOutsideExcluded = (target: Node): boolean => {
    if (!(target instanceof Element)) {
        return false;
    }

    return CLICK_OUTSIDE_EXCLUSIONS.some(exclusion => {
        return target.closest(exclusion.selector) !== null;
    });
};
