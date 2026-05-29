// format.ts —— pure presentation-side formatters shared by ResumePage.
// Kept out of the .tsx so the eslint "no if in presentation" rule
// applies only to component bodies.

const MONTH_ABBREV = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export function stripScheme(s: string): string {
  return s.replace(/^https?:\/\//, '');
}

export function formatPeriod(p: { start: string; end?: string | null }): string {
  const start = ymToShort(p.start);
  return p.end ? `${start} – ${ymToShort(p.end)}` : `${start} – Present`;
}

export function ymToShort(s: string): string {
  const ok = s.length >= 7 && s[4] === '-';
  if (!ok) return s;
  const m = Number(s.slice(5, 7));
  const valid = m >= 1 && m <= MONTH_ABBREV.length;
  if (!valid) return s;
  return `${MONTH_ABBREV[m - 1]} ${s.slice(0, 4)}`;
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function longDate(): string {
  return new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}
