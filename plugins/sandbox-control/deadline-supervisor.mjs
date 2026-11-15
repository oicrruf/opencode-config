// Detached deadline enforcement for a single sandbox execution.
// The raw reservation token arrives over stdin and stays in process memory;
// it is never included in argv or the persisted supervisor state.

import { closeExpiredExecution, readExecutionRecord, recoverSandbox } from "./lifecycle.mjs";
import { readReservation, verifyOwner } from "./reservation.mjs";
import { readSupervisor } from "./execution.mjs";

async function readInput(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const input = await readInput(process.stdin);
if (!input?.cwd || !input?.executionId || !input?.deadlineAt || !input?.token) process.exit(2);

let firstAttempt = true;
for (;;) {
  const supervisor = readSupervisor(input.cwd);
  if (!supervisor.ok || !supervisor.supervisor || supervisor.supervisor.executionId !== input.executionId) process.exit(0);

  const execution = readExecutionRecord(input.cwd, input.executionId);
  if (!execution.ok || ["closed", "failed", "cancelled"].includes(execution.record.phase)) process.exit(0);
  const currentReservation = readReservation(input.cwd);
  if (!currentReservation.ok || currentReservation.state !== "held") process.exit(0);
  if (currentReservation.reservation.executionId !== input.executionId || !verifyOwner(input.cwd, input.token).ok) process.exit(0);

  const remaining = new Date(input.deadlineAt).getTime() - Date.now();
  if (remaining > 0) {
    await delay(Math.min(remaining, 10_000));
    continue;
  }

  const result = firstAttempt
    ? closeExpiredExecution(input.cwd, input.executionId, { token: input.token })
    : recoverSandbox(input.cwd, input.executionId, { token: input.token });
  firstAttempt = false;

  const reservation = readReservation(input.cwd);
  if (!reservation.ok || reservation.state !== "held" || reservation.reservation.executionId !== input.executionId || !verifyOwner(input.cwd, input.token).ok) process.exit(0);
  if (result?.ok && reservation.ok && reservation.state === "free") process.exit(0);

  // A temporary engine outage leaves the execution and its quota intact.
  // Retry closure without changing the original report or touching other runs.
  await delay(30_000);
}
