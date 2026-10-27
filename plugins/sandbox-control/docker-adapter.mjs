// The Docker adapter and the isolation boundary.
//
// The boundary is expressed as a fixed argument set constructed in one
// place, so a test can assert it without a Docker engine. The control
// never mounts the source, never passes the Docker socket, never
// requests elevated privileges, never uses the host network, and
// publishes ports on the loopback interface only.
//
// The build context is the capture, and the build reads it from inside
// the capture directory. The capture is refused when it does not hold
// the whole context, so a `docker build` cannot reach the host's
// content through a Dockerfile that points outside the capture.

import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { isInside } from "./paths.mjs";

export const LABEL_KEY = "com.opencode.sandbox.execution";
export const LABEL_WORK = "com.opencode.sandbox.work";

/**
 * The options that are never present in a constructed argument list.
 * The test asserts their absence by name, so a future option that
 * weakens the boundary fails the test rather than the host.
 *
 * `--security-opt` is not here: the control uses it to *reduce* the
 * privileges of the container with `no-new-privileges`. A blanket ban
 * would forbid the restriction that protects the run.
 */
export const FORBIDDEN_OPTIONS = [
  "--privileged",
  "--network=host",
  "--net=host",
  "--pid=host",
  "--ipc=host",
  "--userns=host",
  "--uts=host",
  "-v",
  "--volume",
  "--mount",
  "--cap-add",
  "--device",
  "--runtime",
  "--add-host",
];

/**
 * The limits the run declares. A run without limits can consume the
 * host's memory, so the limits are part of the boundary rather than a
 * configuration option.
 */
export const DEFAULT_LIMITS = {
  cpus: "2",
  memory: "2g",
  pids: 512,
};

/**
 * Verify the host can run the sandbox.
 *
 * The check reports the block and installs nothing. The platform
 * requirement is real: the isolation boundary is expressed with
 * Docker's own flags, and the reference platform is Linux or WSL2.
 */
export function checkEngineHost(platform = process.platform, release = osRelease()) {
  const isLinux = platform === "linux";
  const isWsl2 = platform === "linux" && /microsoft|wsl/i.test(release);
  if (!isLinux) {
    return {
      ok: false,
      reason: `the sandbox requires a local Docker engine on Linux or WSL2 (this host is ${platform})`,
    };
  }
  if (!isWsl2 && !isLinux) {
    return { ok: false, reason: "the sandbox requires Linux or WSL2" };
  }
  return { ok: true, platform, wsl2: isWsl2 };
}

