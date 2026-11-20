import { test } from "node:test";
import assert from "node:assert/strict";
import { discoverComposeProject, persistentMountsFromManifest, samePersistentMounts, validateComposeResourceManifest } from "../compose-resources.mjs";

const ROOT = "/tmp/compose-project";
const WORK = "/tmp/managed-worktrees/feature-a";
const PROJECT = "fixture-project";
const CONFIG = `${ROOT}/.devcontainer/compose.yml`;
const WORKDIR = `${ROOT}/.devcontainer`;
const idA = "a".repeat(64);
const idB = "b".repeat(64);

function container(id, service, mounts, overrides = {}) {
  return {
    id,
    state: overrides.state ?? "running",
    project: overrides.project ?? PROJECT,
    workingDirectory: overrides.workingDirectory ?? WORKDIR,
    configFiles: overrides.configFiles ?? CONFIG,
    service,
    name: `${PROJECT}-${service}-1`,
    mounts,
    networks: { [`${PROJECT}_default`]: { IPAddress: "172.20.0.2" } },
  };
}

function inspectOutput(value) {
  return [value.id, value.state, value.project, value.workingDirectory, value.configFiles, value.service, `/${value.name}`, value.mounts, value.networks]
    .map((field) => JSON.stringify(field)).join("\t");
}

function dockerFor(containers) {
  const byId = new Map(containers.map((value) => [value.id, value]));
  return (_command, args) => {
    if (args[0] === "ps") return [...byId.keys()].join("\n");
    if (args[0] === "inspect") return inspectOutput(byId.get(args.at(-1)));
    throw new Error("unexpected Docker call");
  };
}

test("resource manifest contains allowlisted Compose and persistent mount metadata only", () => {
  const containers = [
    container(idA, "wordpress", [
      { Type: "bind", Source: WORK, Destination: "/app", RW: true },
      { Type: "bind", Source: "/tmp/shared/uploads", Destination: "/app/uploads", RW: true },
    ]),
    container(idB, "database", [
      { Type: "volume", Name: "fixture_database_data", Destination: "/var/lib/mysql", RW: true },
    ]),
  ];
  const result = discoverComposeProject(dockerFor(containers), { projectRoot: ROOT, workId: "feature-a", worktreePath: WORK, worktreeVerified: true, engineId: "fixture-daemon" }, { now: () => new Date("2026-11-16T00:00:00Z") });
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.manifest.containers.length, 2);
  assert.deepEqual(result.manifest.mounts.map((mount) => mount.type), ["bind", "bind", "volume"]);
  assert.equal(JSON.stringify(result.manifest).includes("DATABASE_PASSWORD"), false);
  assert.equal(JSON.stringify(result.manifest).includes("commandArgs"), false);
  assert.equal(result.manifest.discoveredAt, "2026-11-16T00:00:00.000Z");
  assert.deepEqual(validateComposeResourceManifest(result.manifest), { ok: true, manifest: result.manifest });
});

test("managed worktrees outside the checkout are accepted only with verified inventory evidence", () => {
  const containerFixture = container(idA, "wordpress", [
    { Type: "bind", Source: WORK, Destination: "/app", RW: true },
  ]);
  const executor = dockerFor([containerFixture]);
  assert.equal(discoverComposeProject(executor, { projectRoot: ROOT, workId: "feature-a", worktreePath: WORK, engineId: "fixture-daemon" }).blocked, true);
  const accepted = discoverComposeProject(executor, { projectRoot: ROOT, workId: "feature-a", worktreePath: WORK, worktreeVerified: true, engineId: "fixture-daemon" });
  assert.equal(accepted.ok, true, accepted.reason);
  assert.equal(accepted.manifest.worktreePath, WORK);
});

test("Docker Desktop host_mnt bind paths reconcile to the managed worktree, not persistent data", () => {
  const mounted = container(idA, "wordpress", [
    { Type: "bind", Source: `/host_mnt${WORK}`, Destination: "/app", RW: true },
    { Type: "volume", Name: "fixture_database_data", Destination: "/var/lib/mysql", RW: true },
  ]);
  const result = discoverComposeProject(dockerFor([mounted]), {
    projectRoot: ROOT, workId: "feature-a", worktreePath: WORK,
    worktreeVerified: true, engineId: "fixture-daemon",
  }, { platform: "darwin" });
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.manifest.worktreePath, WORK);
  assert.deepEqual(persistentMountsFromManifest(result.manifest), [
    { type: "volume", name: "fixture_database_data", destination: "/var/lib/mysql", readOnly: false },
  ]);
});

test("Compose files and project directories inside an external managed worktree are attributable", () => {
  const externalConfig = container(idA, "wordpress", [
    { Type: "bind", Source: WORK, Destination: "/app", RW: true },
  ], { workingDirectory: `${WORK}/.devcontainer`, configFiles: `${WORK}/.devcontainer/compose.yml` });
  const result = discoverComposeProject(dockerFor([externalConfig]), {
    projectRoot: ROOT, workId: "feature-a", worktreePath: WORK, worktreeVerified: true, engineId: "fixture-daemon",
  });
  assert.equal(result.ok, true, result.reason);
});

