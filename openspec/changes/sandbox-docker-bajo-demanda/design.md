# Design

## Context

See `proposal.md` for motivation. This is the most substantial capability in
the set: it owns a build, a container, a port binding, a reservation, an
independent supervisor, an evidence file, and a cleanup path. The reference
implementation is roughly 2000 lines of plugin code across the capture, the
configuration reader, the Docker adapter, the reservation, the process
supervisor, and the lifecycle, and it accumulated its rules through
incidents: a lock whose owner could not be verified, a volume created
implicitly by a `VOLUME` instruction, a container that materialized after
the cancellation had already been dispatched, an evidence file that was
destroyed together with the container it described.

Those incidents are the design input. The rules in the specification are
mostly consequences of failures that already happened once, so the
implementation should follow them literally rather than re-deriving a
simpler design that would fail the same way.

Two dependencies shape the approach. The sandbox needs a managed worktree
to capture, which `control-seguro-worktrees` provides, and it needs the
project's quota, which the local execution reservation also uses. The
worktree API is available to plugins directly, so the sandbox can confirm
that a worktree exists without reading the worktree control's inventory
file; that keeps the two plugins coupled through the API rather than
through a file format.

The host constraint is real and not negotiable: the isolation boundary is
expressed with Docker's own flags, so the feature requires a local Docker
engine on Linux or WSL2. There is no equivalent that runs everywhere the
rest of this configuration runs.

## Goals / Non-Goals

**Goals:**

- Make a runtime-only change verifiable from recorded evidence instead of
  from a claim.
- Keep the tested content independent from the working tree, so the test
  covers a known state and the source is never modified by the test.
- Keep the isolation boundary explicit and enforced by the tool's own
  arguments, not by a configuration file the operator might edit.
- Keep the cleanup provably narrow: only the resources the run created,
  identified by a label the tool writes on them.
- Keep the quota honest: a reservation is released only when the identity
  and the absence of the resources are verified, and the death of a
  coordinator never releases it.

**Non-Goals:**

- Run the test on the host. That path stays available and remains the
  operator's choice.
- Provision infrastructure. Databases, caches, and services the test needs
  are prepared by the developer.
- Support Compose, a Kubernetes context, a remote engine, or a rootless
  daemon with a different socket path beyond the documented default.
- Provide equivalence with production. The report states the differences;
  it never claims them away.
- Approve a product. Starting the environment is not an approval, and the
  result states are `passed`, `failed`, `blocked`, and `not executed`.
- Integrate with a work-item tracker. The work is identified by a string
  the caller supplies.

## Decisions

### 1. The Docker engine is driven through its command line

The control invokes the `docker` executable with an explicit argument list
and no shell interpolation. The command line interface is the documented,
stable surface, and it avoids adding a client library to a repository whose
installer supports four shells across three operating systems.

Every container, image, volume, and network the run creates carries a label
that names the execution. The cleanup finds its own resources by that label
and never by name or by age.

**Alternative considered:** A Docker client library. Rejected for the
dependency and the version matrix it would add to an installer that
currently needs only Node.js and Bash.

### 2. The capture is a copy with a manifest, and it is verified before the build

The capture copies the committed files, the modifications, and the new files
into a temporary directory outside the worktree, excluding the Git metadata
and the excluded paths. It records a manifest with the work identity, the
repository, the branch, the head, and a per-file fingerprint, and it
re-reads the source afterwards to detect a change that happened during the
capture.

The re-read is what makes the capture trustworthy. A capture taken while the
developer is editing would otherwise produce a test that corresponds to no
state that ever existed.

**Alternative considered:** Building directly from the worktree with a bind
mount. Rejected because it binds the source into the container, which the
isolation boundary forbids, and because the tested content would not be
identified.

### 3. Git metadata is reconstructed, never copied

When the build needs Git metadata, the control initializes an independent
repository inside the capture and records the captured state in it. The
worktree's Git pointer is never copied, and the original repository is
never opened for writing.

**Alternative considered:** Copying the `.git` directory. Rejected because
it is large, it encodes absolute paths, and it gives the build a way to
reach the original repository.

### 4. The exclusion list is a deny list with a default-on posture

The capture excludes the environment files, the integration credentials, the
model keys, the session directories, the project memory, and the global
configuration. A path is excluded unless the project's declared
configuration explicitly includes it.

The deny list is the default because a new secret file must be excluded
before anyone remembers to add it, not after. A project that genuinely
needs a file excluded from the deny list declares it.

### 5. Test secrets travel outside the build context

A declared test secret is written to a file outside the capture and passed
to the container with an environment file at run time. It is never an
argument, never an image layer, and never part of the capture. The
evidence records that a secret was supplied and never its value.

**Alternative considered:** Build arguments for the secret. Rejected because
a build argument is recorded in the image history, which is exactly the
layering problem the requirement forbids.

### 6. The isolation boundary is expressed as a fixed argument set

The control never mounts the source, never passes the Docker socket, never
requests elevated privileges, never uses the host network, and publishes
ports on the loopback interface only. It declares the CPU and memory
limits it applies. The argument set is constructed in one place in the code
so that the boundary can be asserted by a test that does not need Docker.

