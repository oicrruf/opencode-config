## Context

Two install-time choices (`./install.sh --profile personal` and
`./install.sh --profile work`) currently route the 5 bounded-execution
agents (`build`, `general`, `frontend`, `backend`, `qa`) to different
model ids across profiles, and neither mapping is a good fit for the
workload. The agent-routing matrix and the routing comment in
`agent/routing.md` make the tier assignment explicit:

| Tier | Model | Cost (in / out per M) | Roles (today) |
|------|-------|------------------------|---------------|
| Decision | `openai/gpt-5.6-terra` | $2 / $12 | `architect`, `orchestrator`, `refactor`, `adversarial`, `cotizador`, `/opsx-propose` |
| Planning | `openai/gpt-5.6-luna` | $0.2 / $1.2 | `plan` |
| Direct-MiniMax | `minimax/MiniMax-M3` | $0.3 / $1.2 | root default, `spec-required` implementation |
| Ollama-MiniMax | `ollama-cloud/minimax-m3` | $0.6 / $2.4 | `personal`: `build`, `general`, `frontend`, `backend`, `qa` |
| Value | `ollama-cloud/gpt-oss:20b` | $0.07 / $0.3 | `explore`, `doctor`, `p5t-installer`, `small_model`, `archify`, `dedupe`, `mmx`, `mmx-h3-video`, `jev` |
| (work profile only) | `openai/gpt-5.6-terra` | $2 / $12 | `work`: `build`, `general`, `frontend`, `backend`, `qa` |

The Ollama-MiniMax row is a paid Ollama-hosted proxy of the same
underlying model that the direct row exposes at lower cost. It exists
to provide a second, isolated quota when the direct quota is exhausted
during a long-running session, not to be the default for the
bounded-execution tier. Routing every bounded-execution agent through
the Ollama proxy costs the operator roughly 2× the input price and 2×
the output price versus the direct tier, with no capability delta.

The `work` profile assigns the same 5 agents to Terra, which is the
decision tier. Terra's pricing is 6× the Ollama-MiniMax input and 40× the
Ollama-MiniMax output, again with no capability delta for the workload
(bounded multi-file edits and review).

`ollama-cloud/gpt-oss:20b` is already in the manifest for the
read-mostly slots (`explore`, `doctor`, `p5t-installer`, `small_model`)
and is validated for tool calling. Its 131k context window is
sufficient for the bounded-execution workload and its cost
($0.07/$0.3) is the lowest of the available Ollama Cloud ids.

## Goals / Non-Goals

**Goals**

1. The 5 bounded-execution agents (`build`, `general`, `frontend`,
   `backend`, `qa`) run on `ollama-cloud/gpt-oss:20b` in **both**
   profiles.
2. The profile-rendering flow continues to work end-to-end for both
   profiles; the only diff between profiles after this change is
   `root.model` (`minimax/MiniMax-M3` vs `openai/gpt-5.6-terra`) and
   `commands.opsx-apply` (`minimax/MiniMax-M3` vs
   `openai/gpt-5.6-terra`).
3. `scripts/test-model-profiles.mjs` exits 0 with the new manifest.
4. `scripts/acceptance-harness.mjs` exits 0 for the routing group
   with the new expected values.
5. `scripts/validate-config.mjs` exits 0 against the new manifest
   with the existing skip-notice behavior preserved.
6. The spec `agent-routing` reflects the new tier mapping and the
   spec `minimax-tier-split` is removed because it describes a tier
   that no longer carries any assignments.

**Non-Goals**

1. No new model id added to the manifest; no model id removed.
2. No change to the `minimax/MiniMax-M3` (direct) assignments (root
   default, `spec-required` implementation, `/opsx-apply` in
   `personal`).
3. No change to the `openai/gpt-5.6-terra` (decision) assignments
   (`architect`, `orchestrator`, `refactor`, `adversarial`,
   `cotizador`, `/opsx-propose`).
4. No change to the existing Value tier assignments
   (`explore`, `doctor`, `p5t-installer`, `small_model`, `archify`,
   `dedupe`, `mmx`, `mmx-h3-video`, `jev`).
5. No change to `agent/build.md`, `agent/general.md`,
   `agent/frontend.md`, `agent/backend.md`, `agent/qa.md`
   frontmatter; they do not currently declare a `model:` line for
   these agents, only the manifest does.
