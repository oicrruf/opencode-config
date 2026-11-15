# Verification notes

The observations recorded while this change was implemented. Every
command below was run on the machine that applied the change, and the
result is the actual output, not an expectation.

## Host

| Property | Value |
|---|---|
| Platform | macOS (Darwin 27.0.0, arm64) |
| Git | 2.x |
| OpenCode worktree API | available to plugins through the runtime context |

The worktree control runs on every platform the repository supports: it
uses the worktree API of the runtime and the Git commands of the host.

## 1. The project resolution, the inventory, the capacity, and the lock

```
node plugins/worktree-control/test/control.test.mjs
```

```
✔ a repository resolves and a non-repository does not
✔ the inventory reconciles the records with the worktrees that exist
✔ the inventory report states every worktree and its state
✔ a recorded worktree is added to the inventory
✔ the capacity reports the measurement and announces no maximum
✔ a measurement that cannot be taken is reported as unavailable
✔ only exactly zero available bytes blocks a creation
✔ a second operation is refused with the owner reported
✔ the lock is released when the operation finishes
✔ an unverifiable lock is preserved and not reclaimed
✔ a lock whose owner ended is reported as ended
✔ a release by another owner is refused
✔ the state directory is created with restrictive permissions
ℹ pass 13
ℹ fail 0
```

The capacity report carries `maximum: null` and `remaining: null`: the
control states only what it measured, and the test asserts the absence
of both.

## 2. The creation, the checks, the evidence, and the branch handling

```
node plugins/worktree-control/test/retirement.test.mjs
```

```
✔ the created worktree is outside the checkout and is recorded
✔ a repeated request returns the same worktree and creates no second one
✔ a failing creation leaves the inventory unchanged
✔ each incomplete retirement request is refused with the missing element named
✔ local changes block the retirement and are named
✔ unpublished commits block the retirement and are named
✔ a process with access blocks the retirement and is named
✔ an unavailable process check blocks the retirement
✔ unrecognized ignored files block the retirement and are named
✔ an unsafe path blocks the retirement and is named
✔ the blocking checks report each condition individually
✔ the evidence manifest lists exactly the copied files
✔ the evidence policy recognizes the review and verification reports
✔ the removal happens only after the checks and the preservation
✔ a blocking condition stops the retirement before the preservation
✔ a request to delete the remote branch is refused
✔ an unpublished branch is not removed and is reported as pending
✔ a branch that is checked out in the repository is kept and reported as pending
✔ the branch removal runs in the repository and not in the removed worktree
✔ the candidate listing retires nothing and returns the same set twice
✔ a work name is normalized for use in a directory and a branch
ℹ pass 22
ℹ fail 0
```

## 3. The end-to-end exercise on a real repository

A real repository was prepared with a worktree, a published branch, and
a bare remote, and the control was exercised against it with the
worktree API emulated over the real `git worktree` commands:

```
node plugins/worktree-control/test/e2e.mjs <repository>
```

**The creation.** The worktree was created outside the canonical
checkout, on its own branch, and recorded in the inventory:

```
{
 "ok": true,
 "created": true,
 "directory": ".../probe/wt-e2e-work",
 "branch": "feature/e2e"
}
```

**The inventory.** The reconciliation reported the recorded entry as
present, and the pre-existing worktree that the control did not create
as unrecorded:

```
{
 "total": 2,
 "present": 1,
 "missing": 0,
 "unrecorded": 1
}
```

**The capacity.** The measurement succeeded and no limit was announced:

```
{
 "available": true,
 "availableBytes": 29602009088,
 "worktrees": 2,
 "maximum": null,
 "remaining": null
}
```

**A retirement request with an incomplete identity** was refused, and
each missing element was named:

```
{
 "ok": false,
 "reason": "the retirement request does not carry a complete identity",
 "missing": ["branch", "base", "head", "evidence"]
}
```

**The candidate listing** reported the two worktrees and retired
nothing:

```
{
 "total": 2,
 "retired": 0,
 "first": {
  "candidate": false,
  "reason": "the branch is not published on origin"
 }
}
```

**The valid retirement** preserved the evidence before it removed
anything, removed the worktree, and reported the branch separately:

```
{
 "ok": true,
 "removed": true,
 "evidencePreserved": true,
 "evidence": ".../.opencode/state/worktrees/evidence/e2e-work-2026-10-27",
 "evidenceFiles": [{ "path": "verification-report.md", "bytes": 41 }],
 "branch": {
  "removed": false,
  "pending": true,
  "reason": "the local branch could not be removed and was not forced"
 },
 "remotePreserved": true
}
```