**Alternative considered:** Let the project declare the run flags. Rejected
because a project-supplied flag could weaken the boundary, and the boundary
is the property that makes the capture trustworthy.

### 7. The quota is one per project and covers both the application and the sandbox

The local execution reservation and the sandbox share a single per-project
quota. Starting either refuses when the other holds it. The quota records
its owner, the supervisor identity, and the scope, and it is released only
after the identity and the absence of the resources are verified.

The reference implementation shares the quota for the same reason: a manual
test of the application and a container test of the same project compete for
the same ports and the same attention, and two of them at once produce
results nobody can interpret.

### 8. The deadline supervisor is an independent process

When a maximum duration is agreed for an execution, the control arms a
detached local supervisor that watches a persisted deadline. The
supervisor's expiry triggers the closure, and it never approves anything.
Because the deadline is persisted, a coordinator that dies does not disarm
it.

**Alternative considered:** Let the coordinator enforce the deadline. Rejected
because a coordinator that dies takes the deadline with it, and the run
would then hold the quota forever.

### 9. The report is written outside the environment, before the cleanup

The report is written to the project's local state area, keyed by the
execution identifier, and it records the result, the identity, the capture
fingerprint, the image, the commands, the dependencies, the differences from
production, the performance conditions, and the evidence. It contains no
secret. The cleanup runs only after the report is written, and a failure to
write it keeps the resources so the evidence can be recovered.

The order is the incident lesson: a container destroyed together with its
report leaves nothing to analyze.

### 10. The cleanup finds its own resources by label and tolerates late arrivals

The cleanup lists the resources that carry the execution's label, removes
them, and verifies their absence. It tolerates a resource that materializes
after the cancellation was dispatched by invalidating further dispatches and
reconciling the late response. When a volume was created implicitly by a
`VOLUME` instruction and its identity was not recorded, the cleanup
rediscovers the container that owns it and credits the volume's origin
before removing it.

**Alternative considered:** Record every resource at creation time and
remove exactly that list. Rejected because a `VOLUME` instruction creates a
volume that the control never sees at creation time, and an unrecorded
resource is exactly the one that leaks.

### 11. The work is identified by a string, not by a tracker

Every tool takes a work identifier and a normalized work name. The
identifier is what ties the capture, the session title, the labels, and the
report together. Nothing in the control queries a tracker, and nothing in
the control changes a tracker state.

**Alternative considered:** Require a work-item identifier from a specific
tracker. Rejected because this repository has no tracker contract, and a
capability that depends on one could not be installed globally.

### 12. The host requirements are checked before anything is prepared

The control verifies the platform, the engine's availability, and the
project's declared configuration, and it reports the block without
installing anything and without inventing a configuration. The project
declares its Dockerfile, its context, its stage, and its production
parameters in a small JSON file that the control reads.

**Alternative considered:** Infer the configuration from the repository.
Rejected because an inferred build configuration is the thing most likely
to differ from production, and the whole point of the report is the
difference.

## Risks / Trade-offs

- [The capture is large] → The capture is temporary and removed with the
  execution; the copy is of the source tree, not of the repository history.
- [A build needs a dependency the developer did not prepare] → The test is
  blocked and reported as blocked, which is more useful than a silent
  difference from production.
- [The Docker engine version on a host does not support a flag the control
  uses] → The engine's capabilities are checked at start, and an
  unsupported flag is reported as a block instead of being attempted.
- [The cleanup misses a resource created in an unusual way] → Every
  resource carries the execution's label and the cleanup verifies the
  absence afterwards, so a residue is reported rather than hidden.
- [A secret reaches the capture through an unexpected file] → The deny list
  is default-on, the captured content is screened before the build, and the
  report never records a value.
- [The quota blocks a second session indefinitely] → The reservation
  records its owner and time, and the recovery proceeds only when the owner
  is confirmed to have ended.
- [The feature only works on Linux and WSL2] → The host check reports the
  block clearly, and the rest of the configuration keeps working
  everywhere.
- [A container reaches a service it should not] → The container has no host
  network, so only the loopback publications and the developer's prepared
  services are reachable.

## Migration Plan

1. Apply `control-seguro-worktrees` first; this change uses the worktree
   API to confirm the worktree it captures.
2. Implement the reservation, the process supervisor, and the quota, with
   the tests that do not need Docker.
3. Implement the capture, the exclusion policy, the configuration reader,
   and the fingerprinting.
4. Implement the Docker adapter with the fixed argument set, the labels, and
   the port publication.
5. Implement the lifecycle: start, status, finish, cancel, recover, and the
   deadline supervisor.
6. Write the operator guide next to the plugin source and describe the
   prerequisites, the boundary, the evidence, and the limits in the
   repository documentation.
7. Roll back by removing the tool grants and the plugin. Worktrees and
   repositories are unaffected; the containers and images the runs created
   are removed by the cleanup of the last execution, or manually by their
   labels.
