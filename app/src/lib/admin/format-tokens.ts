// format-tokens —— reads the token count by order of magnitude: 1234567 → "1.2M".
//
// The fuel gauge answers "how much longer can we talk", not "exactly how many
// tokens"; the ones digit changes with every reply, so reading it is pointless.

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
