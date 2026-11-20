# Design

## Context
`lifecycle.mjs` calls `takeCapture` before mapping the Dockerfile and context. The existing `include` field is not a file selector. Do not reinterpret it or modify the credential heuristics to unblock one repository.

## Decisions
Use a new optional `fixtureInputs` list of literal checkout-relative regular file paths. Reject empty lists, wildcard/directory entries, ambiguous names, duplicates, overlapping legacy include declarations and configurations whose Dockerfile is not selected. Permit the checkout root as Docker context without capturing that whole directory: reproduce only the selected relative paths inside a private staging tree. Require every selected path within the declared context; no flattening, external copies or implicit dependency discovery.

Use the existing safe capture machinery or equivalent descriptor-bound reads; reject unsafe ancestry, symlinks, hardlink aliases, protected state and secrets even when explicitly requested. Enforce count, byte and path limits before and during capture. Screen the private bytes to be built, not a different read of the source. Record configuration digest, mode, selected relative paths, content hashes and source identity outside the container; revalidate before build. Never include raw values in findings. Independent Git metadata, if needed, may describe only the selected snapshot.

For MTB, require a **separate project-local** fixture configuration and reviewed Dockerfile with pinned, locally available runtime inputs. Use synthetic pages, local-only temporary database storage and no shared Compose, host mounts, exposed ports or runtime/build egress. The WordPress test must exercise the actual exporter and parser/Polylang behavior, not copied substitute logic. Do not inherit dependency code or real credentials from the site's ignored files. Missing compatible artifacts are a named blocker. The previous five capture findings remain findings for the default full-checkout mode.

## Rollout and rollback
Validate both capture modes and the installer before activation. Require independent security review. Roll back by removing the opt-in fixture declaration and restoring the reviewed control version; never interpret an unsupported selector as permission for an unscoped build. Do not disturb existing reservations or unrelated global edits.
