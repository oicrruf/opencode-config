/**
 * quota-footer — TUI footer that renders codex, MiniMax, and Ollama Cloud quota.
 *
 * Prerequisites
 * ------------
 * For their bars/segments to render:
 *   - codex: the `codex` CLI MUST be logged in (`codex login`).
 *   - mmx:   the `mmx` CLI MUST be logged in (`mmx login`).
 *   - Ollama Cloud: OpenCode MUST be authenticated against Ollama Cloud.
 *     The credential is read from `<state>/auth.json` → `ollama-cloud`
 *     (key sent as `Authorization: Bearer` to https://ollama.com/api/usage
 *     and https://ollama.com/api/me). There is no separate login step for
 *     the footer — the existing OpenCode authentication is the sole source.
 *
 * The plugin does not perform login itself. If a segment is missing or
 * shows the login label, run the matching command in your shell:
 *
 *   - codex:  `codex login`
 *   - mmx:    `mmx login`   (or the `mmx auth login` subcommand your
 *                           build exposes)
 *   - Ollama Cloud: sign in to Ollama Cloud from the Ollama app or via
 *     `ollama signin`; the footer re-reads the credential on each refresh.
 *
 * The TUI icons (`󰧑`, `󰚩`, `󰃖`, `󰀄`, `󰁤`) come from a Nerd Font —
 * install `JetBrainsMono Nerd Font` via `scripts/install-nerd-fonts.sh`
 * (Linux, macOS) or `scripts/install-nerd-fonts.ps1` (Windows). See the
 * README "Nerd Fonts" section, then select "JetBrainsMono Nerd Font" in
 * your terminal profile so the icons render correctly.
 *
 * Visible footer states
 * ---------------------
 * 1. Fresh data (e.g.
 *    `󰧑 MiniMax 5h ███░░ 50% 0h 2m | 󰚩 Codex ████░ 87% 18d 5h 󰃖 | 󰁤 Ollama $2.40  353`).
 *    The Ollama Cloud segment shows the consumed amount in US dollars — the
 *    endpoint's `limits.monthly.usage` fraction multiplied by the plan's
 *    included monthly credit — and the summed request count for the month.
 *    It deliberately carries no percentage bar and no reset indicator because
 *    the API exposes neither.
 *    When the plan's included credit cannot be resolved, the segment renders
 *    the fraction directly as a percentage instead (e.g. `󰁤 Ollama 4%  353`),
 *    which is exactly what the endpoint reports and needs no cap.
 * 2. `󰚩 Codex · login` — the codex CLI is not logged in. Run `codex login`.
 * 3. `󰧑 MiniMax requiere login` — the mmx CLI is not logged in. Run `mmx login`.
 * 4. `󰚩 Codex · sin datos` — codex is failing repeatedly for a non-auth
 *    reason (timeout, JSON-RPC error, malformed response). Tail the
 *    `[quota-footer]` warning stream (e.g. from the OpenCode dev
 *    console) for the specific failure reason.
 * 5. `󰁤 Ollama · login` — the Ollama Cloud credential is missing from
 *    `<state>/auth.json`, or the API rejected it as unauthorized. Sign
 *    in to Ollama Cloud; the footer re-reads the credential on each refresh.
 *
 * The MiniMax segment silently disappears on sustained non-auth
 * failures; only auth-required failures are surfaced as a label
 * (state #3 above) so the operator has a clear remediation. The Ollama
 * Cloud segment preserves its last successful value across transient
 * failures (one `[quota-footer]` warning per cycle) and re-renders
 * `· login` when the credential is missing or rejected. A plan-resolution
 * failure is logged at most once per session and degrades the segment to the
 * percentage form rather than suppressing it.
 *
 * Spec: openspec/specs/tui-quota-footer/spec.md
 *         (and per-change specs under openspec/changes/)
 */

/** @jsxImportSource @opentui/solid */

import { spawn } from "node:child_process"
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { TuiPlugin, TuiPluginModule, TuiThemeCurrent } from "@opencode-ai/plugin/tui"

