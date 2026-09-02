// danger-action —— the **single** shared style for destructive inline actions (delete / discard).
//
// UX-32: on the raw row, the hover state of all three actions (promote / edit / delete)
// converged on the same `--color-accent` (measured as `rgb(181, 57, 28)` in every case), so
// "promote to wiki", "edit", and "permanently delete" gave identical feedback the instant the
// mouse settled — and hover is the last chance to tell them apart before a click. The resting
// state was worse: delete used `--color-faint`, the palest of the three, so the least reversible
// action was the least visible at rest, and unrecognizable on hover.
//
// Two design decisions live here — don't let them scatter again:
//   - Resting state uses `--color-muted`, not `--color-faint` — a destructive action should be
//     **plain**, not **hidden**. Hidden plus indistinguishable-on-hover from a safe action is the
//     worst combination: by the time you notice it, you're already hovering over it.
//   - Hover state does not borrow the brand accent color. Vermillion is this product's **identity**
//     (the LIVE dot, the AI label, the sidebar counters); having it also mean "danger" makes the
//     color say nothing. Use full-strength ink + underline instead: weight + underline reads as
//     "this is a commitment", without adding a new hue to this already-tight palette.
//
// Pull any new delete/discard action from here, so the next one doesn't grow up looking safe.
export const DANGER_ACTION_CLASS =
  'mono text-[10px] tracking-[0.12em] uppercase text-(--color-muted) '
  + 'hover:text-(--color-ink) hover:underline underline-offset-2 disabled:opacity-40';