**After the retirement**, the remote branch and the published commits
were still reachable, the worktree was gone, and the inventory no
longer listed it:

```
{
 "remoteBranch": "c0c8ac5952cc37c206b9c914a321d79ad64e4b97",
 "localBranch": "c0c8ac5952cc37c206b9c914a321d79ad64e4b97",
 "worktrees": ".../probe bedbbb7 [main]"
}
```

The local branch is reported as pending, and that is the specified
outcome: `git branch -d` refuses a branch that is not merged into the
local base, and the specification forbids forcing the removal. The
operator merges the base or removes the branch by hand, and the remote
branch keeps the work reachable either way.

## 4. Two defects the end-to-end exercise exposed

The exercise found two defects that the injected tests had not covered,
and both were corrected with a regression test.

| Defect | Correction |
|---|---|
| The branch removal ran its commands in the worktree directory, which no longer existed after the removal, so an existing branch was reported as missing | The commands run in the repository. The regression test asserts that the reason is never "the local branch does not exist" for a branch that exists. |
| The symbolic-reference check compared the checked-out branch of the repository against the branch being removed, so an ordinary branch was reported as a symbolic reference | The check is about the branch being removed: a symbolic reference is never removed, and a branch that is checked out in the repository is kept and reported as pending. |

## 5. The findings of the adversarial review of the final diff

A targeted review of the final diff returned `pass-with-blocking-findings`:
seven MAJOR findings and two MINOR, all introduced by this change. Every
one was corrected and covered by a test.

| Finding | Correction | Covered by |
|---|---|---|
| The retirement never verified that the worktree lived under the directory the control manages, so a request could reach an external path | The containment is checked before anything is inspected or removed, on the canonical form of both paths, and a path outside is refused | `retirement.test.mjs` |
| The process check assigned a null working directory to every process, so it never detected a holder and the documented blocking was false | The check reads the working directory of every process with `lsof`, and a host that cannot answer reports the check as unavailable, which blocks | `retirement.test.mjs` |
| The conditions were checked once and the removal happened later, so a change created in between was lost | The conditions are revalidated immediately before the removal, and a condition that appeared keeps the worktree. The window is reduced, not eliminated: the lock serializes this control, not Git and not the other processes of the host | `retirement.test.mjs` |
| The symbolic-reference protection never triggered, because `git cat-file -t` resolves the reference and reports the type of the object it points at | The detection uses `git symbolic-ref` on the branch itself | `retirement.test.mjs` |
| The name of the worktree became a directory name without normalization, so a name with a path separator could write outside the evidence area | The name is normalized and the destination is verified to be inside the evidence area | `retirement.test.mjs` |
| The end-to-end exercise accepted an arbitrary repository and used a forced removal and a push | The exercise builds its own throwaway repository and bare remote in a temporary directory, removes the fixture at the end, and does not force the removal | `test/e2e.mjs` |
| A worktree listing that failed returned an empty list, so the reconciliation reported the recorded worktrees as missing and a creation duplicated one | The listing states whether it is trustworthy. An unverified listing produces "unknown" entries instead of "missing", and a creation is refused | `retirement.test.mjs` |
| The copies of the evidence kept the permissions of the source | Every copy is written with restrictive permissions | `retirement.test.mjs` |
| The capacity counted the historical records whose directory was gone | The capacity counts the worktrees that are present | `index.js` |

The focused re-review confirmed eight of the nine corrections and left
the finding about the listing open, through two paths. Both were
corrected:

| Finding still open | Correction | Covered by |
|---|---|---|
| `worktree_create` passed an unverified listing as the actual worktrees, and the creation ignored the flag, so a worktree was created even when the listing had failed | The creation requires a verified listing, whether it comes from the API or is injected. An unverified listing refuses the creation before anything is created | `retirement.test.mjs` |
| The reconciliation compared paths without canonicalizing them, so on macOS the same worktree was reported as missing and as unrecorded at the same time, and a creation could duplicate it | The recorded entries and the listed worktrees are canonicalized before they are compared, and the inventory does not record the same directory twice under two spellings | `retirement.test.mjs` |

The corrected test counts are:

| File | Passing |
|---|---|
| `plugins/worktree-control/test/control.test.mjs` | 14 |
| `plugins/worktree-control/test/retirement.test.mjs` | 33 |

The `worktrees` group of the acceptance harness runs both files and
reports them as passing.


## 6. The repository gates

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
all checks passed
```

```
node scripts/acceptance-harness.mjs
```

```
  FAIL  build and routing document the risk-proportionate adversarial dispatch
        agent/routing.md must forbid cosmetic re-dispatches
 41/42 passed (static only; add --live for runtime tests)