const STATE_KEY = "quota-footer.status"
const REFRESH_INTERVAL_MS = 5 * 60 * 1_000
const COMMAND_TIMEOUT_MS = 10_000
const MMX_TIMEOUT_MS = 70_000
const MAX_CONSECUTIVE_FAILURES = 3
const CODEX_SENTINEL = "󰚩 Codex · sin datos"
const CODEX_LOGIN_REQUIRED_LABEL = "󰚩 Codex · login"
const MMX_LOGIN_REQUIRED_LABEL = "󰧑 MiniMax requiere login"
const CODEX_LOG_PREFIX = "[quota-footer]"
const CODEX_PLAN_BUSINESS_ICON = "󰃖"
const CODEX_PLAN_PERSONAL_ICON = "󰀄"
const OLLAMA_CLOUD_ICON = "󰁤"
const OLLAMA_CLOUD_LOGIN_REQUIRED_LABEL = "󰁤 Ollama · login"
const OLLAMA_CLOUD_PROVIDER_KEY = "ollama-cloud"
const OLLAMA_CLOUD_USAGE_URL = "https://ollama.com/api/usage"
const OLLAMA_CLOUD_ACCOUNT_URL = "https://ollama.com/api/me"
// Included monthly usage credit per plan, in US dollars, from the pricing
// page (https://ollama.com/pricing). No API response exposes this cap, so it
// is maintained here; a plan absent from this table degrades to the
// percentage form rather than multiplying by a guessed allowance.
const OLLAMA_CLOUD_ALLOWANCE_BY_PLAN: Record<string, number> = {
  pro: 60,
  max: 300,
  team: 1000,
}

type FooterState = {
  codex?: string
  minimax?: string
  ollama?: string
  ready: boolean
}

type OllamaApiUsage = {
  limits?: {
    monthly?: {
      usage?: unknown
      models?: ReadonlyArray<{ name?: unknown; request_count?: unknown }>
    }
  }
}

type OllamaApiAccount = {
  Plan?: unknown
}

// Per-session plan resolution state. `resolved` separates "not yet attempted"
// from "attempted and unknown"; `allowance` absent means unknown, which routes
// the segment to the percentage form; `warned` enforces the one-warning-per-
// session rule for a plan-resolution failure. Held in the `tui` closure rather
// than module scope so it never leaks across sessions.
type OllamaAllowanceState = {
  resolved: boolean
  allowance?: number
  warned: boolean
}

type MmxQuota = {
  model_remains?: Array<{
    model_name?: string
    end_time?: number
    weekly_end_time?: number
    current_interval_remaining_percent?: number
    current_weekly_remaining_percent?: number
  }>
}

type CodexWindow = {
  usedPercent?: number
  resetsAt?: number | null
  windowDurationMins?: number | null
}

type CodexIndividualLimit = {
  limit?: string
  used?: string | number
  remainingPercent?: number
  resetsAt?: number | null
}

type CodexCredits = {
  hasCredits?: boolean
  unlimited?: boolean
  balance?: string | null
}

type CodexQuota = {
  rateLimits?: {
    primary?: CodexWindow | null
    secondary?: CodexWindow | null
    individualLimit?: CodexIndividualLimit | null
    credits?: CodexCredits | null
    planType?: string | null
  }
}

type CodexResponseErrorData = {
  type?: string
  reason?: string
  [key: string]: unknown
}

type CodexResponseError = {
  code?: number
  message?: string
  data?: CodexResponseErrorData
}

type CodexResponse = {
  id?: number
  result?: CodexQuota
  error?: CodexResponseError
}

const AUTH_REQUIRED_PATTERNS = [
  "authentication required",
  "not authenticated",
  "not logged in",
  "login required",
  "log in required",
  "auth required",
  "unauthorized",
  "token expired",
  "session expired",
  "session not authenticated",
]

function messageContainsAuthRequired(message: string | undefined): boolean {
  if (!message) return false
  return AUTH_REQUIRED_PATTERNS.some((pattern) => message.toLowerCase().includes(pattern))
}