6. No change to the install.sh or any post-install verification gate.
7. No introduction of new profile-specific tooling or per-agent
   switching logic. The profiles remain install-time choices that
   differ only in the root model and the `opsx-apply` command model.

## Decisions

### Decision: unify the 5 bounded-execution agents on `gpt-oss:20b` in both profiles

The two profiles converge on the same model id for the 5 bounded-
execution agents. The profiles retain their different root model and
`opsx-apply` command model, which is the load-bearing difference
between them today. The execution agents are the same workload in
both profiles; routing them to the same model id is consistent with
that workload being identical.

Alternatives considered:

- **Keep the two profiles on different model ids.** Rejected: the
  operator selects between profiles at install time without changing
  the workload. The "more capable work profile" promise is a misread
  of the routing matrix — Terra costs 6×–40× more for bounded edits
  with no capability bump.
- **Move `work` to `ollama-cloud/minimax-m3` (Ollama proxy).**
  Rejected: this is the cost problem we are solving, not a fix. The
  Ollama proxy is more expensive than the direct tier for the same
  underlying model.
- **Move `work` to `minimax/MiniMax-M3` (direct).** Rejected: the
  direct quota has the 1M context window and isolation that the
  `spec-required` implementation depends on. Saturating that quota
  with bounded-execution traffic from `work` sessions reduces the
  budget available for the load-bearing case.
- **Add a third profile or a `--mode` flag.** Rejected: out of scope
  and adds new surface for a question that the current model
  inventory can answer.

### Decision: shrink `test-model-profiles.mjs` check 3 to compare only the remaining differentiators

Check 3 currently asserts both `personal.agent.build.model !==
work.agent.build.model` and `personal.model !== work.model`. After
this change the first assertion is false for the 5 execution agents
(both profiles render the same id for them), so the assertion must
change shape. The differentiator that survives is `personal.model`
vs `work.model` (root) and the `commands.opsx-apply` model. The new
check asserts that **at least one** agent model and **at least one**
of the surviving differentiators differ between profiles, ensuring
the profiles still represent distinct install-time choices. This
preserves the test's intent (profiles are different) without
requiring every agent to differ.

Alternatives considered:

- **Drop check 3 entirely.** Rejected: the test guards against the
  profile manifest accidentally collapsing to identical entries
  (which would make the install-time flag a no-op). The differentiator
  still exists and is still worth testing.
- **Make check 3 assert that the profiles are byte-identical.**
  Rejected: that contradicts the operator's intent that the profiles
  are distinct install-time choices with different root models.
- **Add a fourth profile to test the per-agent-mode-switching
  scenario.** Rejected: out of scope; the operator asked for a
  unification, not a richer profile matrix.

### Decision: remove the `minimax-tier-split` spec

The spec exists to describe the split between `minimax/MiniMax-M3`
(direct) and `ollama-cloud/minimax-m3` (Ollama proxy) for the bounded-
execution tier. After this change, the Ollama-MiniMax tier carries
zero assignments; every bounded-execution agent sits on
`ollama-cloud/gpt-oss:20b`. The spec's central claims are now false
and the spec describes a state that no operator can reach. Marking
the spec `## REMOVED` keeps the history honest about what changed.

Alternatives considered:

- **Rewrite `minimax-tier-split` to describe the new Value tier.**
  Rejected: that becomes a fork of `agent-routing`'s Value tier
  bullet, which already exists. Two specs describing the same
  mapping is drift bait.
- **Leave `minimax-tier-split` in place with a "deprecated" notice.**
  Rejected: a deprecated spec is still queryable by the operator and
  by future agents; a removed spec cannot accidentally be cited.

### Decision: keep `gpt-oss:20b`'s existing slots untouched

The change extends `ollama-cloud/gpt-oss:20b` to 5 more slots. The
existing slots (`explore`, `doctor`, `p5t-installer`, `small_model`,
`archify`, `dedupe`, `mmx`, `mmx-h3-video`, `jev`) are unaffected;
their assignments and rationale do not change. The validator's
catalog skip-notice string keeps naming the Ollama Cloud ids it
already names (with `ollama-cloud/minimax-m3` removed from the list,
since no agent or command uses it after this change).

Alternatives considered:

