# Sandbox control — operator guide

The sandbox verifies a change that can only be verified at runtime: a
container that does not build, a service that does not answer, a page
that does not render. It builds an independent capture of the work
under test and runs it inside a local Docker engine, and it records the
result as evidence.

The sandbox never approves a product and never claims equivalence with
production. Starting the environment is not an approval.

## Prerequisites

- A local Linux Docker engine on Linux/WSL2, or Docker Desktop on macOS
  with a verified local Unix socket and Linux containers. Native Windows,
  other macOS engines and remote Docker endpoints are not supported.
- Preflight resolves the effective context/DOCKER_HOST, verifies socket and
  daemon metadata without creating resources, and rejects uncertain identity.
  A CLI version or a context named desktop-linux alone is not proof.
- A Node.js runtime that can load the plugin. The plugin itself needs no
  native dependency.
- Python 3 with descriptor-relative no-follow filesystem primitives, already
  used by worktree-control. Config reads reuse those primitives to prevent
  ancestor-symlink substitution; absence blocks without installing anything.
- A project that declares its build configuration.

On a host that does not meet the requirements the control reports the
block. It never installs Docker, never generates a Dockerfile, and never
infers a build configuration.

## The declared configuration

The project declares its build in `.opencode/sandbox.json` (or
`opencode-sandbox.json`):

```json
{
  "dockerfile": "Dockerfile",
  "context": ".",
  "stage": "test",
  "ports": [{ "container": 8080, "host": "127.0.0.1", "hostPort": 18080 }],
  "dependencies": ["postgres://localhost:5432/testdb"],
  "production": { "allowExternalEgress": false },
  "testSecrets": [{ "name": "API_TOKEN", "value": "..." }],
  "include": []
}
```

Every field is optional except `dockerfile`, `context`, and `stage`. A
declared path that leaves the project is refused: the build context is
the boundary that keeps the host's content out of the image, so a
context outside the project would defeat it.

A missing or incomplete declaration is reported as a block. The control
does not guess.

The lifecycle also accepts an explicit `configPath`, relative to the
effective checkout root. Paths with spaces are supported; missing explicit
files do not fall back to another declaration. The JSON must be a bounded
regular file inside that checkout; configuration symlinks are refused.
Dockerfile and build-context paths are relative to the checkout, including
when the configuration lives in a subdirectory.

The selected JSON stays outside the build capture, including hardlink
aliases, and `include` cannot override that exclusion. The external
execution record and report retain its SHA-256 fingerprint and an allowlist
of parameters (Dockerfile, context, stage, egress and dependency/secret
counts). They omit raw JSON, secret values, dependency URLs and arbitrary
fields. The source JSON is revalidated after capture: changes or uncertain
identity block before building. Explicit test secrets still travel only
through the existing external secret file.

## The isolation boundary

Every run happens inside a boundary the control constructs itself:

- no Docker socket inside the container;
- no elevated privileges, no added capabilities, and
  `no-new-privileges`;
- no host network, no host PID, IPC, or UTS namespace;
- no mount of the original source, and no device;
- a network created for the execution, internal by default;
- published ports bound to the loopback interface only;
- declared CPU, memory, and process limits.

The default network is internal: a run that declares no egress cannot
reach the outside world or the host's other networks. A project that
genuinely needs the outside sets `production.allowExternalEgress` to the
boolean `true`, and the difference is recorded in the report. The value
is accepted only as that exact boolean: a string such as `"false"` is
refused, so a typo can never widen the boundary by accident.

The build reads its context from the capture, which lives outside the
worktree. A Dockerfile that points outside the capture is refused.

## The capture

### Effective source resolution for the sandbox command

The command source resolver uses the active V2 session's directory,
project identity and session identity. It resolves the Git toplevel of
that directory, then requires exactly one matching managed work entry
confirmed by both inventory and the public worktree listing for the active
project. A subdirectory resolves to the same checkout. Missing, conflicting
or unverifiable work identity blocks; neither a branch name nor a caller's
path/work identifier supplies authority. The common Git directory anchors
project-wide state only and never silently selects a different source.

The V2 command tools use this resolver before acquiring an operation or
creating resources. An unavailable public listing or ambiguous identity is
a block, never a reason to infer a different source.

The capture copies the committed files, the modifications, and the new
files into a temporary directory outside the worktree. It records a
manifest with the work identity, the repository, the branch, the head,
and a fingerprint per file.

Three things are refused rather than repaired:

- a symbolic link that would bring content from outside the source;
- a source that changed while the capture was taken;
- a branch or head that changed, even when the tree is identical.

The Git pointer is never copied. A build that needs Git metadata gets
an independent repository inside the capture, and the original
repository is never opened for writing.

## Exclusions and secrets

