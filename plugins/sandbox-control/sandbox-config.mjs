// The reader for the project's declared build configuration.
//
// The project declares its Dockerfile, its build context, its target
// stage, and its production parameters in a small JSON file. The
// control reads that declaration and reports what is missing; it never
// infers a configuration and never writes the project's Dockerfile.
//
// A declared path that escapes the project, or that points outside it
// through a symbolic link, is refused here rather than at build time:
// the build context is the boundary that keeps the host's content out
// of the image, so a context outside the project defeats it.

import { existsSync, readFileSync, statSync, lstatSync, realpathSync } from "node:fs";
import net from "node:net";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export const CONFIG_FILE_NAMES = [
  ".opencode/sandbox.json",
  "opencode-sandbox.json",
];

const REQUIRED_FIELDS = ["dockerfile", "context", "stage"];

/**
 * Read the declared configuration of a project.
 *
 * Returns the declaration with every path resolved inside the project,
 * or a report of what is missing.
 */
/**
 * Check the dependencies the project declared.
 *
 * The control uses the services the developer prepared and never
 * provisions one. A dependency that is missing blocks the test, and the
 * block is reported before any resource is created.
 *
 * The check is deliberately non-destructive: it opens a connection and
 * closes it, and it never creates, modifies, or removes anything.
 */
export async function checkDependencies(dependencies = [], deps = {}) {
  const check = deps.checkDependency ?? defaultCheckDependency;
  const missing = [];
  const unavailable = [];

  for (const dependency of dependencies) {
    const target = typeof dependency === "string" ? dependency : dependency?.url;
    if (!target) {
      unavailable.push({ dependency: String(dependency), reason: "the dependency has no url" });
      continue;
    }
    let result;
    try {
      result = await check(target);
    } catch (err) {
      unavailable.push({ dependency: target, reason: err.message });
      continue;
    }
    if (result === false) missing.push({ dependency: target, reason: "the service did not answer" });
    else if (result && result.ok === false) {
      unavailable.push({ dependency: target, reason: result.reason ?? "the service did not answer" });
    }
  }

  if (missing.length > 0 || unavailable.length > 0) {
    return {
      ok: false,
      reason: `the declared dependencies are not available: ${[...missing, ...unavailable]
        .map((entry) => entry.dependency)
        .join(", ")}`,
      missing,
      unavailable,
    };
  }
  return { ok: true, checked: dependencies.length };
}

/**
 * The default dependency check: a TCP connection to the host and port
 * of the declared URL.
 */
function defaultCheckDependency(target) {
  const url = new URL(target);
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  return new Promise((resolve) => {
    const socket = net.connect({ host: url.hostname, port });
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(3000, () => done({ ok: false, reason: "the connection timed out" }));
    socket.on("connect", () => done(true));
    socket.on("error", (err) => done({ ok: false, reason: err.message }));
  });
}

