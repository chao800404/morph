import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  CLOCK_BOUND_MS,
  MARKERS,
  parseMicros,
  parseRfc3339Micros,
  parseMonitorLog,
  recordClockProbe,
  verifyContainerNetworkWindows,
} from "./check-container-network-windows.mjs";

const CHECKER = fileURLToPath(
  new URL("./check-container-network-windows.mjs", import.meta.url),
);

// Times are seconds after 10:00:00 on the run's day, written as each record
// writes them: markers and probes as UTC with `Z`, the monitor zone-less.
const DAY = "2026-11-21T";
/** @param {number} s */
const hms = (s) => {
  const whole = Math.floor(s);
  const micros = Math.round((s - whole) * 1e6);
  const h = 10 + Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const sec = whole % 60;
  const pad = (/** @type {number} */ n) => String(n).padStart(2, "0");
  return `${DAY}${pad(h)}:${pad(m)}:${pad(sec)}.${String(micros).padStart(6, "0")}`;
};
const utc = (/** @type {number} */ s) => `${hms(s)}Z`;
const ms = (/** @type {number} */ s) => new Date(Date.parse(utc(s))).toISOString();

// Lines in the shapes run 44896457000's ip-monitor.log has them.
const link = (/** @type {number} */ s, /** @type {number} */ index, /** @type {string} */ name, deleted = false) =>
  `[${hms(s)}] ${deleted ? "Deleted " : ""}${index}: ${name}@NONE: <BROADCAST,MULTICAST> mtu 1500 qdisc noop state DOWN group default \\    link/ether 7a:9e:41:e8:35:c9 brd ff:ff:ff:ff:ff:ff`;
const fe80 = (/** @type {number} */ s, /** @type {number} */ index, /** @type {string} */ name) =>
  `[${hms(s)}] ${index}: ${name}    inet6 fe80::5c60:2cff:fea8:5c63/64 scope link \\       valid_lft forever preferred_lft forever`;
/** A container veth that comes and goes. */
const veth = (/** @type {number} */ from, /** @type {number} */ to, /** @type {number} */ index, /** @type {string} */ name) => [
  [from, link(from, index, name)],
  [to, link(to, index, name, true)],
];

const MARK = {
  "lifecycle-start": 10,
  "lifecycle-end": 100,
  "preview-access-start": 101,
  "preview-access-end": 200,
};

/**
 * A whole good record; `change` edits its parts before they are written.
 * @param {(parts: { marks: Record<string, number>, lines: [number, string][], probes: Record<string, unknown>[] }) => void} [change]
 */
function record(change) {
  const marks = { ...MARK };
  /** @type {[number, string][]} */
  const lines = [
    [1, link(1, 4, "morphprobe0")],
    [1.01, link(1.01, 4, "morphprobe0", true)],
    ...veth(20, 30, 6, "veth771669f"),
    ...veth(150, 160, 24, "vethd4c0052"),
    [201, link(201, 26, "morphprobe2")],
    [201.01, link(201.01, 26, "morphprobe2", true)],
    // The host's own link-local addresses are not a container's.
    [21, fe80(21, 3, "docker0")],
  ];
  const probes = MARKERS.map((marker, i) => {
    const at = marks[marker] + 0.05;
    lines.push([at + 0.01, link(at + 0.01, 30 + i, `morphclk${i}p`)]);
    lines.push([at + 0.02, link(at + 0.02, 31 + i, `morphclk${i}`)]);
    lines.push([at + 0.03, link(at + 0.03, 31 + i, `morphclk${i}`, true)]);
    return {
      marker,
      link: `morphclk${i}`,
      ipBefore: ms(at),
      ipAfter: ms(at + 0.04),
      ipError: null,
      dockerBefore: ms(at + 0.05),
      dockerAfter: ms(at + 0.3),
      docker: `${hms(at + 0.2)}123Z`,
      dockerError: null,
    };
  });
  change?.({ marks, lines, probes });
  return {
    windows: MARKERS.map((name) => JSON.stringify({ name, utc: `${hms(marks[name])}812Z` })).join("\n") + "\n",
    monitorLog: [...lines].sort((a, b) => a[0] - b[0]).map(([, line]) => line).join("\n") + "\n",
    clockProbes: probes.map((p) => JSON.stringify(p)).join("\n") + "\n",
  };
}

