# Proposal

## Why
The managed sandbox captures the checkout before mapping the Docker build context. A fixture can therefore be blocked by unrelated documentation and credential-rejection test data that the image would never use. Copying more data than necessary also increases exposure. The goal is to reduce the bytes entering the sandbox, not exempt bytes from inspection.

## What Changes
- Introduce an opt-in capture mode for explicitly enumerated fixture inputs; retain the default full eligible checkout capture.
- Validate and screen the exact selected bytes, including the Dockerfile, before making them available to the build. Preserve the existing protected-path, identity, isolation, reporting and cleanup guarantees.
- Provide an operator runbook for a disposable PHP/WordPress/Polylang/database test. Runtime artifacts must be prepared and pinned; missing prerequisites block rather than triggering network provisioning.

## Capabilities
### New Capabilities
- `isolated-fixture-inputs`: opt-in bounded fixture capture and evidence.
### Modified Capabilities
None for existing invocations; full-checkout mode remains the default.

## Impact
Sandbox configuration validation, capture, lifecycle evidence, tests and documentation in the global configuration repository. The project-specific fixture and exporter integration remain in the website change. No scanner exemptions, service startup, production access or shared database use.
