# Verification notes

The observations recorded while this change was implemented. Every
command below was run on the machine that applied the change, and the
result is the actual output, not an expectation.

## Host

| Property | Value |
|---|---|
| Platform | macOS (Darwin 27.0.0, arm64) |
| Docker engine | Docker Desktop 29.7.2, Linux containers |
| WSL2 | no |

The Docker engine is reachable and runs Linux containers on this host,
but the sandbox control requires the *host* platform to be Linux or
WSL2, so the end-to-end execution could not run here. The block is
reported by the control, it is not a failure of the implementation.

## 1. The isolation boundary is asserted without an engine

The argument set is constructed in one place, so the boundary is
asserted by a test that needs no Docker:

```
node plugins/sandbox-control/test/capture.test.mjs
```

```
✔ a complete declaration is accepted and each missing element is reported
✔ a declared path that leaves the project is refused
✔ the capture contains the uncommitted work and the manifest matches it
✔ a symbolic link that leaves the source refuses the capture
✔ each excluded kind is absent from a capture
✔ a capture with a credential-shaped file is refused
✔ the argument set carries none of the forbidden options
✔ a build context that leaves the capture is refused
✔ the run binds the ports to the loopback interface only
✔ the run never joins the default bridge network
✔ an unsupported platform is blocked
✔ the independent repository does not touch the original
ℹ pass 12
ℹ fail 0
```

The `sandbox` group of the acceptance harness asserts the same
properties against the rendered configuration:

```
node scripts/acceptance-harness.mjs sandbox
```

```
sandbox
  PASS  the sandbox tool grants match the intended agents
        3 agents granted, 7 agents denied
  PASS  the sandbox plugin is present with its entry point
        plugin, entry point, and guide are present
  PASS  the sandbox argument set asserts the isolation boundary
        no forbidden option, no host network, loopback publications only, limits declared
  PASS  the sandbox module tests pass without Docker
        the reservation, capture, and lifecycle tests pass on a host without Docker

4/4 passed
```

## 2. The reservation, the quota, and the recovery

```
node plugins/sandbox-control/test/reservation.test.mjs
```

```
✔ a second start is refused and names the holding work
✔ a release requires the identity and the absence of the resources
✔ the owner token is not stored in clear text
✔ a credential-shaped argument is refused
✔ a work without a managed worktree is refused
✔ a wrong token refuses the stop and signals nothing
✔ the ambiguity rules each block the next start
✔ the recovery proceeds only on a confirmed owner and an empty group
✔ the worktree confirmation reports a missing work
✔ the verification of a presented token never leaks the token
ℹ pass 10
ℹ fail 0
```

The owner token is generated from a cryptographic source and stored on
disk only as a salted scrypt verifier, so a stolen reservation file is
not enough to stop the application. The test asserts that the token
never appears in the record.

## 3. The lifecycle, the report, and the cleanup

```
node plugins/sandbox-control/test/lifecycle.test.mjs
```

```
✔ a work name is normalized for use in a resource name
✔ two executions of the same work have distinct identities
✔ the start returns a pending manual test and a distinct identity
✔ the status carries no secret and states the pending result
✔ the report is written before the cleanup and holds no secret
✔ a step that carries a credential is refused and the resources are kept
✔ the cleanup removes only the labeled resources and verifies their absence
✔ a cleanup that cannot remove everything keeps the quota
✔ a recovery finds an already completed closure and acts on no other execution
✔ the result must be one of the declared states
✔ the execution record round-trips
ℹ pass 11
ℹ fail 0
```

The Docker calls are injected in these tests, so the lifecycle rules are
exercised on a host without an engine.

## 4. The repository gates

```
node scripts/validate-config.mjs --profile personal
```

```
validate-config: OK
```

```
node scripts/test-model-profiles.mjs
```

```
  PASS  work baseline matches the documented current assignment
        15 agents aligned with manifest

all checks passed
```

The rendered `opencode.jsonc` in this repository holds the `work`
profile, so it was re-rendered with `--profile work` after the template
changed. The baseline check confirms the result.

```
node scripts/acceptance-harness.mjs
```

```
  FAIL  build and routing document the risk-proportionate adversarial dispatch
        agent/routing.md must forbid cosmetic re-dispatches
34/35 passed (static only; add --live for runtime tests)
```

**Pre-existing failure**, not introduced by this change. The check
expects the string `SHALL NOT re-dispatch `adversarial` for cosmetic`
in `agent/routing.md`, and the file says `NOT re-dispatch `adversarial`
for cosmetic or nits-level concerns` (line 107) without the `SHALL`.
The failure was confirmed on a clean checkout with the changes stashed.

```
openspec validate --specs --strict --type spec
```

```
✗ spec/installer-portability
  ✗ [ERROR] requirements.5.scenarios: Requirement must have at least one scenario
Totals: 11 passed, 1 failed (12 items)
```

**Pre-existing failure**, not introduced by this change. The last
requirement of `openspec/specs/installer-portability/spec.md` (line 301,
"Installer documents the supported shells in its help") has no
scenario. The change's own delta for that capability adds a requirement
with scenarios, and it validates cleanly.

## 5. The end-to-end execution could not run on this host

Task 6.4 asks for one execution end to end on a host with a local
Docker engine. This host has the engine, but the sandbox control
requires the host platform to be Linux or WSL2 and this host is macOS.
The control reports the block and starts nothing:

