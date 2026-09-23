// Local direct SystemOne client used by the read-only `jev` subagent.
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
// against the primitives defined in `openspec/specs/jev-decision-agent/spec.md`.

import process from "node:process";
import { readFileSync } from "node:fs";
import { homedir as osHomedir } from "node:os";
import { join } from "node:path";

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

function unavailable(reason, hint) {
  return {
    status: "unavailable",
    recommendation: null,
    confidence: null,
    rationale: null,
    uncertainty: [reason],
    missing: [],
    details: { reason, hint, upstream: currentUpstreamUrl(), model: UPSTREAM_MODEL, deadlineMs: UPSTREAM_DEADLINE_MS },
  };
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
      raw: payload.raw ?? null,
    },
  };
}

function summarizeAnswers(answers) {
  // SystemOne returns `{type, noul|choice|score, probabilities?, confidence?, legend?}`.
  // Jev (the host agent) asks for a single recommendation; we surface the top
  // answer as the recommendation, the confidence as-is, and the rest as
  // supporting context inside `details.raw`.
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
      if (recommendation === null) recommendation = `${id}=noul(${ans.noul})`;
      if (confidence === null) confidence = ans.noul;
    } else if (t === "choice") {
      if (recommendation === null) recommendation = `${id}=${ans.choice}`;
      if (confidence === null) confidence = ans.confidence ?? null;
    } else if (t === "score") {
      if (recommendation === null) recommendation = `${id}=${ans.score}`;
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
  if (!brief || typeof brief !== "object") {
    return unavailable(
      "invalid_brief",
      "Brief must be an object with state and questions.",
    );
  }
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
      "Authenticate with OpenRouter via /connect; OPENROUTER_API_KEY is empty and ~/.local/share/opencode/auth.json has no openrouter.key.",
    );
  }

  const body = {
    model: UPSTREAM_MODEL,
    state: brief.state,
    questions: brief.questions,
  };
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
  return successful({
    recommendation: summary.recommendation,
    confidence: summary.confidence,
    rationale: parsed.rationale ?? null,
    uncertainty: [],
    missing: [],
    raw: { model: parsed.model ?? UPSTREAM_MODEL, answers: summary.raw, usage: parsed.usage ?? null, authSource: source },
  });
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
