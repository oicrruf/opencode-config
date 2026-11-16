import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { secureFileOperation } from "../secure-files.mjs";

let secureRuntimeAvailable = false;
try {
  secureRuntimeAvailable = execFileSync(
    "python3",
    ["-c", "import os; required=(os.open,os.mkdir,os.unlink,os.stat,os.link); print(int(all(f in os.supports_dir_fd for f in required) and os.stat in os.supports_follow_symlinks and os.link in os.supports_follow_symlinks and hasattr(os,'O_NOFOLLOW') and hasattr(os,'O_DIRECTORY')))"] ,
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  ).trim() === "1";
} catch {}
const secureRequired = { skip: !secureRuntimeAvailable };

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), "worktree-secure-files-"));
  const sourceRoot = join(root, "source");
  const destinationRoot = join(root, "worktree");
  mkdirSync(sourceRoot);
  mkdirSync(destinationRoot);
  try {
    return run({ root, sourceRoot, destinationRoot });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("descriptor-relative copy creates only a regular 0600 file and returns metadata only", secureRequired, () => {
  fixture(({ sourceRoot, destinationRoot }) => {
    mkdirSync(join(sourceRoot, "mcp"));
    writeFileSync(join(sourceRoot, "mcp", "key"), "credential-value");
    const result = secureFileOperation("copy", {
      sourceRoot,
      sourceRelative: "mcp/key",
      destinationRoot,
      destinationRelative: ".mcp/key",
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(Array.isArray(result.identity), true);
    assert.equal(Object.hasOwn(result, "content"), false);
    assert.equal(readFileSync(join(destinationRoot, ".mcp/key"), "utf8"), "credential-value");
    assert.equal(lstatSync(join(destinationRoot, ".mcp/key")).mode & 0o777, 0o600);
  });
});

test("copy refuses symlinked sources and parent directories without escaping the worktree", secureRequired, () => {
  fixture(({ root, sourceRoot, destinationRoot }) => {
    const outside = join(root, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "secret"), "outside-value");
    symlinkSync(join(outside, "secret"), join(sourceRoot, "source-link"));
    symlinkSync(outside, join(destinationRoot, "parent-link"));

    const source = secureFileOperation("copy", {
      sourceRoot,
      sourceRelative: "source-link",
      destinationRoot,
      destinationRelative: "source-copy",
    });
    assert.equal(source.ok, false);

    const destination = secureFileOperation("copy", {
      sourceRoot: root,
      sourceRelative: "outside/secret",
      destinationRoot,
      destinationRelative: "parent-link/escaped",
    });
    assert.equal(destination.ok, false);
    assert.equal(lstatSync(outside).isDirectory(), true);
    assert.equal(readFileSync(join(outside, "secret"), "utf8"), "outside-value");
    assert.equal(lstatSync(outside).mode & 0o777, 0o755);
  });
});

test("copy uses exclusive creation and never overwrites an existing destination", secureRequired, () => {
  fixture(({ sourceRoot, destinationRoot }) => {
    writeFileSync(join(sourceRoot, "key"), "new-value");
    writeFileSync(join(destinationRoot, "key"), "pre-existing");
    const result = secureFileOperation("copy", {
      sourceRoot,
      sourceRelative: "key",
      destinationRoot,
      destinationRelative: "key",
    });
    assert.equal(result.ok, false);
    assert.equal(readFileSync(join(destinationRoot, "key"), "utf8"), "pre-existing");
  });
});

test("inspect and rollback removal are no-follow, regular-file-only, and verify identity", secureRequired, () => {
  fixture(({ sourceRoot, destinationRoot }) => {
    const value = "owned credential";
    writeFileSync(join(destinationRoot, "key"), value, { mode: 0o600 });
    const inspected = secureFileOperation("inspect", { root: destinationRoot, relative: "key" });
    assert.equal(inspected.state, "present");
    assert.deepEqual(inspected.identity.length, 4);
    assert.equal(readFileSync(join(destinationRoot, "key"), "utf8"), value);
    assert.equal(secureFileOperation("remove", { root: destinationRoot, relative: "key", identity: ["0", "0", "0", "0"] }).ok, false);
    assert.equal(readFileSync(join(destinationRoot, "key"), "utf8"), value);
    assert.deepEqual(secureFileOperation("remove", { root: destinationRoot, relative: "key", identity: inspected.identity }), {
      ok: true,
      removed: true,
    });

    symlinkSync(join(sourceRoot, "does-not-exist"), join(destinationRoot, "link"));
    assert.equal(secureFileOperation("inspect", { root: destinationRoot, relative: "link" }).ok, false);
    assert.equal(secureFileOperation("remove", { root: destinationRoot, relative: "link", identity: inspected.identity }).ok, false);
    assert.equal(lstatSync(join(destinationRoot, "link")).isSymbolicLink(), true);
  });
});

test("unsupported Python helper fails closed without exposing process errors", () => {
  fixture(({ sourceRoot, destinationRoot }) => {
    writeFileSync(join(sourceRoot, "key"), "secret");
    const result = secureFileOperation("copy", {
      sourceRoot,
      sourceRelative: "key",
      destinationRoot,
      destinationRelative: "key",
    }, { python: "missing-python-worktree-test" });
    assert.equal(result.ok, false);
    assert.doesNotMatch(JSON.stringify(result), /secret|missing-python-worktree-test/);
  });
});
