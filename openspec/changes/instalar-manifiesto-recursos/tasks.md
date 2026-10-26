# Tasks

## 1. Manifest model, ownership test, and validation

- [ ] 1.1 Add `scripts/resource-manifest.mjs` with the manifest schema: a
  versioned JSON object holding the selected profile, the rendered root
  configuration digest, one entry per managed resource with its identifier,
  kind, target path, and source path or digest, and the retired entries; and
  verify with a focused test that a manifest written by the module reads
  back with the same fields.
- [ ] 1.2 Implement the manifest validation in the same module: reject a
  non-object document, an unsupported version, entries with missing fields,
  duplicate identifiers, unsafe identifiers, targets that resolve outside the
  global configuration directory, targets with a `..` segment, and targets
  whose parent directory is a symbolic link; and verify with a focused test
  that each rejection reports the offending entry and that a valid manifest
  passes.
- [ ] 1.3 Implement the ownership test in the same module: a managed path is
  owned when the manifest records it and it still resolves to the recorded
  source, and every other path at a managed location is foreign; and verify
  with a focused test that a replaced link, a real file, and a link pointing
  elsewhere are each classified as foreign.
- [ ] 1.4 Implement the atomic manifest write through a temporary file and a
  rename, and the read path that treats a missing manifest as the
  first-install case and a present-but-invalid manifest as a hard error; and
  verify with a focused test that an interrupted write leaves the previous
  manifest readable and that a malformed manifest stops the caller.

## 2. Install plan and application

- [ ] 2.1 Implement the plan computation in `scripts/resource-manifest.mjs`:
  every managed entry resolves to exactly one of `keep`, `create`, `repair`,
  `remove`, or `conflict`, and the root configuration resolves to `keep`,
  `render`, or `backup-and-render`; and verify with a focused test that a
  fully synchronized state plans only `keep` actions.
- [ ] 2.2 Implement the plan application in the same module: create the
  missing links, repair the links that no longer point at their source,
  remove the retired entries that are still the artifacts a previous install
  created, keep the ones that are not, and never touch a conflict; and verify
  with a focused test that a conflict is left byte-identical after the
  application and that a retired entry with a replaced target is retained.
- [ ] 2.3 Make the application write the manifest from the state it observes
  rather than from the previous manifest, so a repaired or removed entry is
  reflected immediately; and verify with a focused test that the rewritten
  manifest no longer lists an applied removal and lists the applied repairs.
- [ ] 2.4 Report every conflict and every retained retired entry in the
  result of the application, with the path and the reason; and verify with a
  focused test that a conflicting path appears in the reported conflicts.

## 3. Installer integration and check mode

- [ ] 3.1 Replace the `link()` function in `install.sh` with a delegation to
  `scripts/resource-manifest.mjs`, keeping the resolved `node` binary, the
  WSL and Git Bash path translation, the legacy `plugins/autonomy.js`
  removal now expressed as a retired manifest entry, and the final
  `OpenCode configuration linked from <repo_dir>` message; and verify by
  running `bash ./install.sh --profile personal` on a host with a clean
  configuration directory and confirming that the same seven links exist
  afterwards.
- [ ] 3.2 Add the `--check` mode to `install.sh`: it SHALL run the same plan
  computation, print the differences, and exit zero when the state is in
  sync and non-zero otherwise, without writing; and verify by running
  `bash ./install.sh --check` twice on a synchronized host and confirming the
  exit code stays zero and no file under the configuration directory changes
  its modification time.
- [ ] 3.3 Make the install idempotent: when the plan contains only `keep`
  actions, the installer SHALL report that the configuration is already
  current and SHALL leave the rendered root configuration unmodified; and
  verify by recording the modification time of the installed root
  configuration, running the install again, and confirming the modification
  time did not change.
- [ ] 3.4 Make a profile change render and record the new root
  configuration, keeping the previous file as a backup; and verify by
  installing the `personal` profile, then the `work` profile, and confirming
  the manifest records the new profile and digest and that a previous root
  configuration backup exists.
- [ ] 3.5 Document `--check` in the `--help` output alongside the profile
  selection, keeping the four documented per-shell invocations unchanged; and
  verify that `bash ./install.sh --help` lists the check mode and that the
  help text still names the four supported shells.

## 4. Repository validation gates

- [ ] 4.1 Add a check to `scripts/validate-config.mjs` that the manifest
  module and the installer agree on the managed resource set, so a resource
  linked by `install.sh` but absent from the module fails validation; and
  verify by temporarily removing a managed entry and confirming the
  validator exits non-zero naming the missing resource.
- [ ] 4.2 Add a check to `scripts/acceptance-harness.mjs` that the manifest
  module validates a representative valid manifest and rejects a
  representative invalid one, and that the installer exposes the check mode;
  and verify the acceptance harness reports the new group as passing.
- [ ] 4.3 Add a focused test file for the manifest module covering the
  validation, ownership, planning, and application rules, and verify it
  passes with the repository's Node.js test runner.

## 5. Documentation and integration verification

- [ ] 5.1 Document the manifest, the conflict policy, the retired-resource
  rule, and the `--check` mode in `README.md`, including the documented
  limitation that the manifest protects whole managed links and does not
  inventory the files inside them; and verify that a reader can answer from
  the README alone what happens when a global path is already owned by the
  operator.
- [ ] 5.2 Record the manifest and the check mode in the validation-gates
  section of `AGENTS.md` so the gates list stays accurate; and verify the
  file names the check mode next to the other documented gates.
- [ ] 5.3 Run `node scripts/validate-config.mjs --profile personal`,
  `node scripts/test-model-profiles.mjs`, `node scripts/acceptance-harness.mjs`,
  and `openspec validate --specs --strict --type spec`; verify each result
  and record any pre-existing failure separately from a failure introduced by
  this change.
- [ ] 5.4 Run `bash ./install.sh --profile personal` followed by
  `bash ./install.sh --check` on this host; verify the install reports the
  state it produced and that the check exits zero, and record the actual
  output in the change verification notes.
