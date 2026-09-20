## Context

`quota-tui.tsx` currently reads two providers by spawning authenticated CLI
binaries (`codex app-server --stdio` JSON-RPC, and
`mmx quota show --output json`) and caches each rendered line in
`api.kv` under the `quota-footer.status` key. Both existing paths already
share the patterns this change reuses: the `AUTH_REQUIRED_PATTERNS` matcher,
`resetLabel()`, `quotaBar()`, and the `[quota-footer]` warning prefix.

Three constraints shape this design and come from the live API rather than
from preference:

1. `GET https://ollama.com/api/usage` is the only usage endpoint. It returns
   `limits.monthly.usage` (a dollar amount) and `limits.monthly.models[]`
   with `request_count` per model. No sibling endpoint exposes a plan
   (`/api/plan`, `/api/subscription`, `/api/account`, `/api/limits`,
   `/api/billing/usage` all return 404), and no query parameter adds a cap
   (`?detail`, `?include`, `?full`, `?expand` all return the same two keys).
2. The response therefore has no denominator and no reset timestamp, which
   is why the specs require a dollar-and-count segment with neither a bar
   nor a reset indicator.
3. OpenCode stores the credential at `<XDG_DATA_HOME>/opencode/auth.json`
   under key `ollama-cloud`, with shape `{ type: "api", key: "<57 chars>" }`.
   The plugin API exposes `api.state.path.state` but **not** the data
   directory, and the SDK's credential surface is write-only
   (`V2CredentialUpdate` / `V2CredentialRemove` — there is no read call), so
   the plugin must read the file. The path is reconstructed from
   `$XDG_DATA_HOME/opencode/auth.json` (default `~/.local/share/opencode/auth.json`),
   mirroring the rule OpenCode itself applies at startup.

See `proposal.md` — Why for motivation and the delta spec for the behavior
contract.

## Goals / Non-Goals

**Goals:**

- Add a third provider segment that renders consumed dollars and request
  count, reusing the existing segment shape (icon + provider label).
- Reuse the established failure semantics: per-cycle warning, cached value
  preserved across transient failures, login label on missing or rejected
  credentials.
- Keep the credential out of every log, warning, error message, and
  rendered label.
- Avoid new environment variables and avoid touching `opencode.jsonc`.

**Non-Goals:**

- Rendering a percentage, a remaining balance, or a reset countdown. The
  endpoint does not provide the inputs; see Context.
- Switching the existing Codex and MiniMax reads to HTTP. They stay on
  their authenticated CLIs.
- Changing the refresh cadence, the `api.kv` state key, or the slot
  registration.
- Adding per-model breakdowns to the footer. The full model list stays out
  of the rendered line; only the aggregate request count is shown.

## Decisions

**Use `fetch` over `spawn`.** The existing helpers shell out because the
authoritative data lives in CLIs that own their own auth. Ollama Cloud is
an HTTP API, Node 26 provides a global `fetch`, and spawning a process to
reach an HTTPS endpoint would add a failure surface (binary on PATH, exit
codes, stderr parsing) for no gain. The `run()` helper is reused only where
a CLI is genuinely involved.

**Read the credential from `auth.json`, reconstructed via the same XDG rule
OpenCode applies to its data directory.** Alternatives considered: (a) a
dedicated `OLLAMA_API_KEY` environment variable — rejected because OpenCode
already stores the credential, so the variable would be redundant state the
operator must keep in sync, and it contradicts "no second login step";
(b) the SDK credential API — rejected because it exposes no read operation;
(c) `api.state.path.state` as the lookup root — rejected because the state
and data directories diverge under XDG (e.g. `~/.local/state` vs
`~/.local/share`) and the plugin API does not expose the data dir;
(d) hard-coding `~/.local/share/opencode/auth.json` — rejected because the
path is XDG-relocatable, so the lookup rule must be applied.

**Cache `undefined`-on-transient-failure semantics identical to codex.**
The read helper returns three distinct outcomes, matching the existing
contract: a fresh label string, `null` for a missing credential (which
renders the login label), and `undefined` for a transient failure (which
preserves the cached value and emits one warning). Reusing the shape means
the refresh logic extends by one branch instead of introducing a second
failure model.

**Never log the credential.** The Bearer token is interpolated into the
request header only. Every `console.warn` path passes a reason string built
from the failure cause; an unauthorized response is detected and mapped to
the login label before any warning is emitted, so the credential cannot
reach the diagnostic stream through an error object.

**Reuse the existing icon prefix convention.** The segment uses one
`nf-md-` cloud icon plus the `Ollama` label, mirroring
`󰚩 Codex` and `󰧑 MiniMax`. The icon is added to the README's Nerd Font
list, where the other four icons are documented.

## Risks / Trade-offs

- **Credential shape is observed, not documented.** The
  `{ type: "api", key }` shape under `ollama-cloud` was read from a live
  `auth.json`. If OpenCode changes the key name or the entry shape, the
  segment degrades to the login label rather than failing loudly.
  → Mitigation: treat a missing key as the login-label case, which is
  visible on the next refresh; the warning stream distinguishes a
  malformed entry from a rejected credential.
- **The 4-week activity window and the monthly limit are different
  periods.** `activity.period` is a rolling 4-week window while
  `limits.monthly` is the billing month. The spec pins the segment to
  `limits.monthly`, so `activity` is deliberately unused.
  → Mitigation: never read `activity` for the rendered value.
- **Unknown plan caps make the dollar figure ambiguous to the reader.**
  `$12.40` consumed means different things on a Free, Pro, or Max account,
  and the segment cannot say which.
  → Mitigation: accepted by decision — the segment reports consumption, not
  a budget. The user's chosen approach is consumption-only; a percentage
  was explicitly rejected for this reason.
- **One extra HTTPS request every 5 minutes.** The refresh interval is
  unchanged, so this adds one request per cycle alongside the two existing
  CLI spawns. → Mitigation: the existing `COMMAND_TIMEOUT_MS` bound and the
  `refreshing` guard both apply; a hung request cannot stack another.
- **Reading `auth.json` adds a file-read dependency to a plugin that
  currently only spawns processes.** A permissions error or a partial write
  would surface as a malformed-entry case.
  → Mitigation: the read is wrapped in the same try/catch that yields the
  login label, so a failed read cannot crash the refresh cycle.

## Migration Plan

Additive and self-contained. No migration, no state reset, and no
`opencode.jsonc` change: the existing `api.kv` entry gains an optional
`ollama` field, and an absent credential simply renders the login label.
Rollback is reverting the single file. Because `install.sh` symlinks
`quota-tui.tsx` into `~/.config/opencode/`, the change reaches the operator
on the next OpenCode restart, consistent with the existing distribution
channel.
