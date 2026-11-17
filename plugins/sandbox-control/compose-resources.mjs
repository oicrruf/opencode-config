// Safe, label-based discovery for local Compose applications. This module
// never reads container environments or command arguments.
import { canonicalPath, isInside } from "./paths.mjs";

const CONTAINER_ID = /^[a-f0-9]{12,64}$/i;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const LABEL_PROJECT = "com.docker.compose.project";
const LABEL_WORKDIR = "com.docker.compose.project.working_dir";
const LABEL_CONFIGS = "com.docker.compose.project.config_files";
const LABEL_SERVICE = "com.docker.compose.service";

/** Docker Desktop may expose a Mac host bind path with a /host_mnt prefix. */
export function canonicalBindSource(source, platform = process.platform) {
  const hostPath = platform === "darwin" && typeof source === "string" && source.startsWith("/host_mnt/")
    ? source.slice("/host_mnt".length) : source;
  return canonicalPath(hostPath);
}

const blocked = (reason) => ({ ok: false, blocked: true, reason });

function boundedString(value, max = 2048) {
  return typeof value === "string" && value.length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
}

function parseJsonLine(line) {
  try { return JSON.parse(line); } catch { return undefined; }
}

function parseInspection(output, id, platform = process.platform) {
  const fields = String(output).trimEnd().split("\t");
  if (fields.length !== 9) return null;
  const [fullId, state, project, workingDirectory, configFiles, service, name, mounts, networks] = fields.map(parseJsonLine);
  if (fullId !== id || !boundedString(state, 32) || !boundedString(project, 128) || !boundedString(workingDirectory) ||
      !boundedString(configFiles) || !boundedString(service, 128) || !boundedString(name, 256)) return null;
  if (!SAFE_NAME.test(project) || !SAFE_NAME.test(service) || !SAFE_NAME.test(name.replace(/^\//, ""))) return null;
  const configs = configFiles.split(",").map((path) => path.trim());
  if (!configs.length || configs.some((path) => !boundedString(path) || !path.startsWith("/"))) return null;
  const normalizedMounts = [];
  let unsupportedMounts = !Array.isArray(mounts);
  for (const mount of Array.isArray(mounts) ? mounts : []) {
    if (!mount || typeof mount !== "object" || !["bind", "volume"].includes(mount.Type) || !boundedString(mount.Destination) ||
        typeof mount.RW !== "boolean") { unsupportedMounts = true; continue; }
    if (mount.Type === "bind") {
      if (!boundedString(mount.Source) || !mount.Source.startsWith("/")) { unsupportedMounts = true; continue; }
      normalizedMounts.push({ type: "bind", source: canonicalBindSource(mount.Source, platform), destination: mount.Destination, readOnly: !mount.RW });
    } else {
      if (!boundedString(mount.Name, 256)) { unsupportedMounts = true; continue; }
      normalizedMounts.push({ type: "volume", name: mount.Name, destination: mount.Destination, readOnly: !mount.RW });
    }
  }
  const safeNetworks = networks && typeof networks === "object" && !Array.isArray(networks) ? networks : {};
  const networkNames = Object.keys(safeNetworks);
  if (networkNames.some((network) => !SAFE_NAME.test(network))) return null;
  return {
    id,
    state,
    project,
    workingDirectory: canonicalPath(workingDirectory),
    configFiles: configs.map(canonicalPath).sort(),
    service,
    name: name.replace(/^\//, ""),
    mounts: normalizedMounts,
    unsupportedMounts,
    networks: networkNames.sort(),
  };
}

function belongsToWorktree(container, projectRoot, worktreePath) {
  const configBelongs = container.configFiles.some((path) => isInside(projectRoot, path) || isInside(worktreePath, path));
  const projectContextBelongs = isInside(projectRoot, container.workingDirectory) || isInside(worktreePath, container.workingDirectory);
  const sourceMountBelongs = container.mounts.some((mount) => mount.type === "bind" && isInside(worktreePath, mount.source));
  return configBelongs && projectContextBelongs && (sourceMountBelongs || container.workingDirectory === worktreePath || container.configFiles.some((path) => isInside(worktreePath, path)));
}

function groupKey(container) {
  return `${container.project}\0${container.workingDirectory}\0${container.configFiles.join("\0")}`;
}

/**
 * Validate an allowlisted, secret-free Compose resource manifest.
 * Unknown keys are discarded on construction and rejected on disk reads.
 */
export function validateComposeResourceManifest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.schemaVersion !== 1 ||
      !SAFE_NAME.test(value.project) || !boundedString(value.engineId, 255) || !boundedString(value.workId, 128) || !boundedString(value.projectRoot) ||
      !boundedString(value.worktreePath) || !boundedString(value.workingDirectory) || !Array.isArray(value.configFiles) ||
      !Array.isArray(value.containers) || !Array.isArray(value.networks) || !Array.isArray(value.mounts) ||
      !boundedString(value.discoveredAt, 64)) return { ok: false, reason: "the Compose resource manifest is invalid" };

  const allowed = new Set(["schemaVersion", "engineId", "project", "workId", "projectRoot", "worktreePath", "workingDirectory", "configFiles", "containers", "networks", "mounts", "discoveredAt"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return { ok: false, reason: "the Compose resource manifest contains an unsupported field" };
  if (value.containers.length === 0 || value.containers.some((item) => !item || !CONTAINER_ID.test(item.id) ||
      !SAFE_NAME.test(item.service) || !SAFE_NAME.test(item.name) || !["created", "restarting", "running", "paused", "exited", "dead"].includes(item.state))) {
    return { ok: false, reason: "the Compose resource manifest has an invalid container identity" };
  }
  if (value.configFiles.some((path) => !boundedString(path) || !path.startsWith("/")) ||
      value.networks.some((network) => !SAFE_NAME.test(network))) return { ok: false, reason: "the Compose resource manifest has invalid project paths or networks" };
  if (value.mounts.some((mount) => !mount || !["bind", "volume"].includes(mount.type) ||
      !boundedString(mount.destination) || typeof mount.readOnly !== "boolean" ||
      (mount.type === "bind" ? !boundedString(mount.source) : !boundedString(mount.name, 256)))) {
    return { ok: false, reason: "the Compose resource manifest has an invalid persistent mount" };
  }
  return { ok: true, manifest: value };
}

/**
 * Inspect Docker's Compose labels and mount metadata for exactly one
 * project tied to a managed worktree. Only allowlisted metadata is read;
 * container env, commands and image config are never inspected.
 */
export function discoverComposeProject(docker, { projectRoot, workId, worktreePath, worktreeVerified = false, engineId }, deps = {}) {
  if (typeof docker !== "function" || !boundedString(projectRoot) || !boundedString(workId, 128) || !boundedString(worktreePath) ||
      !worktreeVerified || !boundedString(engineId, 255)) {
    return blocked("the Compose lookup needs a verified project, work and Docker executor");
  }
  const root = canonicalPath(projectRoot);
  const worktree = canonicalPath(worktreePath);
  try {
    // The label-presence filter positively excludes standalone containers
    // while retaining every Compose-labeled container for strict inspection.
    const listing = String(docker("docker", ["ps", "--all", "--no-trunc", "--filter", `label=${LABEL_PROJECT}`, "--format", "{{.ID}}"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024,
    })).trim();
    const ids = listing ? listing.split(/\s+/) : [];
    if (ids.length > 512 || ids.some((id) => !CONTAINER_ID.test(id))) return blocked("the local container listing is invalid or too large to reconcile");
    const containers = [];
    const format = [
      "{{json .Id}}", "{{json .State.Status}}", `{{json (index .Config.Labels "${LABEL_PROJECT}")}}`,
      `{{json (index .Config.Labels "${LABEL_WORKDIR}")}}`, `{{json (index .Config.Labels "${LABEL_CONFIGS}")}}`,
      `{{json (index .Config.Labels "${LABEL_SERVICE}")}}`, "{{json .Name}}", "{{json .Mounts}}", "{{json .NetworkSettings.Networks}}",
    ].join('{{"\\t"}}');
    for (const id of ids) {
      const raw = docker("docker", ["inspect", "--format", format, id], {
        encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 128 * 1024,
      });
      const inspected = parseInspection(raw, id, deps.platform ?? process.platform);
      if (!inspected) return blocked("a listed local container could not be inspected safely; no Compose resources were changed");
      containers.push(inspected);
    }

    const groups = new Set();
    for (const container of containers) {
      if (!belongsToWorktree(container, root, worktree)) continue;
      const key = groupKey(container);
      groups.add(key);
    }
    if (groups.size !== 1) return blocked(groups.size === 0
      ? "no Compose project is verifiably attached to the reserved worktree"
      : "multiple Compose projects match the reserved worktree");
    const [key] = groups;
    const group = containers.filter((container) => groupKey(container) === key);
    if (group.some((container) => container.unsupportedMounts)) return blocked("a Compose container has an unsupported or unverifiable mount; the project is left untouched");
    const projects = new Set(group.map((item) => groupKey(item)));
    if (projects.size !== 1) return blocked("the Compose resources do not resolve to one project");
    const uniqueContainers = [...new Map(group.map((item) => [item.id, item])).values()].sort((a, b) => a.id.localeCompare(b.id));
    const manifest = {
      schemaVersion: 1,
      engineId,
      project: uniqueContainers[0].project,
      workId,
      projectRoot: root,
      worktreePath: worktree,
      workingDirectory: uniqueContainers[0].workingDirectory,
      configFiles: uniqueContainers[0].configFiles,
      containers: uniqueContainers.map(({ id, state, service, name }) => ({ id, state, service, name })),
      networks: [...new Set(uniqueContainers.flatMap((item) => item.networks))].sort(),
      mounts: uniqueContainers.flatMap((item) => item.mounts.map((mount) => ({ ...mount, containerId: item.id })))
        .sort((a, b) => `${a.containerId}\0${a.destination}`.localeCompare(`${b.containerId}\0${b.destination}`)),
      discoveredAt: (deps.now ?? (() => new Date()))().toISOString(),
    };
    return validateComposeResourceManifest(manifest);
  } catch {
    return blocked("the local Compose resources could not be inspected safely");
  }
}

export function samePersistentMounts(expected, actual) {
  const key = (mount) => mount.type === "bind"
    ? `bind\0${canonicalBindSource(mount.source)}\0${mount.destination}\0${mount.readOnly}`
    : `volume\0${mount.name}\0${mount.destination}\0${mount.readOnly}`;
  const left = expected?.mounts?.map(key).sort() ?? [];
  const right = actual?.mounts?.map(key).sort() ?? [];
  return left.length > 0 && left.length === right.length && left.every((value, index) => value === right[index]);
}

/** Render one destination Compose file without launching resources and return
 * only persistent mount identities. Config output may contain secrets; the
 * output is never reported or persisted. */
export function readComposePersistentMounts(docker, { worktreePath, composeFilePath }) {
  if (typeof docker !== "function" || !boundedString(worktreePath) || !boundedString(composeFilePath) ||
      !composeFilePath.startsWith("/")) return blocked("the target Compose configuration is not verified");
  try {
    const output = docker("docker", ["compose", "--project-directory", canonicalPath(composeFilePath.slice(0, composeFilePath.lastIndexOf("/")) || "/"),
      "-f", canonicalPath(composeFilePath), "config", "--format", "json"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 2 * 1024 * 1024,
    });
    const config = JSON.parse(String(output));
    if (!config?.services || typeof config.services !== "object" || Array.isArray(config.services) || !SAFE_NAME.test(config.name ?? "")) return blocked("the target Compose configuration is invalid or has no stable project name");
    const root = canonicalPath(worktreePath);
    const volumes = config.volumes && typeof config.volumes === "object" && !Array.isArray(config.volumes) ? config.volumes : {};
    const mounts = [];
    for (const service of Object.values(config.services)) {
      if (!service || typeof service !== "object" || Array.isArray(service) ||
          (service.volumes !== undefined && !Array.isArray(service.volumes))) {
        return blocked("the target Compose services have unverifiable mount declarations");
      }
      for (const item of service.volumes ?? []) {
        if (!item || typeof item !== "object" || !boundedString(item.target) || !["bind", "volume"].includes(item.type)) {
          return blocked("the target Compose file contains an unsupported mount declaration");
        }
        const readOnly = item.read_only === true;
        if (item.type === "bind") {
          if (!boundedString(item.source) || !item.source.startsWith("/")) return blocked("the target Compose bind source is not an absolute verified path");
          const source = canonicalPath(item.source);
          if (source === root) continue; // This is the replaceable source checkout mount.
          mounts.push({ type: "bind", source, destination: item.target, readOnly });
        } else {
          if (!boundedString(item.source, 256)) return blocked("the target Compose volume identity is invalid");
          const declared = volumes[item.source];
          const name = typeof declared?.name === "string" && declared.name ? declared.name : item.source;
          if (!SAFE_NAME.test(name)) return blocked("the target Compose volume name is invalid");
          mounts.push({ type: "volume", name, destination: item.target, readOnly });
        }
      }
    }
    const unique = [...new Map(mounts.map((mount) => [JSON.stringify(mount), mount])).values()]
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    if (!unique.length) return blocked("the target Compose file declares no persistent mounts to verify");
    return { ok: true, mounts: unique, projectName: config.name };
  } catch {
    return blocked("the target Compose configuration could not be rendered safely");
  }
}

export function persistentMountsFromManifest(manifest) {
  const worktree = canonicalPath(manifest.worktreePath);
  const mounts = (manifest.mounts ?? []).filter((mount) => mount.type === "volume" || canonicalBindSource(mount.source) !== worktree)
    .map(({ type, source, name, destination, readOnly }) => ({ type, ...(type === "bind" ? { source } : { name }), destination, readOnly }));
  return [...new Map(mounts.map((mount) => [JSON.stringify(mount), mount])).values()]
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

export function persistentMountSetsMatch(expected, actual) {
  const key = (mount) => JSON.stringify([mount.type, mount.source ?? null, mount.name ?? null, mount.destination, mount.readOnly]);
  const left = expected?.map(key).sort() ?? [];
  const right = actual?.map(key).sort() ?? [];
  return left.length > 0 && left.length === right.length && left.every((value, index) => value === right[index]);
}
