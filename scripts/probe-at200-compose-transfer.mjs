#!/usr/bin/env node
// Local-engine acceptance probe for Compose release/transfer persistence.
// It uses only cached alpine:latest and an isolated temporary Git project.

import { spawn as childSpawn, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { acquireReservation, readReservation, updateReservationProcessGroup } from "../plugins/sandbox-control/reservation.mjs";
import { transferApplicationReservation, releaseProjectReservation } from "../plugins/sandbox-control/release.mjs";
import { startLocalExecution } from "../plugins/sandbox-control/execution.mjs";
import { inspectLocalEngine } from "../plugins/sandbox-control/engine.mjs";
import { discoverComposeProject, persistentMountsFromManifest, readComposePersistentMounts } from "../plugins/sandbox-control/compose-resources.mjs";
import { checkContainerAccess } from "../plugins/worktree-control/retirement-checks.mjs";
import { recordWorktree } from "../plugins/worktree-control/inventory.mjs";
import { sandboxStateDir } from "../plugins/sandbox-control/paths.mjs";

const run = (command, args, options = {}) => execFileSync(command, args, {
  encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000, ...options,
});
const project = `at200-compose-handoff-${process.pid}-${randomBytes(3).toString("hex")}`;
const volumeName = `${project}_database`;
const root = mkdtempSync(join(tmpdir(), `${project}-project-`));
const sourcePath = join(tmpdir(), `${project}-source`);
const targetPath = join(tmpdir(), `${project}-target`);
const uploadPath = join(tmpdir(), `${project}-uploads`);
const sourceCompose = join(sourcePath, ".devcontainer", "compose.yml");
const targetCompose = join(targetPath, ".devcontainer", "compose.yml");
const dockerCompose = (file) => ["compose", "--project-directory", join(file, ".."), "-f", file];
const reportRoot = sandboxStateDir(process.cwd());
if (!reportRoot.ok) throw new Error(reportRoot.reason);
const reportDirectory = join(reportRoot.dir, "reports");
mkdirSync(reportDirectory, { recursive: true, mode: 0o700 });
const evidencePath = join(reportDirectory, `${project}.json`);
const evidence = {
  schemaVersion: 1,
  type: "at200-compose-transfer-probe",
  project,
  volumeName,
  result: "running",
  engineId: null,
  transfer: null,
  targetStart: null,
  release: null,
  sentinels: { databaseBefore: false, uploadsBefore: false, databaseAfter: false, uploadsAfter: false },
  cleanup: { containersRemoved: false, testVolumeRemoved: false, pathsRemoved: false },
  platform: `${process.platform}-${process.arch}`,
  startedAt: new Date().toISOString(),
};
const save = () => {
  const temporary = `${evidencePath}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  chmodSync(temporary, 0o600);
  renameSync(temporary, evidencePath);
};

let currentOwner = null;
let supervisor = null;
let failure = null;
let stage = "preflight";
const worktreeEntries = [];
const appYaml = () => `name: ${project}
services:
  app:
    image: alpine:latest
    command: ["sh", "-c", "mkdir -p /data /app/uploads; while true; do sleep 3600; done"]
    network_mode: none
    volumes:
      - type: bind
        source: ..
        target: /app
      - type: bind
        source: '${uploadPath.replaceAll("'", "''")}'
        target: /app/uploads
      - type: volume
        source: database
        target: /data
volumes:
  database:
    name: ${volumeName}
`;

function compose(file, args, options = {}) {
  return run("docker", [...dockerCompose(file), ...args], options);
}

function verifySentinels(file, expected) {
  const content = compose(file, ["exec", "-T", "app", "sh", "-c", "cat /data/at200-marker && cat /app/uploads/at200-marker"]);
  const valid = content.trim().split("\n").join("|") === "database-marker|uploads-marker";
  if (valid !== expected) throw new Error(`the Compose target returned ${JSON.stringify(content.trim())} for the persistence sentinels`);
  return valid;
}

try {
  const engine = inspectLocalEngine();
  if (!engine.ok) throw Object.assign(new Error(engine.reason), { blocked: true });
  evidence.engineId = engine.binding.id;
  // Never provision the fixture prerequisite.
  run("docker", ["image", "inspect", "alpine:latest"]);

  stage = "create-fixture-repository";
  mkdirSync(uploadPath, { recursive: true });
  run("git", ["init", "-q", root]);
  run("git", ["-C", root, "config", "user.name", "AT-200 fixture"]);
  run("git", ["-C", root, "config", "user.email", "at200-fixture@example.test"]);
  run("git", ["-C", root, "commit", "--allow-empty", "-qm", "fixture base"]);
  run("git", ["-C", root, "worktree", "add", "-qb", "at200-source", sourcePath]);
  run("git", ["-C", root, "worktree", "add", "-qb", "at200-target", targetPath]);
  const sourceReal = realpathSync(sourcePath);
  const targetReal = realpathSync(targetPath);
  stage = "create-compose-files";
  for (const [workId, directory, branch] of [["at200-source", sourcePath, "at200-source"], ["at200-target", targetPath, "at200-target"]]) {
    mkdirSync(join(directory, ".devcontainer"), { recursive: true });
    recordWorktree(root, { workId, directory, branch });
    worktreeEntries.push({ workId, directory, branch, exists: true });
  }
  writeFileSync(sourceCompose, appYaml());
  writeFileSync(targetCompose, appYaml());
  const sourceComposeReal = realpathSync(sourceCompose);
  const targetComposeReal = realpathSync(targetCompose);
  stage = "start-source-compose";
  const oldCompose = dockerCompose(sourceComposeReal);
  run("docker", [...oldCompose, "up", "--pull", "never", "-d"]);
  stage = "seed-persistent-sentinels";
  compose(sourceComposeReal, ["exec", "-T", "app", "sh", "-c", "printf 'database-marker\\n' > /data/at200-marker; printf 'uploads-marker\\n' > /app/uploads/at200-marker"]);
  const mountedSource = checkContainerAccess(sourceReal);
  if (!mountedSource.ok || !mountedSource.blocked) throw new Error("worktree retirement did not detect the active source bind mount");
  evidence.retirement = { blockedWhileSourceRuns: true, releasedAfterTransfer: false, releasedAfterStop: false };
  const held = acquireReservation(root, { workId: "at200-source", scope: "application", sessionId: "fixture-old-session", executable: "docker" });
  if (!held.ok) throw new Error("the fixture application reservation could not be created");
  supervisor = childSpawn("sleep", ["0.2"], { detached: true, stdio: "ignore" });
  await new Promise((resolve, reject) => { supervisor.once("spawn", resolve); supervisor.once("error", reject); });
  const registered = updateReservationProcessGroup(root, held.token, supervisor.pid);
  if (!registered.ok) throw new Error("the fixture supervisor process group could not be recorded");
  currentOwner = { workId: "at200-source", sessionId: "fixture-old-session", token: held.token, processGroup: supervisor.pid };
  await new Promise((resolve) => setTimeout(resolve, 500));

  const context = { directory: targetReal, sessionID: "fixture-target-session", projectID: project,
    worktree: { async list() { return worktreeEntries; } } };
  const targetIdentity = { ok: true, projectRoot: root, worktreePath: targetReal, workId: "at200-target",
    workName: "AT-200 target", sessionId: context.sessionID, projectID: project };
  stage = "transfer-application";
  const discovered = discoverComposeProject((executable, args, options) => run(executable, args, options), {
    projectRoot: root, workId: "at200-source", worktreePath: sourceReal, worktreeVerified: true, engineId: engine.binding.id,
  });
  const configured = readComposePersistentMounts((executable, args, options) => run(executable, args, options), {
    worktreePath: targetReal, composeFilePath: targetComposeReal,
  });
  evidence.persistenceComparison = {
    actual: discovered.ok ? persistentMountsFromManifest({ worktreePath: sourceReal, mounts: discovered.manifest.mounts }) : { error: discovered.reason },
    destination: configured.ok ? configured.mounts : { error: configured.reason },
  };
  const transferred = await transferApplicationReservation(context, ".devcontainer/compose.yml", {}, targetIdentity);
  if (!transferred.ok || !transferred.awaitingStart) throw new Error(transferred.reason ?? "the application did not enter awaiting-start");
  currentOwner = { workId: "at200-target", sessionId: context.sessionID, token: transferred.token };
  evidence.transfer = { ok: true, from: "at200-source", to: "at200-target", awaitingStart: true,
    preservedNamedVolumes: transferred.preservedNamedVolumes, preservedBindMounts: transferred.preservedBindMounts };
  const sourceRetirementAfterTransfer = checkContainerAccess(sourceReal);
  evidence.retirement.releasedAfterTransfer = sourceRetirementAfterTransfer.ok && !sourceRetirementAfterTransfer.blocked;
  evidence.sentinels.databaseBefore = run("docker", ["run", "--rm", "--pull=never", "--network", "none", "-v", `${volumeName}:/data:ro`, "alpine:latest", "cat", "/data/at200-marker"]).trim() === "database-marker";
  evidence.sentinels.uploadsBefore = readFileSync(join(uploadPath, "at200-marker"), "utf8").trim() === "uploads-marker";
  if (!evidence.sentinels.databaseBefore || !evidence.sentinels.uploadsBefore) throw new Error("persistent sentinels did not survive the source handoff");
  save(); // External evidence is written before starting or cleaning further resources.

  stage = "start-destination-compose";
  const start = await startLocalExecution(targetReal, {
    workId: "at200-target", workName: "AT-200 target", sessionId: context.sessionID,
    worktreeApi: { async list() { return worktreeEntries; } },
    executable: "docker", args: [...dockerCompose(targetComposeReal), "up"], composeFile: targetComposeReal,
    cwd: targetPath, env: { PATH: process.env.PATH, HOME: homedir() }, token: transferred.token,
  }, { spawn: (executable, args, options) => childSpawn(executable, args, { ...options, stdio: "ignore" }) });
  if (!start.ok) throw new Error(start.reason ?? "the destination Compose command failed to launch");
  currentOwner = { workId: "at200-target", sessionId: context.sessionID, token: start.token, processGroup: start.processGroup };
  let readinessError = "not attempted";
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      if (verifySentinels(targetCompose, true)) break;
    } catch (error) {
      readinessError = String(error.message ?? error).slice(0, 600);
      if (attempt === 39) {
        let diagnostic = "unavailable";
        try { diagnostic = compose(targetCompose, ["ps", "--all"]).trim().slice(0, 1800); } catch {}
        throw new Error(`the destination Compose service did not become ready: ${readinessError}; ${diagnostic}`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  evidence.targetStart = { ok: true, workId: "at200-target", processGroup: start.processGroup };

  stage = "release-destination-compose";
  const released = await releaseProjectReservation(context, {});
  if (!released.ok) throw new Error(released.reason ?? "the destination application did not release cleanly");
  currentOwner = null;
  evidence.cleanup.controlReleased = true;
  evidence.release = { ok: true, workId: released.workId, resourceWorkId: released.resourceWorkId,
    preservedNamedVolumes: released.preservedNamedVolumes, preservedBindMounts: released.preservedBindMounts };
  const targetRetirementAfterStop = checkContainerAccess(targetReal);
  evidence.retirement.releasedAfterStop = targetRetirementAfterStop.ok && !targetRetirementAfterStop.blocked;
  if (!evidence.retirement.releasedAfterTransfer || !evidence.retirement.releasedAfterStop) {
    throw new Error("worktree retirement remained blocked by a container bind mount after handoff or release");
  }
  evidence.sentinels.databaseAfter = run("docker", ["run", "--rm", "--pull=never", "--network", "none", "-v", `${volumeName}:/data:ro`, "alpine:latest", "cat", "/data/at200-marker"]).trim() === "database-marker";
  evidence.sentinels.uploadsAfter = readFileSync(join(uploadPath, "at200-marker"), "utf8").trim() === "uploads-marker";
  if (!evidence.sentinels.databaseAfter || !evidence.sentinels.uploadsAfter) throw new Error("persistent sentinels did not survive release");
  evidence.result = "passed";
} catch (error) {
  failure = error;
  evidence.result = error.blocked ? "blocked" : "failed";
  evidence.stage = stage;
  evidence.failure = error.blocked ? "the local Docker engine or cached alpine image is unavailable" : String(error.message ?? error).slice(0, 300);
} finally {
  // Persist the evidence outside the temporary application before teardown.
  save();
  try {
    const reservation = readReservation(root);
    if (reservation.ok && reservation.state === "held") {
      const context = { directory: targetPath, sessionID: currentOwner?.sessionId ?? "fixture-target-session", projectID: project,
        worktree: { async list() { return worktreeEntries; } } };
      const closed = await releaseProjectReservation(context, {});
      if (!closed.ok) throw new Error(closed.reason ?? "fixture reservation cleanup failed");
      evidence.cleanup.controlReleased = true;
    }
  } catch {
    // The fallback targets only this unique fixture project and never uses --volumes.
    for (const file of [sourceCompose, targetCompose]) {
      try { run("docker", [...dockerCompose(file), "down", "--remove-orphans"]); } catch { /* evidence records cleanup limits */ }
    }
    if (Number.isSafeInteger(currentOwner?.processGroup)) {
      try { process.kill(-currentOwner.processGroup, "SIGTERM"); } catch { /* group already exited */ }
    }
  }
  try { run("docker", ["volume", "rm", volumeName]); evidence.cleanup.testVolumeRemoved = true; } catch { /* Compose may not have created the volume */ }
  try {
    const remaining = run("docker", ["ps", "--all", "--filter", `label=com.docker.compose.project=${project}`, "--format", "{{.ID}}"]);
    evidence.cleanup.containersRemoved = remaining.trim() === "";
  } catch { /* leave false when the engine cannot confirm cleanup */ }
  for (const worktree of [sourcePath, targetPath]) {
    try { run("git", ["-C", root, "worktree", "remove", "--force", worktree]); } catch { rmSync(worktree, { recursive: true, force: true }); }
  }
  try { run("git", ["-C", root, "worktree", "prune"]); } catch { /* test repo is removed next */ }
  rmSync(uploadPath, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
  evidence.cleanup.pathsRemoved = true;
  evidence.finishedAt = new Date().toISOString();
  save();
  console.log(JSON.stringify({ result: evidence.result, evidencePath, failure: evidence.failure ?? null,
    persistentDataVerified: evidence.sentinels.databaseBefore && evidence.sentinels.uploadsBefore && evidence.sentinels.databaseAfter && evidence.sentinels.uploadsAfter,
    cleanup: evidence.cleanup }));
}

if (evidence.result !== "passed") process.exitCode = evidence.result === "blocked" ? 2 : 1;
