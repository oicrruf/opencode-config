## Decision

Keep the client fail-closed for invalid or unverifiable recommendations, but
make every `status: "unavailable"` result non-fatal to the caller. The prompt
must explicitly forbid repeated retries and parent-workflow blocking.

Authentication guidance remains available as an optional remediation, never
as a prerequisite for the main task.
