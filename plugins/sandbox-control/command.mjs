// Pure grammar and dispatch: no shell, filesystem, engine or session access.
// Production command registration is separate from these testable primitives.
import { isAbsolute } from "node:path";

export const SANDBOX_USAGE = "/sandbox [help]\n/sandbox release\n/sandbox build <config.json>\n/sandbox rebuild <config.json>\n/sandbox transfer <config>";
const operations = new Set(["release", "build", "rebuild", "transfer"]);
const invalid = () => ({ ok: false, reason: "invalid sandbox arguments", usage: SANDBOX_USAGE });

/** Tool arguments are literal values, not command lines. Reject extra fields. */
export function validateSandboxOperation(operation, input) {
  if (!operations.has(operation) || !input || typeof input !== "object" || Array.isArray(input)) return invalid();
  if (operation === "release") {
    if (Object.keys(input).length !== 0) return invalid();
    return { ok: true, operation, input: {} };
  }
  if (Object.keys(input).some((key) => key !== "configPath")) return invalid();
  const path = input.configPath;
  if (typeof path !== "string" || !path.trim() || /[\x00-\x1f\x7f\\]/.test(path) ||
      isAbsolute(path) || /^[A-Za-z]:|^-/.test(path) || path.split("/").some((part) => part === "..")) return invalid();
  return { ok: true, operation, input: { configPath: path } };
}

/** Parse the text after /sandbox. Quoting groups a single literal operand. */
export function parseSandboxCommand(raw) {
  if (typeof raw !== "string" || /[\x00-\x08\x0a-\x1f\x7f]/.test(raw)) return invalid();
  const text = raw.trim();
  if (!text || text === "help") return { ok: true, help: true, usage: SANDBOX_USAGE };
  if (text === "release") return validateSandboxOperation("release", {});
  const match = /^(build|rebuild|transfer)[ \t]+(?:"([^"]*)"|'([^']*)'|([^ \t"']+))$/.exec(text);
  if (!match) return invalid();
  return validateSandboxOperation(match[1], { configPath: match[2] ?? match[3] ?? match[4] });
}

/** Invalid/help invocations cannot reach the supplied operation handlers. */
export async function dispatchSandboxCommand(raw, handlers) {
  const parsed = parseSandboxCommand(raw);
  if (!parsed.ok || parsed.help) return parsed;
  const handler = handlers?.[parsed.operation];
  if (typeof handler !== "function") return { ok: false, blocked: true, reason: "the requested sandbox operation is unavailable" };
  return handler(parsed.input);
}

/** Native V2 command execution, before any model prompt or tool invocation.
 * The control result is delivered only to the invoking session. */
export async function registerSandboxCommand(ctx, invoke) {
  if (typeof ctx?.command?.transform !== "function" || typeof ctx?.session?.synthetic !== "function" ||
      typeof ctx?.permission?.assert !== "function") throw new Error("sandbox requires the native V2 command, synthetic response and permission APIs");
  return ctx.command.transform((editor) => {
    editor.add({
      name: "sandbox",
      description: "Build, rebuild or explicitly transfer the sandbox of the active work",
      async execute({ sessionID, prompt }) {
        const parsed = parseSandboxCommand(prompt?.text ?? "");
        if (!parsed.ok || parsed.help) {
          await ctx.session.synthetic({ sessionID, text: parsed.ok ? parsed.usage : `${parsed.reason}\n${parsed.usage}`, delivery: "queue", resume: false });
          return;
        }
        // Commands act directly, so explicitly apply the same named action
        // rule as their tools before resolving source or touching resources.
        await ctx.permission.assert({ sessionID, action: `sandbox_${parsed.operation}`, resources: ["*"] });
        const result = await invoke(parsed.operation, parsed.input, sessionID);
        await ctx.session.synthetic({ sessionID, text: JSON.stringify(result), delivery: "queue", resume: false });
      },
    });
  });
}