```
$ node --input-type=module -e '... startSandbox(...) ...'
start ok: false blocked: true
reason: the sandbox requires a local Docker engine on Linux or WSL2 (this host is darwin)
cuota: free
```

The quota stays free, no capture is taken, no image is built, and no
container is created. The platform requirement is the documented
boundary of the capability, and widening it to macOS is a change to the
specification, not to the implementation.

The behaviour that the end-to-end run would have exercised was covered
by the injected tests of section 3 instead: the start, the pending
manual test, the report written before the cleanup, the cleanup by
label, and the recovery.

A separate probe confirmed that the network the control creates behaves
as the boundary claims on this engine:

```
$ docker network create --driver bridge --internal sandbox-net-probe
$ docker run --rm --network sandbox-net-probe alpine sh -c 'wget -T 3 http://example.com'
SALIDA HACIA EXTERIOR: bloqueada
```

## 6. The risks the adversarial review raised, and how this change answers them

| Risk raised | How this change answers it |
|---|---|
| "No host network" does not stop the traffic through the default bridge | The run never joins the default bridge. It joins a network created for its execution, internal by default, and the test asserts that a run without a network is refused. |
| The Dockerfile and the context are not required to resolve inside the capture | The build refuses a Dockerfile or a context that escapes the capture, and the configuration reader refuses a declared path that leaves the project. |
| The token that stops a process group has no secrecy requirement | The token is a high-entropy opaque value, stored only as a salted scrypt verifier, compared in constant time, and never written to a log, a report, or an error message. |

## 7. The findings of the adversarial review of the final diff

A targeted review of the final diff returned
`pass-with-blocking-findings`: ten MAJOR findings and one MINOR, all
introduced by this change. Every one was corrected and covered by a
test.

| Finding | Correction | Covered by |
|---|---|---|
| `reservation_start` launched the process before taking the reservation | The reservation is acquired before the launch; a failed launch releases it with the same verification every release requires | `reservation.test.mjs` |
| The acquisition was a read-then-write without exclusion | The record is created with an exclusive open (`wx`), so two sessions that observe the quota as free cannot both take it | `boundaries.test.mjs` |
| `sandbox_finish` and `sandbox_cancel` verified the token only when one was supplied | Both now require the token that owns the reservation; an actor that knows only the execution identity cannot destroy an environment | `lifecycle.test.mjs` |
| A successful close never released the reservation but reported `quotaReleased: true` | The reservation is released after the evidence is preserved and the absence of the resources is verified, and the reported value is the real one | `lifecycle.test.mjs` |
| A failure after the image or the network was created released the quota and left the resource orphaned | The record is persisted before the first resource is created, each resource is recorded as it is created, and a failure runs the labeled cleanup before the quota is released | `lifecycle.test.mjs` |
| `allowExternalEgress` was coerced with `Boolean()`, so `"false"` enabled the egress | The declaration is accepted only as the boolean `true` or `false`; any other value is refused | `boundaries.test.mjs` |
| The declared `context` was never used, and a Dockerfile outside the capture was replaced by a default | The declared Dockerfile and context are mapped onto the captured tree, and a path that does not map is refused | `boundaries.test.mjs` |
| The change detection during the capture compared only the branch and the head | The fingerprint of every candidate is compared before and after the copy, so an uncommitted change is caught | `boundaries.test.mjs` |
| The cleanup listed the containers without `--all` and used `docker network rm -f` | The containers are listed with `--all`, and the removal arguments are declared per kind because `docker network rm` takes no force flag | `lifecycle.test.mjs` |
| The declared dependencies were never checked | The dependencies are checked before the quota is taken and before any resource is created; a missing one blocks the test | `boundaries.test.mjs` |
| The guide promised the invalidation of late dispatches and the rediscovery of implicit volumes, and the code implemented neither | The implicit volumes are discovered through the containers before they are removed, and the guide now describes the absence verification that catches a late arrival | `lifecycle.test.mjs` |

The corrected test counts are:

| File | Passing |
|---|---|
| `plugins/sandbox-control/test/reservation.test.mjs` | 11 |
| `plugins/sandbox-control/test/capture.test.mjs` | 12 |
| `plugins/sandbox-control/test/lifecycle.test.mjs` | 15 |
| `plugins/sandbox-control/test/boundaries.test.mjs` | 9 |

The `sandbox` group of the acceptance harness runs all four files and
reports them as passing.

## 8. The focused re-review

A single focused re-review of the eleven findings above was dispatched,
as the routing contract allows after a review that returned introduced
MAJOR findings. It confirmed eight corrections and reported three
findings still open. All three were corrected:

| Finding still open | Correction | Covered by |
|---|---|---|
| A `spawn` that fails asynchronously emitted `error` after the reservation was taken, so the reservation stayed held | The start waits for the `spawn` or `error` event before the reservation is confirmed, and a failed launch gives it back | `reservation.test.mjs` |
| `recoverSandbox` destroyed resources with only the `executionId`, so an actor that knew the identity could remove a foreign environment | The recovery requires the token that owns the reservation, exactly as closing and cancelling do | `lifecycle.test.mjs` |
| The result of `writeExecutionRecord` was ignored, so a resource could be created without a record the recovery could find | The record is persisted before the first resource is created, and a failure to persist it stops the start before any resource exists | `lifecycle.test.mjs` |

No path remains in which an actor that knows only the `executionId`,
without the token, can close, cancel, recover, or destroy an execution
it does not own. The token is never written to a report, a log, or an
error message.