test("an unsupported mount on any service blocks the whole Compose project", () => {
  const supported = container(idA, "wordpress", [{ Type: "bind", Source: WORK, Destination: "/app", RW: true }]);
  const unsupported = container(idB, "cache", [{ Type: "tmpfs", Destination: "/tmp", RW: true }]);
  const result = discoverComposeProject(dockerFor([supported, unsupported]), {
    projectRoot: ROOT, workId: "feature-a", worktreePath: WORK, worktreeVerified: true, engineId: "fixture-daemon",
  });
  assert.equal(result.blocked, true);
  assert.match(result.reason, /unsupported or unverifiable mount/);
});

test("Compose lookup blocks when the worktree is not represented by a bind or config path", () => {
  const foreign = container(idA, "wordpress", [
    { Type: "bind", Source: `${ROOT}/.worktrees/another`, Destination: "/app", RW: true },
  ]);
  const result = discoverComposeProject(dockerFor([foreign]), { projectRoot: ROOT, workId: "feature-a", worktreePath: WORK, worktreeVerified: true, engineId: "fixture-daemon" });
  assert.equal(result.blocked, true);
  assert.match(result.reason, /no Compose project/);
});

test("multiple Compose projects attached to one worktree are ambiguous", () => {
  const first = container(idA, "wordpress", [{ Type: "bind", Source: WORK, Destination: "/app", RW: true }]);
  const second = container(idB, "worker", [{ Type: "bind", Source: WORK, Destination: "/worker", RW: true }], { project: "another-compose" });
  const result = discoverComposeProject(dockerFor([first, second]), { projectRoot: ROOT, workId: "feature-a", worktreePath: WORK, worktreeVerified: true, engineId: "fixture-daemon" });
  assert.equal(result.blocked, true);
  assert.match(result.reason, /multiple Compose projects/);
});

test("Compose discovery filters out standalone containers but strictly inspects Compose-labeled ones", () => {
  const candidate = container(idA, "wordpress", [{ Type: "bind", Source: WORK, Destination: "/app", RW: true }]);
  const calls = [];
  const docker = (_command, args) => {
    calls.push(args);
    if (args[0] === "ps") {
      assert.ok(args.includes(`label=com.docker.compose.project`));
      return idA; // Docker's label filter excludes the unrelated standalone container.
    }
    if (args[0] === "inspect") return inspectOutput(candidate);
    throw new Error("unexpected Docker call");
  };
  const result = discoverComposeProject(docker, {
    projectRoot: ROOT, workId: "feature-a", worktreePath: WORK, worktreeVerified: true, engineId: "fixture-daemon",
  });
  assert.equal(result.ok, true, result.reason);
  assert.equal(calls.some((args) => args[0] === "inspect" && args.at(-1) !== idA), false);
});

test("manifest rejects unapproved or secret-bearing fields", () => {
  const manifest = {
    schemaVersion: 1, project: PROJECT, workId: "feature-a", projectRoot: ROOT, worktreePath: WORK,
    engineId: "fixture-daemon",
    workingDirectory: WORKDIR, configFiles: [CONFIG], containers: [{ id: idA, state: "running", service: "wordpress", name: "wordpress-1" }],
    networks: ["fixture_default"], mounts: [{ type: "volume", name: "fixture_database_data", destination: "/db", readOnly: false }],
    discoveredAt: "2026-11-16T00:00:00Z", environment: { PASSWORD: "must-not-be-accepted" },
  };
  assert.equal(validateComposeResourceManifest(manifest).ok, false);
});

test("persistent data comparison requires exact bind sources and named volumes", () => {
  const expected = { mounts: [
    { type: "volume", name: "fixture_database_data", destination: "/var/lib/mysql", readOnly: false },
    { type: "bind", source: "/tmp/shared/uploads", destination: "/app/uploads", readOnly: false },
  ] };
  assert.equal(samePersistentMounts(expected, expected), true);
  assert.equal(samePersistentMounts(expected, { mounts: [
    expected.mounts[0], { ...expected.mounts[1], source: "/tmp/other/uploads" },
  ] }), false);
});

test("foreign Compose containers without directory labels do not block the owned project", () => {
  const owned = container(idA, "web", [{ Type: "bind", Source: WORK, Destination: "/app", RW: true }]);
  const foreign = { ...container(idB, "foreign", [{ Type: "bind", Source: "/tmp/foreign", Destination: "/app", RW: true }]),
    project: "foreign-project", workingDirectory: null, configFiles: null };
  const input = { projectRoot: ROOT, workId: "feature-a", worktreePath: WORK, worktreeVerified: true, engineId: "fixture-daemon" };
  const result = discoverComposeProject(dockerFor([owned, foreign]), input);
  assert.equal(result.ok, true, result.reason);
  assert.deepEqual(result.manifest.containers.map((c) => c.id), [idA]);
  for (const suspicious of [ { ...foreign, project: PROJECT }, { ...foreign, mounts: owned.mounts },
    { ...foreign, workingDirectory: ROOT }, { ...foreign, configFiles: CONFIG },
    { ...foreign, mounts: [{ Type: "unknown" }] } ]) {
    assert.equal(discoverComposeProject(dockerFor([owned, suspicious]), input).blocked, true);
  }
});
