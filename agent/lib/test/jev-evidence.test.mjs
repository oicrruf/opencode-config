// Evidence-first regression tests for the Jev direct client. Run with
// `node agent/lib/test/jev-evidence.test.mjs`. The tests use a fake
// fetch and a temp audit log so they never hit the network and never
// touch the operator's real audit log on disk.
//
// Coverage:
//   1. Successful consultation includes literal upstream evidence
//      whose JSON.stringify contains the recommendation string.
//   2. status === "ok" is refused if the upstream payload does not
//      contain the recommendation substring.
//   3. audit log writes one row per successful consultation with
//      status=ok and a non-null evidenceDigest.
//   4. audit log writes one row per unavailable consultation with the
//      matching reason.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { consult, _setAuditPathOverrideForTest, _setUpstreamUrlOverrideForTest } =
  await import("../jev-client.mjs");

function withFakeFetch(handler, run) {
  const original = globalThis.fetch;
  globalThis.fetch = (url, init) => handler(url, init);
  try {
    return run();
  } finally {
    globalThis.fetch = original;
  }
}

const NOUL_BRIEF = {
  state: "Help! My payouts have been failing for 3 days.",
  questions: {
    is_urgent: { type: "noul", instructions: "Does this convey urgency?" },
  },
};

const NICOUL_UPSTREAM = {
  model: "typesafe/jev-1.13-20260917",
  answers: {
    is_urgent: { type: "noul", noul: 0.92 },
  },
};

test("successful consultation includes literal upstream evidence", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-evidence-ok-"));
  const log = join(dir, "consultations.jsonl");
  _setAuditPathOverrideForTest(log);
  try {
    const result = await withFakeFetch(async () => {
      return new Response(JSON.stringify(NICOUL_UPSTREAM), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }, () => consult(NOUL_BRIEF));
    assert.equal(result.status, "ok");
    assert.ok(typeof result.details.evidence === "string");
    assert.ok(result.details.evidence.length > 0);
    const evidence = JSON.parse(result.details.evidence);
    assert.ok(typeof evidence.upstream === "string");
    assert.ok(typeof evidence.surfacedRecommendation === "string");
    // The surfaced recommendation MUST be a substring of the literal
    // upstream payload (whitespace-stripped) so the evidence-first
    // contract can verify it.
    const upstreamStripped = evidence.upstream.replace(/\s+/g, "");
    assert.ok(
      upstreamStripped.includes(evidence.surfacedRecommendation),
      `upstream evidence does not contain surfaced recommendation: ${evidence.surfacedRecommendation}`,
    );
  } finally {
    _setAuditPathOverrideForTest(null);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fabricated recommendation is refused with unavailable", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-evidence-fab-"));
  const log = join(dir, "consultations.jsonl");
  _setAuditPathOverrideForTest(log);
  try {
    const result = await withFakeFetch(async () => {
      return new Response(JSON.stringify(NICOUL_UPSTREAM), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }, async () => {
      const mod = await import("../jev-client.mjs");
      return mod.consult({
        state: NOUL_BRIEF.state,
        questions: NOUL_BRIEF.questions,
        recommendation: "this was never issued by upstream",
      });
    });
    assert.equal(result.status, "unavailable");
    assert.equal(result.details.reason, "fabricated_recommendation");
  } finally {
    _setAuditPathOverrideForTest(null);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("successful call appends one audit row with evidenceDigest", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-evidence-log-ok-"));
  const log = join(dir, "consultations.jsonl");
  _setAuditPathOverrideForTest(log);
  try {
    await withFakeFetch(async () => {
      return new Response(JSON.stringify(NICOUL_UPSTREAM), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }, () => consult(NOUL_BRIEF));
    const lines = readFileSync(log, "utf8").trim().split("\n");
    const last = JSON.parse(lines[lines.length - 1]);
    assert.equal(last.status, "ok");
    assert.ok(last.evidenceDigest && last.evidenceDigest.length === 64);
    assert.ok(last.recommendation && last.recommendation.length > 0);
    assert.ok(last.briefDigest && last.briefDigest.length === 64);
  } finally {
    _setAuditPathOverrideForTest(null);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("unavailable call appends one audit row with the matching reason", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-evidence-log-err-"));
  const log = join(dir, "consultations.jsonl");
  _setAuditPathOverrideForTest(log);
  try {
    await withFakeFetch(async () => {
      throw new Error("should not be called");
    }, () => consult({ state: null, questions: {} }));
    const lines = readFileSync(log, "utf8").trim().split("\n");
    const last = JSON.parse(lines[lines.length - 1]);
    assert.equal(last.status, "unavailable");
    assert.equal(last.reason, "invalid_brief");
    assert.equal(last.recommendation, null);
    assert.equal(last.evidenceDigest, null);
  } finally {
    _setAuditPathOverrideForTest(null);
    rmSync(dir, { recursive: true, force: true });
  }
});