- **Move the `gpt-oss:20b` slots to a different model id.** Rejected:
  the existing slots are read-mostly, tool-calling works, and the
  cost is already the lowest in the catalog.
- **Re-split the Value tier into a "read-mostly" and "write" sub-tier.**
  Rejected: out of scope and unnecessary; `gpt-oss:20b` is validated
  for both reads and bounded writes.

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| The 5 agents cannot complete a bounded task on `gpt-oss:20b` within the 131k context window. | Low | Earlier operator probes validated `gpt-oss:20b` for tool calling. The bounded-execution agents typically operate on a single change-set per session, well under 131k tokens. If a session overflows, the agent's session will degrade gracefully and the operator can re-run with a more focused brief; this is the same behavior the previous Ollama-MiniMax tier would have at 512k overflow. |
| After unification, `personal` and `work` look too similar for an operator to choose between them at install time. | Low | The differentiators (`root.model` and `commands.opsx-apply`) survive and are documented in `agent/routing.md` and the `_comment` in `config/model-profiles.json`. The README should be updated to point at those differentiators. |
| The validator's skip-notice string drops `ollama-cloud/minimax-m3` while a stale catalog still has it. | Low | The validator only checks IDs against the catalog when the catalog exists and parses. Stale entries are not flagged. The skip notice is informational; an unknown id in the manifest would fail with a clearer error. |
| A future contributor reintroduces `ollama-cloud/minimax-m3` because the spec `minimax-tier-split` was the only document describing why we use it. | Low | The change is documented in `openspec/changes/archive/<date>-unify-execution-tier-on-gpt-oss/` (after archive) and the new tier rationale lives in `agent-routing` and `agent/routing.md`. |
| The `scripts/test-model-profiles.mjs` check 3 rewrite drops a meaningful invariant. | Low | The new assertion still catches a regression where one profile accidentally mirrors the other root model. |
| The OpenCode catalog (`~/.cache/opencode/models.json`) on a host where `ollama-cloud/gpt-oss:20b` is missing or renamed. | Low | The validator prints a skip notice when the catalog is missing or unparseable, and exits zero in that case. A renamed id would surface as a phantom failure on hosts that ship an updated catalog; this is the same behavior any model id change exhibits. |

## Validation gates

`/opsx-apply` MUST NOT complete until every gate below is green:

1. **`config/model-profiles.json`** shows `ollama-cloud/gpt-oss:20b` for
   `build`, `general`, `frontend`, `backend`, and `qa` in both
   `profiles.personal.agents` and `profiles.work.agents`.
2. **`opencode.jsonc`** renders `agent.<name>.model` as
   `ollama-cloud/gpt-oss:20b` for those 5 agents after a fresh render
   of the `personal` profile.
3. **`node scripts/test-model-profiles.mjs`** exits 0 with the new
   expectations and the rewritten check 3.
4. **`node scripts/acceptance-harness.mjs`** exits 0 for the routing
   group with `EXPECTED_AGENT_MODELS` updated.
5. **`node scripts/validate-config.mjs --profile personal`** exits 0
   and prints `validate-config: OK` (or the same pre-existing
   `mmx-cli` warnings unrelated to this change).
6. **`bash ./install.sh --help`** exits 0 with the help body unchanged
   (no install-script edits in this change).
7. **`openspec validate unify-execution-tier-on-gpt-oss --strict`**
   exits 0; **`openspec validate --specs --strict`** exits 0 after
   the spec delta is applied.
8. **Check #9** still reports 0 CRLF in 169 shell/runtime files (the
   change does not touch line endings, but the gate is cheap to run
   and confirms the working tree has no incidental CRLF regressions).

## Out of scope (deferred)

- README updates describing how to choose between `personal` and
  `work`. The differentiators survive but the README's current
  wording may be stale; out of scope here, tracked for a separate
  `docs-refresh` change.
- A more aggressive Value tier consolidation (e.g. moving the
  `archify` / `dedupe` / `mmx` / `mmx-h3-video` commands to
  `ollama-cloud/gpt-oss:20b` is what they already use; nothing to
  change there).
- Adding a profile that distinguishes more on capability (e.g. a
  `coding` profile that uses `minimax/MiniMax-M3` for bounded edits
  when the operator wants the direct tier). Tracked as a separate
  `add-coding-profile` proposal if the operator wants it later.
