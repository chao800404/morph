export const SELECTION_OVERLAY_SETTLE_MS = 160;

export function createSelectionOverlaySettler(
  onSettled: () => void,
  delayMs = SELECTION_OVERLAY_SETTLE_MS,
) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let frozen = false;

  return {
    freezeUntilSettled() {
      frozen = true;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        frozen = false;
        onSettled();
      }, delayMs);
    },
    isFrozen() {
      return frozen;
    },
    cancel() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      frozen = false;
    },
  };
}