function isAuthRequiredError(error?: CodexResponseError): boolean {
  if (!error) return false
  if (messageContainsAuthRequired(error.message)) return true
  const data = error.data
  if (!data || typeof data !== "object") return false
  if (typeof data.type === "string" && messageContainsAuthRequired(data.type)) return true
  if (typeof data.reason === "string" && messageContainsAuthRequired(data.reason)) return true
  return false
}

function formatCodexError(error: CodexResponseError): string {
  const { code, message } = error
  if (typeof code === "number" && typeof message === "string") return `code ${code}: ${message}`
  if (typeof code === "number") return `code ${code}`
  return message ?? "unknown"
}

function run(command: string, args: string[], signal: AbortSignal, timeoutMs = COMMAND_TIMEOUT_MS) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    let settled = false

    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      signal.removeEventListener("abort", abort)
      if (error) reject(error)
      else resolve(stdout)
    }
    const abort = () => {
      child.kill()
      finish(new Error("cancelled"))
    }
    const timeout = setTimeout(() => {
      child.kill()
      finish(new Error(`${command} timed out`))
    }, timeoutMs)

    signal.addEventListener("abort", abort, { once: true })
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk) => (stdout += chunk))
    child.stderr.on("data", (chunk) => (stderr += chunk))
    child.on("error", finish)
    child.on("close", (code) => {
      if (code === 0) finish()
      else finish(new Error(stderr.trim() || `${command} exited with ${code}`))
    })
  })
}

function remaining(window?: CodexWindow | null) {
  if (typeof window?.usedPercent !== "number") return undefined
  return Math.max(0, Math.min(100, 100 - window.usedPercent))
}

function quotaBar(percent: number) {
  const segments = 5
  const value = Math.round(Math.max(0, Math.min(100, percent)))
  const filled = Math.round((value / 100) * segments)
  return `${"█".repeat(filled)}${"░".repeat(segments - filled)} ${value}%`
}

function coloredLabel(label: string, theme: TuiThemeCurrent) {
  const output = []
  let cursor = 0

  for (const match of label.matchAll(/[█░]{5}/g)) {
    const bar = match[0]
    const filled = bar.indexOf("░") === -1 ? bar.length : bar.indexOf("░")
    const color = filled >= 4 ? theme.success : filled >= 2 ? theme.warning : theme.error
    output.push(label.slice(cursor, match.index))
    if (filled) output.push(<span style={{ fg: color }}>{bar.slice(0, filled)}</span>)
    if (filled < bar.length) output.push(<span style={{ fg: theme.textMuted }}>{bar.slice(filled)}</span>)
    cursor = match.index + bar.length
  }

  output.push(label.slice(cursor))
  return output
}

function planBadge(planType?: string | null): string {
  if (typeof planType !== "string" || planType.length === 0) return ""
  if (planType.startsWith("self_serve_business")) return CODEX_PLAN_BUSINESS_ICON
  if (/^(free|plus|pro|team)$/.test(planType)) return CODEX_PLAN_PERSONAL_ICON
  return ""
}

function resetLabel(resetsAt?: number | null): string {
  if (typeof resetsAt !== "number" || !Number.isFinite(resetsAt) || resetsAt <= 0) return ""
  const totalSeconds = Math.max(0, resetsAt - Math.floor(Date.now() / 1000))
  if (totalSeconds === 0) return ""
  if (totalSeconds >= 86400) {
    const days = Math.floor(totalSeconds / 86400)
    const hours = Math.floor((totalSeconds % 86400) / 3600)
    return hours > 0 ? ` ${days}d ${hours}h` : ` ${days}d`
  }
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  // Sub-day horizons always render both hours and minutes (no zero
  // suppression) so the 5h window reads consistently: `3h 5m`, never
  // `0h 5m` or `45m`.
  return ` ${hours}h ${minutes}m`
}