The capture always excludes environment files, integration credentials,
model keys, session directories, project memory, global configuration,
Git metadata, and installed dependencies. These protected exclusions
cannot be overridden by `include`; that field only documents additional
project paths to capture.

A declared test secret is written to a file outside the capture and
passed to the container with `--env-file`. It is never an argument,
never an image layer, and never part of the report. The report records
that a secret was supplied and never its value.

Every captured file is screened before the build. A capture that holds
a credential-shaped value is refused and removed.

## The result states

| Result | Meaning |
|---|---|
| `passed` | The test was performed and its steps passed. |
| `failed` | The test was performed and something failed. |
| `blocked` | The test could not start because a dependency was missing. |
| `not executed` | The test was never performed. |

None of them approves the product. The report states the differences
from production; it never claims them away.

## Where the evidence lands

The report is written to `.opencode/state/sandbox/reports/<execution>.json`
in the project's state area, outside the environment and outside the
capture. The report holds the result, the identity, the capture
fingerprint, the image, the steps, the dependencies, the differences
from production, and the names of the secrets that were supplied.

The report is written **before** anything is removed. A failure to
write it keeps the resources, because the evidence must be
recoverable.

Ordinary finish, cancel and recover require the token bound to the exact
reservation execution and generation. Explicit transfer is a separate,
verified transition for the same managed work identity: it uses the active V2
session, preserves evidence and closes attributable resources without asking
for another session's token. Knowing an execution identity alone is
insufficient. Application handoff requires the destination Compose file so
its persistent mount mapping can be checked before teardown.

## The dependencies

The dependencies the project declares are checked before the quota is
taken and before any resource is created. The check opens a connection
to the declared host and port and closes it; it never creates, modifies,
or removes anything.

A dependency that does not answer blocks the test. The control never
provisions a service: a database, a cache, or an API the test needs is
the developer's to prepare. The block names the dependency that is
missing, so the remediation is obvious.

## The quota

One local application runs at a time per project. The sandbox and the
manual application share the same quota, so a second session is refused
before anything is launched, and the refusal names the work that holds
it.

The reservation records its owner, the supervisor identity, the start
time, the process group, and the session. Ordinary application stops require
the owner token; explicit release may close a Compose application only when
its labels and mounts map uniquely to one managed worktree in the project.
For legacy reservations with stale work IDs, reports retain both the recorded
owner and the runtime source worktree; ambiguity still blocks. The token is
high-entropy, is stored on
disk only as a salted verifier, and is never written to a log, a
report, or an error message.

The reservation is released only when the identity is verified and the
resources are confirmed to be absent. An ambiguous reservation — a
reused process identifier, a group that still has processes, or a
process state that cannot be inspected — blocks the next start and is
reported. The death of a coordinator is never enough on its own.

## The cleanup

The cleanup finds the resources by the label the run wrote on them,
never by name and never by age. It removes the container, the network,
the image, and the volumes of the execution, and it verifies their
absence before the quota is released.

A volume created implicitly by a `VOLUME` instruction is rediscovered
through the container that owns it: the containers of the execution are
inspected before they are removed, and the volumes they mount are
credited to the execution before they are removed with it.

A resource that materializes after the removal was dispatched is caught
by the absence verification, which lists the resources again after the
removals. A resource that is still present keeps the quota and is
reported, so a late arrival is never hidden.

A cleanup that cannot complete keeps the quota and reports what
remains.

## The recovery

### Sandbox command and replacement

After installation and a fresh OpenCode session, use:

```text
/sandbox help
/sandbox release
/sandbox build .opencode/sandbox.json
/sandbox rebuild .opencode/sandbox.json
/sandbox transfer .devcontainer/compose.yml
```

Build requires free quota. Rebuild requires this session's sandbox in the
same checkout. Transfer explicitly changes ownership from a verified managed
worktree for the same managed work identity; it validates the destination
configuration before closure. For an application reservation the transfer
path names the destination Compose file; the control renders it without
starting resources, verifies exact persistent mounts, stops/removes the old
containers without deleting volumes or bind paths, and rotates the slot to
the destination in `awaiting-start`. The destination starts it through
`reservation_start` with the returned token and exact foreground Compose
command; the control checks the same persistent mapping again. Release closes
the project's one verified sandbox or Compose application reservation on an
explicit user/developer request. Both release and transfer ask for their named
permission. Build/rebuild and transfer accept one literal checkout-relative
path; for transfer, the reservation scope determines whether it is sandbox
JSON or a Compose file. Release accepts no operands. The native V2 executor parses before model/tool
dispatch and records a synthetic session response with queued delivery and
`resume: false`, visible in the session inbox without waking the agent. Help
and invalid arguments need no model. Variables and shell syntax are never
expanded. New ownership has a fresh token and generation; old tokens and
supervisors cannot act on it.

