// code-ghost —— F-A-10 mapping between the code-override 3-state switch
// (inherit/on/off) and the wire value (null/true/false).
// Pulled out of CodeCard: the presentation layer bans `if`, so pure mapping
// logic goes in lib.

// ghostToSelect —— wire value → select value. null/undefined = inherit the role.
export function ghostToSelect(v: boolean | null | undefined): string {
  if (v === true) return 'on';
  if (v === false) return 'off';
  return 'inherit';
}

// ghostFromSelect —— select value → wire value. 'inherit' = null (clears the override, falls back to the role).
export function ghostFromSelect(v: string): boolean | null {
  if (v === 'on') return true;
  if (v === 'off') return false;
  return null;
}
