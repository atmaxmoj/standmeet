// StubSection —— design 已经画但 product 还没 land 的 section 用这个占位。
// owner 进去看到 "coming soon" + design intent + 接 Claude 用 MCP 替代
// 的 hint。比 404 友好。

'use client';

import { SectionHeader } from '@/components/admin/SectionHeader';

interface Props {
  kicker: string;
  title: string;
  intent: string;
  mcpHint?: string;
}

export function StubSection(props: Props) {
  return (
    <>
      <SectionHeader kicker={props.kicker} title={props.title} count="coming soon" />
      <div className="border border-(--color-rule) rounded-[3px] bg-(--color-surface)/40 p-6 max-w-[54em]">
        <p className="font-serif text-(--color-ink) text-[18px] leading-[1.5]">
          {props.intent}
        </p>
        {props.mcpHint && (
          <p className="reading text-(--color-muted) text-[14px] mt-3">
            For now: {props.mcpHint}
          </p>
        )}
      </div>
    </>
  );
}
