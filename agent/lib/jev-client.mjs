// Local direct SystemOne client used by the read-only `triage` subagent.
//
// This client exists because the previous Jev MCP server repeatedly
// timed out OpenCode's stdio lifecycle even when the underlying REST
// requests succeeded. The agent now uses a Node-side HTTP call directly,
// with a 25-second upstream deadline (well under OpenCode's 30-second
// operation timeout). It is intentionally a single module with no
// dependencies so the agent stays tiny and auditable.
//
// Auth resolution precedence:
//   1. `OPENROUTER_API_KEY` environment variable.
//   2. Read-only read of `~/.local/share/opencode/auth.json` looking for
//      `auth.openrouter.key`. The key is never written, logged, or echoed.
//
// The client enforces a strict decision envelope so the agent cannot be
// turned into a free-form chat client. Inputs and outputs are validated
// against the primitives defined in `openspec/specs/triage-decision-agent/spec.md`.

import process from "node:process";
import { readFileSync, mkdirSync, openSync, fsyncSync, closeSync, writeSync } from "node:fs";
import { homedir as osHomedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";

function currentHomedir() {
  if (typeof homedirOverride === "function") return homedirOverride();
  if (typeof homedirOverride === "string") return homedirOverride;
  return osHomedir();
}

const UPSTREAM_URL = "https://openrouter.ai/api/v1/systemone";
const UPSTREAM_MODEL = "typesafe/jev-1.13";

// Allow tests to point consult() at a stub URL without rewriting the
// module's constants at import time.
let UPSTREAM_URL_OVERRIDE = null;
export function _setUpstreamUrlOverrideForTest(value) {
  UPSTREAM_URL_OVERRIDE = value;
}
function currentUpstreamUrl() {
  return UPSTREAM_URL_OVERRIDE ?? UPSTREAM_URL;
}

// Internal deadline exposed for tests via `deadlineMsForTest` below.
let UPSTREAM_DEADLINE_MS = 25_000;
export function deadlineMsForTest(ms) {
  UPSTREAM_DEADLINE_MS = ms;
}
export const deadlineMs = () => UPSTREAM_DEADLINE_MS;

const FIXTURE_KEYS = new Set(["sk-or-v1-replace-me", "sk-or-fixture"]);

function isLikelyKey(s) {
  return typeof s === "string" && s.length > 0 && !FIXTURE_KEYS.has(s);
}

function readAuthJson() {
  const candidates = [
    process.env.OPENCODE_AUTH_PATH,
    authPathOverride ?? join(currentHomedir(), ".local/share/opencode/auth.json"),
  ];
  for (const p of candidates.filter(Boolean)) {
    try {
      const raw = readFileSync(p, "utf8");
      return JSON.parse(raw);
    } catch {
      // try next candidate
    }
  }
  return null;
}

// Test hooks: allow the test harness to redirect auth.json resolution
// without mutating global state. Callers in production never touch these.
let authPathOverride = null;
let homedirOverride = null;
export function _setAuthPathOverrideForTest(value) {
  authPathOverride = value;
}
export function _setHomedirOverrideForTest(value) {
  homedirOverride = value;
}

export function resolveApiKey() {
  if (isLikelyKey(process.env.OPENROUTER_API_KEY)) {
    return { key: process.env.OPENROUTER_API_KEY, source: "env" };
  }
  const auth = readAuthJson();
  const entry = auth && (auth.openrouter || (auth.auth && auth.auth.openrouter));
  const k = entry && (typeof entry === "string" ? entry : entry.key);
  if (isLikelyKey(k)) {
    return { key: k, source: "auth-store" };
  }
  return { key: null, source: null };
}

// --- Decision envelope validation -------------------------------------

const PRIMITIVES = new Set(["noul", "choice", "score"]);

function validateQuestions(questions) {
  if (!questions || typeof questions !== "object" || Array.isArray(questions)) {
    throw new Error("questions must be a non-array object keyed by question id");
  }
  const ids = Object.keys(questions);
  if (ids.length === 0) {
    throw new Error("questions must contain at least one question");
  }
  for (const id of ids) {
    const q = questions[id];
    if (!q || typeof q !== "object") {
      throw new Error(`question '${id}' must be an object`);
    }
    if (!PRIMITIVES.has(q.type)) {
      throw new Error(`question '${id}' has unsupported type '${q.type}'`);
    }
    if (typeof q.instructions !== "string" || q.instructions.trim() === "") {
      throw new Error(`question '${id}' must include non-empty instructions`);
    }
    if (q.type === "choice") {
      if (
        !q.criteria ||
        typeof q.criteria !== "object" ||
        Object.keys(q.criteria).length === 0
      ) {
        throw new Error(`choice question '${id}' must include a non-empty criteria map`);
      }
    }
  }
  return ids;
}

function validateState(state) {
  if (state === undefined || state === null) {
    throw new Error("state is required");
  }
  const t = typeof state;
  if (t === "string") {
    if (state.trim() === "") throw new Error("state string must be non-empty");
    return;
  }
  if (t !== "object") {
    throw new Error("state must be a string, object, or array");
  }
}

// --- Structured result shape -----------------------------------------

let lastBriefDigest = null;
function recordBriefDigest(brief) {
  try {
    lastBriefDigest = sha256(JSON.stringify({ state: brief.state, questions: brief.questions }));
  } catch {
    lastBriefDigest = null;
  }
}

function unavailable(reason, hint) {
  const result = {
    status: "unavailable",
    recommendation: null,
    confidence: null,
    rationale: null,
    uncertainty: [reason],
    missing: [],
    details: { reason, hint, upstream: currentUpstreamUrl(), model: UPSTREAM_MODEL, deadlineMs: UPSTREAM_DEADLINE_MS },
  };
  appendAuditRow({
    timestamp: new Date().toISOString(),
    briefDigest: lastBriefDigest,
    status: "unavailable",
    reason,
    recommendation: null,
    confidence: null,
    evidenceDigest: null,
  });
  lastBriefDigest = null;
  return result;
}

function successful(payload) {
  return {
    status: "ok",
    recommendation: payload.recommendation ?? null,
    confidence: payload.confidence ?? null,
    rationale: payload.rationale ?? null,
    uncertainty: payload.uncertainty ?? [],
    missing: payload.missing ?? [],
    details: {
      upstream: currentUpstreamUrl(),
      model: UPSTREAM_MODEL,
      evidence: payload.evidence ?? null,
      raw: payload.raw ?? null,
    },
  };
}

// --- Audit log -------------------------------------------------------

const DEFAULT_AUDIT_PATH = resolve(
  process.cwd(),
  ".opencode/state/triage/consultations.jsonl",
);

let auditPathOverride = null;
export function _setAuditPathOverrideForTest(value) {
  auditPathOverride = value;
}
function currentAuditPath() {
  return auditPathOverride ?? DEFAULT_AUDIT_PATH;
}

let bypassFabricationCheck = false;
export function _setBypassFabricationCheckForTest(value) {
  bypassFabricationCheck = !!value;
}

function sha256(s) {
  return createHash("sha256").update(String(s)).digest("hex");
}

function appendAuditRow(row) {
  const target = currentAuditPath();
  try {
    mkdirSync(dirname(target), { recursive: true });
  } catch {
    // Best-effort: directory creation failures do not block the call.
  }
  let fd;
  try {
    fd = openSync(target, "a");
    const line = JSON.stringify(row) + "\n";
    writeSync(fd, line);
    fsyncSync(fd);
  } catch {
    // Audit failures are never fatal to the consultation.
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* ignore */ }
    }
  }
}

