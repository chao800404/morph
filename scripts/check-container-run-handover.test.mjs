import assert from "node:assert/strict";
import test from "node:test";
import { verifyContainerRunHandover } from "./check-container-run-handover.mjs";

const stateRoot = "/tmp";
const lockFile = "/tmp/morph-editor-e2e.lock";
const validRecord = () => ({
  schemaVersion: 1,
  invocationId: "run-attempt-step-uuid",
  spec: "e2e/m1-container-lifecycle-acceptance.spec.ts",
  phase: "teardown-complete",
  runner: { pid: 1234, pgid: 1200, startedAtUtc: "2026-11-10T00:00:00.000Z" },
  children: [
    { name: "dev server", pid: 2345, pgid: 2345, stopped: true },
  ],
  stateDir: { path: "/tmp/morph-e2e-abc123", removed: true },
  containers: {
    prefix: "workerd-morph-e2e-abcdef123456-",
    cleanupAttempted: true,
    gone: true,
  },
  machineLock: { path: lockFile, acquired: true, releaseCompleted: true },
  writtenAtUtc: "2026-11-10T00:03:00.000Z",
});

const adapters = (overrides = {}) => ({
  stateRoot,
  expectedLockFile: lockFile,
  processState: () => "gone",
  processGroupState: () => "gone",
  pathState: () => "absent",
  containersForPrefix: () => [],
  lockIsFree: () => true,
  ...overrides,
});

test("accepts a complete handover only when every identity is gone", async () => {
  const result = await verifyContainerRunHandover(
    validRecord(),
    adapters(),
  );
  assert.equal(result.passed, true);
});

test("rejects a missing, malformed, or interrupted manifest", async (t) => {
  for (const [name, mutate] of [
    ["null", () => null],
    ["wrong schema", (record) => ({ ...record, schemaVersion: 2 })],
    ["identity-only phase", (record) => ({ ...record, phase: "identity-recorded" })],
    ["incomplete phase", (record) => ({ ...record, phase: "teardown-incomplete" })],
    ["missing invocation id", (record) => ({ ...record, invocationId: "" })],
  ]) {
    await t.test(name, async () => {
      await assert.rejects(
        verifyContainerRunHandover(mutate(validRecord()), adapters()),
        /HANDOVER_/,
      );
    });
  }
});

test("requires the runner PID and its process group to be gone", async (t) => {
  for (const [name, override] of [
    ["runner remains alive", { processState: () => "alive" }],
    ["runner status is unknown", { processState: () => "unknown" }],
    ["runner group remains alive", { processGroupState: () => "alive" }],
    ["runner group status is unknown", { processGroupState: () => "unknown" }],
  ]) {
    await t.test(name, async () => {
      await assert.rejects(
        verifyContainerRunHandover(validRecord(), adapters(override)),
        /HANDOVER_/,
      );
    });
  }
});

test("requires every recorded child process group to be gone", async (t) => {
  await t.test("a child group is alive", async () => {
    await assert.rejects(
      verifyContainerRunHandover(
        validRecord(),
        adapters({ processGroupState: (_pgid) => "alive" }),
      ),
      /HANDOVER_/,
    );
  });
  await t.test("a child group stop was not confirmed", async () => {
    const record = validRecord();
    record.children[0].stopped = false;
    await assert.rejects(
      verifyContainerRunHandover(record, adapters()),
      /HANDOVER_/,
    );
  });
});

test("requires the exact run state directory to be absent", async (t) => {
  for (const [name, pathState] of [
    ["still exists", "present"],
    ["cannot be inspected", "unknown"],
  ]) {
    await t.test(name, async () => {
      await assert.rejects(
        verifyContainerRunHandover(
          validRecord(),
          adapters({ pathState: () => pathState }),
        ),
        /HANDOVER_/,
      );
    });
  }
  await t.test("state directory was not recorded as removed", async () => {
    const record = validRecord();
    record.stateDir.removed = false;
    await assert.rejects(
      verifyContainerRunHandover(record, adapters()),
      /HANDOVER_/,
    );
  });
  await t.test("path outside the exact temporary root", async () => {
    const record = validRecord();
    record.stateDir.path = "/tmp-other/morph-e2e-abc123";
    await assert.rejects(
      verifyContainerRunHandover(record, adapters()),
      /HANDOVER_/,
    );
  });
});

test("requires the exact run container prefix to have no remaining containers", async (t) => {
  for (const [name, containersForPrefix] of [
    ["owned containers remain", () => ["container-id"]],
    ["Docker status is unknown", () => null],
  ]) {
    await t.test(name, async () => {
      await assert.rejects(
        verifyContainerRunHandover(
          validRecord(),
          adapters({ containersForPrefix }),
        ),
        /HANDOVER_/,
      );
    });
  }
  await t.test("rejects a broad or malformed container prefix", async () => {
    const record = validRecord();
    record.containers.prefix = "workerd-morph-e2e-";
    await assert.rejects(
      verifyContainerRunHandover(record, adapters()),
      /HANDOVER_/,
    );
  });
  await t.test("requires cleanup to have been confirmed", async () => {
    const record = validRecord();
    record.containers.gone = false;
    await assert.rejects(
      verifyContainerRunHandover(record, adapters()),
      /HANDOVER_/,
    );
  });
});

test("requires the configured machine lock to be released and reacquirable", async (t) => {
  for (const [name, override, mutate] of [
    ["lock is held", { lockIsFree: () => false }, () => {}],
    ["lock cannot be checked", { lockIsFree: () => null }, () => {}],
    ["runner did not acquire it", {}, (record) => { record.machineLock.acquired = false; }],
    ["runner handed it to the guardian", {}, (record) => { record.machineLock.releaseCompleted = false; }],
    ["manifest names another lock", {}, (record) => { record.machineLock.path = "/tmp/other.lock"; }],
  ]) {
    await t.test(name, async () => {
      const record = validRecord();
      mutate(record);
      await assert.rejects(
        verifyContainerRunHandover(record, adapters(override)),
        /HANDOVER_/,
      );
    });
  }
});
