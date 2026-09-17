# OpenSpec store selection

When the user names a store (a standalone OpenSpec repo registered on
this machine) or the work lives in one, every command shown below is
shorthand: append `--store <id>` to the commands that read or write
specs and changes (`new change`, `status`, `instructions`, `list`,
`show`, `validate`, `archive`, `doctor`, `context`, `schemas`, `view`).
Hints printed by the CLI already carry the flag; keep it on follow-ups.
Without a store, commands act on the nearest local `openspec/` root.

Discover the store id once with `openspec store list --json`, then treat
the chosen `--store <id>` as sticky for the rest of the workflow. Do not
pass `--store` to commands that do not accept it.
