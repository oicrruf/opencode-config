// One mutation at a time per project, including asynchronous starts. Authority
// to re-enter is process-private AsyncLocalStorage, never a caller argument or
// an operation ID read from disk. Crashes intentionally leave a blocking record.
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { openSync, closeSync, readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync, lstatSync, realpathSync, constants } from "node:fs";
import { join } from "node:path";
import { resolveRepositoryRoot } from "./paths.mjs";
import { screenValue } from "./secret-screen.mjs";

const context = new AsyncLocalStorage();
const phases = new Set(["intent", "reported", "closing", "closed", "successor", "running", "recovery-pending", "recovered"]);
const failure = (reason) => ({ ok: false, blocked: true, reason });

function statePaths(cwd) {
  const project = resolveRepositoryRoot(cwd);
  if (!project.ok) throw new Error("project identity unavailable");
  const root = realpathSync(project.root);
  let dir = root;
  for (const segment of [".opencode", "state", "sandbox"]) {
    dir = join(dir, segment);
    try { mkdirSync(dir, { mode: 0o700 }); } catch (error) { if (error.code !== "EEXIST") throw error; }
    const stat = lstatSync(dir);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("unsafe state directory");
  }
  return { root, lock: join(dir, "operation.json"), journal: join(dir, "transition.json") };
}

function readJson(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try { return JSON.parse(readFileSync(fd, "utf8")); }
  finally { closeSync(fd); }
}

