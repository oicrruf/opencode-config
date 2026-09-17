# Token Architecture

Every color, spacing, depth, and typography choice traces to a small
set of primitives. The architecture beneath every craft decision.

## Token names

Token names feel like implementation detail, but they evoke a world.
`--ink` and `--parchment` evoke a world; `--gray-700` and `--surface-2`
evoke a template. Someone reading only your tokens should guess what
product this is.

## Color primitives

- **foreground** — text, icons, the things the user reads.
- **background** — surface, the canvas.
- **border** — separation.
- **brand** — the accent that signals "this product".
- **semantic** — destructive / warning / success / info.

No random hex — everything maps to primitives. The primitives are
the only place a hex literal appears.

## Spacing scale

Pick a base unit (4 or 8px), use multiples only. Scale by context:
micro (icon gaps), component (within buttons/cards), section
(between groups), major (between areas). Random values signal no
system.

## Depth

Pick a depth vocabulary — surface, raised, modal, popover — and bind
each to a primitive token. Avoid the temptation to scatter `box-shadow:
0 1px 3px rgba(0,0,0,0.1)` everywhere; that is shadow-as-noise.

## Control tokens

Inputs/selects/checkboxes get dedicated background, border, and
focus tokens — don't reuse surface tokens, so you can tune controls
independently. Native `<select>` / `<input type="date">` can't be
styled — compose a headless primitive instead of hand-rolling one.

## Style order

System → component → token → utility. Bind to semantic tokens, not
hardcoded literals. `bg-card border-border text-muted-foreground`,
not `bg-white border-gray-200 text-gray-500`. Hardcoded `gray-200` /
`#fff` / `px-4` raw values break theming and dark mode and signal
no system.
