## Approach

Treat `triage` as the canonical internal role name. Rename the agent file and
all internal identifiers that describe the subagent, including profile keys,
dispatch allowlists, acceptance expectations, OpenSpec specs, and audit path.
Do not rename `agent/lib/jev-client.mjs` or `typesafe/jev-1.13`, because those
identify the transport client and external upstream model.

## Compatibility

No alias for `jev` will be retained: an alias would leave two possible agent
identities and make the dispatch contract ambiguous. Existing callers must
update to `triage`.

## Verification

Run the profile validators, model-profile tests, Jev client tests, acceptance
harness, and strict OpenSpec validation. Search the non-archived tree for
internal `jev` agent references and permit only upstream/provider/client names.
