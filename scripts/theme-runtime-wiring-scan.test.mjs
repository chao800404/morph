/**
 * The shapes the wiring guard has to tell apart.
 *
 * Three states, and only one of them is a pass. `PENDING` is asserted as
 * strongly as `PASS`, because a guard that cannot tell "nothing is configured"
 * from "configured correctly" goes green on an unconfigured deployment — which
 * is the failure it exists to prevent, and the reason `required.every(passed)`
 * over an empty rollup once reported a mergeable pull request.
 *
 * The first case is the trap that decided the implementation. `wrangler.jsonc`
 * carries a commented-out `services` example, and a text match reads that
 * comment as a declaration — reporting a `FAIL` against `MY_SERVICE` instead of
 * the honest `PENDING`. That is why the config is parsed as JSONC rather than
 * pattern-matched, and why the same file's `"https://…"` gets its own case: a
 * naive comment strip would cut that line in half at the `//`.
 *
 * Run by `node --test` from `check:theme-runtime-wiring`. Not vitest: its
 * include pattern is `src/**\/*.test.{ts,tsx}`, so a test beside a script would
 * never be collected — and a guard whose tests never run is what this guard
 * exists to prevent.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  FAIL,
  PENDING,
  PASS,
  evaluateThemeRuntimeWiring,
  parseJsonc,
  readDefaultThemeServiceBinding,
  stripJsonComments,
} from "./theme-runtime-wiring-scan.mjs";

const BINDING = "THEME_WORKER";
const withServices = (services) => ({ services });

describe("reading the config as JSONC", () => {
  it("does not treat a commented-out services example as a declaration", () => {
    const text = [
      "{",
      '  "name": "morph",',
      '  // "services": [{ "binding": "MY_SERVICE", "service": "my-service" }]',
      "}",
    ].join("\n");

    const parsed = parseJsonc(text);
    assert.equal(parsed.ok, true);
    assert.equal("services" in parsed.value, false);
    assert.equal(
      evaluateThemeRuntimeWiring({ config: parsed.value, defaultBindingName: BINDING })
        .state,
      PENDING,
    );
  });

  it("keeps a // inside a string, which a naive strip would cut in half", () => {
    const text = '{ "PUBLIC_URL": "https://morph.example.workers.dev" }';
    assert.equal(
      parseJsonc(text).value.PUBLIC_URL,
      "https://morph.example.workers.dev",
    );
  });

  it("keeps the URL that is a value and drops the one that is a comment", () => {
    const text = [
      "{",
      "  // docs: https://developers.cloudflare.com/workers/wrangler/",
      '  "vars": { "PUBLIC_URL": "https://morph.example.workers.dev" },',
      '  "services": [{ "binding": "THEME_WORKER", "service": "morph-theme-shop" }]',
      "}",
    ].join("\n");

    const parsed = parseJsonc(text);
    assert.equal(parsed.ok, true);
    assert.equal(
      parsed.value.vars.PUBLIC_URL,
      "https://morph.example.workers.dev",
    );
    assert.equal(parsed.value.services.length, 1);
    assert.equal(
      (stripJsonComments(text).match(/https:\/\//g) ?? []).length,
      1,
      "only the URL that is a value may survive the strip",
    );
  });

  it("removes a block comment", () => {
    assert.equal(parseJsonc('{ /* note */ "name": "morph" }').value.name, "morph");
  });

  it("tolerates a trailing comma, which JSONC allows", () => {
    const text = '{ "services": [{ "binding": "A", "service": "b" },], }';
    assert.equal(parseJsonc(text).value.services.length, 1);
  });

  it("reports an unreadable config instead of reading it as absent", () => {
    assert.equal(parseJsonc("{ not json").ok, false);
  });

  it("preserves offsets so a parse error still points at its line", () => {
    assert.equal(stripJsonComments("a\n// comment\nb").split("\n")[1], "          ");
  });
});

describe("the runtime's own binding name", () => {
  it("is read from the source rather than restated here", () => {
    assert.equal(
      readDefaultThemeServiceBinding(
        'export const DEFAULT_THEME_SERVICE_BINDING = "THEME_WORKER";',
      ),
      "THEME_WORKER",
    );
  });

  it("being unreadable is a FAIL, not a pass", () => {
    assert.equal(
      evaluateThemeRuntimeWiring({ config: {}, defaultBindingName: null }).state,
      FAIL,
    );
  });
});

describe("the three states", () => {
  it("no services key at all is PENDING, never PASS", () => {
    const verdict = evaluateThemeRuntimeWiring({
      config: {},
      defaultBindingName: BINDING,
    });
    assert.equal(verdict.state, PENDING);
    assert.match(verdict.message, /503/);
  });

  it("an empty services array is PENDING too", () => {
    assert.equal(
      evaluateThemeRuntimeWiring({
        config: withServices([]),
        defaultBindingName: BINDING,
      }).state,
      PENDING,
    );
  });

  it("a renamed binding is FAIL, and the message says what it found", () => {
    const verdict = evaluateThemeRuntimeWiring({
      config: withServices([
        { binding: "THEME_WORKERS", service: "morph-theme-shop" },
      ]),
      defaultBindingName: BINDING,
    });
    assert.equal(verdict.state, FAIL);
    assert.match(verdict.message, /THEME_WORKERS/);
    assert.match(verdict.message, /THEME_WORKER/);
  });

  it("a target that is not a storefront script name is FAIL", () => {
    const verdict = evaluateThemeRuntimeWiring({
      config: withServices([{ binding: BINDING, service: "my-service" }]),
      defaultBindingName: BINDING,
    });
    assert.equal(verdict.state, FAIL);
    assert.match(verdict.message, /my-service/);
  });

  it("a storefront-stable target is PASS", () => {
    assert.equal(
      evaluateThemeRuntimeWiring({
        config: withServices([{ binding: BINDING, service: "morph-theme-shop" }]),
        defaultBindingName: BINDING,
      }).state,
      PASS,
    );
  });

  it("finds the binding among unrelated services", () => {
    assert.equal(
      evaluateThemeRuntimeWiring({
        config: withServices([
          { binding: "OTHER", service: "other-worker" },
          { binding: BINDING, service: "morph-theme-shop" },
        ]),
        defaultBindingName: BINDING,
      }).state,
      PASS,
    );
  });
});
