type InspectorPreRenderScheduler = Pick<Window, "setTimeout" | "clearTimeout"> &
  Partial<Pick<Window, "requestIdleCallback" | "cancelIdleCallback">>;

export function scheduleInspectorPreRender(
  callback: () => void,
  scheduler: InspectorPreRenderScheduler,
): () => void {
  let cancelled = false;
  const run = () => {
    if (!cancelled) callback();
  };

  if (scheduler.requestIdleCallback) {
    const id = scheduler.requestIdleCallback(run, { timeout: 1_200 });
    return () => {
      cancelled = true;
      scheduler.cancelIdleCallback?.(id);
    };
  }

  const id = scheduler.setTimeout(run, 200);
  return () => {
    cancelled = true;
    scheduler.clearTimeout(id);
  };
}