```

**Pre-existing failure**, not introduced by this change. The check
expects the string `SHALL NOT re-dispatch `adversarial` for cosmetic`
in `agent/routing.md`, and the file says `NOT re-dispatch `adversarial`
for cosmetic or nits-level concerns` (line 107) without the `SHALL`.
The failure was confirmed on a clean checkout with the changes stashed.

The `worktrees` group of the harness covers the tool surface, the
agent instructions, the plugin, the inventory reconciliation, the
capacity reporting, the refusal of an incomplete request, and the
module tests:

```
node scripts/acceptance-harness.mjs worktrees
```

```
worktrees
  PASS  the worktree tool grants match the intended agents
        2 agents granted, 7 agents denied
  PASS  the refactor agent creates its worktree through the managed control
        the refactor agent uses the managed control for creation and retirement
  PASS  the build agent documents the retirement sequence
        the build agent documents the three separate retirement results
   PASS  the worktree plugin is present with its entry point
        plugin and entry point are present
   PASS  the installer links the worktree plugin entry point
        the worktree plugin is installed at the global plugin entry point
  PASS  the worktree inventory reconciles and the capacity announces no limit
        the inventory reconciles, the capacity announces no limit, and an incomplete request is refused
  PASS  the worktree module tests pass
        the control and retirement tests pass

 7/7 passed
```

```
openspec validate --specs --strict --type spec
```

```
✗ spec/installer-portability
  ✗ [ERROR] requirements.5.scenarios: Requirement must have at least one scenario
Totals: 13 passed, 1 failed (14 items)
```

**Pre-existing failure**, not introduced by this change. The last
requirement of `openspec/specs/installer-portability/spec.md` (line 301,
"Installer documents the supported shells in its help") has no
scenario. The change's own delta for that capability adds a requirement
with scenarios, and it validates cleanly.

## 7. The relationship with the other changes

The `sandbox-docker-bajo-demanda` change depends on this one: the
sandbox confirms through the worktree API that a managed worktree
exists for the work it captures, and it takes the quota from the same
per-project reservation. The API shape this change provides is the one
the sandbox expects:

```js
const api = { list, create, remove };
```

The sandbox already consumes it as an injected dependency, so the two
changes stay coupled through the API rather than through a file format.

## 8. Final review findings and corrections

A targeted review of the final implementation found four introduced major
issues: retirement did not verify the requested branch/head/base against Git;
the installer did not link the plugin; evidence destinations could overwrite
prior evidence; and symlinked state paths could redirect writes. These were
corrected and covered by focused tests:

| Finding | Correction | Coverage |
|---|---|---|
| Requested identity could be unrelated to the actual worktree | Verify the linked worktree's repository, branch, head, and integration into a distinct local and published base before preservation/removal; re-check before removal | `retirement.test.mjs` |
| The base could be the retiring branch itself | Reject `base === branch` before integration checks | `retirement.test.mjs` |
| Installer did not expose the worktree plugin | Link its entry point into the global plugin directory; validate and load a temporary installed symlink | `scripts/validate-config.mjs`, `scripts/acceptance-harness.mjs` |
| A duplicate dated evidence destination could overwrite prior evidence | Exclusively create destinations and refuse collisions without changing the existing manifest | `retirement.test.mjs` |
| State/evidence writes could follow repository-controlled symlinks | Check state path components without following links before inventory, lock, and evidence operations | `control.test.mjs`, `retirement.test.mjs` |

The focused review of the first fixes found that a branch could name itself as
its own base. The specific guard and regression were then confirmed by a
focused re-review with no remaining introduced BLOCKER or MAJOR findings.

Final task-relevant verification:

| Check | Result |
|---|---|
| `node plugins/worktree-control/test/control.test.mjs` | 14 passed |
| `node plugins/worktree-control/test/retirement.test.mjs` | 33 passed |
| `node plugins/worktree-control/test/e2e.mjs` | Passed with a disposable repository and bare remote |
| `node scripts/acceptance-harness.mjs worktrees` | 7/7 passed |
| `node scripts/validate-config.mjs --profile personal` | Passed |
| `openspec validate control-seguro-worktrees --strict --type change` | Passed |
| `node scripts/test-model-profiles.mjs` | Passed |
| `node scripts/acceptance-harness.mjs` | 41/42; the same pre-existing routing-string assertion failed |
| `openspec validate --specs --strict --type spec` | 13 passed, 1 pre-existing `installer-portability` scenario error |

The full-suite failures remain limited to the pre-existing issues documented
above; the worktree-specific gates and the change's own strict validation pass.
