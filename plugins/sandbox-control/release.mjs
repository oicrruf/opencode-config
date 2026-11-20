import { withSandboxOperation } from "./operation.mjs";
import { resolveSandboxSource } from "./source.mjs";
import { resolveReleaseSource, resolveGitReleaseSource } from "./release-source.mjs";
import { canonicalPath, isInside } from "./paths.mjs";
import { readReservation, releaseVerifiedReservation, handoffApplicationReservation } from "./reservation.mjs";
import { inspectLocalEngine, boundDocker } from "./engine.mjs";
import { discoverComposeProject, persistentMountsFromManifest, readComposePersistentMounts, persistentMountSetsMatch } from "./compose-resources.mjs";
import { listWorktrees } from "../worktree-control/creation.mjs";
import { reconcileInventory } from "../worktree-control/inventory.mjs";
import { readTransition, writeTransition } from "./operation.mjs";
import { resolveRepositoryRoot, reportDir, ensureDir } from "./paths.mjs";
import { closeTransitionExecution, readExecutionRecord } from "./lifecycle.mjs";
import { readFileSync, writeFileSync, lstatSync, existsSync, statSync } from "node:fs";
import { join, resolve, relative, sep } from "node:path";
import { screenValue } from "./secret-screen.mjs";
import { inspectProcessGroup, stopProcessGroup } from "./execution.mjs";
import { readProcessStartIdentity } from "./reservation.mjs";

const blocked = (reason) => ({ ok: false, blocked: true, released: false, reason });

function persistComposeReleaseReport(cwd, reservation, manifest) {
  const directory = reportDir(cwd);
  if (!directory.ok) return directory;
  const ensured = ensureDir(directory.dir);
  if (!ensured.ok) return ensured;
  const path = join(directory.dir, `compose-release-${reservation.generation ?? reservation.ownerTokenId}.json`);
  const report = {
    schemaVersion: 2, type: "compose-release", workId: reservation.workId,
    resourceWorkId: manifest.workId,
    ownerGeneration: reservation.generation ?? null, ownerTokenId: reservation.ownerTokenId,
    projectRoot: manifest.projectRoot, worktreePath: manifest.worktreePath,
    composeProject: manifest.project, engineId: manifest.engineId,
    containers: manifest.containers, networks: manifest.networks, mounts: manifest.mounts,
    recordedAt: new Date().toISOString(),
  };
  if (screenValue(JSON.stringify(report))) return blocked("the release report contains credential-shaped data");
  try {
    writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    return { ok: true, path };
  } catch (err) {
    if (err.code !== "EEXIST") return blocked("the release report could not be preserved before cleanup");
    try {
      if (lstatSync(path).isSymbolicLink()) return blocked("the existing release report path is unsafe");
      const previous = JSON.parse(readFileSync(path, "utf8"));
      const currentContainersBelong = Array.isArray(previous.containers) && manifest.containers.every((item) =>
        previous.containers.some((old) => old.id === item.id && old.service === item.service && old.name === item.name));
      const mountKey = (mount) => JSON.stringify([mount.containerId, mount.type, mount.name ?? null,
        mount.source ?? null, mount.destination, mount.readOnly]);
      const currentMountsBelong = Array.isArray(previous.mounts) && manifest.mounts.every((item) =>
        previous.mounts.some((old) => mountKey(old) === mountKey(item)));
      if (previous.type !== report.type || previous.workId !== report.workId ||
          (previous.resourceWorkId !== undefined && previous.resourceWorkId !== report.resourceWorkId) ||
          previous.ownerGeneration !== report.ownerGeneration || previous.composeProject !== report.composeProject ||
          previous.ownerTokenId !== report.ownerTokenId || previous.engineId !== report.engineId ||
          canonicalPath(previous.projectRoot) !== canonicalPath(report.projectRoot) ||
          canonicalPath(previous.worktreePath) !== canonicalPath(report.worktreePath) ||
          !currentContainersBelong || !currentMountsBelong) return blocked("an existing release report belongs to different resources");
      return { ok: true, path };
    } catch { return blocked("the existing release report cannot be verified"); }
  }
}

