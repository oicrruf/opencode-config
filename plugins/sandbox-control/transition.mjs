import { randomUUID } from "node:crypto";
import { unlinkSync, existsSync, readFileSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { validateSandboxOperation } from "./command.mjs";
import { resolveSandboxSource } from "./source.mjs";
import { canonicalPath, resolveRepositoryRoot, reportDir } from "./paths.mjs";
import { readSandboxConfig, checkDependencies, verifyConfigurationSnapshot, configurationEvidence } from "./sandbox-config.mjs";
import { inspectLocalEngine } from "./engine.mjs";
import { withSandboxOperation, withSandboxRecovery, readTransition, writeTransition } from "./operation.mjs";
import { readReservation, replaceSandboxReservation, recordPath } from "./reservation.mjs";
import { startSandbox, buildExecutionIdentity, readExecutionRecord, writeExecutionRecord, closeTransitionExecution, cleanupExecution, executionDir, buildReport, writeReport } from "./lifecycle.mjs";
import { releaseProjectReservation, transferApplicationReservation } from "./release.mjs";

const blocked = (reason, detail = {}) => ({ ok: false, blocked: true, reason, ...detail });

/** Tool callers supply only configuration. Identity comes from the adapter. */
export async function executeSandboxOperation(operation, input, context, deps = {}) {
  const argumentsValid = validateSandboxOperation(operation, input);
  if (!argumentsValid.ok) return argumentsValid;
  if (operation === "release") return releaseProjectReservation(context, deps);
  const source = await resolveSandboxSource(context);
  if (!source.ok) return source;
  const cwd = source.worktreePath;
  return withSandboxOperation(cwd, operation, async () => {
    const journal = readTransition(cwd);
    if (!journal.ok) return journal;
    if (journal.transition && !["running", "recovered"].includes(journal.transition.phase)) {
      return blocked("an interrupted transition requires explicit sandbox_recover_transition before another start");
    }
    const current = readReservation(cwd);
    if (!current.ok) return blocked("the project reservation is unverifiable");
    const request = { ...source, cwd, configPath: input.configPath };
    if (current.state === "free") {
      if (operation === "transfer" && !input.configPath) return blocked("transfer needs a destination configuration path");
      if (operation === "rebuild") return blocked("rebuild requires an active owned sandbox");
      return startSandbox(request, deps);
    }
    if (operation === "build") return blocked("the project already holds an application reservation");

    const old = current.reservation;
    if (operation === "transfer" && old.scope === "application") {
      if (!input.configPath) return blocked("application transfer needs the destination Compose file path for a pre-teardown persistence check");
      return transferApplicationReservation(context, input.configPath, deps, source);
    }
    const previous = readExecutionRecord(cwd, old.executionId);
    if (old.scope !== "sandbox" || old.workId !== source.workId || !old.generation || !old.sessionId || !previous.ok ||
        previous.record.workId !== source.workId || previous.record.generation !== old.generation ||
        previous.record.sessionId !== old.sessionId || previous.record.projectID !== source.projectID ||
        typeof previous.record.source?.checkout !== "string") {
      return blocked("the reservation is not a verified transferable sandbox for this project and work");
    }
    const previousProject = resolveRepositoryRoot(previous.record.source.checkout);
    if (!previousProject.ok || canonicalPath(previousProject.root) !== source.projectRoot) {
      return blocked("the previous sandbox source cannot be verified in this project");
    }
    if (operation === "rebuild" && (old.sessionId !== source.sessionId || canonicalPath(previous.record.source.checkout) !== source.worktreePath)) {
      return blocked("rebuild requires the owning session and checkout; request explicit transfer to change ownership");
    }

    // Validate replacement prerequisites before touching the current sandbox.
    const config = readSandboxConfig(cwd, input.configPath);
    if (!config.ok) return config;
    const engine = inspectLocalEngine(deps);
    if (!engine.ok) return engine;
    const dependencies = await checkDependencies(config.config.dependencies, deps);
    if (!dependencies.ok) return dependencies;
    const stable = verifyConfigurationSnapshot(cwd, config.config);
    if (!stable.ok) return stable;

    const identity = buildExecutionIdentity(source.workId, source.workName);
    const generation = randomUUID();
    const transition = {
      phase: "intent", workId: source.workId, worktreePath: cwd, sessionId: source.sessionId,
      previousExecutionId: old.executionId, previousGeneration: old.generation,
      successorExecutionId: identity.executionId, successorGeneration: generation,
    };
    const persist = (phase) => {
      const saved = writeTransition(cwd, { ...transition, phase });
      if (saved.ok) deps.onTransitionPhase?.(phase);
      return saved;
    };
    const intended = persist("intent");
    if (!intended.ok) return intended;
    const closed = closeTransitionExecution(cwd, old.executionId, deps);
    if (!closed.ok) return blocked(closed.reason, { quotaReleased: false, remaining: closed.remaining ?? [], transitionPending: true });
    const closureSaved = persist("closed");
    if (!closureSaved.ok) return closureSaved;

    // A provisional successor makes even a crash before start's preflight
    // recoverable. It has no captured secrets or created resources yet.
    const prepared = writeExecutionRecord(cwd, {
      ...identity, schemaVersion: 2, generation, sessionId: source.sessionId, projectID: source.projectID,
      source: { checkout: cwd }, configuration: configurationEvidence(config.config),
      engine: engine.binding, startedAt: new Date().toISOString(), phase: "preparing", result: null,
      capture: null, image: null, container: null, network: null, reportPath: null,
      secretNames: [], resources: { containers: [], images: [], networks: [], volumes: [] }, deadlineAt: null,
    });
    if (!prepared.ok) return prepared;
    deps.onTransitionPhase?.("prepared");
    const replacement = replaceSandboxReservation(cwd, old, { ...identity, generation, sessionId: source.sessionId });
    if (!replacement.ok) return replacement;
    const successorSaved = persist("successor");
    if (!successorSaved.ok) return { ...successorSaved, executionId: identity.executionId, token: replacement.token };
    const started = await startSandbox(request, {
      ...deps, expectedConfigurationFingerprint: config.config.fingerprint,
      preparedExecution: { identity, reservation: replacement },
    });
    const remaining = readReservation(cwd);
    const saved = persist(started.ok ? "running" : remaining.ok && remaining.state === "free" ? "recovered" : "recovery-pending");
    if (!saved.ok) return { ...started, ...blocked(saved.reason), executionId: identity.executionId, token: replacement.token };
    return started.ok ? { ...started, previousExecutionId: old.executionId, previousReportPath: closed.reportPath, transferred: operation === "transfer" } :
      { ...started, transitionPending: remaining.state !== "free", ...(remaining.state !== "free" ? { executionId: identity.executionId, token: replacement.token } : {}) };
  });
}

/** Explicit recovery closes the identified transition only. It never builds. */
export async function recoverSandboxTransition(context, deps = {}) {
  const source = await resolveSandboxSource(context);
  if (!source.ok) return source;
  const cwd = source.worktreePath;
  return withSandboxRecovery(cwd, (recovery) => {
    const journal = readTransition(cwd);
    if (!journal.ok) return journal;
    const transition = journal.transition;
    if (!transition) return { ok: true, recovered: false, reason: "no transition journal exists; the reservation is unchanged" };
    if (transition.workId !== source.workId) return blocked("the transition belongs to another work");
    const current = readReservation(cwd);
    if (!current.ok) return blocked("the current reservation is unverifiable");
    if (current.state === "free") {
      if (transition.phase === "recovered") return { ok: true, recovered: true, alreadyClosed: true };
      const record = readExecutionRecord(cwd, transition.successorExecutionId);
      if (!record.ok || record.record.phase !== "closed" || record.record.generation !== transition.successorGeneration) {
        return blocked("a free reservation alone does not prove the transition closed");
      }
      const absent = cleanupExecution(cwd, transition.successorExecutionId, deps);
      if (!absent.ok) return absent;
      return writeTransition(cwd, { ...transition, phase: "recovered" });
    }
    const held = current.reservation;
    if (held.scope !== "sandbox" || held.workId !== source.workId || !(
      (held.executionId === transition.previousExecutionId && held.generation === transition.previousGeneration) ||
      (held.executionId === transition.successorExecutionId && held.generation === transition.successorGeneration))) {
      return blocked("the current reservation does not match the interrupted transition");
    }
    if (transition.phase === "running" && !recovery.abandoned && held.sessionId !== source.sessionId) {
      return blocked("a running transition requires its verified owning session or proof that its operation owner ended");
    }
    const closed = closeTransitionExecution(cwd, held.executionId, deps);
    if (!closed.ok) return closed;
    if (held.executionId === transition.previousExecutionId) {
      // An interruption may occur after writing the provisional successor
      // but before reservation rotation. Close that unused state as well.
      const successor = executionDir(cwd, transition.successorExecutionId);
      if (!successor.ok) return successor;
      if (existsSync(successor.dir)) {
        const provisional = readExecutionRecord(cwd, transition.successorExecutionId);
        if (!provisional.ok || provisional.record.generation !== transition.successorGeneration ||
            provisional.record.workId !== source.workId || !["preparing", "closed"].includes(provisional.record.phase) || provisional.record.capture !== null) {
          return blocked("the unused successor state is unverifiable");
        }
        const report = buildReport(provisional.record, { result: "not executed", steps: ["unused successor closed during explicit transition recovery"], differencesFromProduction: [] });
        if (!report.ok) return report;
        let savedReport;
        if (provisional.record.phase === "closed") {
          const directory = reportDir(cwd);
          if (!directory.ok) return directory;
          const path = join(directory.dir, `${transition.successorExecutionId}.json`);
          try {
            if (lstatSync(path).isSymbolicLink()) throw new Error("unsafe report");
            const original = JSON.parse(readFileSync(path, "utf8"));
            if (original.executionId !== transition.successorExecutionId || original.workId !== source.workId || original.result !== "not executed") throw new Error("invalid report");
            savedReport = { ok: true, path };
          } catch { return blocked("the closed provisional successor report cannot be verified"); }
        } else savedReport = writeReport(cwd, transition.successorExecutionId, report.report);
        if (!savedReport.ok) return savedReport;
        const absent = cleanupExecution(cwd, transition.successorExecutionId, { ...deps, preserveExecutionRecord: true });
        if (!absent.ok) return absent;
        const savedRecord = writeExecutionRecord(cwd, { ...provisional.record, phase: "closed", result: "not executed", reportPath: savedReport.path });
        if (!savedRecord.ok) return savedRecord;
      }
    }
    const saved = writeTransition(cwd, { ...transition, phase: "recovered" });
    if (!saved.ok) return saved;
    // Closure and exact identity were verified under the same private
    // exclusive operation. No old session token is obtained or exposed.
    const confirmed = readReservation(cwd);
    if (!confirmed.ok || confirmed.reservation?.executionId !== held.executionId || confirmed.reservation?.generation !== held.generation) {
      return blocked("the reservation changed before transition release");
    }
    const path = recordPath(cwd);
    if (!path.ok) return path;
    try { unlinkSync(path.path); }
    catch { return blocked("the closed transition reservation could not be released"); }
    return { ok: true, recovered: true, closed: true, quotaReleased: true, reportPath: closed.reportPath };
  });
}
