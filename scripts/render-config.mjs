#!/usr/bin/env node
// Render the installed OpenCode root configuration by combining the
// version-controlled template with a selected profile from the manifest.
//
// Usage:
//   node scripts/render-config.mjs [--profile <name>] [--output <path>]
//   node scripts/render-config.mjs --help
//
// Exit codes:
//   0  rendered successfully
//   1  bad arguments, missing file, unknown profile, or coverage failure
//
// Inputs (resolved relative to the repo root):
//   config/opencode.template.jsonc
//   config/model-profiles.json
//
// Output:
//   --output <path>     write to path
//   (omitted)           write to stdout
//
// The renderer does not consult the OpenCode models catalog; that check is
// done by scripts/validate-config.mjs on the rendered output so a missing
// catalog on the build machine does not block a deterministic render.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const templatePath = resolve(repoRoot, 'config/opencode.template.jsonc');
const manifestPath = resolve(repoRoot, 'config/model-profiles.json');

function fail(msg, code = 1) {
  console.error(`render-config: ${msg}`);
  process.exit(code);
}

function parseArgs(argv) {
  const out = { profile: null, output: null, help: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      out.help = true;
    } else if (a === '--profile') {
      const v = argv[++i];
      if (!v) fail('--profile requires a value');
      out.profile = v;
    } else if (a.startsWith('--profile=')) {
      out.profile = a.slice('--profile='.length);
    } else if (a === '--output' || a === '-o') {
      const v = argv[++i];
      if (!v) fail('--output requires a value');
      out.output = v;
    } else if (a.startsWith('--output=')) {
      out.output = a.slice('--output='.length);
    } else {
      fail(`unknown argument: ${a}`);
    }
  }
  return out;
}

function readJsonc(file) {
  const raw = readFileSync(file, 'utf8');
  const stripped = raw
    .replace(/^\s*\/\/[^\n]*\n/gm, '')
    .replace(/\/\*[^*]*\*+(?:[^/*][^*]*\*+)*\//g, '');
  return JSON.parse(stripped);
}

function printHelp() {
  console.log(`Usage: node scripts/render-config.mjs [--profile <name>] [--output <path>]

Reads config/opencode.template.jsonc and config/model-profiles.json,
selects the named profile (or the manifest default), and writes the
rendered OpenCode root configuration.

Options:
  --profile <name>   select a profile from the manifest (default: defaultProfile)
  --output <path>    write to path (default: stdout)
  --help, -h         show this help
`);
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  let manifest, template;
  try {
    manifest = readJsonc(manifestPath);
  } catch (e) {
    fail(`cannot read manifest at ${manifestPath}: ${e.message}`);
  }
  try {
    template = readJsonc(templatePath);
  } catch (e) {
    fail(`cannot read template at ${templatePath}: ${e.message}`);
  }

  if (!manifest.defaultProfile || typeof manifest.defaultProfile !== 'string') {
    fail('manifest is missing a string defaultProfile field');
  }
  if (!manifest.profiles || typeof manifest.profiles !== 'object') {
    fail('manifest is missing a profiles object');
  }

  const profileName = args.profile ?? manifest.defaultProfile;
  const profile = manifest.profiles[profileName];
  if (!profile) {
    fail(`unknown profile '${profileName}'; available: ${Object.keys(manifest.profiles).join(', ')}`);
  }

  if (!profile.root || typeof profile.root !== 'object') {
    fail(`profile '${profileName}' is missing a root object`);
  }
  if (!profile.agents || typeof profile.agents !== 'object') {
    fail(`profile '${profileName}' is missing an agents object`);
  }

  // Apply root-level model assignments.
  template.model = profile.root.model;
  template.small_model = profile.root.small_model;

  // Apply per-agent model assignments. Every agent the template declares must
  // have a profile entry; every profile agent entry must exist in the template.
  if (!template.agent || typeof template.agent !== 'object') {
    fail('template is missing an agent object');
  }

  const templateAgents = Object.keys(template.agent);
  const profileAgents = Object.keys(profile.agents);

  const missing = templateAgents.filter((name) => !profile.agents[name]);
  if (missing.length > 0) {
    fail(
      `profile '${profileName}' has incomplete agent coverage; missing: ${missing.join(', ')}`,
    );
  }
  const extra = profileAgents.filter((name) => !template.agent[name]);
  if (extra.length > 0) {
    fail(
      `profile '${profileName}' references agents not in the template: ${extra.join(', ')}`,
    );
  }

  for (const [name, model] of Object.entries(profile.agents)) {
    template.agent[name].model = model;
  }

  // Local MCP command paths are now expected to already be absolute in the
  // template. The previous `{__repo_root__}` placeholder machinery was used
  // by the now-removed Jev adapter; keeping the renderer strict means a
  // future agent that ships an MCP server must commit to an absolute path
  // or fail validation, instead of silently rewriting a relative token.
  if (template.mcp && typeof template.mcp === 'object') {
    for (const [, entry] of Object.entries(template.mcp)) {
      if (!entry || entry.type !== 'local' || !Array.isArray(entry.command)) {
        continue;
      }
      entry.command = entry.command.map((value) => {
        if (typeof value === 'string' && /\{__repo_root__\}/.test(value)) {
          return value.replace(/\{__repo_root__\}/g, repoRoot);
        }
        return value;
      });
    }
  }

  // Commands: the manifest is informational. The renderer does not write
  // command files; commands are symlinked from the source directory and keep
  // their `model:` frontmatter. Coverage of every command with a frontmatter
  // model is enforced by scripts/validate-config.mjs against this profile's
  // `commands` block.
  if (!profile.commands || typeof profile.commands !== 'object') {
    fail(`profile '${profileName}' is missing a commands object`);
  }

  const rendered = JSON.stringify(template, null, 2) + '\n';
  if (args.output) {
    writeFileSync(args.output, rendered, 'utf8');
  } else {
    process.stdout.write(rendered);
  }
}

main();
