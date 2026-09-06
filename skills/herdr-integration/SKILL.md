---
name: herdr-integration
description: OpenCode ↔ Herdr (herdr.dev) bridge — what Herdr is, how the opencode plugin reports lifecycle state, the socket protocol, and the file layout for the integration scripts. Use when working on `~/.config/opencode/plugins/herdr-agent-state.js` or `~/.config/opencode/herdr-tui-session.js`, debugging "herdr says wrong state", changing how OpenCode reports to Herdr, or upgrading the integration via `herdr integration install opencode`. Verified against herdr.dev/docs (v0.8.2).
---

# herdr-integration

Reference for the **OpenCode ↔ Herdr bridge**. Read this before touching
the integration scripts or chasing state-reporting bugs.

## What Herdr is

[Herdr](https://herdr.dev) is **the runtime coding agents run on** — a
terminal multiplexer purpose-built for AI agents. It keeps real terminals
alive across laptop sleep / network drops, tracks per-pane agent state
(`idle` / `working` / `blocked`), and ships with a CLI + local socket API
so agents can coordinate with each other.

- Built by Herdr, Inc. (YC-backed), Apache 2.0
- 21 agent CLIs detected out of the box (Claude Code, Codex, Cursor,
  OpenCode, Kimi, Hermes, Grok, …)
- 980 community plugins
- Detection works via screen manifests by default; integrations (hooks
  / plugins) add lifecycle authority and native session restore

## Integration with OpenCode

OpenCode has **lifecycle authority** in Herdr when the plugin is installed.
That means:

- Herdr uses the plugin's hook reports for `idle` / `working` / `blocked`.
- Herdr does NOT also run screen manifest fallback for the same pane
  (avoids two sources of truth).
- After the plugin reports a session id, Herdr can resume the pane with
  `opencode --session <id>` across server restarts.

**Without the plugin**, Herdr falls back to screen manifest detection
(scraping the bottom of the pane buffer). State still works, but session
restore doesn't.

## Install / upgrade

```bash
# Install the OpenCode integration (writes the plugin file)
herdr integration install opencode

# Upgrade later (re-reads the bundle)
herdr integration install opencode --upgrade    # if supported in your herdr version

# Status / versions
herdr integration status

# Show what's installed
ls -la ~/.config/opencode/plugins/herdr-agent-state.js
```

Herdr writes only that one plugin file and removes only that one file
on uninstall. Other OpenCode config is not touched.

**Integration version**: Herdr tracks the integration separately from
the plugin file. Required for native session restore: **OpenCode
integration version 5** (per Herdr's [Integrations docs](https://herdr.dev/docs/integrations/#opencode)).

The plugin file also carries an internal `HERDR_INTEGRATION_VERSION=10`
marker comment — that's a **different counter** the plugin uses for its
own changes, not the Herdr-tracked integration version. They're not
comparable.

## File layout (in this repo's OpenCode config)

```
~/.config/opencode/
├── tui.jsonc                       # loads herdr-tui-session.js as a TUI plugin
├── plugins/
│   └── herdr-agent-state.js        # bus-event → pane state reporter
└── herdr-tui-session.js            # reports root session of the pane
```

Both files are **managed by Herdr**. Herdr reinstalls them when its
integration changes. Do not edit them by hand — your edits will be
overwritten. Customize via a sibling plugin in `plugins/` instead.

## Environment variables herdr sets

When OpenCode runs inside a Herdr pane, Herdr sets:

| Var | Purpose |
|---|---|
| `HERDR_ENV=1` | Marker that we're inside a Herdr-managed session. The plugin early-returns when unset. |
| `HERDR_PANE_ID` | e.g. `w1:p1` — which pane to report into. |
| `HERDR_TAB_ID` | Tab the pane lives in. |
| `HERDR_WORKSPACE_ID` | Workspace the tab lives in. |
| `HERDR_SOCKET_PATH` | Unix socket / named pipe to send JSON-RPC requests to. Default: `~/.config/herdr/herdr.sock` |
| `HERDR_BIN_PATH` | Path to the `herdr` binary (used by integrations to call CLI wrappers portably). |

The plugin silently does nothing outside a Herdr pane — by design, so
OpenCode behaves the same with or without Herdr.

## How state is reported

The plugin listens to OpenCode's bus event stream and maps events to
Herdr pane state via the local socket.

### State values

Herdr accepts five `state` values: `idle`, `working`, `blocked`, `done`,
`unknown`. Report only the first three for normal OpenCode flows; `done`
is Herdr-internal (idle + not yet seen by the user).

### Reporting style

Prefer **CLI wrappers** over raw socket when possible — they give you
cross-platform path handling for free:

```bash
# State
"$HERDR_BIN_PATH" pane report-agent "$HERDR_PANE_ID" \
  --source herdr:opencode \
  --agent opencode \
  --state working

# Session identity
"$HERDR_BIN_PATH" pane report-agent-session "$HERDR_PANE_ID" \
  --source herdr:opencode \
  --agent opencode \
  --agent-session-id "$SESSION_ID"

# Release on exit
"$HERDR_BIN_PATH" pane release-agent "$HERDR_PANE_ID" \
  --source herdr:opencode \
  --agent opencode
```

The plugin uses raw socket requests internally (`pane.report_agent`,
`pane.report_agent_session`) because it needs to fire on every bus
event and the CLI is slower.

### Event → state mapping (current plugin behavior)

| OpenCode event | Herdr state |
|---|---|
| `session.idle` | `idle` |
| `chat.message` | `working` (skipped for child sub-sessions) |
| `tool.execute.before` / `.after` | `working` |
| `permission.replied`, `question.replied`, `question.rejected` | `working` |
| `permission.asked`, `question.asked`, `session.error` | `blocked` |
| `session.status` (status ∈ `active`, `busy`, `pending`, `retry`, `running`, `streaming`, `working`) | `working` |
| `session.status` (status = `idle`) | `idle` |
| `session.created` / `session.updated` / `session.deleted` | (no state change) — session bookkeeping only |

### Root vs child sessions

OpenCode may spawn child subagent sessions. Only the **root** session
of a pane should drive Herdr state. The plugin tracks this via
`parentID`:

```js
if (info?.id && info.parentID) childSessions.add(info.id);
```

Child sessions still produce `permission.asked` / `question.asked` →
`blocked` and their replies → `working`, so user-visible prompts from
subagents are caught even when the root is doing something else.

### `seq` for out-of-order reports

Reports can arrive out of order. Herdr ignores stale `seq` values from
the same source. The plugin increments `seq` per call:

```js
let reportSeq = Date.now() * 1000;
// next call: reportSeq += 1
```

Don't skip this — without `seq`, a delayed event from a prior turn can
rewrite the pane's current state.

## Socket protocol (raw)

When the CLI isn't suitable (e.g., the plugin needs many fire-and-forget
calls per turn), use the socket directly.

### Transport

- **Unix**: newline-delimited JSON over `~/.config/herdr/herdr.sock`
- **Windows**: named pipe (`\\.\pipe\<name>`)
- Named sessions: `~/.config/herdr/sessions/<name>/herdr.sock`
- Env override: `HERDR_SOCKET_PATH` (low-level; prefer `herdr` CLI for portable code)

### Request shape

```json
{"id": "<unique>", "method": "<method>", "params": { ... }}
```

One request per line. Successful responses use `{"id": "...", "result": {...}}`.
Errors use `{"id": "...", "error": {"code": "...", "message": "..."}}`.

### Relevant methods for OpenCode integration

- `pane.report_agent` — semantic state (idle/working/blocked).
- `pane.report_agent_session` — session identity (lets Herdr resume).
- `pane.release_agent` — release lifecycle authority (call when the agent exits).
- `pane.report_metadata` — display-only patches (titles, tokens); doesn't take over state.

Full schema: `herdr api schema --output herdr-api.schema.json`.

## Plugin API (for sibling plugins)

If you want to extend the integration without touching Herdr-managed
files, write a **sibling OpenCode plugin** in
`~/.config/opencode/plugins/<name>.js`. It can hook the same bus events
and additionally make Herdr-plugin-style reports (CLI wrappers or raw
socket from Node).

A **Herdr-native plugin** (Herdr's plugin system, distinct from OpenCode's
plugin system) is a different thing — it lives at
`~/.config/herdr/plugins/<id>/herdr-plugin.toml` and acts as a workflow
tool inside Herdr. Two separate systems; don't confuse them.

## Common gotchas

- **No `HERDR_ENV=1`**: the plugin early-returns to `{}` (no hooks fire).
  You'll see the TUI integration work, but no state changes. Check with
  `env | grep HERDR_`.
- **`HERDR_PANE_ID` mismatch**: both plugins use it. If Herdr restarts
  with a different pane id, old requests silently no-op.
- **Child session noise**: every subagent with `parentID` triggers
  permission/question events; expect the UI to flicker briefly when a
  child asks something and the root keeps working. That's by design.
- **State stuck at `working` after a crash**: Herdr doesn't see OpenCode
  exit; state stays until Herdr's heuristic rolls it back, or until a new
  session reports `idle`. Manual fix:
  `"$HERDR_BIN_PATH" pane release-agent "$HERDR_PANE_ID" --source herdr:opencode --agent opencode`.
- **Plugin file overwritten after update**: that's Herdr reinstalling.
  Your changes are gone. Use a sibling plugin for customizations.
- **Version drift**: Herdr-tracked integration version needs to match
  expectations for native session restore. Check
  `herdr integration status` after upgrading Herdr.

## Debugging

```bash
# Verify Herdr env is set
env | grep HERDR_

# Check integration status / versions
herdr integration status

# Explain why a pane has the state it does
herdr agent explain w1:p1
herdr agent explain --file screen.txt --agent codex --json    # offline

# See what Herdr sees
herdr pane read w1:p1 --source recent --lines 50
herdr agent list

# Schema dump for the socket protocol
herdr api schema --output herdr-api.schema.json
```

If state looks wrong:

1. Confirm `HERDR_ENV=1` and `HERDR_PANE_ID` non-empty.
2. Confirm `~/.config/opencode/plugins/herdr-agent-state.js` exists.
3. `herdr agent explain w1:p1` — shows the **authoritative** source
   (`lifecycle plugin` vs `screen manifest`).
4. `herdr integration status` — verify integration version ≥ 5.
5. Tail the socket traffic with `socat`:
   ```bash
   socat - UNIX-CONNECT:~/.config/herdr/herdr.sock <<< '{"id":"t","method":"ping","params":{}}'
   ```