async function readMmx(signal: AbortSignal, onFailure?: (reason: string) => void) {
  try {
    const output = await run("mmx", ["quota", "show", "--output", "json", "--quiet"], signal, MMX_TIMEOUT_MS)
    const quota = JSON.parse(output) as MmxQuota
    const general = quota.model_remains?.find((item) => item.model_name === "general") ?? quota.model_remains?.[0]
    if (!general || typeof general.current_interval_remaining_percent !== "number") return undefined

    const intervalReset = typeof general.end_time === "number" ? resetLabel(Math.floor(general.end_time / 1000)) : ""
    const weeklyReset =
      typeof general.weekly_end_time === "number" ? resetLabel(Math.floor(general.weekly_end_time / 1000)) : ""

    const parts = [`󰧑 MiniMax 5h ${quotaBar(general.current_interval_remaining_percent)}${intervalReset}`]
    if (typeof general.current_weekly_remaining_percent === "number") {
      parts.push(`sem ${quotaBar(general.current_weekly_remaining_percent)}${weeklyReset}`)
    }
    return parts.join("  ")
  } catch (error) {
    if (signal.aborted) return undefined
    if (!(error instanceof Error)) return undefined
    if (error.message.includes("ENOENT")) {
      onFailure?.("ENOENT: mmx binary not on PATH")
      return null
    }
    if (messageContainsAuthRequired(error.message)) {
      // Auth-required is a fresh label, not a failure: do not call onFailure.
      return MMX_LOGIN_REQUIRED_LABEL
    }
    onFailure?.(error.message)
    return undefined
  }
}

async function readCodex(
  signal: AbortSignal,
  onFailure?: (reason: string) => void,
) {
  try {
    const response = await new Promise<CodexResponse>((resolve, reject) => {
      const child = spawn("codex", ["app-server", "--stdio"], { stdio: ["pipe", "pipe", "pipe"] })
      let buffer = ""
      let stderr = ""
      let settled = false

      const finish = (value?: CodexResponse, error?: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        signal.removeEventListener("abort", abort)
        child.kill()
        if (error) reject(error)
        else resolve(value ?? {})
      }
      const abort = () => finish(undefined, new Error("cancelled"))
      const timeout = setTimeout(() => finish(undefined, new Error("codex timed out")), COMMAND_TIMEOUT_MS)

      signal.addEventListener("abort", abort, { once: true })
      child.stdout.setEncoding("utf8")
      child.stderr.setEncoding("utf8")
      child.stderr.on("data", (chunk) => (stderr += chunk))
      child.on("error", (error) => finish(undefined, error))
      child.on("close", (code) => {
        if (!settled) finish(undefined, new Error(stderr.trim() || `codex exited with ${code}`))
      })
      child.stdout.on("data", (chunk) => {
        buffer += chunk
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""
        for (const line of lines) {
          if (!line) continue
          let message: CodexResponse
          try {
            message = JSON.parse(line) as CodexResponse
          } catch {
            continue
          }
          if (message.id === 1) {
            child.stdin.write(`${JSON.stringify({ method: "initialized" })}\n`)
            child.stdin.write(`${JSON.stringify({ id: 2, method: "account/rateLimits/read" })}\n`)
          }
          if (message.id === 2) finish(message)
        }
      })

      child.stdin.write(
        `${JSON.stringify({
          id: 1,
          method: "initialize",
          params: { clientInfo: { name: "opencode-quota", version: "1.0.0" } },
        })}\n`,
      )
    })

    if (response?.error) {
      if (isAuthRequiredError(response.error)) {
        return CODEX_LOGIN_REQUIRED_LABEL
      }
      onFailure?.(`json-rpc error: ${formatCodexError(response.error)}`)
      return undefined
    }

    const individual = response?.result?.rateLimits?.individualLimit
    const individualRemaining =
      typeof individual?.remainingPercent === "number"
        ? Math.max(0, Math.min(100, individual.remainingPercent))
        : undefined

    const primary = response?.result?.rateLimits?.primary
    const secondary = response?.result?.rateLimits?.secondary
    const primaryRemaining = remaining(primary)
    const secondaryRemaining = remaining(secondary)

    if (
      individualRemaining === undefined &&
      primaryRemaining === undefined &&
      secondaryRemaining === undefined
    ) {
      onFailure?.("no rate-limit fields in response")
      return undefined
    }

    const parts: string[] = []
    const hasAnyRemaining =
      individualRemaining !== undefined ||
      primaryRemaining !== undefined ||
      secondaryRemaining !== undefined
    const badge = planBadge(response?.result?.rateLimits?.planType)
    if (individualRemaining !== undefined) {
      const reset = resetLabel(individual?.resetsAt)
      const badgeSuffix = badge.length > 0 ? ` ${badge}` : ""
      parts.push(`󰚩 Codex ${quotaBar(individualRemaining)}${reset}${badgeSuffix}`)
    } else if (hasAnyRemaining) {
      // Server returned null individualLimit (some plan types) but exposed
      // primary/secondary windows. Surface the codex prefix once so the user
      // still gets the icon, the right grouping, and the plan badge.
      const badgeSuffix = badge.length > 0 ? ` ${badge}` : ""
      parts.push(`󰚩 Codex${badgeSuffix}`)
    }
    if (primaryRemaining !== undefined) {
      const window = primary?.windowDurationMins
      const label = typeof window === "number" ? `${window / 60}h` : "5h"
      parts.push(`${label} ${quotaBar(primaryRemaining)}`)
    }
    if (secondaryRemaining !== undefined) parts.push(`sem ${quotaBar(secondaryRemaining)}`)
    return parts.join("  ")
  } catch (error) {
    if (signal.aborted) return undefined
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes("ENOENT")) {
      onFailure?.("ENOENT: codex binary not on PATH")
      return null
    }
    onFailure?.(message)
    return undefined
  }
}

