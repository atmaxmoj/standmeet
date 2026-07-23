// code-ghost —— F-A-10 code-override 3 态开关(inherit/on/off)与 wire 值(null/true/false)的映射。
// 从 CodeCard 抽出:presentation 层禁 `if`,纯映射逻辑归 lib。

// ghostToSelect —— wire 值 → select value。null/undefined = 继承 role。
export function ghostToSelect(v: boolean | null | undefined): string {
  if (v === true) return 'on';
  if (v === false) return 'off';
  return 'inherit';
}

// ghostFromSelect —— select value → wire 值。'inherit' = null(清覆盖,回落 role)。
export function ghostFromSelect(v: string): boolean | null {
  if (v === 'on') return true;
  if (v === 'off') return false;
  return null;
}
