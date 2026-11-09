/**
 * Early implementation of the handover check. The first test commit
 * intentionally demonstrates why a phase-only check is insufficient.
 * @param {any} record
 */
export async function verifyContainerRunHandover(record) {
  if (record?.phase !== "teardown-complete") {
    throw new Error("HANDOVER_INCOMPLETE: runner teardown did not complete");
  }
  return { passed: true };
}