// Resolves the absolute path of OpenCode's `auth.json` using the same XDG rule
// the OpenCode binary applies to its data directory. The plugin API exposes
// the runtime state dir but not the data dir, so we mirror the rule OpenCode
// uses at startup (env XDG_DATA_HOME, falling back to ~/.local/share) and
// append `opencode/auth.json`. This keeps the read resilient to installs that
// relocate the data directory through XDG_DATA_HOME.
function resolveAuthJsonPath(): string {
  const dataHome = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share")
  return join(dataHome, "opencode", "auth.json")
}

// Reads the Ollama Cloud API key that OpenCode keeps in its data directory.
// Returns the key on success, or `undefined` for every "not available" case
// (file missing, entry missing, key missing, malformed JSON, read error).
// The credential is never echoed to logs, warnings, or rendered output: this
// function returns it as a string so the only call site can place it in the
// `Authorization` header.
function loadOllamaCredential(): string | undefined {
  try {
    const raw = readFileSync(resolveAuthJsonPath(), "utf8")
    const data = JSON.parse(raw) as Record<string, unknown>
    const entry = data[OLLAMA_CLOUD_PROVIDER_KEY]
    if (!entry || typeof entry !== "object") return undefined
    const key = (entry as Record<string, unknown>).key
    if (typeof key !== "string" || key.length === 0) return undefined
    return key
  } catch {
    return undefined
  }
}

// `limits.monthly.usage` is the FRACTION of the plan's included monthly credit
// already consumed (e.g. `0.04` on a `$60` plan = `$2.40`), not a dollar
// amount. See the change `fix-ollama-usage-units` for the evidence.
//
// With a resolved allowance the segment renders dollars. Without one — the
// plan is unknown, unreadable, or absent from the mapping — it renders the
// fraction itself as a percentage, which is exactly what the endpoint reports
// and needs no cap, rather than multiplying by a guessed allowance.
function formatOllamaFraction(usage: number): string {
  const rounded = Math.round(usage * 100 * 10) / 10
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
  return `${text}%`
}

function formatOllamaUsage(usage: number, requestCount: number, allowance?: number) {
  const value =
    allowance === undefined
      ? formatOllamaFraction(usage)
      : `$${(usage * allowance).toFixed(2)}`
  return requestCount > 0
    ? `${OLLAMA_CLOUD_ICON} Ollama ${value}  ${requestCount}`
    : `${OLLAMA_CLOUD_ICON} Ollama ${value}`
}

