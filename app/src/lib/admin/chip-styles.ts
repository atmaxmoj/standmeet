// chip-styles —— assembles the Chip's class string.

export type ChipTone = 'neutral' | 'private';

const TONE_CLS: Record<ChipTone, string> = {
  neutral: 'text-(--color-muted) border-(--color-rule)',
  private: 'text-(--color-accent) border-(--color-accent)/50',
};

const ACTIVE_CLS = 'bg-(--color-ink) text-(--color-paper) border-(--color-ink)';
const BASE =
  'inline-flex items-baseline gap-1 px-2 py-0.5 border rounded-sm ' +
  'mono text-[10px] tracking-[0.04em] lowercase leading-[1.4]';

export function resolveChipClass(
  tone: ChipTone = 'neutral', active = false, clickable = false,
): string {
  const tint = active ? ACTIVE_CLS : TONE_CLS[tone];
  const hover = clickable ? ' cursor-pointer hover:border-(--color-ink) transition-colors' : '';
  return `${BASE} ${tint}${hover}`;
}