async function closeVerifiedProcessGroup(reservation, deps) {
  if (reservation.processGroup == null) return blocked("the reservation has no process-group identity");
  let group = inspectProcessGroup(reservation.processGroup, deps);
  if (!group.ok) return blocked(group.reason ?? "the reservation process group cannot be inspected");
  if (group.hasProcesses) {
    const actualIdentity = readProcessStartIdentity(reservation.processGroup);
    const leaderPresent = group.processes.some(({ pid, pgid }) => pid === reservation.processGroup && pgid === reservation.processGroup);
    if (!leaderPresent || !reservation.processGroupStartIdentity || actualIdentity !== reservation.processGroupStartIdentity) {
      return blocked("the live reservation process group has no matching recorded start identity and cannot be stopped safely");
    }
    const stopped = stopProcessGroup(reservation.processGroup, deps);
    if (!stopped.ok) return blocked(stopped.reason);
    // Compose clients may take several seconds to unwind after SIGTERM while
    // the engine completes its configured container stop timeout.
    for (let attempt = 0; attempt < 150; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      group = inspectProcessGroup(reservation.processGroup, deps);
      if (group.ok && group.hasProcesses === false) return { ok: true };
      if (!group.ok) return blocked(group.reason ?? "the reservation process group state became unknown after stop");
    }
    return blocked("the recorded reservation process group did not stop; Compose resources and quota are preserved");
  }
  if (group.hasProcesses !== false) return blocked("the reservation process group is not confirmed empty");
  return { ok: true };
}

function existingReleaseReport(cwd, reservation) {
  const directory = reportDir(cwd);
  if (!directory.ok) return directory;
  const path = join(directory.dir, `compose-release-${reservation.generation ?? reservation.ownerTokenId}.json`);
  if (!existsSync(path)) return { ok: true, report: null, path };
  try {
    if (lstatSync(path).isSymbolicLink()) return blocked("the existing Compose release report path is unsafe");
    const report = JSON.parse(readFileSync(path, "utf8"));
    if (![1, 2].includes(report.schemaVersion) || report.type !== "compose-release" || report.workId !== reservation.workId ||
        (report.schemaVersion === 2 && (typeof report.resourceWorkId !== "string" || !report.resourceWorkId)) ||
        report.ownerGeneration !== (reservation.generation ?? null) || report.ownerTokenId !== reservation.ownerTokenId ||
        !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(report.composeProject) ||
        typeof report.engineId !== "string" || !report.engineId || typeof report.projectRoot !== "string" || !report.projectRoot.startsWith("/") ||
        typeof report.worktreePath !== "string" || !report.worktreePath.startsWith("/") ||
        !Array.isArray(report.containers) || report.containers.length === 0 ||
        report.containers.some((item) => !/^[a-f0-9]{12,64}$/i.test(item?.id ?? "") ||
          !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(item?.service ?? "") || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(item?.name ?? "")) ||
        !Array.isArray(report.mounts) || report.mounts.some((mount) => !mount || !["bind", "volume"].includes(mount.type) ||
          !/^[a-f0-9]{12,64}$/i.test(mount.containerId ?? "") || typeof mount.destination !== "string" || typeof mount.readOnly !== "boolean" ||
          (mount.type === "bind" ? typeof mount.source !== "string" || !mount.source.startsWith("/") : typeof mount.name !== "string")) ||
        screenValue(JSON.stringify(report))) return blocked("the existing Compose release report is unverifiable");
    return { ok: true, report, path };
  } catch { return blocked("the existing Compose release report cannot be read safely"); }
}

/** Resolve the one Compose project whose bind mounts identify a managed
 * worktree in this project. Legacy reservation ownership can be stale; the
 * runtime source is accepted only when exactly one inventory entry proves it. */
function discoverManagedComposeSource(docker, projectRoot, inventory, engineId, deps = {}) {
  const matches = [];
  const ambiguous = [];
  for (const entry of inventory.present) {
    const result = discoverComposeProject(docker, {
      projectRoot, workId: entry.workId, worktreePath: entry.directory,
      worktreeVerified: true, engineId,
    }, deps);
    if (result.ok) matches.push({ entry, manifest: result.manifest });
    else if (!result.reason?.includes("no Compose project is verifiably attached to the reserved worktree")) {
      ambiguous.push({ entry, reason: result.reason ?? "Compose identity is not verified" });
    }
  }
  if (ambiguous.length) return blocked("Compose resources are ambiguous across the managed worktree inventory");
  if (matches.length !== 1) return blocked(matches.length === 0
    ? "no Compose project is verifiably attached to a managed worktree in this project"
    : "multiple Compose projects match managed worktrees in this project");
  return { ok: true, ...matches[0] };
}

