// format-tokens —— token 数按量级读:1234567 → "1.2M"。
//
// 油量是"还能聊多久"的问题,不是精确到个位的问题;而个位数字每答一句就变一次,读它没有意义。

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
