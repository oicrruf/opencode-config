---
name: interface-design
description: Craft-first interface design for dashboards, admin panels, SaaS apps, tools, settings pages, data interfaces, and interactive products. Use when designing, building, reviewing, auditing, or refining product UI where visual craft, layout hierarchy, tokens, states, visual direction, or design-system consistency matter. Not for marketing pages, landing pages, campaigns, or brand-only work.
---

# Interface Design

Build product interfaces with the craft of a top design team — Linear,
Vercel, Stripe, Apple. The difference between those and generic output
is not talent. It is that every decision was _decided_, the hierarchy
is unmistakable, and a hundred small details are correct at once. This
skill is how you get there.

## Scope

**Use for:** Dashboards, admin panels, SaaS apps, tools, settings pages,
data interfaces.

**Not for:** Landing pages, marketing sites, campaigns, brand-only work.

## References (load only the branch you need)

| File                                 | Branch / when to load                                       |
|--------------------------------------|-------------------------------------------------------------|
| `references/intent-and-domain.md`     | Before proposing a direction (intent, domain, signature).   |
| `references/render-it-when-you-can.md`| When the session exposes an inline renderer tool.          |
| `references/hierarchy-composition.md`| When laying out a screen (focal points, density, grouping). |
| `references/token-architecture.md`    | When naming tokens, picking colors, or building a system.   |
| `references/components-states.md`    | When styling controls, forms, or state machines.            |
| `references/motion-and-polish.md`    | When adding transitions, micro-interactions, or empty states.|

Each reference is self-contained: open the file only when its branch
fires. The router file (this `SKILL.md`) stays in the always-loaded
context; the references disclose on demand.

## Load the minimum

For most design tasks: read `intent-and-domain.md` once, then jump to
the branch the work needs (`hierarchy-composition.md` for layout,
`token-architecture.md` for naming, `components-states.md` for
controls). Skip the rest.

For audit/critique work: read `intent-and-domain.md` and
`hierarchy-composition.md`, then drill into the branch that matches
the failing layer.

## Stop condition

Stop when the proposed direction passes the three checks in
`references/intent-and-domain.md` ("Read your proposal with the
product name removed", "Defaults check", "Signature check"). Once the
direction lands, branch into the relevant reference and stop loading
the rest.
