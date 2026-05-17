// PlaceholderSection —— M8 minimum 没填充的 section 暂用此占位。
// 后续 milestone 把每个 section 替换成真实组件。

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