function processIdentity() {
  try { return execFileSync("ps", ["-p", String(process.pid), "-o", "lstart="], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim() || null; }
  catch { return null; }
}

function owns(paths, operation) {
  if (!operation?.active || operation.root !== paths.root) return false;
  try { return readJson(paths.lock).operationId === operation.record.operationId; }
  catch { return false; }
}

export function ownsSandboxOperation(cwd) {
  try { return owns(statePaths(cwd), context.getStore()); } catch { return false; }
}

/** Works with both synchronous helpers and async lifecycle operations. */
export function withSandboxOperation(cwd, action, run) {
  let paths;
  try { paths = statePaths(cwd); }
  catch { return failure("the sandbox operation state is unsafe or unavailable"); }
  const inherited = context.getStore();
  if (owns(paths, inherited)) return run();
  const record = { schemaVersion: 1, operationId: randomUUID(), action, pid: process.pid, ownerStartIdentity: processIdentity(), startedAt: new Date().toISOString() };
  let fd;
  try {
    fd = openSync(paths.lock, "wx", 0o600);
    writeFileSync(fd, `${JSON.stringify(record)}\n`);
  } catch {
    // Even a partially written lock remains a block. Never delete unknown
    // state to retry a mutation; an operator can reconcile it explicitly.
    return failure("a sandbox operation is active or its ownership is unverifiable");
  } finally { if (fd !== undefined) closeSync(fd); }

  return runOwned(paths, record, run);
}

function runOwned(paths, record, run) {
  const operation = { active: true, root: paths.root, record };
  const release = () => {
    if (!owns(paths, operation)) { operation.active = false; return false; }
    operation.active = false;
    try { unlinkSync(paths.lock); return true; } catch { return false; }
  };
  const finish = (result) => release() ? result : { ...result, ...failure("the sandbox operation lock could not be released; reconciliation is required") };
  return context.run(operation, () => {
    try {
      const result = run();
      if (result && typeof result.then === "function") {
        return Promise.resolve(result).then(finish, (error) => { release(); throw error; });
      }
      return finish(result);
    } catch (error) { release(); throw error; }
  });
}

/** Explicit recovery only. PID/start identity, never age, establishes that
 * the old mutator cannot resume. Atomic replacement keeps the gate closed. */
export function withSandboxRecovery(cwd, run) {
  let paths;
  try { paths = statePaths(cwd); } catch { return failure("operation recovery state unavailable"); }
  let previous;
  try { previous = readJson(paths.lock); }
  catch (error) { return error.code === "ENOENT" ? withSandboxOperation(cwd, "recoverTransition", () => run({ abandoned: false })) : failure("operation ownership cannot be reconciled"); }
  if (previous?.schemaVersion !== 1 || typeof previous.operationId !== "string" || !previous.ownerStartIdentity ||
      !Number.isSafeInteger(previous.pid) || previous.pid <= 0) return failure("operation owner identity is incomplete");
  let ended = false;
  try {
    process.kill(previous.pid, 0);
    const observed = execFileSync("ps", ["-p", String(previous.pid), "-o", "lstart="], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    ended = Boolean(observed) && observed !== previous.ownerStartIdentity;
  } catch (error) { ended = error.code === "ESRCH"; }
  if (!ended) return failure("the previous operation owner has not verifiably ended");
  const claim = `${paths.lock}.recovery`;
  let claimFd;
  const record = { schemaVersion: 1, operationId: randomUUID(), action: "recoverTransition", pid: process.pid, ownerStartIdentity: processIdentity(), startedAt: new Date().toISOString() };
  const temporary = `${paths.lock}.${record.operationId}.tmp`;
  try {
    claimFd = openSync(claim, "wx", 0o600);
    writeFileSync(claimFd, JSON.stringify(record));
    if (readJson(paths.lock).operationId !== previous.operationId) throw new Error("changed operation");
    writeFileSync(temporary, `${JSON.stringify(record)}\n`, { flag: "wx", mode: 0o600 });
    renameSync(temporary, paths.lock);
  } catch {
    try { unlinkSync(temporary); } catch { /* preserve canonical identity */ }
    return failure("operation recovery is contested or could not be persisted");
  } finally {
    if (claimFd !== undefined) {
      closeSync(claimFd);
      try { if (readJson(claim).operationId === record.operationId) unlinkSync(claim); } catch { /* uncertainty blocks subsequent recovery */ }
    }
  }
  return runOwned(paths, record, () => run({ abandoned: true }));
}

/** A journal is evidence, not a capability. Never store tokens/verifiers. */
export function writeTransition(cwd, input) {
  let paths;
  try { paths = statePaths(cwd); } catch { return failure("transition state unavailable"); }
  if (!owns(paths, context.getStore())) return failure("transition writes require the exclusive operation");
  if (!phases.has(input?.phase)) return failure("invalid transition phase");
  const record = { schemaVersion: 1, updatedAt: new Date().toISOString() };
  for (const key of ["phase", "workId", "worktreePath", "sessionId", "previousExecutionId", "previousGeneration", "successorExecutionId", "successorGeneration"]) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== "string" || !input[key]) return failure("invalid transition identity");
      record[key] = input[key];
    }
  }
  if (!record.workId || !record.sessionId || !record.worktreePath) return failure("incomplete transition identity");
  if (screenValue(JSON.stringify(record))) return failure("transition metadata contains a credential-shaped value");
  const temporary = `${paths.journal}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(record)}\n`, { flag: "wx", mode: 0o600 });
    renameSync(temporary, paths.journal);
    return { ok: true, transition: record };
  } catch {
    try { unlinkSync(temporary); } catch { /* evidence at the canonical path stays untouched */ }
    return failure("the transition could not be persisted");
  }
}

export function readTransition(cwd) {
  try {
    const paths = statePaths(cwd);
    let transition;
    try { transition = readJson(paths.journal); }
    catch (error) { if (error.code === "ENOENT") return { ok: true, transition: null }; throw error; }
    if (transition?.schemaVersion !== 1 || !phases.has(transition?.phase) ||
        ![transition.workId, transition.sessionId, transition.worktreePath].every((value) => typeof value === "string" && value)) {
      return failure("transition identity is invalid or unsupported");
    }
    return { ok: true, transition };
  } catch { return failure("transition state is unverifiable"); }
}