export function readSandboxConfig(projectRoot) {
  // The root is canonicalized: on macOS a temporary directory lives
  // under `/var`, which is a symbolic link to `/private/var`, and the
  // containment check compares the canonical paths.
  const root = canonicalRoot(projectRoot);
  const found = CONFIG_FILE_NAMES.map((name) => join(root, name)).find((path) => existsSync(path));
  if (!found) {
    return {
      ok: false,
      reason: `the project declares no sandbox configuration (expected one of: ${CONFIG_FILE_NAMES.join(", ")})`,
      missing: ["configuration file"],
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(found, "utf8"));
  } catch (err) {
    return {
      ok: false,
      reason: `the sandbox configuration could not be parsed: ${err.message}`,
      missing: ["valid configuration file"],
    };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      reason: "the sandbox configuration is not an object",
      missing: ["valid configuration file"],
    };
  }

  const missing = REQUIRED_FIELDS.filter((field) => {
    const value = parsed[field];
    return typeof value !== "string" || value.trim() === "";
  });
  if (missing.length > 0) {
    return {
      ok: false,
      reason: `the sandbox configuration is incomplete: ${missing.join(", ")}`,
      missing,
    };
  }

  const dockerfile = resolveInside(root, parsed.dockerfile);
  if (!dockerfile.ok) {
    return { ok: false, reason: dockerfile.reason, missing: ["dockerfile inside the project"] };
  }
  const context = resolveInside(root, parsed.context);
  if (!context.ok) {
    return { ok: false, reason: context.reason, missing: ["context inside the project"] };
  }

  if (!existsSync(dockerfile.path)) {
    return {
      ok: false,
      reason: `the declared Dockerfile does not exist: ${parsed.dockerfile}`,
      missing: ["existing Dockerfile"],
    };
  }
  if (!existsSync(context.path) || !statSync(context.path).isDirectory()) {
    return {
      ok: false,
      reason: `the declared build context is not a directory: ${parsed.context}`,
      missing: ["existing build context directory"],
    };
  }

  // The egress declaration is a security boundary, so it is accepted
  // only when it is exactly the boolean `true`. A string, a number, or
  // a missing value leaves the network internal.
  const production = parsed.production && typeof parsed.production === "object" ? parsed.production : {};
  const allowExternalEgress = production.allowExternalEgress;
  if (allowExternalEgress !== undefined && allowExternalEgress !== true && allowExternalEgress !== false) {
    return {
      ok: false,
      reason: "production.allowExternalEgress must be the boolean true or false",
      missing: ["a boolean production.allowExternalEgress"],
    };
  }

  return {
    ok: true,
    config: {
      path: found,
      dockerfile: dockerfile.path,
      dockerfileRelative: parsed.dockerfile,
      context: context.path,
      contextRelative: parsed.context,
      stage: parsed.stage,
      production: { ...production, allowExternalEgress: allowExternalEgress === true },
      ports: Array.isArray(parsed.ports) ? parsed.ports : [],
      dependencies: Array.isArray(parsed.dependencies) ? parsed.dependencies : [],
      testSecrets: Array.isArray(parsed.testSecrets) ? parsed.testSecrets : [],
      limits: parsed.limits ?? {},
      include: Array.isArray(parsed.include) ? parsed.include : [],
    },
  };
}

/**
 * Resolve a declared path inside the project.
 *
 * A path that leaves the project, either lexically or through a
 * symbolic link, is refused. The build context is what keeps the host's
 * content out of the image, so a context outside the project is a hole
 * in the isolation boundary rather than a convenience.
 */
export function resolveInside(root, declared) {
  const base = canonicalRoot(root);
  const candidate = isAbsolute(declared) ? resolve(declared) : resolve(base, declared);

  const rel = relative(base, candidate);
  if (rel !== "" && (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))) {
    return {
      ok: false,
      reason: `the declared path escapes the project: ${declared}`,
    };
  }

  // A symbolic link anywhere on the way to the path is refused: the
  // resolved destination may live outside the project even when the
  // declared path does not.
  const real = realpathIfExists(candidate);
  if (real) {
    const realRel = relative(base, real);
    if (realRel !== "" && (realRel === ".." || realRel.startsWith(`..${sep}`) || isAbsolute(realRel))) {
      return {
        ok: false,
        reason: `the declared path resolves outside the project through a symbolic link: ${declared}`,
      };
    }
  }

  return { ok: true, path: candidate };
}

function realpathIfExists(path) {
  try {
    return resolve(realpathSync(path));
  } catch {
    return null;
  }
}

/**
 * The canonical form of a project root. A root that does not exist
 * resolves to itself, so the caller still receives a usable path.
 */
function canonicalRoot(root) {
  const resolved = resolve(root);
  try {
    return resolve(realpathSync(resolved));
  } catch {
    return resolved;
  }
}

/**
 * True when the path is a symbolic link.
 */
export function isSymbolicLink(path) {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}
