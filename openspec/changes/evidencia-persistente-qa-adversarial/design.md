# Design

## Context

See `proposal.md` for motivation. The `qa` and `adversarial` agents are
defined in `agent/qa.md` and `agent/adversarial.md`. Both are read-only
specialists: `qa` runs the project's checks and reports failures tagged with
the owning role; `adversarial` audits the final diff along eight axes and
returns a verdict of `fail`, `pass-with-blocking-findings`,
`pass-with-nits`, or `incomplete`. Both already end their session with the
fenced `metrics:` block defined in `docs/contracts/_metrics-contract.md`.

What is missing is durability. Both agents are dispatched by a coordinator
inside a single session, and their entire output is the assistant message.
When a later session needs to know whether a change was reviewed, what the
review found, or whether a finding was ever fixed, there is nothing to
consult. The repository's conventions already assume such evidence exists:
the `build` agent is told to summarize the verification it ran, and a
coordinator preparing a handoff has no way to check the most recent review
without re-running it.

The permission surface constrains the design. Both agents have
`permission.edit: deny` and `permission.bash: deny` in the configuration
template, so they cannot write a report themselves with the tools they
currently have. The evidence therefore has to be written by whoever holds
the write permission, or the agents have to be given a bounded write
permission over a single directory.

## Goals / Non-Goals

**Goals:**

- Make the outcome of a verification or review run a durable artifact that a
  later session can read.
- Give the artifact a fixed format so a reader can compare two reports
  without reading the surrounding prose.
- Define which findings block the handoff, by consequence rather than by
  impression, and give the blocking case an explicit escape that is
  recorded.
- Relate each source of truth to the cases that cover it, so "verified" is
  a claim about named cases rather than a general impression.
- Keep the reports free of credentials and transcripts.

**Non-Goals:**

- Replace the `metrics:` block or the session summaries. The persisted
  report complements them; it does not replace the immediate answer the
  coordinator needs in the same session.
- Turn the reports into a task system. Findings stay recommendations.
- Define the QA or adversarial audit method. The `agent-routing` and
  `context-budget` specifications already own the scope, the modes, the
  dispatch policy, and the closure rules; this change adds persistence and
  the critical gate on top of them.
- Add a report viewer, a dashboard, or a CI integration.
- Change the model-profile manifest, the step ceilings, or the routing
  classes.

## Decisions

### 1. The reports are Markdown files with a frontmatter block

A report is a Markdown file whose frontmatter declares the agent, the
timestamp, the scope, the mode, the reviewed commit, the branch or worktree,
and the verdict, followed by the findings and the verification matrix.
Markdown is what the repository already writes and reviews — `README.md`,
the OpenSpec artifacts, the agent instructions — and it is diffable, so a
review of a review is possible.

**Alternative considered:** A JSON report plus a rendered summary. Rejected
because the matrix and the reproduction steps are prose, and a JSON file
would make them worse to read while adding a parser.

### 2. The location is scoped by branch or worktree

Reports live under `.opencode/qa/<branch-or-worktree>/` and
`.opencode/adversarial/<branch-or-worktree>/`, with a timestamp and a short
slug in the file name. Scoping by branch keeps the evidence of a feature
separate from the evidence of the integration branch, and lets a reader
answer "what did this change get reviewed against" without ambiguity.

The directory names come from the branch name with the characters that are
unsafe in a path replaced, and a worktree takes precedence when the session
runs inside one.

**Alternative considered:** A single directory per agent. Rejected because
the evidence of two different changes would interleave, and the "most recent
report" question would have no reliable answer.

### 3. A clean run writes nothing

A report is written when the run produced findings, a failed check, or a
blocked check. A run in which every check passed and nothing was found
leaves no file.

This keeps the directory a record of problems rather than a log of routine
activity, and it keeps the "is there something to look at" question
answerable by listing the directory. The cost is that a clean run is not
recorded; the session summary and the `metrics:` block still carry it, and
the handoff can cite those.

**Alternative considered:** Always write a report. Rejected because a
directory that grows with every routine run stops being evidence and becomes
noise, and reviewers stop reading it.

### 4. The agents get a bounded write permission instead of the coordinator writing for them

The report belongs to the run that produced it: a coordinator that rewrites
the reviewer's words reintroduces the risk of misrepresenting a finding.
Both agents therefore receive a write permission limited to their own
directory, and they keep `permission.bash: deny` and no permission over the
rest of the repository.

**Alternative considered:** The coordinator writes the report from the
specialist's returned summary. Rejected because the summary is a
transformation of the findings, and the transformations that matter — the
severity, the origin, the critical classification — are exactly the ones a
coordinator is most likely to soften.