// Resolves the account plan's included monthly credit. Reads the top-level
// `Plan` field from the account endpoint and maps it through
// OLLAMA_CLOUD_ALLOWANCE_BY_PLAN. Returns `undefined` for every unresolvable
// case (request failure, non-success status, absent or non-string `Plan`,
// plan not in the mapping table); the caller emits at most one warning per
// session and falls back to the percentage form.
async function readOllamaPlan(
  credential: string,
  signal: AbortSignal,
  onFailure?: (reason: string) => void,
): Promise<number | undefined> {
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  signal.addEventListener("abort", onAbort, { once: true })
  try {
    timeoutHandle = setTimeout(() => controller.abort(), COMMAND_TIMEOUT_MS)

    const response = await fetch(OLLAMA_CLOUD_ACCOUNT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${credential}` },
      signal: controller.signal,
    })

    if (!response.ok) {
      onFailure?.(`HTTP ${response.status}`)
      return undefined
    }

    const body = (await response.json()) as OllamaApiAccount
    const plan = body?.Plan
    if (typeof plan !== "string" || plan.length === 0) {
      onFailure?.("no Plan in account response")
      return undefined
    }
    const allowance = OLLAMA_CLOUD_ALLOWANCE_BY_PLAN[plan]
    if (allowance === undefined) {
      onFailure?.(`unmapped plan: ${plan}`)
      return undefined
    }
    return allowance
  } catch (error) {
    if (signal.aborted) return undefined
    const reason = error instanceof Error ? error.message : String(error)
    // `reason` never contains the credential: it is only used in the request
    // header, never in a message.
    onFailure?.(reason)
    return undefined
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
    signal.removeEventListener("abort", onAbort)
  }
}

async function readOllamaCloud(
  signal: AbortSignal,
  allowanceState: OllamaAllowanceState,
  onFailure?: (reason: string) => void,
): Promise<string | undefined> {
  const credential = loadOllamaCredential()
  if (!credential) return OLLAMA_CLOUD_LOGIN_REQUIRED_LABEL

  // The plan-resolution warning and a usage failure can coincide in one cycle,
  // but the footer must emit exactly one warning per failed refresh cycle. This
  // guard collapses both into the cycle's single diagnostic slot; the plan
  // warning additionally fires at most once per session via `allowanceState`.
  let warnedThisCycle = false
  const warn = (reason: string) => {
    if (warnedThisCycle) return
    warnedThisCycle = true
    onFailure?.(reason)
  }

  // Resolve the plan once per session, before the usage request. A resolved
  // attempt (success or failure) never re-issues the request; an unresolved
  // plan leaves `allowance` unset and the segment renders the percentage form.
  if (!allowanceState.resolved) {
    allowanceState.allowance = await readOllamaPlan(credential, signal, (reason) => {
      if (allowanceState.warned) return
      allowanceState.warned = true
      warn(`plan resolution failed: ${reason}`)
    })
    allowanceState.resolved = true
  }
  if (signal.aborted) return undefined

  const controller = new AbortController()
  const onAbort = () => controller.abort()
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  signal.addEventListener("abort", onAbort, { once: true })
  try {
    timeoutHandle = setTimeout(() => controller.abort(), COMMAND_TIMEOUT_MS)

    const response = await fetch(OLLAMA_CLOUD_USAGE_URL, {
      method: "GET",
      headers: { Authorization: `Bearer ${credential}` },
      signal: controller.signal,
    })

    if (response.status === 401 || response.status === 403) {
      // Unauthorized is a fresh label, not a transient failure: do not call
      // onFailure. The credential itself never appears in the response path.
      return OLLAMA_CLOUD_LOGIN_REQUIRED_LABEL
    }
    if (!response.ok) {
      warn(`HTTP ${response.status}`)
      return undefined
    }

    const body = (await response.json()) as OllamaApiUsage
    const monthly = body?.limits?.monthly
    if (!monthly) {
      warn("no monthly usage in response")
      return undefined
    }
    const usage = monthly.usage
    if (typeof usage !== "number" || !Number.isFinite(usage)) {
      warn("usage is not a finite number")
      return undefined
    }
    const models = Array.isArray(monthly.models) ? monthly.models : []
    const requestCount = models.reduce((sum, model) => {
      const rc = model?.request_count
      return sum + (typeof rc === "number" && Number.isFinite(rc) ? rc : 0)
    }, 0)
    return formatOllamaUsage(usage, requestCount, allowanceState.allowance)
  } catch (error) {
    if (signal.aborted) return undefined
    const reason = error instanceof Error ? error.message : String(error)
    // `reason` is the fetch/DOMException message; it never contains the
    // credential because the credential is only used in the request header.
    warn(reason)
    return undefined
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
    signal.removeEventListener("abort", onAbort)
  }
}

const tui: TuiPlugin = async (api) => {
  let refreshing = false
  let consecutiveCodexFailures = 0
  // Per-session Ollama Cloud allowance resolution. Session-scoped by
  // construction: the closure is created once per `tui` invocation, so the
  // cache is discarded when the session ends.
  const ollamaAllowance: OllamaAllowanceState = { resolved: false, warned: false }
  // Spec trace (openspec/changes/fix-quota-stale-state/specs/tui-quota-footer/spec.md):
  // - "Three consecutive failures reach the sentinel": counter increments on `undefined`,
  //   sentinel replaces cached line once counter >= MAX_CONSECUTIVE_FAILURES.
  // - "Successful read clears the sentinel": a fresh label string (success or auth-required)
  //   resets the counter to zero and overwrites the cached value.
  // - "Auth-required response does not count as failure": auth-required is a string return,
  //   not undefined, so the reset path handles it; onFailure is not invoked.
  // - "ENOENT is logged once": ENOENT returns `null`; only the segment is cleared and the
  //   warning is emitted; the counter is left untouched (not incremented, not reset).
  //
  // Spec trace (openspec/changes/tui-mmx-auth-required/specs/tui-quota-footer/spec.md):
  // - "MiniMax login label is shown when the CLI is not authenticated": `readMmx`'s catch
  //   block detects auth-required in `error.message` and returns MMX_LOGIN_REQUIRED_LABEL,
  //   which is a fresh string and therefore replaces the cached minimax segment (the
  //   `undefined ? previous.minimax : (minimax ?? "")` branch handles it).
  // - "Successful MiniMax read clears the login label": same path — a fresh string from
  //   `readMmx` overwrites the cached auth-required label.
  // - "MiniMax login label does not appear for unrelated failures": non-auth errors
  //   (timeout, malformed JSON, etc.) fall through to `onFailure?.(message); return undefined`,
  //   which silently keeps the previous value and does NOT surface a login label.
  // - "ENOENT for mmx keeps the existing empty-segment behavior": ENOENT returns `null`
  //   which falls through the `minimax === undefined` guard and clears the cached segment,
  //   matching the codex ENOENT semantics.
  //
  // Spec trace (openspec/changes/tui-ollama-cloud-usage/specs/tui-quota-footer/spec.md):
  // - "Credential absent renders login label": `loadOllamaCredential` returns undefined
  //   for every missing/malformed case; `readOllamaCloud` then returns
  //   OLLAMA_CLOUD_LOGIN_REQUIRED_LABEL without invoking onFailure.
  // - "Unauthorized response is not a transient failure": 401/403 returns the login label
  //   directly (fresh string), so the refresh path replaces the cached segment without
  //   incrementing any failure counter or emitting a warning.
  // - "Transient failure logs once and preserves the cached value": any non-auth error
  //   (timeout, transport error, malformed payload, non-success status, non-finite usage)
  //   resolves to `undefined`, exactly one `[quota-footer] ollama read failed: <reason>`
  //   warning is emitted, and the previous Ollama segment is preserved.
  // - "Successful read replaces the login label": a fresh consumption string from
  //   `readOllamaCloud` overwrites the cached login label via the same branch.
  //
  // Spec trace (openspec/changes/fix-ollama-usage-units/specs/tui-quota-footer/spec.md):
  // - "Consumption and request count are rendered": `formatOllamaUsage` emits
  //   `usage × allowance` as dollars when the session record carries an allowance.
  // - "Consumption is not rendered as the raw fraction": the dollar form is computed
  //   only from the product, so the unconverted fraction never reaches the label.
  // - "Unknown plan renders the fraction as a percentage": `readOllamaPlan` returns
  //   undefined for a missing/unmapped `Plan`, leaving `allowance` unset, and
  //   `formatOllamaFraction` renders the fraction instead without suppressing the segment.
  // - "Known plan resolves its included credit" / "Every mapped plan resolves its
  //   published credit": `OLLAMA_CLOUD_ALLOWANCE_BY_PLAN` maps pro/max/team to 60/300/1000.
  // - "Plan request failure does not blank a valid segment" / "Allowance is not
  //   re-requested every cycle": `allowanceState.resolved` short-circuits the plan read
  //   after the first attempt, and `allowanceState.warned` caps the warning at one
  //   per session while the usage segment still renders.
  // - "Plan request never echoes the credential": `readOllamaPlan` places the credential
  //   only in the request header and passes only the failure reason to onFailure.
  // - "No percentage bar is rendered" / "No reset indicator is rendered": both formatters
  //   emit only the icon, `Ollama` label, value, and optional request count.
  const refresh = async () => {
    if (refreshing || api.lifecycle.signal.aborted) return
    refreshing = true
    try {
      const [codex, minimax, ollama] = await Promise.all([
        readCodex(api.lifecycle.signal, (reason) => {
          console.warn(CODEX_LOG_PREFIX, "codex read failed:", reason)
        }),
        readMmx(api.lifecycle.signal, (reason) => {
          console.warn(CODEX_LOG_PREFIX, "mmx read failed:", reason)
        }),
        readOllamaCloud(api.lifecycle.signal, ollamaAllowance, (reason) => {
          console.warn(CODEX_LOG_PREFIX, "ollama read failed:", reason)
        }),
      ])
      if (api.lifecycle.signal.aborted) return
      const previous = api.kv.get<FooterState>(STATE_KEY, { ready: false })
      let nextCodex: string
      if (codex === undefined) {
        consecutiveCodexFailures += 1
        nextCodex =
          consecutiveCodexFailures >= MAX_CONSECUTIVE_FAILURES
            ? CODEX_SENTINEL
            : (previous.codex ?? "")
      } else if (codex === null) {
        // ENOENT: clear segment, counter unchanged per spec scenario.
        nextCodex = ""
      } else {
        // Fresh label string (success or auth-required): reset counter, display.
        consecutiveCodexFailures = 0
        nextCodex = codex
      }
      // `readOllamaCloud` returns either a fresh string (consumption or login label)
      // or `undefined` for transient failures. The previous cached value is preserved on
      // `undefined`; a fresh string replaces it.
      const nextOllama = ollama === undefined ? (previous.ollama ?? "") : ollama
      api.kv.set(STATE_KEY, {
        codex: nextCodex,
        minimax: minimax === undefined ? previous.minimax : (minimax ?? ""),
        ollama: nextOllama,
        ready: true,
      } satisfies FooterState)
    } finally {
      refreshing = false
    }
  }

  api.slots.register({
    order: 100,
    slots: {
      app_bottom(ctx) {
        const state = () => api.kv.get<FooterState>(STATE_KEY, { ready: false })
        const label = () => {
          const value = state()
          if (!value.ready) return "Cuota · consultando..."
          return [value.codex, value.minimax, value.ollama].filter(Boolean).join(" | ")
        }
        return (
          <box width="100%" flexShrink={0} paddingLeft={3} paddingRight={1} paddingBottom={1}>
            <text fg={ctx.theme.current.textMuted}>
              {coloredLabel(label(), ctx.theme.current)}
            </text>
          </box>
        )
      },
    },
  })

  void refresh()
  const timer = setInterval(() => void refresh(), REFRESH_INTERVAL_MS)
  api.lifecycle.onDispose(() => clearInterval(timer))
}

const plugin: TuiPluginModule & { id: string } = {
  id: "quota-footer",
  tui,
}

export default plugin
