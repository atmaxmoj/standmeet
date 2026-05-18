// PlaceholderSection —— 还没填充的 section 暂用此占位，后续替换成真实组件。

import { SectionHeader } from './SectionHeader';

type Props = {
  title: string;
  subtitle: string;
  note: string;
};

export function PlaceholderSection({ title, subtitle, note }: Props) {
  return (
    <>
      <SectionHeader title={title} subtitle={subtitle} />
      <p className="reading italic text-(--color-muted)">{note}</p>
    </>
  );
}