/** @param {ReturnType<typeof record>} input @param {string} code */
function refuses(input, code) {
  assert.throws(
    () => verifyContainerNetworkWindows(input),
    (error) => error instanceof Error && error.message.startsWith(`${code}: `),
    code,
  );
}

test("a record whose windows each made and removed their own veths, on one clock, passes", () => {
  const result = verifyContainerNetworkWindows(record());
  assert.deepEqual(
    result.windows.map((w) => [w.name, w.veths]),
    [
      ["lifecycle", 1],
      ["preview-access", 1],
    ],
  );
  assert.deepEqual(
    result.clock.map((c) => [c.marker, c.ipSkewMs, c.dockerSkewMs]),
    MARKERS.map((marker) => [marker, 0, 0]),
  );
});

test("timestamps keep their sub-millisecond digits, and ip's zone-less time is read as UTC", () => {
  assert.equal(parseMicros("2026-11-21T10:54:56.736613800Z", { zone: "Z" }), Date.parse("2026-11-21T10:54:56Z") * 1000 + 736613);
  assert.equal(parseMicros("2026-11-21T10:54:56.584402", { zone: "none" }), Date.parse("2026-11-21T10:54:56Z") * 1000 + 584402);
  // A marker without its zone, or ip's time with one, is not a time.
  assert.equal(parseMicros("2026-11-21T10:54:56.736", { zone: "Z" }), null);
  assert.equal(parseMicros("2026-11-21T10:54:56.584402Z", { zone: "none" }), null);
  // Docker's SystemTime: nanoseconds, and its own zone honoured.
  assert.equal(parseRfc3339Micros("2026-11-21T10:54:56.123456789Z"), Date.parse("2026-11-21T10:54:56Z") * 1000 + 123456);
  assert.equal(parseRfc3339Micros("2026-11-21T18:54:56.5+08:00"), Date.parse("2026-11-21T10:54:56Z") * 1000 + 500000);
  assert.equal(parseRfc3339Micros("2026-11-21 10:54:56"), null);
  const [event] = parseMonitorLog(fe80(1, 7, "vethd9c9256"));
  assert.equal(event.name, "vethd9c9256");
  assert.equal(event.kind, "addr");
  assert.equal(event.linkLocal, true);
});

test("markers that are missing, repeated, out of order or without a zone fail", () => {
  const good = record();
  const lines = good.windows.trim().split("\n");
  refuses({ ...good, windows: lines.slice(0, 3).join("\n") }, "NETWORK_BAD_MARKERS");
  refuses({ ...good, windows: [lines[0], ...lines].join("\n") }, "NETWORK_BAD_MARKERS");
  refuses({ ...good, windows: [lines[1], lines[0], lines[2], lines[3]].join("\n") }, "NETWORK_BAD_MARKERS");
  refuses({ ...good, windows: lines.map((l) => l.replace("812Z", "812")).join("\n") }, "NETWORK_BAD_MARKERS");
  refuses({ ...good, windows: "" }, "NETWORK_BAD_MARKERS");
  refuses({ ...good, windows: "{not json\n" }, "NETWORK_BAD_RECORD");
  // Times out of order although the names are in order.
  refuses(record(({ marks }) => (marks["preview-access-start"] = 99)), "NETWORK_BAD_MARKERS");
});

test("a monitor record that cannot be read in full, or in order, fails", () => {
  const good = record();
  refuses({ ...good, monitorLog: `${good.monitorLog}netlink receive error No buffer space available (105)\n` }, "NETWORK_RECORD_UNPARSEABLE");
  const lines = good.monitorLog.trim().split("\n");
  refuses({ ...good, monitorLog: [lines[1], lines[0], ...lines.slice(2)].join("\n") }, "NETWORK_RECORD_NOT_MONOTONIC");
});

test("a monitor that started after the first window or stopped before the last one ended fails", () => {
  refuses(record(({ lines }) => lines.splice(0, 2)), "NETWORK_MONITOR_LATE");
  refuses(record(({ marks }) => (marks["lifecycle-start"] = 0.5)), "NETWORK_MONITOR_LATE");
  refuses(
    record(({ lines }) => {
      const at = lines.findIndex(([, l]) => l.includes("morphprobe2"));
      lines.splice(at, 2);
    }),
    "NETWORK_MONITOR_STOPPED",
  );
});