Release and transfer stop/remove only resources that can be tied to the held
reservation, exact Compose labels and one verified managed runtime source
worktree. A transfer target must be a different managed worktree in the same
project. Named database volumes and host upload paths are persistent and are
preserved. Compose applications are eligible only when engine labels identify
one project and its mounts map to exactly one managed worktree; name-only or
ambiguous matches block without resource changes. Reports record the legacy
reservation owner and runtime source separately when they differ. Compose
networks are retained. For isolated sandbox
runs, the JSON stays outside the capture and external evidence records its
fingerprint and secret-free parameters. This command never deletes a Git
worktree.

Mutators share a cross-process `operation.json` gate, including ordinary
start/finish/cancel/recover, manual applications, release, transfer and the supervisor. The
`transition.json` journal records identities, generations and verified phases
without tokens. The reservation stays occupied across old closure and the
atomic successor replacement. Busy or unknown operations block instead of
retrying. A failure to preserve evidence or verify resource absence keeps
the reservation and blocks the successor.

If a replacement is interrupted, explicitly request
`sandbox_recover_transition` in the same managed work context. It verifies
the previous operation's PID/start identity before recovering an abandoned
gate and refuses a live or unverifiable owner. It resumes attributable
closure only; it never starts another test or asks for a different session's
token. A `running` transition whose token delivery was interrupted can be
closed by its verified owning session or after proving the previous operation
owner ended; an unrelated live session cannot use recovery to close it.
Unknown/partial lock ownership remains blocked for operator
reconciliation. Do not delete locks, reservations or journals to clear a
block. Ordinary finish/cancel still require the current owner's token.
Execution records are retained while resources/secrets are removed and are
updated atomically, so a failed terminal write remains recoverable. Recovery
also accepts an already closed provisional successor after verifying its
report and resource absence; it never restarts a build to repair a journal.

### Activation and rollback

Run `./install.sh --profile <selected>` only when activating the reviewed
change, start a fresh execution and verify with `bash ./install.sh --check`.
No model override or broader agent permission is needed for `/sandbox`.
Old records without a verified session, source and generation remain readable
but cannot be silently upgraded or transferred.

Before rolling back, stop new transfers and close/recover executions with
the version that understands their records. Preserve external reports.
Reinstall the previous version only after verifying absence of incompatible
resources/transitions; do not discard state to make the old version start.

An execution interrupted while it was being prepared, run, or cleaned
up is recovered by consulting its record and the engine's own state.
The recovery resumes the closure of the identified execution, never
starts a second test for it, and never acts on another execution.

## The limits

- The sandbox supports two client/engine combinations:

- Linux (including WSL2) with a verified local Unix-socket Docker engine
  running Linux containers. The engine does not need to identify as Docker Desktop.
- macOS with a verified local Unix-socket endpoint and positively identified
  Docker Desktop running Linux containers.

Windows outside WSL2, remote endpoints and other macOS container engines are
refused.
- The sandbox does not provision dependencies. A missing service blocks
  the test; it is the developer's to prepare.
- The sandbox does not support Compose, a Kubernetes context, or a
  remote engine.
- The sandbox does not return the changes a test made inside the
  container. A correction is made in the worktree and requires a new
  capture.
- The sandbox does not modify the host's branches, publish code, open a
  pull request, or integrate.


## Local Docker Desktop binding

New executions record the endpoint and daemon identity. Build, inspection,
closure, cancellation, recovery and supervisor cleanup are pinned to that
endpoint with contradictory ambient overrides removed. Every operation
rechecks daemon identity; changing the default context does not redirect it.
A restarted/different/unreachable daemon preserves resources and reservation.
Older execution records without binding require explicit reconciliation;
never adopt the current context or delete a reservation to bypass uncertainty.
Rollback of Desktop support must preserve bindings needed to close old runs.

The client may be macOS while containers use the verified Linux daemon.
Evidence records that distinction without claiming native Linux or production
equivalence. All original isolation restrictions remain: no Docker socket,
no elevated privileges, no host network or original-source mount, internal
network by default, loopback publication and declared resource limits.

Prerequisites are inspected, not provisioned. A cached Node image does not
prove an architecture-compatible OpenCode Linux executable is available.
Fixtures must declare their Dockerfile and test runtime explicitly; missing
images, binaries or services block the test rather than trigger downloads.


Run `node scripts/probe-docker-desktop.mjs` for the declared cached-image
prerequisite/isolation probe. It inspects the local image before building,
uses sandbox-control for the container, and preserves observations and the
closure report in its printed temporary repository. It never pulls an image.
This probe is not the AT-188 installation/plugin-loading fixture. If its
OpenCode Linux prerequisite is missing, AT-188 stays blocked; an operator must
provide an already prepared compatible runtime before the real loading test.
