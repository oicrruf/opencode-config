# Design

## Context

See `proposal.md` for motivation. The current reviewer defaults to `targeted`, but its broad purpose text, full-mode escalation rule, and 100-step ceiling do not prescribe a bounded handoff or a terminal closure. The reviewer instructions also contain conflicts with its read-only role and the global single-depth delegation policy. Existing `agent-routing` and `context-budget` specs define audit modes and the step ceiling, so the new policy must extend rather than replace them.

## Goals / Non-Goals

**Goals:**
- Make the coordinator's adversarial dispatch decision deterministic from documented risk classes.
- Keep a targeted review limited to final-diff evidence and directly affected paths.
- Make review closure observable: introduced versus pre-existing findings, one focused re-review, and a terminal incomplete result when necessary.
- Preserve full reviews for explicit requests and concrete high-risk work.

**Non-Goals:**
- Change the reviewer model, global step ceilings, or the independently configured QA workflow.
- Remove the ability to request an explicit full review.
- Automatically repair findings, change the reviewer into an implementation agent, or introduce runtime usage telemetry.

## Decisions

### 1. Use a coordinator-owned risk matrix

The coordinator will decide whether to omit, target, or require adversarial review after task-relevant verification and against the final diff. Low-risk mechanical changes omit the independent review; bounded logic changes receive one targeted review; defined security, data, compatibility, or incident risks require one. This avoids the reviewer self-expanding its mandate and prevents repeated reviews during incremental edits.

**Alternative considered:** Always review every change. Rejected because it makes the expensive independent audit a universal completion gate rather than a risk control.

### 2. Define targeted scope in the reviewer prompt, not through dynamic tool permissions

Targeted mode will explicitly limit investigation to the final diff, direct callers/dependencies, and relevant axes. Browser, broad repository, dependency-wide, and full-suite checks need concrete evidence from the diff. The current OpenCode configuration exposes one static permission set per agent, so changing MCP permissions per mode is not an enforceable runtime control; the prompt and acceptance harness are the appropriate policy boundary.

**Alternative considered:** Remove Playwright from the agent. Rejected because a genuinely high-risk or explicitly full UI review still needs it and static permissions cannot express the mode distinction.

### 3. Make the review verdict terminal after one focused re-review

The review report will classify findings as introduced, pre-existing, or unverifiable. Only introduced `BLOCKER` and `MAJOR` findings trigger remediation; after fixes, the coordinator permits one focused re-review limited to those findings. If material risk cannot be verified within the budget, the reviewer returns an incomplete verdict with an explicit operator decision rather than repeatedly broadening the audit.

**Alternative considered:** Use remaining step capacity for unlimited review/fix rounds. Rejected because the 100-step ceiling is a safety ceiling, not a workflow budget, and it does not bound elapsed time.

### 4. Tighten full-mode escalation without changing the decision-tier model

Full mode remains available for explicit requests and documented security, migration, public-compatibility, or incident risks. An external-facing artifact alone does not upgrade the review. `adversarial` remains on its current decision-tier model and highest-mode step ceiling because model selection and mode-specific limits are static in the present configuration.

**Alternative considered:** Downgrade targeted reviews to a cheaper model or lower the static step count. Rejected for this change because a static model or step reduction would also weaken full reviews; behavior-first bounding gives a measurable improvement without conflating cost and assurance decisions.

### 5. Resolve role-contract conflicts directly

The adversarial agent remains read-only and does not dispatch nested reviewers. It may propose convention changes as findings, but implementation belongs to the main thread or an explicitly authorized follow-up. The refactor workflow will retain its mandatory compatibility review for its existing high-risk boundary while adopting the common verdict and re-review terminology.

## Risks / Trade-offs

- [A low-risk change is misclassified and skips a useful review] → Define the high-risk trigger list in routing policy and preserve user-requested reviews.
- [A targeted review misses a broad systemic issue] → Permit full review when concrete risk evidence or an explicit request exists; report unverifiable material risks rather than silently passing.
- [Policy exists only in prose] → Update the acceptance harness and validator checks for the enforceable static contracts, including required wording/permissions and no conflicting delegation allowance.
- [Existing automation expects an unconditional refactor audit] → Preserve the refactor-specific mandatory audit; only constrain its scope and closure.

## Migration Plan

1. Update the authoritative specs and routing/agent instructions together.
2. Update static configuration or validation assertions only where the revised contract can be mechanically checked.
3. Run configuration validation, model-profile tests, acceptance harness, and strict OpenSpec validation.
4. Roll back by restoring the prior agent and routing instructions if validation reveals incompatible workflow assumptions; no user data or runtime migration is involved.