function summarizeAnswers(answers) {
  // SystemOne returns `{type, noul|choice|score, probabilities?, confidence?, legend?}`.
  // The surfaced recommendation MUST be a substring of the upstream JSON
  // payload so the evidence-first contract can verify it. We pick the
  // first answer and emit the substring `"<id>":<JSON(ans)>` that
  // appears verbatim inside the upstream `answers` map.
  if (!answers || typeof answers !== "object") {
    return { recommendation: null, confidence: null, raw: null };
  }
  let recommendation = null;
  let confidence = null;
  const raw = {};
  for (const [id, ans] of Object.entries(answers)) {
    raw[id] = ans;
    if (!ans || typeof ans !== "object") continue;
    const t = ans.type;
    if (t === "noul") {
      if (recommendation === null) {
        recommendation = `"${id}":${JSON.stringify(ans)}`;
      }
      if (confidence === null) confidence = ans.noul;
    } else if (t === "choice") {
      if (recommendation === null) {
        recommendation = `"${id}":${JSON.stringify(ans)}`;
      }
      if (confidence === null) confidence = ans.confidence ?? null;
    } else if (t === "score") {
      if (recommendation === null) {
        recommendation = `"${id}":${JSON.stringify(ans)}`;
      }
      if (confidence === null) confidence = ans.confidence ?? null;
    }
  }
  return { recommendation, confidence, raw };
}

// --- Public API -------------------------------------------------------

/**
 * Run a bounded decision consultation against SystemOne.
 *
 * @param {{state: any, questions: object, brief?: string, classes?: string[]}} brief
 * @returns {Promise<{status: 'ok'|'unavailable', recommendation: any, confidence: any,
 *   rationale: any, uncertainty: string[], missing: string[], details: object}>}
 */
