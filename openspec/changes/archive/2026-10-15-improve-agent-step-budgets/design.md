# Design

## Context

See proposal.md for motivation. Ceilings currently occur in `config/opencode.template.jsonc`, agent Markdown frontmatter where present, and the routing table. Build is capped at 60, and general/frontend/backend at 40. The existing runtime documentation describes a final text-only step and manual renewal on new user input. No exact remaining-step counter is established by this investigation.

This is a cross-cutting prompt/configuration change, not an OpenCode runtime modification. The repository retains its existing configuration format; unrelated V2 migration is excluded.

## Goals / Non-Goals

**Goals:** Make related declarations consistent, avoid redundant exploration, and preserve enough state in conversation to resume safely when interrupted.

**Non-Goals:** Automatic continuation, plugins, step-count telemetry, model reassignment, altered permissions or delegation depth, compaction tuning, new persistent tracking files, or guaranteed prevention of interruptions.

## Decisions

1. **Selective ceiling increase.** Use 120 for build and 80 for general/frontend/backend. These are initial operational values, not measured optimal settings. Leave exploration, QA, and decision roles unchanged instead of doubling every agent. Update all corresponding declarations together and test rendering under both profiles without altering the model manifest.
2. **Shared execution guidance.** Put concise efficiency and recovery rules in the canonical cross-agent guidance and routing policy; use short references in relevant prompts where needed. Do not create a general Markdown agent solely to duplicate shared instructions. Reuse existing discovery/stop rules rather than layering conflicting prescriptions.
3. **Evidence-led batching.** Group only independent operations and reuse successful results. Do not assert that every tool call equals a model step; batching can reduce round trips but is not a guaranteed accounting mechanism. Long tasks are bounded without bypassing OpenSpec or nested-delegation limits.
4. **Text-only interruption template.** Capture completed/files, pending, verification, blockers/risks, and next manual action from known evidence. Do not require a last-minute state-file write, fabricated counter, or exact percentage-based trigger. A normal final-step summary is the primary recovery mechanism; existing progress updates provide supporting context. Keep specialist responses within their allowed fields and existing reviewer incomplete-verdict rules.
5. **Separate structural proof from behavior.** Extend focused acceptance coverage for the four ceilings, unchanged other ceilings, duplicate declaration agreement, rendered profiles, and presence of shared policy. Exercise interruption/resume with an isolated temporary low-step agent or controlled prompt fixture, not by lowering production defaults. Record actual observations; static checks alone cannot prove model compliance.

## Risks / Trade-offs

- [Larger ceilings permit more cost or longer loops] → Keep finite limits, early-stop rules, and no automatic restart.
- [Prompt compliance is probabilistic] → Test explicit exhaustion and manual continuation; disclose unverified behavior instead of promising guaranteed recovery.
- [Configuration overrides may supersede defaults] → Document installed/project override checks and verify rendered values; do not claim the live session changed merely because repository files did.
- [No exact step telemetry] → Avoid invented thresholds and use runtime exhaustion instructions plus existing progress evidence.
- [Batching dependent operations can race] → Restrict grouping to independent discovery and checks with stable inputs.

## Migration Plan

Implement and validate repository changes first. Run structural/profile/harness gates and isolated behavior checks, then let the operator install the selected existing profile and verify effective values in a new run. Do not change the installed configuration during proposal creation. Roll back by restoring the four previous ceilings and prior guidance, validating, and reinstalling the same profile. No data migration is required.
