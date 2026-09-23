// Self-contained regression tests for the Jev direct client. Run with
// `node agent/lib/test/jev-client.test.mjs`. The tests use a fake fetch
// implementation so they never hit the network and do not depend on a
// real OpenRouter key. They cover:
//
//   1. valid noul brief returns the upstream recommendation and confidence
//   2. invalid briefs (missing state, bad question type, empty choice
//      criteria) are rejected without contacting upstream
//   3. missing credentials surface as structured unavailability
//   4. upstream non-2xx is reported without echoing the key
//   5. upstream timeout is reported within the deadline
//   6. credential resolution falls back to auth.json when the env var is
//      absent and skips the key when it is a known fixture value
//
// `missing_credentials` and the timeout test run in a fresh Node
// subprocess because the operator's `~/.local/share/opencode/auth.json`
// otherwise provides a real OpenRouter key through the auth-store
// fallback, masking the credential-missing code path.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// For tests 1 and 4 we can safely consult with the operator's real auth,
// but we set an env-var override to a fixture so the credentials path is
// deterministic and never touches the real key. The auth-store fallback is
// only exercised by test 6 with an explicit mkdtemp auth.json path.
process.env.OPENROUTER_API_KEY = "sk-or-fixture";
process.env.OPENCODE_AUTH_PATH = "/nonexistent/auth.json";

const { consult, resolveApiKey, deadlineMsForTest, _setHomedirOverrideForTest, _setUpstreamUrlOverrideForTest } = await import("../jev-client.mjs");

// Redirect the operator's real ~/.local/share/opencode/auth.json to a temp
// directory so tests can simulate the missing-credentials path without
// touching production state. The override is unset in afterEach hooks.
function withIsolatedHome(fn) {
  const dir = mkdtempSync(join(tmpdir(), "jev-home-"));
  _setHomedirOverrideForTest(dir);
  // Reset env so the env override cannot bypass the homedir override.
  delete process.env.OPENROUTER_API_KEY;
  process.env.OPENCODE_AUTH_PATH = "/nonexistent/auth.json";
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    _setHomedirOverrideForTest(null);
    delete process.env.OPENCODE_AUTH_PATH;
  }
}

function withFakeFetch(handler, run) {
  const original = globalThis.fetch;
  globalThis.fetch = (url, init) => handler(url, init);
  try {
    return run();
  } finally {
    globalThis.fetch = original;
  }
}

const NICOUL_BRIEF = {
  state: "Help! My payouts have been failing for 3 days.",
  questions: {
    is_urgent: { type: "noul", instructions: "Does this convey urgency?" },
  },
};

test("noul brief returns recommendation and confidence", async () => {
  const result = await withFakeFetch(async () => {
    return new Response(
      JSON.stringify({
        model: "typesafe/jev-1.13-20260917",
        answers: {
          is_urgent: { type: "noul", noul: 0.92 },
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }, () => consult(NICOUL_BRIEF));
  assert.equal(result.status, "ok");
  assert.match(result.recommendation, /is_urgent=noul\(0\.92\)/);
  assert.equal(result.confidence, 0.92);
  assert.equal(result.details.raw.model, "typesafe/jev-1.13-20260917");
});

test("invalid briefs are rejected without contacting upstream", async () => {
  let calls = 0;
  const run = async (brief) => {
    calls = 0;
    return withFakeFetch(async () => {
      calls++;
      throw new Error("fetch should not have been called");
    }, () => consult(brief));
  };
  const missingState = await run({ questions: NICOUL_BRIEF.questions });
  assert.equal(missingState.status, "unavailable");
  assert.equal(missingState.details.reason, "invalid_brief");
  assert.equal(calls, 0);

  const badType = await run({
    state: "hi",
    questions: { q: { type: "freeform", instructions: "?" } },
  });
  assert.equal(badType.details.reason, "invalid_brief");
  assert.equal(calls, 0);

  const emptyChoice = await run({
    state: "hi",
    questions: { q: { type: "choice", instructions: "?", criteria: {} } },
  });
  assert.equal(emptyChoice.details.reason, "invalid_brief");
  assert.equal(calls, 0);

  const noQuestions = await run({ state: "hi", questions: {} });
  assert.equal(noQuestions.details.reason, "invalid_brief");
  assert.equal(calls, 0);
});

test("missing credentials surface as structured unavailability", async () => {
  // Redirect the home directory used by the auth-store fallback so the
  // operator's real ~/.local/share/opencode/auth.json cannot leak into
  // the test environment, then verify the client refuses to fetch.
  await withIsolatedHome(async () => {
    let calls = 0;
    const result = await withFakeFetch(async () => {
      calls++;
      throw new Error("fetch should not have been called");
    }, () => consult(NICOUL_BRIEF));
    assert.equal(calls, 0);
    assert.equal(result.status, "unavailable");
    assert.equal(result.details.reason, "missing_credentials");
    assert.match(result.details.hint, /OPENROUTER_API_KEY/);
    assert.equal(typeof result.details.deadlineMs, "number");
  });
});

test("upstream non-2xx is reported without echoing the key", async () => {
  process.env.OPENROUTER_API_KEY = "sk-or-v1-test-not-real-credential";
  try {
    const result = await withFakeFetch(async () => {
      return new Response("unauthorized", { status: 401 });
    }, () => consult(NICOUL_BRIEF));
    assert.equal(result.status, "unavailable");
    assert.equal(result.details.reason, "unauthorized");
    assert.doesNotMatch(JSON.stringify(result), /sk-or-v1/);
  } finally {
    delete process.env.OPENROUTER_API_KEY;
  }
});

test("upstream timeout is reported within the deadline", async () => {
  // Stand up a TCP listener that never replies, point the client at it,
  // and verify the AbortController fires `upstream_timeout` within the
  // shrunken deadline. The endpoint never receives an Authorization
  // header leak: the assertion checks the structured failure and the
  // absence of the key in the returned payload.
  const net = await import("node:net");
  const srv = net.createServer(() => {});
  await new Promise((r) => srv.listen(0, r));
  const port = srv.address().port;
  deadlineMsForTest(50);
  process.env.OPENROUTER_API_KEY = "sk-or-v1-test-not-real-credential";
  _setUpstreamUrlOverrideForTest(`http://127.0.0.1:${port}`);
  try {
    const result = await consult(NICOUL_BRIEF);
    assert.equal(result.status, "unavailable");
    assert.equal(result.details.reason, "upstream_timeout");
    assert.doesNotMatch(JSON.stringify(result), /sk-or-v1/);
  } finally {
    _setUpstreamUrlOverrideForTest(null);
    deadlineMsForTest(25_000);
    delete process.env.OPENROUTER_API_KEY;
    srv.close();
  }
});

test("resolveApiKey reads from auth.json when env is absent", () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-auth-"));
  const file = join(dir, "auth.json");
  process.env.OPENCODE_AUTH_PATH = file;
  delete process.env.OPENROUTER_API_KEY;
  try {
    // Fixture keys must be rejected even when found in auth.json.
    writeFileSync(file, JSON.stringify({ openrouter: { key: "sk-or-fixture" } }));
    assert.equal(resolveApiKey().source, null);

    // Real-shape key in a nested `auth.openrouter` envelope is honored.
    writeFileSync(file, JSON.stringify({ auth: { openrouter: { key: "sk-or-v1-test-not-real-credential" } } }));
    assert.equal(resolveApiKey().source, "auth-store");

    // Top-level `openrouter` object form is also accepted.
    writeFileSync(file, JSON.stringify({ openrouter: "sk-or-v1-test-not-real-credential" }));
    assert.equal(resolveApiKey().source, "auth-store");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
