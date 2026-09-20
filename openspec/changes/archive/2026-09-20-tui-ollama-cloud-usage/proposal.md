## Why

`quota-tui.tsx` renders plan consumption for two providers in the TUI
footer (Codex and MiniMax). Ollama Cloud is authenticated in this
configuration — OpenCode stores its API key in the state directory's
`auth.json` under the `ollama-cloud` key, and the provider is in active
use — but the footer exposes nothing about it. The included monthly credit
can be exhausted mid-session with no in-TUI signal, which makes Ollama
Cloud the only configured paid provider whose consumption is invisible.

## What Changes

- Add a third provider segment to the footer, sourced from
  `GET https://ollama.com/api/usage` with an `Authorization: Bearer`
  header, rendered as the consumed monthly amount in US dollars plus the
  summed request count for the current month.
- Read the credential from the `ollama-cloud` entry OpenCode already
  maintains in `auth.json`, resolved through the plugin's
  `api.state.path.state`. No new environment variable, no second login
  step, and no change to `opencode.jsonc`.
- Render **no percentage bar** and **no reset indicator** for this segment.
  The endpoint reports consumption (`limits.monthly.usage`) but exposes
  neither a plan cap nor a reset timestamp, so a percentage or a countdown
  would be invented rather than observed.
- Extend failure handling to the new provider, consistent with the existing
  codex rules: a missing credential surfaces a login label, and a transient
  read failure emits exactly one diagnostic warning per cycle through the
  existing `[quota-footer]` channel without overwriting a fresh cached
  value.
- Document the third prerequisite and the new segment in the plugin
  docblock and in the README Nerd Font icon list.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `tui-quota-footer`: adds requirements for the Ollama Cloud segment — the
  rendered fields, the explicit absence of a bar and reset indicator, the
  credential source, and the provider's failure handling.

## Impact

- **Files**: `quota-tui.tsx` (new read helper, new segment, extended
  docblock), `README.md` (icon list and provider mention), plus the
  `tui-quota-footer` delta in this change.
- **New I/O**: the plugin currently spawns two authenticated CLIs and reads
  no files. It will also issue one HTTPS request per refresh cycle and read
  one credential file. The API key MUST never be logged or rendered.
- **Compatibility**: additive. When no `ollama-cloud` credential exists the
  segment is absent or shows the login label, and Codex/MiniMax rendering is
  unchanged.
- **Not covered**: the API exposes no plan cap, so the segment reports
  consumption only, not a remaining budget or a percentage.
