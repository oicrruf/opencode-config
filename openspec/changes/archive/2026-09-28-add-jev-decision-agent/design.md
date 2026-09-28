## Context

See `proposal.md` for motivation. Direct SystemOne requests work, while the
local MCP lifecycle consistently times out. SystemOne supplies calibrated
typed primitives but is not a conversational provider, so Jev needs a small
host agent to normalize a bounded brief into a typed evaluation and report
the outcome.

## Goals / Non-Goals

**Goals:**
- Provide cheap, reliable, structured consultation without MCP startup.
- Prefer a recommended option when the supplied evidence supports one.
- Preserve scope gates: Jev advises; the primary agent owns decisions and
  OpenSpec compliance.

**Non-Goals:**
- Make Jev a general implementation, chat, or autonomous orchestration agent.
- Expose a new OpenCode model provider or retain the Jev MCP tool.

## Decisions

### Value-tier wrapper with direct SystemOne client

The `jev` subagent uses the value-tier model only to validate a bounded brief
and present a concise result. A Node client reads the existing OpenCode
OpenRouter auth entry as a fallback and submits the typed request directly to
SystemOne. This removes the failing MCP transport without duplicating the
endpoint contract.

Alternative: configure `typesafe/jev-1.13` as Jev's agent model. Rejected
because SystemOne is not an OpenAI-compatible chat-completions model.

### Fixed decision envelope

The prompt defines supported decision classes and requires explicit options,
one recommendation, confidence, rationale, and uncertainty. It uses a
`choice` primitive for selections and `score` or `noul` only where they fit.
The client validates input/output and rejects unsupported free-form work.

Alternative: permit arbitrary prompts. Rejected because broad delegation
would spend general-agent tokens and make calibrated output unreliable.

### Least privilege and explicit dispatch

Jev is a subagent with no edit, task, MCP, or external-directory permission.
Its shell permission is restricted to its local direct-client command. Other
agents invoke it under the existing task dispatch contract, supplying the
brief and alternatives.

## Risks / Trade-offs

- [A primary agent delegates trivial decisions] → prompt and routing docs
  limit Jev to bounded decisions where calibrated evidence is useful.
- [SystemOne is unavailable] → return a structured unavailable result so the
  caller can decide without Jev; never leak auth data.
- [A recommendation is mistaken for authority] → label output advisory and
  prohibit bypassing scope or approval gates.

## Migration Plan

1. Remove Jev MCP wiring and permissions before installing the new config.
2. Add the direct client and read-only agent definition with fixture tests.
3. Validate rendered profiles and start OpenCode without a Jev MCP entry.
4. Roll back by restoring the prior installed config backup; do not restore
   the MCP unless its runtime compatibility is independently fixed.
