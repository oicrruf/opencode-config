# Tasks

## 1. Reservation, quota, and process supervisor

- [ ] 1.1 Implement the per-project quota in
  `plugins/sandbox-control/reservation.mjs`: acquire it before a start,
  refuse a start when it is held, record the owner token, the supervisor
  identity, the start time, the process group, and the session, and release
  it only after the identity and the absence of the resources are verified;
  and verify with a focused test that a second start is refused with the
  holding work reported and that a release requires the verification.
- [ ] 1.2 Implement the local execution start: confirm through the
  worktree API that a managed worktree exists for the work, execute the
  program directly without a shell, store only the executable name, refuse
  arguments that look like credentials, and return the owner token; and
  verify with a focused test that a work without a worktree is refused and
  that a credential-shaped argument is refused.
- [ ] 1.3 Implement the stop: verify the token against the reservation,
  signal only the managed process group, refuse a wrong token without
  signalling, and let the supervisor close the remaining descendants of the
  group when the application ends by itself; and verify with a focused test
  for each of those outcomes.
- [ ] 1.4 Implement the ambiguity rules: when the owner's identity does not
  match, the group still has processes, or the process state cannot be
  inspected, do not signal, do not release, and block the next start; and
  verify with a focused test that each condition blocks and is reported.
- [ ] 1.5 Implement the conservative recovery: release a reservation only
  when the exact owner is confirmed to have ended and its group has no
  remaining process, never on age alone, and record the recovery so a retry
  does not release a different reservation; and verify with a focused test
  for the confirmed and the unconfirmed case.

## 2. Capture, exclusions, and configuration

- [ ] 2.1 Implement the configuration reader in
  `plugins/sandbox-control/sandbox-config.mjs`: read the project's declared
  Dockerfile, build context, target stage, and production parameters, and
  report what is missing instead of inferring it; and verify with a focused
  test that a complete declaration is accepted and that each missing
  element is reported.
- [ ] 2.2 Implement the capture in
  `plugins/sandbox-control/sandbox-capture.mjs`: copy the committed files,
  the modifications, and the new files into a temporary directory outside
  the worktree, preserve the deletions and the relevant permissions, and
  record a manifest with the work identity, the repository, the branch, the
  head, and a per-file fingerprint; and verify with a focused test that the
  capture contains the uncommitted work and that the manifest matches it.
- [ ] 2.3 Make the capture reject a symbolic link that would bring content
  from outside the source, without reading the destination, and reject a
  capture whose source changed while it was taken, including a change of
  the symbolic branch or the head; and verify with a focused test for each
  rejection.
- [ ] 2.4 Implement the exclusion policy: exclude the environment files,
  the integration credentials, the model keys, the session directories, the
  project memory, and the global configuration, and include a path only when
  the declared configuration includes it; and verify with a focused test
  that each excluded kind is absent from a capture.
- [ ] 2.5 Implement the independent repository for builds that need Git
  metadata: initialize a repository inside the capture holding the captured
  state, without copying the worktree's pointer and without writing to the
  original repository; and verify with a focused test that the original
  repository is untouched.
- [ ] 2.6 Screen the captured content for credential-shaped values before
  the build and refuse a capture that contains one; and verify with a
  focused test that such a capture is refused.

## 3. Docker adapter and isolation boundary

- [ ] 3.1 Implement the engine check: verify the platform is Linux or
  WSL2, verify the local engine is reachable, and report the block without
  installing anything when it is not; and verify with a focused test that
  an unsupported platform produces a block.
- [ ] 3.2 Implement the fixed argument set for the build and the run: no
  Docker socket, no elevated privileges, no host network, no mount of the
  original source, ports published on the loopback interface only, and
  declared CPU and memory limits; and verify with a focused test that
  asserts the constructed arguments contain none of the forbidden options
  and do bind the ports to the loopback interface.
- [ ] 3.3 Implement the label that names the execution on every container,
  image, volume, and network the run creates; and verify with a focused test
  that each created resource carries the execution's label.
- [ ] 3.4 Implement the test-secret supply: write the declared secret to a
  file outside the capture, pass it to the run through an environment file
  outside the build context, and keep it out of the arguments, the layers,
  and the report; and verify with a focused test that the value appears
  neither in the build arguments nor in the report.

## 4. Lifecycle, evidence, cleanup, and recovery

