# Design

## Context

The manifest centralizes root, global-agent, and command model assignments,
while command frontmatter remains static because the installer links the
whole `commands/` directory. Current assignments span OpenAI, MiniMax, and
Ollama Cloud. OpenCode's provider catalog and saved authentication are
machine-local.

## Goals / Non-Goals

**Goals:**

- Use OpenAI model IDs for every OpenCode root, agent, and command assignment
  in every profile.
- Keep lighter, execution, and decision roles distinct while using the
  verified OpenAI catalog.
- Use existing ChatGPT Plus/Pro OAuth and make its plan allowance distinct
  from API billing.
- Fail validation if a profile or command override reintroduces another
  provider.

**Non-Goals:**

- Change external services invoked by tools, including MiniMax CLI media
  generation or the separately integrated Jev endpoint.
- Add API keys, credentials, or a new provider integration.
- Install the profile into the user's global OpenCode configuration.

## Decisions

- Use `openai/gpt-5.6-luna` for lightweight work, `openai/gpt-6.1-sol` for
  implementation, and `openai/gpt-5.6-terra` for high-ambiguity decisions.
  These exact IDs are present in the authenticated local OpenCode catalog.
- Keep `personal` root on Sol and use Terra as the `work` demonstration
  profile's root model. Other agent assignments stay consistent across both
  profiles; the work profile remains distinguishable without introducing a
  non-OpenAI model.
- Keep commands' installed frontmatter overrides static and OpenAI-only. The
  manifest's command values remain informational per existing contract.
- Add a provider-prefix guard across all manifest profiles and command
  frontmatter, alongside the existing model-catalog lookup. Do not require
  saved OAuth credentials at install time.
- Document OpenCode ChatGPT Plus/Pro OAuth, plan usage, and separate API
  billing using the official OpenCode and OpenAI billing documentation.

## Risks / Trade-offs

- **Pro usage limits vary by model and task** → document plan usage and use the
  smaller OpenAI tier for bounded work; do not claim unlimited usage.
- **OAuth or catalog availability can change** → validate against the current
  local catalog and keep provider IDs in the single manifest.
- **A profile may omit or mismatch a static command override** → validate
  command frontmatter and every profile provider assignment; retain the
  existing command coverage checks.

## Migration Plan

1. Update the manifest, routing documentation, agent prompts, command
   frontmatter, and README guidance.
2. Add provider restrictions to validation and update profile/routing tests.
3. Validate both profiles, render both outputs, and run the profile and
   acceptance checks.
4. Install only when the operator chooses; normal OpenCode startup will use
   the selected profile after installation.

## References

- [OpenCode providers](https://opencode.ai/docs/providers)
- [OpenAI billing for ChatGPT and API](https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform)
