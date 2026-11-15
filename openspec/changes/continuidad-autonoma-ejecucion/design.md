# Design

## Context

See proposal.md for AT-186. OpenCode 2.2.7 was inspected at its published tag. `packages/core/src/session/runner/llm.ts` applies the last-step restriction only when `loaded.agent.info.steps !== undefined && step >= loaded.agent.info.steps`. An isolated `opencode debug agents --standalone` resolved both primary agents without a steps property when omitted. Configuration sources merge: omission in a project cannot erase a finite value already installed globally. Both the installed root and symlinked primary frontmatter must be updated at rollout.

## Goals / Non-Goals

**Goals:** Native continuity in one user turn, explicit specialist limits, recoverable progress, and test evidence separating runtime behavior from model compliance.

**Non-Goals:** A supervisor, automatic session restart, synthetic user input, new permission grants, model changes, hard monetary enforcement, automatic installation, or changes to specialist delegation depth.

## Decisions

1. Omit steps only for `build` and `plan`, the two primary agents. `orchestrator` and `refactor` are currently subagents and retain 100. Zero, null, a huge integer, and legacy maxSteps are not substitutes for omission. This uses native runtime continuation rather than a restart plugin and therefore adds no concurrent runner or duplicated external operation.
2. Shared instructions require working toward acceptance while authorized and making progress. The installed build/plan Markdown prompts carry the essential controls themselves, because a consumer project does not inherit this repository's AGENTS.md. Integration resolves the actual rendered config and primary Markdown in an unrelated temporary project. A short conversational checkpoint after each bounded unit records completed/files, ordered pending work, verification, and blockers. The coordinator can finish an incomplete specialist unit directly within its permissions or issue a narrower task where routing and review gates allow; specialists do not restart themselves. Required review re-dispatch limits still apply.
3. Stop after three consecutive unsuccessful attempts at the same blocked action without new evidence, unless the operator gives another finite threshold. Honor an explicit operator elapsed-time or cost budget using observed values only. These are prompt-level controls, not a plugin watchdog or guaranteed monetary cap. Permission requests, cancellation, scope changes, and persistent provider failures remain real stop conditions. Record these limitations plainly.
4. Keep the text-only handoff for externally imposed limits and real interruptions. It is a fallback, not the primary execution lifecycle. If tools are already removed, summarize known evidence without claiming a final state write. Completion is never inferred solely from a summary.
5. Add an isolated Node integration harness against the installed OpenCode CLI with a loopback OpenAI-compatible scripted provider. It drives multiple sequential read calls, records last-step tool restrictions, checks early termination, project/global/frontmatter precedence, and denial/error/cancellation behavior. Tests use temporary config/data/cache/state and bounded subprocess timeouts; no production permissions or provider credentials are changed. Add an explicit live mode using an existing authenticated provider and a temporary read-only agent; no auth contents are printed or copied to the repository. A scripted provider proves runtime control flow, while live evidence proves model behavior only for the observed task. Live assertions require six distinct read message IDs in chain order and a separate final response step; tool-call count alone is insufficient.
6. Align both main specs with the delta, keeping the active change for review rather than archiving automatically. Profile tests must check omission and specialist budgets for personal and work. Acceptance must reject stale finite primary values in template, rendered root, or frontmatter.

## Risks / Trade-offs

- [Longer executions can consume more resources] → Explicit acceptance, early completion, observed operator budgets, and prompt-level no-progress stopping; user cancellation remains available.
- [Old global configuration still contributes steps] → Document reinstall and inspect effective agents in a fresh run; never claim activation from repository edits alone.
- [Model compliance is probabilistic] → Deterministic real-runtime tests plus a separately reported authenticated-provider observation, with failure/blockage reported honestly.
- [Provider or CLI compatibility changes] → Record version and requests in test results; fail closed on unsupported CLI/config behavior rather than silently skipping coverage.

## Migration Plan

Validate repository changes and both profiles, run isolated integration and live observation, and complete targeted final review. The operator then runs `./install.sh --profile <selected>` and starts a fresh run; project overrides must also omit primary steps. Roll back by restoring the previous template, root, primary frontmatter, and guidance together, validating, and reinstalling the same profile. Do not modify installed configuration as part of this change.
