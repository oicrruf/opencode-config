# AT-188 — final adversarial review

Classification: spec-required, full review of the affected filesystem ownership,
migration, retirement and compatibility boundaries. Required by agent/routing.md.
Reviewer: delegated read-only agent `review_at188`; it changed no files and
used disposable directories for reproduction.

## Verdict

Incomplete verification, **no unresolved introduced BLOCKER or MAJOR found**.
The review activity is complete, but runtime discovery and native-platform
compatibility remain explicitly unverified. This does not waive tasks 4.3 or
4.5 or prove readiness for installation or delivery.

## Corrected finding

MINOR, introduced: under-lock revalidation originally omitted `repairOnly`.
With an owned retired autonomy link and a missing agents link, doctor planned
to retain the retired link, while revalidation planned removal; it therefore
rejected a repair with zero conflicts. The reviewer reproduced this failure.

The plan now carries repairOnly into revalidation. Regression evidence: the
owned absence is recreated while the retired link is retained. Reviewer
independently inspected the correction and ran helper tests **22/22**. The
coordinator reran combined tests **30/30** and acceptance **44/44** afterward.
There is no outstanding action on this finding and no focused re-review
was required for this MINOR correction.

## Reviewed boundaries and remaining evidence

The reviewer inspected the implementation diff, helper, both suites, docs and
OpenSpec artifacts. It checked malformed-manifest refusal, foreign/modified
resource preservation, allowlisted identities, symlink-parent rejection,
legacy and retired provenance, locking, revalidation, journals, backups and
same-filesystem atomic writes. No additional concrete introduced material
defect was established.

Distribution now uses Node symlinkSync, including directory links. Windows
privilege behavior, Git Bash paths and WSL UNC behavior were not exercised on
those hosts; Darwin fixtures do not establish the four-shell runtime contract.

Installed-entrypoint imports and distinct tool names prove importability only.
Actual OpenCode discovery and single loading require the mandated sandbox;
Darwin and the missing declaration block that test. No dependency was
provisioned or host-runtime substitute used.

Main-spec strict validation still fails for the pre-existing missing scenario
in installer-portability. Broader successful gate results were supplied by the
coordinator and are identified in verification.md; the reviewer did not rerun
them. It independently ran the earlier combined 29-case suite, corrected
22-case helper suite and git diff --check. The final coordinator rerun includes
the added regression and yields 30 cases.


## Subsequent gate correction

After this review, the operator requested resolving outstanding work. The
missing installer-portability help scenario was added and main-spec strict
validation passed 14/14. This was a specification completeness correction;
installer, helper and doctor implementation code remained unchanged. The
review's runtime and native-platform limitations still apply.