test("a window with no container veth fails, though the job as a whole saw some", () => {
  refuses(
    record(({ lines }) => {
      for (let i = lines.length - 1; i >= 0; i--) if (lines[i][1].includes("vethd4c0052")) lines.splice(i, 1);
    }),
    "NETWORK_WINDOW_NO_VETH",
  );
});

test("a veth between the windows, across a window edge, or never removed fails", () => {
  refuses(record(({ lines }) => lines.push(...veth(100.2, 100.4, 40, "veth0aa0bb1"))), "NETWORK_VETH_OUTSIDE_WINDOW");
  refuses(record(({ lines }) => lines.push(...veth(5, 6, 40, "veth0aa0bb1"))), "NETWORK_VETH_OUTSIDE_WINDOW");
  refuses(record(({ lines }) => lines.push(...veth(90, 150, 40, "veth0aa0bb1"))), "NETWORK_VETH_SPANS_WINDOWS");
  refuses(record(({ lines }) => lines.push([50, link(50, 40, "veth0aa0bb1")])), "NETWORK_VETH_NOT_DELETED");
  // Deleted from the host when it moves into the container, then back: the
  // last word is what counts.
  refuses(
    record(({ lines }) => lines.push(...veth(50, 51, 40, "veth0aa0bb1"), [52, link(52, 40, "veth0aa0bb1")])),
    "NETWORK_VETH_NOT_DELETED",
  );
});

test("a container veth that got a link-local address fails, in or out of a window (#382)", () => {
  refuses(record(({ lines }) => lines.push([25, fe80(25, 6, "veth771669f")])), "NETWORK_VETH_LINK_LOCAL");
  refuses(record(({ lines }) => lines.push([155, fe80(155, 24, "vethd4c0052")])), "NETWORK_VETH_LINK_LOCAL");
});

test("without a clock probe at every marker the windows are not compared", () => {
  refuses(record(({ probes }) => probes.pop()), "CLOCK_BAD_PROBES");
  refuses({ ...record(), clockProbes: "" }, "CLOCK_BAD_PROBES");
  refuses(record(({ probes }) => probes.reverse()), "CLOCK_BAD_PROBES");
  refuses(record(({ probes }) => (probes[1].ipAfter = "10:00:01")), "CLOCK_BAD_PROBES");
  refuses(record(({ probes }) => (probes[2].ipError = "ip link add exited 1: Operation not permitted")), "CLOCK_PROBE_FAILED");
  refuses(
    record(({ lines }) => {
      for (let i = lines.length - 1; i >= 0; i--) if (/ morphclk1@/.test(lines[i][1])) lines.splice(i, 1);
    }),
    "CLOCK_PROBE_UNSEEN",
  );
  // A probe from another moment does not speak for this marker.
  refuses(record(({ probes }) => (probes[3].ipBefore = ms(MARK["preview-access-end"] + 30))), "CLOCK_PROBE_NOT_AT_MARKER");
});

test("a monitor or Docker daemon on another clock fails, past the bound and not before", () => {
  // `ip -ts` printing local time on a runner whose zone is not UTC: every
  // stamp in the record moves by the zone offset. It fails as a clock, not
  // as a window that looks empty.
  const zoneShifted = record(({ lines }) => {
    for (const entry of lines) {
      entry[0] += 3600;
      entry[1] = entry[1].replace(/^\[[^\]]+\]/, `[${hms(entry[0])}]`);
    }
  });
  refuses(zoneShifted, "CLOCK_SKEW");
  const shiftProbe = (/** @type {number} */ seconds) =>
    record(({ lines }) => {
      for (const entry of lines) {
        if (!/ morphclk2[@:]/.test(entry[1])) continue;
        entry[0] += seconds;
        entry[1] = entry[1].replace(/^\[[^\]]+\]/, `[${hms(entry[0])}]`);
      }
    });
  refuses(shiftProbe(CLOCK_BOUND_MS / 1000 + 0.5), "CLOCK_SKEW");
  refuses(shiftProbe(-(CLOCK_BOUND_MS / 1000 + 0.5)), "CLOCK_SKEW");
  // Within the bound it passes, and the skew is reported.
  const near = verifyContainerNetworkWindows(shiftProbe(0.5));
  assert.ok(near.clock[2].ipSkewMs > 400 && near.clock[2].ipSkewMs < 500, String(near.clock[2].ipSkewMs));

  refuses(record(({ probes }) => (probes[0].docker = `${hms(MARK["lifecycle-start"] + 3600)}Z`)), "CLOCK_DOCKER_SKEW");
  // Docker's own zone is honoured: the same instant written as +08:00 passes.
  const zoned = verifyContainerNetworkWindows(
    record(({ probes }) => {
      const instant = new Date(Date.parse(probes[0].docker));
      instant.setUTCHours(instant.getUTCHours() + 8);
      probes[0].docker = `${instant.toISOString().slice(0, -1)}+08:00`;
    }),
  );
  assert.equal(zoned.clock[0].dockerSkewMs, 0);
  refuses(record(({ probes }) => ((probes[1].docker = null), (probes[1].dockerError = "docker info exited 1: Cannot connect"))), "CLOCK_DOCKER_UNAVAILABLE");
  refuses(record(({ probes }) => (probes[1].docker = "yesterday")), "CLOCK_DOCKER_UNAVAILABLE");
});