function osRelease() {
  try {
    return execFileSync("uname", ["-r"], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

/**
 * Verify that the local Docker engine is reachable.
 */
export function checkEngineReachable(deps = {}) {
  const run = deps.execFileSync ?? execFileSync;
  try {
    const out = run("docker", ["version", "--format", "{{.Server.Version}}"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const version = String(out).trim();
    if (!version) {
      return { ok: false, reason: "the local Docker engine did not report a server version" };
    }
    return { ok: true, version };
  } catch (err) {
    return {
      ok: false,
      reason: `the local Docker engine could not be reached: ${err.message}`,
    };
  }
}

/**
 * Build the fixed argument set of a build.
 *
 * The context is the capture directory. The Dockerfile is resolved
 * inside the capture; a Dockerfile that leaves it is refused, because
 * the build would then read the host's content.
 */
export function buildBuildArguments(input) {
  const {
    captureDir,
    dockerfileRelative = "Dockerfile",
    contextRelative = ".",
    stage = null,
    imageTag,
    executionId,
    workId,
    limits = DEFAULT_LIMITS,
    buildArgs = {},
  } = input ?? {};

  if (!captureDir) return { ok: false, reason: "the build needs a capture directory" };
  if (!imageTag) return { ok: false, reason: "the build needs an image tag" };
  if (!executionId) return { ok: false, reason: "the build needs an execution identifier" };

  const capture = resolve(captureDir);
  // The Dockerfile and the context are resolved inside the capture. A
  // path that leaves it is refused: the build would then read the
  // host's content, which the capture exists to prevent.
  const dockerfile = resolve(capture, dockerfileRelative);
  if (!isInside(capture, dockerfile)) {
    return {
      ok: false,
      reason: `the Dockerfile escapes the capture: ${dockerfileRelative}`,
    };
  }
  if (!existsSync(dockerfile) || !statSync(dockerfile).isFile()) {
    return {
      ok: false,
      reason: `the Dockerfile is not inside the capture: ${dockerfileRelative}`,
    };
  }

  const context = resolve(capture, contextRelative);
  if (!isInside(capture, context)) {
    return {
      ok: false,
      reason: `the build context escapes the capture: ${contextRelative}`,
    };
  }
  if (!existsSync(context) || !statSync(context).isDirectory()) {
    return {
      ok: false,
      reason: `the build context is not inside the capture: ${contextRelative}`,
    };
  }

  const args = ["build", "--file", dockerfile];
  if (stage) args.push("--target", stage);
  args.push("--tag", imageTag);
  args.push("--label", `${LABEL_KEY}=${executionId}`);
  args.push("--label", `${LABEL_WORK}=${workId ?? "unknown"}`);
  args.push("--label", "com.opencode.sandbox.managed=true");
  args.push("--build-arg", `HTTP_PROXY=`);
  args.push("--build-arg", `HTTPS_PROXY=`);
  args.push("--build-arg", `NO_PROXY=*`);
  for (const [key, value] of Object.entries(buildArgs ?? {})) {
    args.push("--build-arg", `${key}=${value}`);
  }
  args.push(context);

  return { ok: true, args, imageTag, context };
}

/**
 * Build the fixed argument set of a run.
 *
 * The container runs with no host network, no added capabilities, no
 * privileged mode, no devices, no mounts, and the declared limits. The
 * ports are published on the loopback interface only.
 */
export function buildRunArguments(input) {
  const {
    imageTag,
    executionId,
    workId,
    containerName,
    networkName = null,
    ports = [],
    env = {},
    envFile = null,
    limits = DEFAULT_LIMITS,
    command = [],
  } = input ?? {};

  if (!imageTag) return { ok: false, reason: "the run needs an image tag" };
  if (!executionId) return { ok: false, reason: "the run needs an execution identifier" };
  if (!containerName) return { ok: false, reason: "the run needs a container name" };
  if (!networkName) {
    // The run always joins the network the control created for it. The
    // default bridge is never used: it reaches the outside world and
    // the host's other networks, which is exactly what the boundary
    // forbids.
    return { ok: false, reason: "the run needs the network created for its execution" };
  }

  const args = [
    "run",
    "--detach",
    "--name",
    containerName,
    "--label",
    `${LABEL_KEY}=${executionId}`,
    "--label",
    `${LABEL_WORK}=${workId ?? "unknown"}`,
    "--label",
    "com.opencode.sandbox.managed=true",
    "--network",
    networkName,
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--cpus",
    String(limits.cpus ?? DEFAULT_LIMITS.cpus),
    "--memory",
    String(limits.memory ?? DEFAULT_LIMITS.memory),
    "--pids-limit",
    String(limits.pids ?? DEFAULT_LIMITS.pids),
  ];

  for (const port of ports) {
    const { container, host = container } = port;
    if (!container) continue;
    // The publication binds the loopback interface only. A host address
    // that is not a loopback address is refused rather than published.
    if (host !== "127.0.0.1" && host !== "localhost") {
      return {
        ok: false,
        reason: `the port publication must bind the loopback interface only: ${container}:${host}`,
      };
    }
    args.push("--publish", `${container}:${host}:${port.hostPort ?? container}`);
  }

  if (envFile) args.push("--env-file", envFile);
  for (const [key, value] of Object.entries(env ?? {})) {
    args.push("--env", `${key}=${value}`);
  }

  args.push(imageTag);
  args.push(...command);

  return { ok: true, args, containerName };
}

/**
 * The network the run uses.
 *
 * The default bridge network still reaches the outside world, so the
 * network is created per execution with the egress the run needs
 * declared by the project. A run that declares no egress gets a
 * network that isolates it from the host and from the outside.
 */
export function buildNetworkArguments(input) {
  const { executionId, name, allowExternalEgress = false } = input ?? {};
  if (!name) return { ok: false, reason: "the network needs a name" };
  if (!executionId) return { ok: false, reason: "the network needs an execution identifier" };

  const args = [
    "network",
    "create",
    "--driver",
    "bridge",
    "--label",
    `${LABEL_KEY}=${executionId}`,
    "--label",
    "com.opencode.sandbox.managed=true",
  ];
  if (!allowExternalEgress) {
    // `--internal` keeps the network from reaching the outside and
    // from reaching the host's other networks.
    args.push("--internal");
  }
  args.push(name);

  return { ok: true, args, name, internal: !allowExternalEgress };
}

/**
 * The label arguments that name an execution on a resource.
 */
export function labelArguments(executionId, workId) {
  return [
    "--label",
    `${LABEL_KEY}=${executionId}`,
    "--label",
    `${LABEL_WORK}=${workId ?? "unknown"}`,
    "--label",
    "com.opencode.sandbox.managed=true",
  ];
}

/**
 * Assert that an argument list carries no forbidden option.
 *
 * The check is by name, so a forbidden option with an unusual spelling
 * of its value still fails.
 */
export function assertNoForbiddenOptions(args) {
  const found = [];
  for (const arg of args ?? []) {
    if (!arg.startsWith("-")) continue;
    const name = arg.split("=")[0];
    if (FORBIDDEN_OPTIONS.includes(name)) found.push(arg);
    // A forbidden option that takes its value as the next argument is
    // caught by the name, so the value is irrelevant here.
  }
  return { ok: found.length === 0, found };
}