- [ ] 4.1 Implement the start: acquire the quota, take the capture, build
  the image, run the container, publish the local access, name the sandbox
  and the session with the work identifier and a normalized work name, and
  return the identifiers without approving anything; and verify with a
  focused test that the start returns a pending manual test and an
  execution identity that differs from a previous run of the same work.
- [ ] 4.2 Implement the status: report the identity, the phase, and the
  visible conditions without revealing secrets, and report that a ready
  environment is not an approved test; and verify with a focused test that
  the status carries no secret and states the pending result.
- [ ] 4.3 Implement the finish: require an explicit result of passed,
  failed, blocked, or not executed, the steps, and the differences from
  production, write the report outside the environment before removing
  anything, and remove only the recorded exclusive resources; and verify
  with a focused test that the report is written before the cleanup and
  that the report contains no secret.
- [ ] 4.4 Implement the cleanup: find the resources by label, remove them,
  tolerate a resource that materializes after the cancellation was
  dispatched, rediscover an implicitly created volume and credit its origin
  before removing it, and verify the absence of the resources; and verify
  with a focused test for the late arrival and for the implicit volume.
- [ ] 4.5 Implement the cancel and the recover: invalidate further
  dispatches, keep the quota until the resources are accounted for, and
  resume the closure of the identified execution without starting a second
  test; and verify with a focused test that a recovery finds an already
  completed closure and acts on no other execution.
- [ ] 4.6 Implement the deadline supervisor: arm an independent detached
  process before the start when a maximum duration is agreed, persist the
  deadline, close the run on expiry without approving it, and keep the
  reservation until the evidence is preserved and the cleanup is verified;
  and verify with a focused test that the expiry closes the run and that
  the deadline survives the loss of the coordinator.
- [ ] 4.7 Make the sandbox unable to affect the host's Git state, and
  verify with a focused test that the host's references and the working
  tree are unchanged after a run that modifies files inside the container.

## 5. Agent instructions, permissions, and validation

- [ ] 5.1 Write the operator guide next to the plugin source: the
  prerequisites, the declared configuration, the isolation boundary, the
  evidence, the result states, the differences from production, and the
  limits; and verify every step the guide states can be followed as
  written.
- [ ] 5.2 Grant the sandbox and reservation tools to the agents that
  verify a change in `config/opencode.template.jsonc`, and SHALL NOT grant
  them to the audit specialists, to `explore`, or to the read-only
  reviewers; and verify by reading the rendered configuration for the
  `personal` profile.
- [ ] 5.3 Add a check to `scripts/validate-config.mjs` that the sandbox tool
  grants match the intended agents and that the plugin directory is present
  with its entry point; and verify by granting a tool to `qa` temporarily
  and confirming the validator exits non-zero naming the agent.
- [ ] 5.4 Add a group to `scripts/acceptance-harness.mjs` that checks the
  tool surface and the argument-set assertions that do not need Docker; and
  verify the group reports as passing on a host without Docker.
- [ ] 5.5 Add a focused test file for the sandbox modules covering the
  reservation, the capture, the exclusions, the argument set, the report
  shape, and the cleanup rules; and verify it passes with the repository's
  test runner.

## 6. Documentation and integration verification

- [ ] 6.1 Document in `README.md` the prerequisites, the declared build
  configuration, the isolation boundary, the result states, where the
  evidence lands, and the limits, including that starting the environment
  does not approve the product; and verify that a reader can answer from
  the README alone what the sandbox does and does not prove.
- [ ] 6.2 Record the sandbox flow and its limits in `AGENTS.md` next to the
  other cross-agent conventions; and verify the file names the quota, the
  evidence, and the blocking behavior for a missing dependency.
- [ ] 6.3 Run `node scripts/validate-config.mjs --profile personal`,
  `node scripts/test-model-profiles.mjs`, `node scripts/acceptance-harness.mjs`,
  and `openspec validate --specs --strict --type spec`; verify each result
  and record any pre-existing failure separately from a failure introduced by
  this change.
- [ ] 6.4 On a host with a local Docker engine, run one execution end to
  end: capture a worktree with an uncommitted change, build, run, conclude
  with an explicit result, and confirm the report is preserved outside the
  environment before the cleanup, that the cleanup removes only the run's
  own resources, and that the local branch and the published commits are
  untouched; and record the actual observations in the change verification
  notes, or record that the host could not run it and why.
