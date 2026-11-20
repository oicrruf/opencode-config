# Native sandbox command

This file documents the native V2 `/sandbox` command registered by
sandbox-control. The native executor parses arguments before a model prompt
or tool call, enforces the operation's permission, and uses the verified
session and managed work identity.

The user starts or replaces a sandbox by invoking the native command.
Agent tools for start, build, rebuild and transfer return command guidance.
General implementation or test requests do not start a sandbox.

Supported syntax:

- `/sandbox` or `/sandbox help`
- `/sandbox release`
- `/sandbox build`
- `/sandbox rebuild`
- `/sandbox transfer <config>` (sandbox replacement or application handoff)

Release accepts no operands and explicitly closes the one verified project
reservation. Build and rebuild read the effective checkout's declared sandbox
configuration. They look for `.opencode/sandbox.json` first, then
`opencode-sandbox.json`. An optional checkout-relative path selects a different
configuration. If no declaration exists, the command reports it and stops.
Transfer requires one checkout-relative path. For a sandbox it is the sandbox
JSON configuration. For an application it is the destination Compose file;
the control compares the destination's rendered persistent mounts before it
stops the old runtime.
Single or double quotes group spaces. No variables, globs or shell expressions
are expanded. Unknown operations, missing/extra operands, flags, absolute
paths, traversal and malformed quoting return usage without dispatch.

Build requires free quota. Rebuild requires the current owning session and
checkout. Release and transfer require explicit approval. A path-based transfer
replaces a verified sandbox for the same managed work identity. An application
handoff stops the exact old Compose runtime and rotates the reservation to the
active managed worktree in `awaiting-start`; it returns a new token. The target
must resume through `reservation_start` using the same Compose file and exact
foreground `docker compose ... up` invocation after a second persistent-mount
check. Release handles sandbox executions and Compose
applications whose labels and mounts map uniquely to a managed worktree in the
same project. It removes verified container IDs without deleting named
database volumes or host upload paths; Compose networks are retained. Ambiguous
or mismatched state remains blocked without resource changes. The configuration
JSON stays outside the capture; external evidence records its fingerprint and
secret-free parameters.

Interrupted transitions are closed only after an explicit request for
`sandbox_recover_transition`; recovery never starts another test. Starting
an environment never approves a product, provisions dependencies or modifies
Git, PRs or Linear.

The command is registered by the plugin only. No same-name Markdown command
is installed: a prompt template must not shadow the native executor or
substitute model interpretation for argument validation.
