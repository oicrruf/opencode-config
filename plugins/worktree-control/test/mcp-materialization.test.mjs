import { test } from "node:test";
import assert from "node:assert/strict";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  inspectMcpConfiguration,
  ownedMcpCredentialFiles,
} from "../mcp-preparation.mjs";
import { readCredentialOwnership, writeCredentialOwnership } from "../credential-ownership.mjs";
import { secureFileOperation } from "../secure-files.mjs";
import { retireWorktree } from "../lifecycle.mjs";

let secureRuntimeAvailable = false;
try {
  secureRuntimeAvailable = execFileSync(
    "python3",
    ["-c", "import os; required=(os.open,os.mkdir,os.unlink,os.stat,os.link); print(int(all(f in os.supports_dir_fd for f in required) and os.stat in os.supports_follow_symlinks and os.link in os.supports_follow_symlinks and hasattr(os,'O_NOFOLLOW') and hasattr(os,'O_DIRECTORY')))"] ,
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  ).trim() === "1";
} catch {}

async function setup(run) {
  const root = mkdtempSync(join(tmpdir(), "worktree-mcp-materialize-"));
  const project = join(root, "project");
  const worktree = join(root, "worktree");
  mkdirSync(project);
  mkdirSync(worktree);
  try { return await run({ root, project, worktree }); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

function sourceConfig(worktree, servers) {
  const mcpServers = JSON.stringify(servers, null, 2);
  writeFileSync(join(worktree, "opencode.jsonc"), `{
    // OpenCode parses JSONC and substitutes file values from this source.
    "mcp": { "servers": ${mcpServers}, },
  }\n`);
  return [{ type: "document", path: join(worktree, "opencode.jsonc"), info: { mcp: { servers } } }];
}

test("copies only an enabled MCP's explicitly referenced and allowlisted project file", { skip: !secureRuntimeAvailable }, () => {
  return setup(async ({ project, worktree }) => {
    mkdirSync(join(project, ".private"));
    writeFileSync(join(project, ".private", "mcp-key"), "non-disclosed-secret");
    writeFileSync(join(project, ".private", "unrelated"), "must-not-be-copied");
    const entries = sourceConfig(worktree, {
      localServer: { type: "local", env: { TOKEN: "{file:.private/mcp-key}" } },
    });
    let configReads = 0;

    const readiness = await inspectMcpConfiguration(worktree, { async get() { configReads += 1; return { data: entries }; } }, {
      projectRoot: project,
      credentialFiles: JSON.stringify([".private/mcp-key"]),
    });
    assert.equal(readiness.ok, true, JSON.stringify(readiness));
    assert.equal(configReads, 2, "effective MCP config is re-read after credentials are materialized");
    assert.equal(readiness.preparedFiles, 1);
    assert.equal(readiness.connectionStatus, "unknown");
    assert.equal(readFileSync(join(worktree, ".private", "mcp-key"), "utf8"), "non-disclosed-secret");
    assert.equal(lstatSync(join(worktree, ".private", "mcp-key")).mode & 0o777, 0o600);
    assert.equal(lstatSync(join(worktree, ".private", "unrelated"), { throwIfNoEntry: false }), undefined);
    assert.doesNotMatch(JSON.stringify(readiness), /non-disclosed-secret/);
    const ownership = ownedMcpCredentialFiles(project, worktree);
    assert.equal(ownership.ok, true);
    assert.deepEqual(ownership.files.map((file) => file.path), [".private/mcp-key"]);
    assert.equal(lstatSync(ownership.manifest).mode & 0o777, 0o600);
    assert.doesNotMatch(JSON.stringify(ownership), /non-disclosed-secret/);
  });
});

test("already-present file references and disabled MCPs never trigger copies", async () => {
  await setup(async ({ project, worktree }) => {
    mkdirSync(join(worktree, ".private"));
    writeFileSync(join(worktree, ".private", "existing"), "existing");
    mkdirSync(join(project, ".private"));
    writeFileSync(join(project, ".private", "disabled"), "disabled-secret");
    const entries = sourceConfig(worktree, {
      local: { type: "local", env: { TOKEN: "{file:.private/existing}" } },
      disabled: { type: "local", enabled: false, env: { TOKEN: "{file:.private/disabled}" } },
    });
    const result = await inspectMcpConfiguration(worktree, { async get() { return { data: entries }; }, }, {
      projectRoot: project,
      credentialFiles: "invalid-json-is-irrelevant-unless-copy-is-needed",
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.preparedFiles, 0);
    assert.equal(readFileSync(join(project, ".private", "disabled"), "utf8"), "disabled-secret");
  });
});

test("an enabled MCP with an unreadable source document blocks readiness", async () => {
  await setup(async ({ project, worktree }) => {
    const result = await inspectMcpConfiguration(worktree, {
      async get() {
        return { data: [{ type: "document", info: { mcp: { servers: { enabled: { type: "local" } } } } }] };
      },
    }, { projectRoot: project, credentialFiles: "[]" });
    assert.equal(result.ok, false);
    assert.doesNotMatch(JSON.stringify(result), /credential|secret values/i);
  });
});

test("global file references are reused and are not copied into worktrees", async () => {
  await setup(async ({ project, worktree }) => {
    const globalConfig = join(project, "global.jsonc");
    const globalKeyDir = join(project, "global-secrets");
    mkdirSync(globalKeyDir);
    writeFileSync(join(globalKeyDir, "key"), "global-secret");
    const server = { type: "local", env: { TOKEN: "{file:global-secrets/key}" } };
    writeFileSync(globalConfig, JSON.stringify({ mcp: { servers: { global: server } } }));
    const entries = [{ type: "document", path: globalConfig, info: { mcp: { servers: { global: server } } } }];
    const result = await inspectMcpConfiguration(worktree, { async get() { return { data: entries }; }, }, {
      projectRoot: project,
      credentialFiles: "not-needed",
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.preparedFiles, 0);
    assert.equal(lstatSync(worktree).isDirectory(), true);
  });
});

test("unlisted, malformed, missing, unsafe, symlink, and .env sources fail closed", async () => {
  await setup(async ({ project, worktree }) => {
    mkdirSync(join(project, ".private"));
    writeFileSync(join(project, ".private", "key"), "value");
    writeFileSync(join(project, ".private", ".env"), "env-secret");
    mkdirSync(join(project, ".private", "whole-directory"));
    writeFileSync(join(project, ".private", "whole-directory", "nested"), "nested-secret");
    const run = async (reference, allowlist, sourceEntries = true) => {
      const entries = sourceConfig(worktree, {
        server: { type: "local", env: { TOKEN: `{file:${reference}}` } },
      });
      return inspectMcpConfiguration(worktree, { async get() { return { data: sourceEntries ? entries : [] }; } }, {
        projectRoot: project,
        credentialFiles: allowlist,
      });
    };

    assert.equal((await run(".private/key", "[]")).ok, false);
    assert.equal((await run(".private/key", "not-json")).ok, false);
    assert.equal((await run(".private/missing", '[".private/missing"]')).ok, false);
    assert.equal((await run(".private/.env", '[".private/.env"]')).ok, false);
    assert.equal((await run(".private/whole-directory", '[".private/whole-directory"]')).ok, false);
    assert.equal((await run("../outside/key", '["../outside/key"]')).ok, false);

    const outside = join(project, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "key"), "link-secret");
    symlinkSync(outside, join(worktree, ".private"));
    assert.equal((await run(".private/key", '[".private/key"]')).ok, false);
    assert.doesNotMatch(JSON.stringify(await run(".private/key", '[".private/key"]')), /link-secret|env-secret|value/);
  });
});

test("partial preparation is recorded and safely resumes after a later source appears", { skip: !secureRuntimeAvailable }, async () => {
  await setup(async ({ project, worktree }) => {
    mkdirSync(join(project, ".private"));
    writeFileSync(join(project, ".private", "first"), "first-secret");
    const entries = sourceConfig(worktree, {
      server: { type: "local", env: { A: "{file:.private/first}", B: "{file:.private/second}" } },
    });
    const configApi = { async get() { return { data: entries }; } };
    const initial = await inspectMcpConfiguration(worktree, configApi, {
      projectRoot: project,
      credentialFiles: '[".private/first", ".private/second"]',
    });
    assert.equal(initial.ok, false);
    assert.equal(readFileSync(join(worktree, ".private", "first"), "utf8"), "first-secret");
    assert.deepEqual(ownedMcpCredentialFiles(project, worktree).files.map((file) => file.path), [".private/first"]);

    writeFileSync(join(project, ".private", "second"), "second-secret");
    const resumed = await inspectMcpConfiguration(worktree, configApi, {
      projectRoot: project,
      credentialFiles: '[".private/first", ".private/second"]',
    });
    assert.equal(resumed.ok, true, JSON.stringify(resumed));
    assert.equal(resumed.preparedFiles, 1);
    assert.deepEqual(ownedMcpCredentialFiles(project, worktree).files.map((file) => file.path), [".private/first", ".private/second"]);

    writeFileSync(join(worktree, ".private", "first"), "tampered-first-secret-content");
    const changed = await inspectMcpConfiguration(worktree, configApi, {
      projectRoot: project,
      credentialFiles: '[".private/first", ".private/second"]',
    });
    assert.equal(changed.ok, false);
    assert.match(changed.reason, /changed/);
  });
});

async function retirementFixture(run) {
  const root = mkdtempSync(join(tmpdir(), "worktree-mcp-retire-"));
  const project = join(root, "project");
  const managed = join(root, "managed");
  const worktree = join(managed, "wt");
  mkdirSync(project);
  mkdirSync(worktree, { recursive: true });
  execFileSync("git", ["init", "-q", project], { stdio: "ignore" });
  execFileSync("git", ["-C", project, "config", "user.email", "test@local"], { stdio: "ignore" });
  execFileSync("git", ["-C", project, "config", "user.name", "test"], { stdio: "ignore" });
  execFileSync("git", ["init", "-q", worktree], { stdio: "ignore" });
  execFileSync("git", ["-C", worktree, "config", "user.email", "test@local"], { stdio: "ignore" });
  execFileSync("git", ["-C", worktree, "config", "user.name", "test"], { stdio: "ignore" });
  writeFileSync(join(worktree, ".gitignore"), "*.secret\n");
  execFileSync("git", ["-C", worktree, "add", ".gitignore"], { stdio: "ignore" });
  execFileSync("git", ["-C", worktree, "commit", "-q", "-m", "base"], { stdio: "ignore" });
  try { await run({ root, project, managed, worktree }); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

async function materializeOwnedFile(project, worktree) {
  mkdirSync(join(project, ".secrets"));
  writeFileSync(join(project, ".secrets", "mcp.secret"), "do-not-log");
  const copied = secureFileOperation("copy", {
    sourceRoot: project,
    sourceRelative: ".secrets/mcp.secret",
    destinationRoot: worktree,
    destinationRelative: ".secrets/mcp.secret",
  });
  assert.equal(copied.ok, true, JSON.stringify(copied));
  const state = writeCredentialOwnership(project, realpathSync(worktree), [
    { path: ".secrets/mcp.secret", identity: copied.identity, server: "test" },
  ]);
  assert.equal(state.ok, true, JSON.stringify(state));
}

test("retirement refuses before the API call while an owned credential remains", { skip: !secureRuntimeAvailable }, async () => {
  await retirementFixture(async ({ project, managed, worktree }) => {
    await materializeOwnedFile(project, worktree);
    let removed = false;
    const result = await retireWorktree(
      {
        request: { worktree, branch: "not-a-real-branch", base: "main", head: "abc", evidence: "integrated" },
        worktreeApi: { async remove() { removed = true; return { data: true }; } },
        cwd: project,
        expectedRoot: managed,
      },
      { listProcesses: () => [], verifyRetirementIdentity: () => ({ ok: true }) },
    );
    assert.equal(result.ok, false);
    assert.equal(result.blocked, true);
    assert.equal(removed, false);
    assert.deepEqual(result.credentialFiles, [".secrets/mcp.secret"]);
    assert.equal(readFileSync(join(worktree, ".secrets", "mcp.secret"), "utf8"), "do-not-log");
    assert.equal(readCredentialOwnership(project, realpathSync(worktree)).files.length, 1);
  });
});

test("retirement refuses changed owned credentials without calling the worktree API", { skip: !secureRuntimeAvailable }, async () => {
  await retirementFixture(async ({ project, managed, worktree }) => {
    await materializeOwnedFile(project, worktree);
    writeFileSync(join(worktree, ".secrets", "mcp.secret"), "changed-secret-content");
    let removed = false;
    const result = await retireWorktree(
      {
        request: { worktree, branch: "not-a-real-branch", base: "main", head: "abc", evidence: "integrated" },
        worktreeApi: { async remove() { removed = true; return { data: true }; } },
        cwd: project,
        expectedRoot: managed,
      },
      { listProcesses: () => [], verifyRetirementIdentity: () => ({ ok: true }) },
    );
    assert.equal(result.ok, false);
    assert.equal(result.blocked, true);
    assert.equal(removed, false);
    assert.equal(readFileSync(join(worktree, ".secrets", "mcp.secret"), "utf8"), "changed-secret-content");
  });
});

test("retirement proceeds only after the operator moves owned credentials out of the worktree", { skip: !secureRuntimeAvailable }, async () => {
  await retirementFixture(async ({ project, managed, worktree, root }) => {
    await materializeOwnedFile(project, worktree);
    const ownershipKey = realpathSync(worktree);
    const externalCopy = join(root, "operator-moved-mcp.secret");
    renameSync(join(worktree, ".secrets", "mcp.secret"), externalCopy);
    let removed = false;
    const result = await retireWorktree(
      {
        request: { worktree, branch: "not-a-real-branch", base: "main", head: "abc", evidence: "integrated" },
        worktreeApi: { async remove() { removed = true; rmSync(worktree, { recursive: true, force: true }); return { data: true }; } },
        cwd: project,
        expectedRoot: managed,
      },
      { listProcesses: () => [], verifyRetirementIdentity: () => ({ ok: true }) },
    );
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(removed, true);
    assert.equal(readFileSync(externalCopy, "utf8"), "do-not-log");
    assert.deepEqual(readCredentialOwnership(project, ownershipKey), { ok: true, files: [], manifest: null });
    assert.deepEqual(result.credentialCleanup, { ok: true, removed: [], pending: false });
  });
});

test("an API success that leaves a worktree without owned credentials cannot claim retirement", async () => {
  await retirementFixture(async ({ project, managed, worktree }) => {
    const result = await retireWorktree(
      {
        request: { worktree, branch: "not-a-real-branch", base: "main", head: "abc", evidence: "integrated" },
        worktreeApi: { async remove() { return { data: true }; } },
        cwd: project,
        expectedRoot: managed,
      },
      { listProcesses: () => [], verifyRetirementIdentity: () => ({ ok: true }) },
    );
    assert.equal(result.ok, false);
    assert.equal(result.removed, false);
    assert.equal(lstatSync(worktree).isDirectory(), true);
  });
});
