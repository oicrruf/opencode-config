# Motion and Polish

Motion is craft. It is also where defaults live — every project
ends up with `transition: all 200ms ease` if you let it.

## Motion vocabulary

Pick a small vocabulary — fast, normal, slow; in, out, spring — and
bind each to a token. Use the same token for the same intent. The
right number is the same number repeated.

## What to animate

- State transitions (hover, focus, active).
- Layout changes (list reorders, expand/collapse).
- Route changes — a quick crossfade is enough; a parallax
  spectacle is wrong.

## What not to animate

- Initial render of the entire page.
- Loading text ("Loading..." that pulses).
- Decorative motion that does not communicate state.

## Easings

- `ease-out` for things appearing (decelerate into place).
- `ease-in` for things leaving (accelerate out of place).
- `ease-in-out` for state changes that the user initiated.

## Performance

Animate `transform` and `opacity`. Layout properties (`width`,
`height`, `top`, `left`) trigger layout and paint. Use
`will-change` only when you can prove you need it.