export async function consult(brief) {
  lastBriefDigest = null;
  if (!brief || typeof brief !== "object") {
    return unavailable(
      "invalid_brief",
      "Brief must be an object with state and questions.",
    );
  }
  recordBriefDigest(brief);
  // Test-only override: a fabricated recommendation can be injected to
  // verify the evidence-first contract. Production callers never set
  // this field; if it is set, the call MUST NOT return status=ok when
  // the recommendation is not a substring of the upstream payload.
  const forcedRecommendation = typeof brief.recommendation === "string" ? brief.recommendation : null;
  let ids;
  try {
    validateState(brief.state);
    ids = validateQuestions(brief.questions);
  } catch (err) {
    return unavailable(
      "invalid_brief",
      err && err.message ? err.message : String(err),
    );
  }

  const { key, source } = resolveApiKey();
  if (!key) {
    return unavailable(
      "missing_credentials",
      "OpenRouter API key is optional for this configuration. Triage is being skipped because OPENROUTER_API_KEY is empty and ~/.local/share/opencode/auth.json has no openrouter.key; continue without Triage. Use /connect only if you want to enable Triage.",
    );
  }

  const body = {
    model: UPSTREAM_MODEL,
    state: brief.state,
    questions: brief.questions,
  };
  lastBriefDigest = sha256(JSON.stringify(body));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_DEADLINE_MS);

  let response;
  try {
    response = await fetch(currentUpstreamUrl(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err && err.name === "AbortError") {
      return unavailable(
        "upstream_timeout",
        `OpenRouter did not respond within ${UPSTREAM_DEADLINE_MS} ms; retry or proceed without Jev.`,
      );
    }
    return unavailable(
      "upstream_network_error",
      err && err.message ? err.message : String(err),
    );
  }
  clearTimeout(timer);

  const text = await response.text();
  if (!response.ok) {
    return unavailable(
      response.status === 401 ? "unauthorized" : `http_${response.status}`,
      response.status === 401
        ? "Upstream rejected the credentials; re-run /connect for OpenRouter."
        : `OpenRouter returned HTTP ${response.status}.`,
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return unavailable(
      "upstream_parse_error",
      err && err.message ? err.message : "Response body was not JSON.",
    );
  }
  const summary = summarizeAnswers(parsed.answers);
  const surfacedRecommendation = forcedRecommendation ?? summary.recommendation;
  // Upstream-only evidence: the canonical source of truth. The
  // fabrication check runs against this string alone. We strip
  // whitespace because JSON.stringify uses a space after every
  // colon/comma while our surfaced recommendation does not.
  const upstreamEvidenceRaw = JSON.stringify({
    model: parsed.model ?? UPSTREAM_MODEL,
    answers: parsed.answers,
    rationale: parsed.rationale ?? null,
    usage: parsed.usage ?? null,
    authSource: source,
  });
  const upstreamEvidence = upstreamEvidenceRaw.replace(/\s+/g, "");
  // Compose the surfaced recommendation from the upstream answer so it
  // is, by construction, a substring of the upstream evidence. This
  // makes the fabrication guard a meaningful check: any value that
  // does not match the upstream structure cannot return ok.
  let displayString = surfacedRecommendation;
  if (summary.recommendation && surfacedRecommendation === summary.recommendation) {
    // The summary already produced a string of the shape
    // `<id>=<primitive>(<value>)` from `answers[id]`. Verify it
    // appears in the upstream evidence; if not, refuse.
    displayString = summary.recommendation;
  }
  const evidence = JSON.stringify({
    upstream: upstreamEvidenceRaw,
    surfacedRecommendation: displayString,
  });
  const result = successful({
    recommendation: surfacedRecommendation,
    confidence: summary.confidence,
    rationale: parsed.rationale ?? null,
    uncertainty: [],
    missing: [],
    evidence,
    raw: {
      model: parsed.model ?? UPSTREAM_MODEL,
      answers: summary.raw,
      usage: parsed.usage ?? null,
      authSource: source,
    },
  });
  // Evidence-first contract: refuse `status: "ok"` if the surfaced
  // recommendation is not a substring of the literal upstream payload.
  // The upstream payload is the canonical source of truth; the surfaced
  // recommendation is the host's claim, which MUST be backed by it.
  if (!bypassFabricationCheck) {
    const rec = result.recommendation;
    if (rec !== null && rec !== undefined && !upstreamEvidence.includes(String(rec))) {
      appendAuditRow({
        timestamp: new Date().toISOString(),
        briefDigest: sha256(JSON.stringify(body)),
        status: "unavailable",
        reason: "fabricated_recommendation",
        recommendation: null,
        confidence: null,
        evidenceDigest: sha256(evidence),
      });
      lastBriefDigest = null;
      return unavailable(
        "fabricated_recommendation",
        "Upstream reply did not contain the surfaced recommendation; refusing to return ok.",
      );
    }
  }
  appendAuditRow({
    timestamp: new Date().toISOString(),
    briefDigest: sha256(JSON.stringify(body)),
    status: "ok",
    reason: null,
    recommendation: result.recommendation,
    confidence: result.confidence,
    evidenceDigest: sha256(evidence),
  });
  lastBriefDigest = null;
  return result;
}

// --- Self-check entry point -------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const fake = {
    state: "Help! My payouts have been failing for 3 days.",
    questions: {
      is_urgent: { type: "noul", instructions: "Does this convey urgency?" },
    },
  };
  consult(fake).then((r) => {
    process.stdout.write(JSON.stringify(r, null, 2) + "\n");
  });
}
