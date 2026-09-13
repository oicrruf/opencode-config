/** @jsxImportSource @opentui/solid */

import { spawn } from "node:child_process"
import type { TuiPlugin, TuiPluginModule, TuiThemeCurrent } from "@opencode-ai/plugin/tui"

const STATE_KEY = "quota-footer.status"
const REFRESH_INTERVAL_MS = 5 * 60 * 1_000
const COMMAND_TIMEOUT_MS = 10_000
const MMX_TIMEOUT_MS = 70_000
const MAX_CONSECUTIVE_FAILURES = 3
const CODEX_SENTINEL = "󰚩 Codex · sin datos"
const CODEX_LOG_PREFIX = "[quota-footer]"

type FooterState = {
  codex?: string
  minimax?: string
  ready: boolean
}

type MmxQuota = {
  model_remains?: Array<{
    model_name?: string
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
  }
}

type CodexResponse = {
  id?: number
  result?: CodexQuota
  error?: { message?: string }
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

async function readMmx(signal: AbortSignal) {
  try {
    const output = await run("mmx", ["quota", "show", "--output", "json", "--quiet"], signal, MMX_TIMEOUT_MS)
    const quota = JSON.parse(output) as MmxQuota
    const general = quota.model_remains?.find((item) => item.model_name === "general") ?? quota.model_remains?.[0]
    if (!general || typeof general.current_interval_remaining_percent !== "number") return undefined

    const parts = [`󰧑 MiniMax 5h ${quotaBar(general.current_interval_remaining_percent)}`]
    if (typeof general.current_weekly_remaining_percent === "number") {
      parts.push(`sem ${quotaBar(general.current_weekly_remaining_percent)}`)
    }
    return parts.join("  ")
  } catch (error) {
    if (signal.aborted) return undefined
    return error instanceof Error && error.message.includes("ENOENT") ? null : undefined
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
      if (response.error.message?.includes("authentication required")) {
        return "󰚩 Codex requiere login"
      }
      onFailure?.(`json-rpc error: ${response.error.message ?? "unknown"}`)
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
    if (individualRemaining !== undefined) {
      parts.push(`󰚩 Codex ${quotaBar(individualRemaining)}`)
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

const tui: TuiPlugin = async (api) => {
  let refreshing = false
  let consecutiveCodexFailures = 0
  // Spec trace (openspec/changes/fix-quota-stale-state/specs/tui-quota-footer/spec.md):
  // - "Three consecutive failures reach the sentinel": counter increments on `undefined`,
  //   sentinel replaces cached line once counter >= MAX_CONSECUTIVE_FAILURES.
  // - "Successful read clears the sentinel": a fresh label string (success or auth-required)
  //   resets the counter to zero and overwrites the cached value.
  // - "Auth-required response does not count as failure": auth-required is a string return,
  //   not undefined, so the reset path handles it; onFailure is not invoked.
  // - "ENOENT is logged once": ENOENT returns `null`; only the segment is cleared and the
  //   warning is emitted; the counter is left untouched (not incremented, not reset).
  const refresh = async () => {
    if (refreshing || api.lifecycle.signal.aborted) return
    refreshing = true
    try {
      const [codex, minimax] = await Promise.all([
        readCodex(api.lifecycle.signal, (reason) => {
          console.warn(CODEX_LOG_PREFIX, "codex read failed:", reason)
        }),
        readMmx(api.lifecycle.signal),
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
      api.kv.set(STATE_KEY, {
        codex: nextCodex,
        minimax: minimax === undefined ? previous.minimax : (minimax ?? ""),
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
          return [value.codex, value.minimax].filter(Boolean).join(" | ")
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
