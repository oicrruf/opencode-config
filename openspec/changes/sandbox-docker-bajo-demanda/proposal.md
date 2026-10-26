# Proposal

## Why

Verifying a change that only fails at runtime — a container that does not
build, a service that does not answer, a page that does not render — has no
safe path in this repository today. The agent can run the project on the
host, which mixes the agent's own environment with the project's, and it
can run it inside a container, which means assembling the build context,
the secrets, the mounts, and the ports by hand, differently every time. The
result is that such a change is usually verified by a human on their own
machine, and the agent's report is a claim rather than evidence.

The reference implementation of this capability solves it by building an
independent capture of the worktree and running it under a local Docker
engine with a controlled isolation boundary. The machinery is substantial,
and it is also the most expensive capability in the set to own, which is why
it is specified last and separately.

## What Changes

- Verify the host and the project's declared build configuration before any
  resource is prepared, and report the block when the host or the
  configuration does not allow it, without inventing a configuration and
  without installing anything.
- Build an independent capture of the work under test that includes the
  committed files, the modifications, and the new files, that carries a
  manifest and fingerprints, that never copies the worktree's Git pointer,
  and that is rejected when the source changes while it is being captured.
- Exclude secrets and the agent's local state from the capture by default,
  and supply explicitly declared test secrets outside the build context
  without baking them into image layers.
- Run the build and the test inside a boundary that grants no access to the
  Docker socket, no privileges, no host network, and no mount of the
  original source, and that publishes ports on the loopback interface only.
- Use the external dependencies the developer prepared, and report a block
  when one is missing instead of provisioning it.
- Give every execution a distinct identity tied to the work, so two
  successive runs of the same work never share resources or reports.
- Keep the start of a test separate from its approval: the test stays
  available until it is concluded or cancelled, and starting it never
  approves the product.
- Preserve the report outside the environment before anything is removed,
  with the result, the commands, the dependencies, the differences from
  production, and no secrets.
- Remove only the resources the run created, and recover an interrupted run
  without releasing the quota that protects the environment.
- Keep Git, the branch, and the delivery outside the sandbox, so the test
  can never modify the host's references.
- Reserve one local application per project, so a second session cannot
  start a competing process, and stop an application only through the token
  that owns it.

## Capabilities

### New Capabilities

- `docker-test-sandbox`: build and test an independent capture of the work
  under test in an isolated local container, with preserved evidence and a
  conservative cleanup.
- `local-execution-reservation`: run one local development application at a
  time per project under an owned reservation, and stop only the process
  group that owns it.

### Modified Capabilities

- None.

## Impact

- New plugin source: `plugins/sandbox-control/` with the capture, the
  configuration reader, the Docker adapter, the reservation, the process
  supervisor, the lifecycle, and the recovery.
- Dependency: the managed worktree control introduced by
  `control-seguro-worktrees`, whose inventory, lock, and capacity
  measurement this change builds on.
- Configuration: the sandbox tools are granted to the agents that verify a
  change; no other agent receives them.
- Documentation: `README.md` describes the prerequisites, the isolation
  boundary, the evidence, and the limits; a dedicated guide covers the
  operator-facing steps.
- Validation: the validator and the acceptance harness gain assertions for
  the tool surface and for the isolation rules that can be checked without
  Docker.
- No change to the model-profile manifest, the routing classes, the step
  ceilings, or the audit specialists' permissions.
