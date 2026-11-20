import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync, linkSync, renameSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSandboxConfig } from "../sandbox-config.mjs";
import { takeCapture, verifyCapture, verifyFixtureSource } from "../sandbox-capture.mjs";
import { FIXTURE_LIMITS, checkFixtureRuntimeInputs } from "../fixture-inputs.mjs";

function fixture(run) {
  const dir = mkdtempSync(join(tmpdir(), "sandbox-selected-"));
  try {
    execFileSync("git", ["init", "-q", dir]);
    mkdirSync(join(dir, "fixture"));
    writeFileSync(join(dir, "fixture", "Dockerfile"), "FROM scratch\n");
    writeFileSync(join(dir, "fixture", "input.txt"), "reviewed fixture\n");
    const declaration = { dockerfile: "fixture/Dockerfile", context: "fixture", stage: "test",
      fixtureInputs: ["fixture/Dockerfile", "fixture/input.txt"] };
    const config = (overrides = {}) => {
      writeFileSync(join(dir, "opencode-sandbox.json"), JSON.stringify({ ...declaration, ...overrides }));
      return readSandboxConfig(dir);
    };
    const capture = (overrides = {}) => takeCapture({
      cwd: dir, worktreePath: dir, workId: "fixture", executionId: "fixture-test",
      fixtureInputs: declaration.fixtureInputs, dockerfile: declaration.dockerfile,
      context: declaration.context, protectedPaths: ["opencode-sandbox.json"], ...overrides,
    });
    return run({ dir, declaration, config, capture });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("fixture selector absent retains legacy include and explicit empty selector is refused", () => fixture(({ dir, config }) => {
  writeFileSync(join(dir, "opencode-sandbox.json"), JSON.stringify({
    dockerfile: "fixture/Dockerfile", context: ".", stage: "test", include: ["fixture"],
  }));
  const legacy = readSandboxConfig(dir);
  assert.equal(legacy.ok, true);
  assert.equal(Object.hasOwn(legacy.config, "fixtureInputs"), false);
  assert.deepEqual(legacy.config.include, ["fixture"]);
  for (const fixtureInputs of [[], null, {}, "fixture/input.txt", false]) {
    assert.equal(config({ fixtureInputs }).ok, false);
  }
  assert.equal(config().ok, true);
}));

test("literal selectors reject normalization ambiguity, globs, limits, protected names and legacy overlap", () => fixture(({ config }) => {
  for (const path of ["", ".", "..", "/etc/passwd", "../x", "fixture/../input.txt", "./fixture/input.txt",
    "fixture//input.txt", "fixture/*.txt", "fixture/[x]", "fixture/{x}", "fixture\\input.txt",
    "fixture/input.txt ", "fixture/x\n", "fixture/\u202ex", "fixture/x\u00a0", "fixture/a.", "fixture/é".normalize("NFD"),
    Array(20).fill("x".repeat(64)).join("/"),
    `fixture/${"a".repeat(FIXTURE_LIMITS.segmentBytes + 1)}`, "fixture/.env", "fixture/.env.local",
    "fixture/.opencode/state/secret", "fixture/.git/config", "fixture/.ssh/id_rsa",
    "fixture/.npmrc", "fixture/private.key", "fixture/credentials.json", "fixture/opencode.jsonc",
    "fixture/opencode-sandbox.json", "fixture/.opencode-sandbox-capture.json"]) {
    assert.equal(config({ fixtureInputs: ["fixture/Dockerfile", path] }).ok, false, JSON.stringify(path));
  }
  assert.equal(config({ fixtureInputs: ["fixture/Dockerfile", "fixture/Dockerfile"] }).ok, false);
  assert.equal(config({ fixtureInputs: ["fixture/Dockerfile", "fixture/dockerfile"] }).ok, false);
  assert.equal(config({ fixtureInputs: Array.from({ length: FIXTURE_LIMITS.count + 1 }, (_, i) => `fixture/f${i}`) }).ok, false);
  assert.equal(config({ fixtureInputs: ["fixture/input.txt"] }).ok, false);
  assert.equal(config({ fixtureInputs: ["fixture/Dockerfile", "outside.txt"] }).ok, false);
  assert.equal(config({ context: "./fixture" }).ok, false);
  assert.equal(config({ dockerfile: "./fixture/Dockerfile" }).ok, false);
  for (const include of [[], null, "fixture", false]) assert.equal(config({ include }).ok, false);
  for (const overrides of [{ production: { allowExternalEgress: true } }, { ports: [80] }, { dependencies: ["http://localhost"] }]) {
    assert.equal(config(overrides).ok, false);
  }
}));

test("missing, directory, symlink ancestry and hardlinked aliases are refused", () => fixture(({ dir, config }) => {
  assert.equal(config({ fixtureInputs: ["fixture/Dockerfile", "fixture/missing"] }).ok, false);
  assert.equal(config({ fixtureInputs: ["fixture/Dockerfile", "fixture"] }).ok, false);
  symlinkSync("input.txt", join(dir, "fixture/link"));
  assert.equal(config({ fixtureInputs: ["fixture/Dockerfile", "fixture/link"] }).ok, false);
  symlinkSync("fixture", join(dir, "alias"));
  assert.equal(config({ context: ".", fixtureInputs: ["fixture/Dockerfile", "alias/input.txt"] }).ok, false);
  execFileSync("mkfifo", [join(dir, "fixture/pipe")]);
  assert.equal(config({ fixtureInputs: ["fixture/Dockerfile", "fixture/pipe"] }).ok, false);
  linkSync(join(dir, "opencode-sandbox.json"), join(dir, "fixture/config-alias"));
  assert.equal(config({ fixtureInputs: ["fixture/Dockerfile", "fixture/config-alias"] }).ok, false);
}));

test("custom configuration path itself and differently cased aliases cannot be selected", () => fixture(({ dir, declaration }) => {
  const custom = "fixture/custom.json";
  for (const path of [custom, "fixture/CUSTOM.json"]) {
    writeFileSync(join(dir, custom), JSON.stringify({ ...declaration, fixtureInputs: ["fixture/Dockerfile", path] }));
    assert.equal(readSandboxConfig(dir, custom).ok, false);
  }
}));

test("file and total byte ceilings are enforced before and during capture", () => fixture(({ dir, declaration, config, capture }) => {
  writeFileSync(join(dir, "fixture/input.txt"), Buffer.alloc(FIXTURE_LIMITS.fileBytes + 1));
  assert.equal(config().ok, false);
  assert.equal(capture().ok, false);
  writeFileSync(join(dir, "fixture/input.txt"), "reviewed");
  const paths = ["fixture/Dockerfile"];
  for (let index = 0; index < 9; index++) {
    const path = `fixture/large-${index}`;
    writeFileSync(join(dir, path), Buffer.alloc(FIXTURE_LIMITS.fileBytes));
    paths.push(path);
  }
  assert.equal(config({ fixtureInputs: paths }).ok, false);
  assert.equal(capture({ fixtureInputs: paths }).ok, false);
  assert.equal(config({ fixtureInputs: declaration.fixtureInputs }).ok, true);
}));

test("capture contains only screened selected inputs, no unrelated secret or configuration bytes", () => fixture(({ dir, config, capture }) => {
  writeFileSync(join(dir, "unselected.txt"), 'password="unselected-sentinel-value"');
  const configuration = config({ context: "." });
  assert.equal(configuration.ok, true);
  const legacy = takeCapture({ cwd: dir, worktreePath: dir, workId: "legacy", executionId: "legacy-test",
    protectedPaths: ["opencode-sandbox.json"] });
  assert.equal(legacy.ok, false, "legacy screening must still refuse the unrelated credential");
  assert.match(legacy.reason, /credential-shaped/);
  const result = capture({ context: ".", configurationFingerprint: configuration.config.fingerprint,
    fixtureSourceIdentity: configuration.config.fixtureSourceIdentity });
  assert.equal(result.ok, true, result.reason);
  assert.deepEqual(readdirSync(result.destination), ["fixture"]);
  assert.deepEqual(readdirSync(join(result.destination, "fixture")).sort(), ["Dockerfile", "input.txt"]);
  assert.equal(existsSync(join(result.destination, "unselected.txt")), false);
  assert.equal(existsSync(join(result.destination, "opencode-sandbox.json")), false);
  assert.equal(result.manifest.mode, "fixture-inputs");
  assert.equal(result.manifest.configurationFingerprint, configuration.config.fingerprint);
  assert.equal(verifyCapture(result.destination, result.manifest).ok, true);
  assert.equal(verifyFixtureSource(result.manifest).ok, true);
  assert.equal(readFileSync(join(result.destination, "fixture/input.txt"), "utf8"), "reviewed fixture\n");
}));

test("source changes after configuration validation are not recertified as a fresh fixture", () => fixture(({ dir, config, capture }) => {
  const configured = config();
  assert.equal(configured.ok, true);
  writeFileSync(join(dir, "fixture/input.txt"), "changed after declaration");
  const result = capture({ fixtureSourceIdentity: configured.config.fixtureSourceIdentity });
  assert.equal(result.ok, false);
  assert.equal(result.inconsistent, true);
}));

test("selected secrets in Dockerfile, binary-shaped or larger text are refused without echoing values", () => {
  for (const kind of ["dockerfile", "binary", "large"]) fixture(({ dir, capture }) => {
    const value = "selected-credential-value";
    const bytes = kind === "binary" ? Buffer.from(`\0password="${value}"`) :
      `${kind === "large" ? "x".repeat(1024 * 1024) : ""}\npassword="${value}"`;
    writeFileSync(join(dir, kind === "dockerfile" ? "fixture/Dockerfile" : "fixture/input.txt"), bytes);
    const result = capture();
    assert.equal(result.ok, false);
    assert.equal(JSON.stringify(result).includes(value), false);
    assert.equal(existsSync(join(dir, ".opencode/state/sandbox/captures/fixture-test")), false);
  });
});

test("source drift, regular-directory replacement and symlink replacement refuse and remove staging", () => {
  for (const mutation of ["content", "directory", "symlink"]) fixture(({ dir, capture }) => {
    const result = capture({ onBeforeCompare() {
      if (mutation === "content") writeFileSync(join(dir, "fixture/input.txt"), "changed");
      else {
        renameSync(join(dir, "fixture"), join(dir, "old-fixture"));
        if (mutation === "symlink") symlinkSync("old-fixture", join(dir, "fixture"));
        else {
          mkdirSync(join(dir, "fixture"));
          writeFileSync(join(dir, "fixture/Dockerfile"), "FROM scratch\n");
          writeFileSync(join(dir, "fixture/input.txt"), "reviewed fixture\n");
        }
      }
    } });
    assert.equal(result.ok, false, mutation);
    assert.equal(result.inconsistent, true);
    assert.equal(existsSync(join(dir, ".opencode/state/sandbox/captures/fixture-test")), false);
  });
});

test("capture verification rejects added bytes, symlinks, hardlinks, content and identical-content replacement", () => {
  for (const mutation of ["extra", "link", "hardlink", "content", "replacement"]) fixture(({ dir, capture }) => {
    const result = capture();
    assert.equal(result.ok, true, result.reason);
    const path = join(result.destination, "fixture/input.txt");
    if (mutation === "extra") writeFileSync(join(result.destination, "extra"), "unselected");
    else if (mutation === "link") { rmSync(path); symlinkSync(join(dir, "fixture/input.txt"), path); }
    else if (mutation === "hardlink") { rmSync(path); linkSync(join(dir, "fixture/input.txt"), path); }
    else if (mutation === "content") writeFileSync(path, "changed");
    else { rmSync(path); writeFileSync(path, "reviewed fixture\n"); }
    assert.equal(verifyCapture(result.destination, result.manifest).ok, false, mutation);
  });
});

test("pinned dependency check never pulls, blocks dynamic/remote inputs and accepts available pinned images", () => {
  const pinned = `local/runtime@sha256:${"a".repeat(64)}`;
  const calls = [];
  const run = (command, args) => {
    calls.push([command, ...args]);
    return JSON.stringify([{ Id: "sha256:local", Config: { OnBuild: [] } }]);
  };
  assert.equal(checkFixtureRuntimeInputs(Buffer.from(`FROM ${pinned} AS base\nFROM base AS test\nCOPY --from=base /a /a\n`), run).ok, true);
  assert.deepEqual(calls, [["docker", "image", "inspect", pinned]]);
  assert.equal(checkFixtureRuntimeInputs(Buffer.from(`FROM ${pinned}`), () => { throw new Error("missing"); }).ok, false);
  for (const text of ["FROM runtime:latest", "FROM $BASE", "# syntax=docker/dockerfile:1\nFROM scratch",
    "FROM scratch\nADD https://example.com/a /a", "FROM scratch\nCOPY --from=remote:latest /a /a",
    'FROM scratch\nADD ["https:\\/\\/example.com/a", "/a"]',
    "FROM scratch\nCOPY --from=scratch /a /a", "FROM scratch\nCOPY --from=42 /a /a",
    "FROM scratch\nCOPY --from=0 --from=runtime:latest /a /a",
    "FROM scratch\nRUN --mount=type=bind echo x", "", "COPY ./x /x"]) {
    assert.equal(checkFixtureRuntimeInputs(Buffer.from(text), run).ok, false, text);
  }
  assert.equal(checkFixtureRuntimeInputs(Buffer.from("FROM scratch"), run).ok, true);
});