test("the probe records what it saw, numbers its links, and records a failure instead of throwing", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "clock-probe-"));
  try {
    let tick = Date.parse(utc(10));
    const now = () => new Date((tick += 7));
    /** @type {string[][]} */
    const calls = [];
    const ok = (/** @type {string} */ stdout = "") => ({ status: 0, stdout, stderr: "" });
    const first = recordClockProbe(dir, "lifecycle-start", {
      now,
      run: (command, args) => {
        calls.push([command, ...args]);
        return command === "docker" ? ok(`"${utc(10.02)}"\n`) : ok();
      },
    });
    assert.deepEqual(calls, [
      ["sudo", "-n", "ip", "link", "add", "morphclk0", "type", "veth", "peer", "name", "morphclk0p"],
      ["sudo", "-n", "ip", "link", "del", "morphclk0"],
      ["docker", "info", "--format", "{{json .SystemTime}}"],
    ]);
    assert.equal(first.docker, utc(10.02));
    assert.equal(first.ipError, null);
    assert.equal(first.dockerError, null);
    assert.ok(first.ipBefore < first.ipAfter && first.dockerBefore < first.dockerAfter);

    const second = recordClockProbe(dir, "lifecycle-end", {
      now,
      run: (command) =>
        command === "docker"
          ? { status: 1, stdout: "", stderr: "Cannot connect to the Docker daemon" }
          : { status: 1, stdout: "", stderr: "RTNETLINK answers: Operation not permitted" },
    });
    assert.equal(second.link, "morphclk1");
    assert.match(second.ipError, /^ip link add exited 1: RTNETLINK/);
    assert.match(second.dockerError, /^docker info exited 1: Cannot connect/);
    assert.equal(second.docker, null);

    const written = readFileSync(path.join(dir, "clock-probes.ndjson"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(written, [first, second]);
    assert.throws(() => recordClockProbe(dir, "preview-start"), /^Error: CLOCK_BAD_PROBES: unknown marker/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the command line passes a good record and fails a missing or bad one with a CI error", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "network-windows-"));
  try {
    const good = record();
    writeFileSync(path.join(dir, "windows.ndjson"), good.windows);
    writeFileSync(path.join(dir, "ip-monitor.log"), good.monitorLog);
    const run = () => spawnSync(process.execPath, [CHECKER, "check", dir], { encoding: "utf8" });

    const missing = run();
    assert.equal(missing.status, 1, missing.stdout + missing.stderr);
    assert.match(missing.stdout, /^::error::NETWORK_RECORD_MISSING: clock-probes\.ndjson/m);

    writeFileSync(path.join(dir, "clock-probes.ndjson"), good.clockProbes);
    const passed = run();
    assert.equal(passed.status, 0, passed.stdout + passed.stderr);
    assert.match(passed.stdout, /^lifecycle window .*: 1 container veths created and deleted inside it/m);
    assert.match(passed.stdout, /^preview-access window .*: 1 container veths/m);

    writeFileSync(
      path.join(dir, "ip-monitor.log"),
      record(({ lines }) => lines.push([155, fe80(155, 24, "vethd4c0052")])).monitorLog,
    );
    const linkLocal = run();
    assert.equal(linkLocal.status, 1);
    assert.match(linkLocal.stdout, /^::error::NETWORK_VETH_LINK_LOCAL: vethd4c0052/m);

    const usage = spawnSync(process.execPath, [CHECKER], { encoding: "utf8" });
    assert.equal(usage.status, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
