// Autonomy plugin for opencode.
// Auto-stash checkpoints every N edits + desktop notifications on session.idle/error.
// Sits in ~/.config/opencode/plugins/ so it is auto-discovered.
//
// Env vars:
//   OPENCODE_AUTONOMY=0            disable entirely
//   OPENCODE_CHECKPOINT_INTERVAL=N edits per checkpoint (default 10)
//   OPENCODE_NOTIFY=0              disable desktop notifications
//   OPENCODE_AUTONOMY_LOG=path     also log events to this file
//
// Recovery after a session dies:
//   cd <project> && git stash list && git stash pop

import { spawn } from "node:child_process";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const INTERVAL = parseInt(process.env.OPENCODE_CHECKPOINT_INTERVAL || "10", 10) || 10;
const editCount = new Map(); // directory -> int

function notify(title, body) {
  if (process.env.OPENCODE_NOTIFY === "0") return;
  try {
    const child = spawn("notify-send", ["--app-name=opencode", title, body], {
      stdio: "ignore",
      detached: true,
    });
    child.unref();
  } catch {
    // notify-send not available — silent fallback
  }
}

async function logEvent(file, line) {
  if (!file) return;
  try {
    await mkdir(dirname(file), { recursive: true });
    await appendFile(file, `${new Date().toISOString()} ${line}\n`);
  } catch {
    // log dir not writable — silent
  }
}

async function checkpoint(directory, $, log) {
  const count = editCount.get(directory) || 0;
  if (count === 0 || count % INTERVAL !== 0) return;
  try {
    await $`git stash push -u -m opencode-checkpoint-${count}`.cwd(directory);
    const projectName = directory.split("/").filter(Boolean).pop();
    notify("OpenCode checkpoint", `${projectName}: auto-stashed after ${count} edits`);
    await log(log, `checkpoint project=${projectName} count=${count}`);
  } catch (err) {
    // not a git repo, no changes to stash, or git missing — silent
    await log(log, `checkpoint-skip project=${directory} err=${err?.message?.slice(0, 100)}`);
  }
}

async function log(file, line) {
  await logEvent(file, line);
}

export const AutonomyPlugin = async ({ directory, $ }) => {
  if (process.env.OPENCODE_AUTONOMY === "0") return {};
  const logFile = process.env.OPENCODE_AUTONOMY_LOG || "";
  await log(logFile, `plugin-loaded directory=${directory}`);

  return {
    "tool.execute.after": async (input, output) => {
      const tool = input?.tool;
      if (tool !== "edit" && tool !== "write") return;
      const count = (editCount.get(directory) || 0) + 1;
      editCount.set(directory, count);
      await checkpoint(directory, $, logFile);
    },

    event: async ({ event }) => {
      const type = event?.type;
      if (!type) return;

      if (type === "session.idle") {
        notify("OpenCode: listo", "Sesión inactiva, podés volver a la PC");
        await log(logFile, `session.idle`);
      } else if (type === "session.error") {
        const msg = event?.properties?.error?.message || "Error desconocido";
        notify("OpenCode: error", msg.slice(0, 200));
        await log(logFile, `session.error msg=${msg.slice(0, 200)}`);
      }
    },
  };
};