**Alternative considered:** Grant the agents a general write permission.
Rejected because it would contradict the read-only contract that the
`agent-routing` specification already states for the audit roles.

### 5. Criticality is a consequence, not a severity

A finding is critical when its consequence is unauthorized access, exposure
of sensitive data, or loss or corruption of data. The classification is
therefore derivable from the finding itself, and two reviewers reach the
same answer for the same defect. The existing `BLOCKER` severity stays
about impact on the change, and the two are recorded independently: a
`MAJOR` finding can be critical, and a `BLOCKER` that only degrades
ergonomics is not.

**Alternative considered:** Reuse the `BLOCKER` severity as the gate.
Rejected because the severity ladder mixes "breaks the change" with "hurts
someone's data", and only the second justifies blocking a delivery.

### 6. The blocking case has one recorded escape

The coordinator resolves the finding and revalidates it, or an authorized
owner accepts the risk and that acceptance is recorded next to the finding
with the owner and the accepted risk. There is no third path, and the
coordinator never claims an accepted risk was resolved.

**Alternative considered:** Let the coordinator decide to proceed. Rejected
because the coordinator is the party that benefits from the change shipping
and therefore is not the right party to accept a risk to the operator.

### 7. The verification matrix is part of the report, not a separate artifact

The `qa` report carries a matrix in which each source — an acceptance
criterion, a scenario, a requirement — is related to the cases that cover
it, with the preconditions, the inputs, the expected result, the type, the
reproduction steps, the state, and the evidence for each case. The state is
one of passed, failed, blocked, or not executed.

The matrix lives in the report because the report is what a reader
consults, and a matrix in a separate file is a matrix nobody reads.

**Alternative considered:** Keep the matrix in the session only. Rejected
because the same problem this change addresses — the evidence not surviving
the session — applies to the matrix more than to the findings.

### 8. The regression rule is stated in terms of the two runs

A regression test is valid when it fails against the uncorrected behavior
and passes against the corrected behavior. The report records both runs. A
test that passes in both runs is reported as not reproducing the defect, and
a failure caused by the environment is not reported as the defect.

**Alternative considered:** Accept a test that passes after the fix.
Rejected because a test that never exercised the defect gives false
confidence and still shows a green suite.

### 9. The reports are versioned

The report directories are part of the repository, so the evidence of a
review is reviewable in the same pull request as the change it reviews. This
also means the reports are subject to the repository's own line-ending and
content rules.

**Alternative considered:** Keep the reports unversioned and local. Rejected
because the reviewer of a pull request is exactly the person who needs the
evidence, and a local file is invisible to them.

### 10. The report format is a contract that the validator can check

The validator checks that the agent instructions state the reporting
obligation, the report location, and the report format, and that the
permission surface grants each audit agent a write permission limited to its
own report directory. The acceptance harness checks the same contract
against the rendered configuration.

**Alternative considered:** Rely on the agent instructions alone.
Rejected because the instructions are prose that drifts, and the
`skill-surface` and `agent-routing` specifications have already been
protected by mechanical checks for exactly that reason.

## Risks / Trade-offs

- [A grant to write a directory is broader than read-only] → The grant is
  limited to the agent's own report directory, and the acceptance harness
  asserts that neither audit agent holds a write permission over the rest of
  the repository.
- [A report is committed with a credential in it] → The format requires
  reproduction steps that name the command and the safe data, and the
  credential screening rule is part of the report contract.
- [The report directory grows over time] → Only runs with something to
  report write a file, and the directory is scoped per branch.
- [The persisted report is read as an approval] → The report declares the
  verdict and the state of each case, and the specification states that a
  green report does not establish coverage or correctness.
- [The critical gate blocks delivery over a false positive] → The finding
  is classified by consequence, and the coordinator may resolve and
  revalidate it or obtain a recorded acceptance.
- [The report and the session summary disagree] → The report is written by
  the run that produced the findings, and the coordinator's summary cites
  the report path.

## Migration Plan

1. Add the report directories to the repository with a documented naming
   convention and a short index explaining what a report proves and what it
   does not.
2. Extend `agent/qa.md` and `agent/adversarial.md` with the reporting
   obligation, the location, and the format, and extend `agent/build.md`
   with the reference to the report and the blocking rule.
3. Grant each audit agent a write permission over its own report directory
   in the configuration template.
4. Add the validator and acceptance-harness assertions.
5. Roll back by removing the permissions, the instructions, and the report
   directories. Reports already written stay as historical evidence.
