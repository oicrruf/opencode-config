## Why

Triage is advisory and depends on optional OpenRouter credentials and network
access. Its unavailability must not block the parent agent's work.

## What Changes

Update the triage contract so missing credentials, upstream failures, and
timeouts are reported as a skipped optional consultation. The dispatcher
continues using its own reasoning and available evidence.

When credentials are missing, the user-visible result explicitly states that
the OpenRouter API key is optional for the rest of the configuration and is
only needed to enable Triage.
