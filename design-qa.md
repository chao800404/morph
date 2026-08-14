# Resource Link Card Design QA

- Source visual truth: `C:\Users\a0921\AppData\Local\Temp\codex-clipboard-b845c74d-77ba-47cd-b25e-37ceddfebd43.png`
- Source pixels: 794 x 238
- Previous implementation evidence: `C:\Users\a0921\AppData\Local\Temp\codex-clipboard-69cf629d-97a8-4f03-8cee-fe56d44f091e.png`
- Previous implementation pixels: 2048 x 899; focused Sales channel region is approximately 482 x 151
- Intended CSS state: dark Dashboard, `/dashboard/online-store`, desktop viewport
- Density normalization: visual proportions compared after normalizing the focused card regions by width
- Revised implementation screenshot: `C:\Users\a0921\Desktop\morph\design-qa-online-store-refined.png`
- Verified viewport: 1956 x 1104 CSS pixels at device pixel ratio 1.75
- Focused implementation card: 448 x 137.14 CSS pixels
- Width-normalized source card: 448 x 134.3 CSS pixels

## Full-view comparison evidence

The previous implementation placed the relationship card correctly beneath Website information, but its header was too compact, the inner row was darker than the container, the title weight was too light, the header action was absent, and the chevron did not match the solid directional marker in the reference.

## Focused region comparison evidence

The reference card uses a taller padded header, a large semibold heading, a top-right overflow action, no full-width divider before the resource row, a lightly elevated inner panel, a framed icon tile, a semibold resource name, muted secondary text, and a small solid right-facing marker. The shared `ResourceLinkCard` was updated to reproduce those properties using existing Dashboard tokens and Lucide icons.

## Comparison history

### Iteration 1

- P2: Header density and hierarchy were weaker than the reference.
  - Fix: increased card-header vertical padding and heading size/weight; added the header action slot.
- P2: Inner resource row was darker and flatter than the reference.
  - Fix: changed to a lighter semantic muted surface, larger radius, stronger border, and subtle shadow.
- P2: Navigation marker and icon tile differed.
  - Fix: replaced the chevron with a solid right-facing marker and added the framed, inset-ring icon treatment.
- P2: A full-width content divider was visible but absent from the reference.
  - Fix: added a scoped `CardWrapper` content override and removed the divider for this component.

### Post-fix evidence

The authenticated Dashboard was captured after HMR. The card now matches the reference's outer radius, padded header, overflow action, borderless content transition, raised inner row, framed icon tile, text hierarchy, and solid right-facing marker. The remaining width-normalized height difference is approximately 2.8 CSS pixels and does not create a visible hierarchy or alignment error.

## Required fidelity surfaces

- Fonts and typography: browser-verified against the reference hierarchy.
- Spacing and layout rhythm: browser-verified for header, row, icon, and outer padding.
- Colors and visual tokens: semantic Dashboard tokens only; inner panel lightened to match the reference.
- Image quality and assets: no raster assets are present; icons use the project's existing Lucide library.
- Copy and content: application-specific Sales channel name and type intentionally replace the shipping-profile example copy.

## Primary interactions and console

- Router link and intent preload remain implemented.
- Clicking the resource row successfully navigated to the connected sales-channel detail route, and browser back returned to `/dashboard/online-store`.
- Console inspection found only browser-extension messages and an extension-injected body attribute hydration warning; no component-specific application error was observed.

## Findings

- P3: The implementation is approximately 2.8 CSS pixels taller than the width-normalized source. This is within rendering and typography variance and does not warrant a local layout override.
- No actionable P0, P1, or P2 findings remain.

final result: passed
