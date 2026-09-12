// Toggle —— an iOS-style on/off switch: a pill track with a knob that slides to the right when on.
// role="switch" + aria-checked so it reads as a toggle to assistive tech and to tests. The visible
// state is the knob position + the track fill (no text). Extracted from BlockPanel's enable
// toggle so the same switch is used everywhere a boolean is flipped in place.

function trackClass(on: boolean, disabled: boolean): string {
  const tint = on
    ? 'bg-(--color-ink) border-(--color-ink)'
    : 'bg-transparent border-(--color-rule)';
  const cursor = disabled ? ' opacity-40 cursor-not-allowed' : ' cursor-pointer';
  return `relative h-5 w-9 shrink-0 rounded-full border transition-colors ${tint}${cursor}`;
}

// The knob sits at left-0.5 when off and slides to left-[18px] when on (a 9-wide track, 3.5-wide knob).
function knobClass(on: boolean): string {
  const pos = on ? 'left-[18px] bg-(--color-paper)' : 'left-0.5 bg-(--color-muted)';
  return `absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all ${pos}`;
}

export function Toggle({ on, onToggle, label, testid, disabled = false }: {
  on: boolean;
  onToggle: () => void;
  label: string;      // the accessible name (the switch has no visible text)
  testid?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      data-testid={testid}
      onClick={onToggle}
      className={trackClass(on, disabled)}
    >
      <span className={knobClass(on)} />
    </button>
  );
}
