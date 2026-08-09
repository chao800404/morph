/**
 * The surface a create flow is rendered on.
 *
 * Two things use it: the shared create window (`DialogCreateWrapper`) and the
 * full-page product wizard. They cannot share components — the wizard is a
 * route, so it has no Radix Dialog context to hang `DialogHeader` off — but the
 * surface must be indistinguishable between them. Copying the class strings is
 * how they drifted the first time: the header's divider is a shadow in dark
 * mode and a hairline border in light mode, which is easy to get wrong by hand.
 *
 * Anything that changes the look of a create surface changes it here, once.
 */

export const createSurface = {
  /** The card itself: background, border, radius. */
  shell: "bg-component flex flex-col border border-border/30",

  /**
   * Top bar. The divider is a hairline in light mode and an elevation shadow in
   * dark mode, never both.
   */
  header:
    "dark:shadow-elevation-modal-header overflow-hidden h-fit border-b-[0.5px] border-ring/20 rounded-t-lg relative z-30 dark:border-none",

  /** Default padding for a header holding a title. */
  headerPadding: "px-4 py-2",

  /** The scrolling middle. */
  body: "bg-component w-full flex-1 min-h-0 overflow-hidden border-b relative z-20 dark:shadow-elevation-modal dark:border-border/30",

  /** The centred column the fields sit in. */
  content: "pt-24 px-5 pb-10 max-w-3xl mx-auto relative z-50",

  /** Bottom bar holding the submit actions. */
  footer:
    "bg-component h-fit border-ring/80 border-t-[0.5px] px-4 py-4 rounded-b-lg relative z-30 dark:shadow-elevation-modal dark:border-border/30",
} as const;
