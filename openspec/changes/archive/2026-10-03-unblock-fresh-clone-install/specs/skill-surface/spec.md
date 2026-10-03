## MODIFIED Requirements

### Requirement: Command wrappers preserve the skill as single source of truth

Every command wrapper for a hidden skill SHALL read the canonical
`SKILL.md` from its installed path and SHALL NOT duplicate the skill body.
`scripts/validate-config.mjs` SHALL verify that every skill path referenced
by a wrapper command exists on disk, so a renamed or removed skill fails
validation instead of producing a wrapper that injects nothing.

The check SHALL distinguish a repository skill from a local-only skill. A
referenced path that the repository's Git rules ignore SHALL be reported as
a warning naming the wrapper, the path, and the link the operator must
create, and SHALL NOT affect the validator's exit code. A referenced path
that Git does not ignore SHALL keep failing validation.

When `git check-ignore` cannot answer (Git is not on PATH, the tree is not
a Git repository, or Git refuses the path — for example, Windows Git
refusing a WSL checkout as dubious ownership), the validator SHALL fall
back to reading `.gitignore` for a conservative literal-path match
(anchored, unanchored, directory suffix). The fallback SHALL handle only
literal rules and SHALL leave glob or negation patterns undecided. A
referenced path the fallback can neither confirm nor deny SHALL keep
failing validation.

#### Scenario: a renamed skill fails validation

- **WHEN** a wrapper references `skills/archify/SKILL.md` and that file no
  longer exists
- **THEN** `scripts/validate-config.mjs` SHALL exit non-zero naming the
  wrapper command and the missing path

#### Scenario: upstream skill updates propagate without editing the wrapper

- **WHEN** the `archify` skill body is updated in `skills/archify/SKILL.md`
- **THEN** `/archify` SHALL inject the updated body with no change to
  `commands/archify.md`, because the wrapper reads the file rather than
  embedding it

#### Scenario: a missing local-only skill warns instead of failing

- **WHEN** a wrapper references `skills/mmx-cli/SKILL.md`, that path does
  not exist on disk, and the repository's Git rules ignore it
- **THEN** `scripts/validate-config.mjs` SHALL print a warning naming the
  wrapper, the path, and the `ln -s` that satisfies it, SHALL NOT count it
  as a failure, and SHALL exit zero when no other check fails

#### Scenario: a fresh clone installs without local-only skills

- **WHEN** an operator runs `bash ./install.sh` on a fresh clone where
  every Git-ignored skill directory is absent
- **THEN** the validator SHALL exit zero, the installer SHALL link the
  configuration, and `/mmx` SHALL be documented in the warnings as
  injecting nothing until the operator creates the local link

#### Scenario: Git is unavailable, documented literal rule still warns

- **WHEN** a wrapper references `skills/mmx-cli/SKILL.md`, that path does
  not exist on disk, `git check-ignore` cannot answer, and `.gitignore`
  contains the literal entry `/skills/mmx-cli`
- **THEN** `scripts/validate-config.mjs` SHALL print the same warning it
  prints when Git answers, SHALL exit zero when no other check fails

#### Scenario: Git is unavailable and the rule is undecidable stays strict

- **WHEN** a wrapper references a path that does not exist on disk,
  `git check-ignore` cannot answer, and `.gitignore` contains no literal
  rule the fallback can match
- **THEN** `scripts/validate-config.mjs` SHALL exit non-zero naming the
  wrapper and the missing path, as it does today