function reportResourceOwner(report, inventory) {
  const matches = inventory.present.filter((entry) => entry.exists === true &&
    canonicalPath(entry.directory) === canonicalPath(report.worktreePath) &&
    (!report.resourceWorkId || entry.workId === report.resourceWorkId));
  return matches.length === 1 ? { ok: true, entry: matches[0] } : blocked("the persisted Compose report does not resolve to one managed resource worktree");
}

/** Explicitly release an application only after Compose labels and mounts
 * prove the exact managed source worktree. Docker volumes are never removed. */
export async function releaseProjectReservation(context, deps = {}) {
  const source = await resolveReleaseSource(context);
  if (!source.ok) return source;
  return withSandboxOperation(source.worktreePath, "sandboxRelease", async () => {
    const current = readReservation(source.worktreePath);
    if (!current.ok) return blocked("the project reservation is unverifiable");
    if (current.state === "free") return { ok: true, released: false, reason: "the project reservation is already free" };
    const reservation = current.reservation;
    let inventory;
    if (source.releaseGitFallback) {
      const refreshed = resolveGitReleaseSource(context);
      if (!refreshed.ok) return refreshed;
      if (refreshed.projectRoot !== source.projectRoot || refreshed.worktreePath !== source.worktreePath) return blocked("the release project changed while acquiring its operation");
      inventory = refreshed.inventory;
    } else {
      const listing = await listWorktrees(context.worktree, source.worktreePath);
      if (!listing.verified) return blocked(listing.reason ?? "the managed worktree inventory is unverifiable");
      inventory = reconcileInventory(source.projectRoot, listing.worktrees, { verified: true });
    }
    if (!inventory.ok) return blocked(inventory.reason);
    const ownerMatches = inventory.present.filter((entry) => entry?.workId === reservation.workId && entry?.exists === true && typeof entry.directory === "string");

    if (reservation.scope === "sandbox") {
      if (ownerMatches.length !== 1) return blocked("the reservation owner does not resolve to one managed worktree");
      const record = readExecutionRecord(source.worktreePath, reservation.executionId);
      const project = record.ok ? resolveRepositoryRoot(record.record.source?.checkout ?? "") : { ok: false };
      if (!reservation.generation || !reservation.executionId || !record.ok ||
          record.record.workId !== reservation.workId || record.record.generation !== reservation.generation ||
          record.record.sessionId !== reservation.sessionId || !project.ok || canonicalPath(project.root) !== canonicalPath(source.projectRoot) ||
          canonicalPath(record.record.source.checkout) !== canonicalPath(ownerMatches[0].directory)) {
        return blocked("the sandbox reservation does not match one managed execution in this project");
      }
      const prior = readTransition(source.worktreePath);
      if (!prior.ok || (prior.transition && !["running", "recovered"].includes(prior.transition.phase))) {
        return blocked("an earlier transition needs explicit recovery before release");
      }
      const transition = {
        phase: "intent", workId: reservation.workId, worktreePath: source.worktreePath,
        sessionId: source.sessionId, previousExecutionId: reservation.executionId,
        previousGeneration: reservation.generation,
      };
      const intended = writeTransition(source.worktreePath, transition);
      if (!intended.ok) return intended;
      const closed = closeTransitionExecution(source.worktreePath, reservation.executionId, deps);
      if (!closed.ok) return closed;
      const closureSaved = writeTransition(source.worktreePath, { ...transition, phase: "closed" });
      if (!closureSaved.ok) return closureSaved;
      const released = releaseVerifiedReservation(source.worktreePath, reservation, { resourcesAbsent: true });
      if (!released.ok) return blocked(released.reason);
      const reconciled = writeTransition(source.worktreePath, { ...transition, phase: "recovered" });
      return reconciled.ok ? { ok: true, released: true, workId: reservation.workId, reportPath: closed.reportPath } : reconciled;
    }
    if (reservation.scope !== "application") return blocked("the reservation scope is not supported for explicit release");
    const engine = inspectLocalEngine(deps);
    if (!engine.ok) return blocked(engine.reason);
    const docker = boundDocker(engine.binding, deps);
    const priorReport = existingReleaseReport(source.worktreePath, reservation);
    if (!priorReport.ok) return priorReport;
    let resourceOwner = null;
    if (priorReport.report) {
      const reportOwner = reportResourceOwner(priorReport.report, inventory);
      if (!reportOwner.ok) return reportOwner;
      resourceOwner = reportOwner.entry;
      if (priorReport.report.engineId !== engine.binding.id ||
          canonicalPath(priorReport.report.projectRoot) !== canonicalPath(source.projectRoot) ||
          canonicalPath(priorReport.report.worktreePath) !== canonicalPath(resourceOwner.directory)) {
        return blocked("the existing release report does not match this engine and managed worktree");
      }
      const labeled = String(docker("docker", ["ps", "--all", "--no-trunc", "--filter", `label=com.docker.compose.project=${priorReport.report.composeProject}`, "--format", "{{.ID}}"], {
        encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024,
      })).trim();
      if (!labeled) {
        const groupAfter = await closeVerifiedProcessGroup(reservation, deps);
        if (!groupAfter.ok) return groupAfter;
        const released = releaseVerifiedReservation(source.worktreePath, reservation, { resourcesAbsent: true });
        if (!released.ok) return blocked(released.reason);
        return { ok: true, released: true, recovered: true, workId: reservation.workId, reportPath: priorReport.path,
          preservedNamedVolumes: [...new Set(priorReport.report.mounts.filter((mount) => mount.type === "volume").map((mount) => mount.name))].sort(),
          preservedBindMounts: [...new Set(priorReport.report.mounts.filter((mount) => mount.type === "bind").map((mount) => mount.source))].sort() };
      }
    }
    let manifest;
    if (resourceOwner) {
      const found = discoverComposeProject(docker, {
        projectRoot: source.projectRoot, workId: resourceOwner.workId,
        worktreePath: canonicalPath(resourceOwner.directory), worktreeVerified: true, engineId: engine.binding.id,
      }, deps);
      if (!found.ok) return blocked(found.reason);
      manifest = found.manifest;
    } else {
      const found = discoverManagedComposeSource(docker, source.projectRoot, inventory, engine.binding.id, deps);
      if (!found.ok) return blocked(found.reason);
      resourceOwner = found.entry;
      manifest = found.manifest;
    }
    if (manifest.engineId !== engine.binding.id || manifest.workId !== resourceOwner.workId ||
        canonicalPath(manifest.projectRoot) !== canonicalPath(source.projectRoot) ||
        canonicalPath(manifest.worktreePath) !== canonicalPath(resourceOwner.directory)) {
      return blocked("Compose resources do not match one managed worktree in the active project");
    }
    const report = persistComposeReleaseReport(source.worktreePath, reservation, manifest);
    if (!report.ok) return report;
    const groupState = await closeVerifiedProcessGroup(reservation, deps);
    if (!groupState.ok) return groupState;

    try {
      for (const container of manifest.containers) {
        if (container.state === "running" || container.state === "restarting" || container.state === "paused") {
          docker("docker", ["stop", "--time", "10", container.id], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
        }
      }
      for (const container of manifest.containers) {
        docker("docker", ["rm", container.id], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      }
      const stillPresent = String(docker("docker", ["ps", "--all", "--no-trunc", "--format", "{{.ID}}"], {
        encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024,
      })).trim().split(/\s+/).filter(Boolean);
      if (manifest.containers.some(({ id }) => stillPresent.includes(id))) {
        return blocked("some verified Compose containers remain; the reservation and persistent data are preserved");
      }
      const projectContainers = String(docker("docker", ["ps", "--all", "--no-trunc", "--filter", `label=com.docker.compose.project=${manifest.project}`, "--format", "{{.ID}}"], {
        encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024,
      })).trim();
      if (projectContainers) return blocked("Compose containers with the verified project label remain; the reservation is preserved");
      const groupAfter = await closeVerifiedProcessGroup(reservation, deps);
      if (!groupAfter.ok) return groupAfter;
      const post = discoverManagedComposeSource(docker, source.projectRoot, inventory, engine.binding.id, deps);
      if (post.ok || post.reason !== "no Compose project is verifiably attached to a managed worktree in this project") {
        return blocked(post.reason ?? "new or unverifiable Compose resources appeared during release");
      }
    } catch {
      return blocked("Compose cleanup did not complete; the reservation and all persistent data are preserved");
    }
    const released = releaseVerifiedReservation(source.worktreePath, reservation, { resourcesAbsent: true });
    if (!released.ok) return blocked(released.reason);
    return {
      ok: true, released: true, workId: reservation.workId, composeProject: manifest.project,
      resourceWorkId: resourceOwner.workId,
      stoppedContainers: manifest.containers.map(({ id }) => id),
      preservedNamedVolumes: [...new Set(manifest.mounts.filter((mount) => mount.type === "volume").map((mount) => mount.name))].sort(),
      preservedBindMounts: [...new Set(manifest.mounts.filter((mount) => mount.type === "bind").map((mount) => mount.source))].sort(),
      networksPreserved: manifest.networks,
      reportPath: report.path,
      note: "No volumes or bind paths were deleted. Compose networks were preserved.",
    };
  });
}

function safeComposeFile(worktreePath, requestedPath) {
  if (typeof requestedPath !== "string" || !requestedPath.trim() || requestedPath.startsWith("/") || /^[A-Za-z]:|\\/.test(requestedPath) ||
      requestedPath.split(/[\\/]/).some((part) => !part || part === "..")) return null;
  const root = canonicalPath(worktreePath);
  const file = resolve(root, requestedPath);
  if (!isInside(root, file)) return null;
  let cursor = root;
  for (const part of relative(root, file).split(sep)) {
    cursor = join(cursor, part);
    try { if (lstatSync(cursor).isSymbolicLink()) return null; } catch { return null; }
  }
  try { return statSync(file).isFile() ? canonicalPath(file) : null; } catch { return null; }
}

/** Stop the verified old Compose application and rotate its quota to the
 * active managed worktree. The target must resume with the returned token. */
export async function transferApplicationReservation(context, configPath, deps = {}, verifiedSource = null) {
  const source = verifiedSource ?? await resolveSandboxSource(context);
  if (!source.ok) return source;
  const composeFile = safeComposeFile(source.worktreePath, configPath);
  if (!composeFile) return blocked("application transfer needs one regular Compose file inside the destination worktree");
  return withSandboxOperation(source.worktreePath, "applicationHandoff", async () => {
    const current = readReservation(source.worktreePath);
    if (!current.ok || current.state !== "held" || current.reservation.scope !== "application") return blocked("there is no held Compose application reservation to transfer");
    const reservation = current.reservation;
    const listing = await listWorktrees(context.worktree, source.worktreePath);
    if (!listing.verified) return blocked(listing.reason ?? "the managed worktree inventory is unverifiable");
    const inventory = reconcileInventory(source.projectRoot, listing.worktrees, { verified: true });
    if (!inventory.ok) return blocked(inventory.reason);
    const newOwner = inventory.present.filter((entry) => entry.workId === source.workId && canonicalPath(entry.directory) === source.worktreePath);
    if (newOwner.length !== 1) return blocked("the destination must resolve to one managed worktree in this project");
    const engine = inspectLocalEngine(deps);
    if (!engine.ok) return blocked(engine.reason);
    const docker = boundDocker(engine.binding, deps);
    const priorReport = existingReleaseReport(source.worktreePath, reservation);
    if (!priorReport.ok) return priorReport;
    let resourceOwner = null;
    if (priorReport.report) {
      const stored = priorReport.report;
      const reportOwner = reportResourceOwner(stored, inventory);
      if (!reportOwner.ok) return reportOwner;
      resourceOwner = reportOwner.entry;
      if (stored.engineId !== engine.binding.id || canonicalPath(stored.projectRoot) !== canonicalPath(source.projectRoot) ||
          canonicalPath(stored.worktreePath) !== canonicalPath(resourceOwner.directory)) {
        return blocked("the interrupted handoff report does not match this engine and source worktree");
      }
      if (canonicalPath(resourceOwner.directory) === source.worktreePath) {
        return blocked("the destination is already the Compose resource worktree; transfer must target a different managed worktree");
      }
      const labeled = String(docker("docker", ["ps", "--all", "--no-trunc", "--filter", `label=com.docker.compose.project=${stored.composeProject}`, "--format", "{{.ID}}"], {
        encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024,
      })).trim();
      if (!labeled) {
        const previousPersistent = persistentMountsFromManifest({ worktreePath: canonicalPath(resourceOwner.directory), mounts: stored.mounts });
        const targetPersistent = readComposePersistentMounts(docker, { worktreePath: source.worktreePath, composeFilePath: composeFile });
        if (!targetPersistent.ok || !persistentMountSetsMatch(previousPersistent, targetPersistent.mounts)) {
          return blocked("the interrupted handoff still requires an exact destination persistence mapping; its reservation is preserved");
        }
        const groupState = await closeVerifiedProcessGroup(reservation, deps);
        if (!groupState.ok) return groupState;
        const handed = handoffApplicationReservation(source.worktreePath, reservation, {
          resourcesAbsent: true, workId: source.workId, workName: source.workName,
          sessionId: source.sessionId, composeFile, persistentMounts: previousPersistent,
          composeProject: targetPersistent.projectName, engineId: engine.binding.id,
        });
        if (!handed.ok) return handed;
        return { ok: true, transferred: true, recovered: true, awaitingStart: true, workId: source.workId,
          token: handed.token, reportPath: priorReport.path, composeFile,
          preservedNamedVolumes: [...new Set(previousPersistent.filter((mount) => mount.type === "volume").map((mount) => mount.name))].sort(),
          preservedBindMounts: [...new Set(previousPersistent.filter((mount) => mount.type === "bind").map((mount) => mount.source))].sort() };
      }
    }
    let found;
    if (resourceOwner) {
      const existing = discoverComposeProject(docker, {
        projectRoot: source.projectRoot, workId: resourceOwner.workId,
        worktreePath: canonicalPath(resourceOwner.directory), worktreeVerified: true, engineId: engine.binding.id,
      }, deps);
      found = existing.ok ? { ok: true, entry: resourceOwner, manifest: existing.manifest } : existing;
    } else {
      found = discoverManagedComposeSource(docker, source.projectRoot, inventory, engine.binding.id, deps);
    }
    if (!found.ok) return blocked(found.reason);
    resourceOwner = found.entry;
    if (canonicalPath(resourceOwner.directory) === source.worktreePath) {
      return blocked("the destination is already the Compose resource worktree; transfer must target a different managed worktree");
    }
    const report = persistComposeReleaseReport(source.worktreePath, reservation, found.manifest);
    if (!report.ok) return report;
    let immutableReport;
    try { immutableReport = JSON.parse(readFileSync(report.path, "utf8")); }
    catch { return blocked("the original Compose release manifest cannot be re-read safely"); }
    const previousPersistent = persistentMountsFromManifest({ worktreePath: canonicalPath(resourceOwner.directory), mounts: immutableReport.mounts });
    const targetPersistent = readComposePersistentMounts(docker, { worktreePath: source.worktreePath, composeFilePath: composeFile });
    if (!targetPersistent.ok) return blocked(targetPersistent.reason);
    if (!persistentMountSetsMatch(previousPersistent, targetPersistent.mounts)) {
      return blocked("the destination Compose file does not reuse the exact persistent database-volume and upload mapping; the old application remains running");
    }
    const groupState = await closeVerifiedProcessGroup(reservation, deps);
    if (!groupState.ok) return groupState;
    try {
      for (const container of found.manifest.containers) {
        if (["running", "restarting", "paused"].includes(container.state)) docker("docker", ["stop", "--time", "10", container.id], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      }
      for (const container of found.manifest.containers) docker("docker", ["rm", container.id], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      const remaining = String(docker("docker", ["ps", "--all", "--no-trunc", "--filter", `label=com.docker.compose.project=${found.manifest.project}`, "--format", "{{.ID}}"], {
        encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024,
      })).trim();
      if (remaining) return blocked("containers with the verified Compose project label remain; ownership stays with the source worktree");
    } catch { return blocked("Compose closure failed; the source reservation and persistent data are preserved"); }
    const afterGroup = await closeVerifiedProcessGroup(reservation, deps);
    if (!afterGroup.ok) return afterGroup;
    const handed = handoffApplicationReservation(source.worktreePath, reservation, {
      resourcesAbsent: true, workId: source.workId, workName: source.workName,
      sessionId: source.sessionId, composeFile, persistentMounts: previousPersistent,
      composeProject: targetPersistent.projectName, engineId: engine.binding.id,
    });
    if (!handed.ok) return handed;
    return {
      ok: true, transferred: true, awaitingStart: true, workId: source.workId,
      token: handed.token, reportPath: report.path, composeFile,
      preservedNamedVolumes: [...new Set(previousPersistent.filter((mount) => mount.type === "volume").map((mount) => mount.name))].sort(),
      preservedBindMounts: [...new Set(previousPersistent.filter((mount) => mount.type === "bind").map((mount) => mount.source))].sort(),
      note: "The old containers were removed without deleting persistent volumes or bind paths. Start the destination Compose file using the returned token through reservation_start.",
    };
  });
}
